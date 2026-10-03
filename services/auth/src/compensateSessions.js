// 存量 session 幂等补偿同步。
//
// 背景：修复前的 user.register / user.login outbox 事件不携带 payload.session，
// 事件被 worker 消费后 D1 sessions 缺少这些 token_hash，导致本地有效 token 在云端
// 账号接口一律 401。本脚本为「现存未过期且尚未被任何事件携带过」的 session 生成
// 全新补偿事件（user.login + payload.session），复用 workers/sync 的
// applyUserLogin + applySession 幂等路径。
//
// 约束：
// - 不修改、不重放任何历史事件的 event_id/payload；补偿事件使用全新 event_id。
// - 只写 SQLite（sessions/sync_outbox/sync_state），不直接访问网络或 D1。
// - 幂等：sync_state 高水位 + 在途事件 token_hash 检查，重复运行不会重复排队。
//
// 用法：
//   node src/compensateSessions.js --dry-run   # 只打印计划，不写入
//   node src/compensateSessions.js             # 写入补偿事件，由 syncWorker 异步投递
import { randomId, nowIso, withTransaction } from './auth.js';
import { openDb, closeDb, resolveDbPath } from './db.js';

const STATE_KEY = 'session_compensated_before';
const DEFAULT_DRY_RUN = false;

function readStateValue(db, key) {
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
  return row ? String(row.value || '') : '';
}

function writeStateValue(db, key, value) {
  db.prepare(
    'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value || ''));
}

/** 在途（pending/processing）事件中已携带的 session token_hash 集合。 */
function collectInFlightSessionTokenHashes(db) {
  const rows = db.prepare(
    `SELECT json_extract(payload, '$.session.token_hash') AS token_hash
     FROM sync_outbox
     WHERE status IN ('pending', 'processing')`
  ).all();
  const hashes = new Set();
  for (const row of rows) {
    const tokenHash = String(row?.token_hash || '').trim();
    if (tokenHash) hashes.add(tokenHash);
  }
  return hashes;
}

/**
 * 计划一次补偿：
 * - asOf 之后的 session 不处理（它们由修复后的代码生成，事件本身携带 session）。
 * - compensatedBefore 之前的 session 已被上一轮补偿覆盖，不重复处理。
 * - last_login_at 使用该用户「最新未过期 session 的 created_at」，
 *   保证同一用户多条补偿事件以任意顺序落 D1 时结果一致。
 */
export function planSessionCompensation(db, { asOf = nowIso(), compensatedBefore = '' } = {}) {
  const cutoff = String(compensatedBefore || '').trim();
  const rows = cutoff
    ? db.prepare(
        `SELECT s.token_hash, s.user_id, s.created_at, s.expires_at, u.username
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.expires_at > ? AND s.created_at < ?
         ORDER BY s.user_id ASC, s.created_at ASC`
      ).all(asOf, cutoff)
    : db.prepare(
        `SELECT s.token_hash, s.user_id, s.created_at, s.expires_at, u.username
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.expires_at > ?
         ORDER BY s.user_id ASC, s.created_at ASC`
      ).all(asOf);

  const newestLiveLoginAtByUser = new Map();
  for (const row of rows) {
    const known = newestLiveLoginAtByUser.get(row.user_id);
    if (!known || String(row.created_at) > String(known)) {
      newestLiveLoginAtByUser.set(row.user_id, String(row.created_at));
    }
  }

  const inFlight = collectInFlightSessionTokenHashes(db);
  const planned = [];
  const skippedInFlight = [];
  for (const row of rows) {
    if (inFlight.has(String(row.token_hash))) {
      skippedInFlight.push(String(row.token_hash));
      continue;
    }
    planned.push({
      // 事件 payload 必须沿用 user.login 契约（applyUserLogin 读取 payload.id），
      // 字段名错误会被 worker 以 400 拒绝并进 dead letter。
      id: String(row.user_id),
      username: String(row.username),
      last_login_at: newestLiveLoginAtByUser.get(row.user_id) || String(row.created_at),
      session: {
        token_hash: String(row.token_hash),
        user_id: String(row.user_id),
        created_at: String(row.created_at),
        expires_at: String(row.expires_at),
      },
    });
  }
  return { asOf, planned, skippedInFlight };
}

/**
 * 执行补偿：为每个计划中的 session 入队一个全新 user.login 事件。
 * dry-run 时只返回计划，不写任何表。
 */
export function compensateSessions(db, { dryRun = DEFAULT_DRY_RUN } = {}) {
  const asOf = nowIso();
  const compensatedBefore = readStateValue(db, STATE_KEY);
  const { planned, skippedInFlight } = planSessionCompensation(db, { asOf, compensatedBefore });

  if (!dryRun && planned.length) {
    const insert = db.prepare(
      `INSERT INTO sync_outbox
         (event_id, event_type, payload, status, retry_count, next_attempt_at, created_at)
       VALUES (?, 'user.login', ?, 'pending', 0, ?, ?)`
    );
    withTransaction(db, () => {
      for (const event of planned) {
        insert.run(randomId('evt_cs_'), JSON.stringify(event), nowIso(), nowIso());
      }
    });
    // 高水位只覆盖本轮扫描范围；下一轮只处理 asOf 之后新出现的 session。
    writeStateValue(db, STATE_KEY, asOf);
  }

  return {
    dryRun,
    compensatedBefore,
    asOf,
    plannedCount: planned.length,
    skippedInFlightCount: skippedInFlight.length,
    planned,
  };
}

function printReport(result) {
  const mode = result.dryRun ? '[dry-run] ' : '';
  console.log(`${mode}补偿扫描基准时间: ${result.asOf}`);
  console.log(`${mode}上一轮高水位: ${result.compensatedBefore || '(无)'}`);
  console.log(`${mode}计划新建补偿事件: ${result.plannedCount}`);
  console.log(`${mode}已被在途事件携带而跳过: ${result.skippedInFlightCount}`);
  for (const event of result.planned) {
    console.log(
      `${mode}  user.login ${event.user_id}(${event.username}) session ${event.session.token_hash.slice(0, 12)}… ` +
        `created ${event.session.created_at} expires ${event.session.expires_at}`
    );
  }
}

export function main({ dryRun = DEFAULT_DRY_RUN, dbPath = resolveDbPath() } = {}) {
  const db = openDb(dbPath);
  try {
    const result = compensateSessions(db, { dryRun });
    printReport(result);
    return result;
  } finally {
    closeDb(db);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const dryRun = process.argv.includes('--dry-run');
  main({ dryRun });
}
