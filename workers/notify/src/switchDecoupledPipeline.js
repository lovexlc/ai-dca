import { fetchSwitchCollectorSnapshot } from './switchMarketCollector.js';
import { enqueueTriggerOutbox, loadSwitchSnapshot, saveImmutableSwitchSnapshot } from './notifyReliabilityStorage.js';
import { buildSwitchTriggerNotification, getRunnableSwitchRules, isInTradingSession, normalizeSwitchConfig, switchConfigKey, switchSnapshotKey, switchStateKey } from './switchStrategy.js';

const TABLE = 'notify_user_records';
const CONFIG_PREFIX = 'switch:config:';
const CONFIG_PAGE_SIZE = 40;
const DEFAULT_SWITCH_FUND_CODES = Object.freeze(['513390', '513300', '513110', '513100', '159941', '159696', '159660', '159659', '159632', '159513', '159509', '159501']);
const MAX_DAILY_PUSHES = 3;
function text(value = '', max = 240) { return String(value ?? '').trim().slice(0, max); }
function parse(value, fallback = null) { try { const data = JSON.parse(String(value || '')); return data && typeof data === 'object' ? data : fallback; } catch { return fallback; } }
function fundCodes(env) { const configured = text(env.SWITCH_FUND_CODES, 1000).split(',').map((item) => item.trim()).filter((item) => /^\d{6}$/.test(item)); return Array.from(new Set(configured.length ? configured : DEFAULT_SWITCH_FUND_CODES)).slice(0, 30); }
function shanghaiDate(value = Date.now()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
function pairKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }
function pairDiff(result, from, to) { const row = result.pairsByKey[pairKey(from, to)]; if (!row || !Number.isFinite(row.diffPct)) return null; return row.leftCode === from ? row.diffPct : -row.diffPct; }
function classify(benchClass, candidateClass, gap, sellLower, buyOther) { if (!Number.isFinite(gap) || !['H', 'L'].includes(benchClass) || !['H', 'L'].includes(candidateClass) || benchClass === candidateClass) return 'none'; if (benchClass === 'L' && gap <= sellLower) return 'A'; if (benchClass === 'H' && gap >= buyOther) return 'B'; return 'none'; }
async function upsertUserKv(env, owner, key, value) { const now = new Date().toISOString(); await env.SYNC_DB.prepare(`INSERT INTO ${TABLE} (owner_user_id, record_type, record_id, payload, revision, created_at, updated_at) VALUES (?, 'user-kv', ?, ?, 1, ?, ?) ON CONFLICT(owner_user_id, record_type, record_id) DO UPDATE SET payload=excluded.payload, revision=${TABLE}.revision+1, updated_at=excluded.updated_at`).bind(owner, key, JSON.stringify(value), now, now).run(); }
async function readUserKv(env, owner, key) { const row = await env.SYNC_DB.prepare(`SELECT payload FROM ${TABLE} WHERE owner_user_id=? AND record_type='user-kv' AND record_id=?`).bind(owner, key).first(); return parse(row?.payload, null); }

export async function calculateSwitchMarketDiffs(env, scheduledMs = Date.now()) {
  const codes = fundCodes(env); const collector = await fetchSwitchCollectorSnapshot(env, codes); const computedAt = collector.generatedAt || new Date(scheduledMs).toISOString(); const funds = {};
  for (const code of codes) { const item = collector.funds[code] || {}; funds[code] = { code, name: text(item.name || code, 80), price: Number.isFinite(item.price) ? item.price : null, iopv: Number.isFinite(item.iopv) ? item.iopv : null, premiumPct: item.valid && Number.isFinite(item.premiumPct) ? item.premiumPct : null, asOf: item.asOf || '', expiresAt: item.expiresAt || '', source: item.source || 'market-collector', orderBook: item.orderBook || null, valid: Boolean(item.valid), invalidReasons: item.invalidReasons || [] }; }
  const pairs = []; const pairsByKey = {};
  for (let i = 0; i < codes.length; i += 1) for (let j = i + 1; j < codes.length; j += 1) { const left = funds[codes[i]]; const right = funds[codes[j]]; const valid = left.valid && right.valid && Number.isFinite(left.premiumPct) && Number.isFinite(right.premiumPct); const row = { pairKey: pairKey(left.code, right.code), leftCode: left.code, rightCode: right.code, diffPct: valid ? Number((left.premiumPct - right.premiumPct).toFixed(4)) : null, valid, invalidReasons: valid ? [] : [...(left.invalidReasons || []).map((reason) => `${left.code}:${reason}`), ...(right.invalidReasons || []).map((reason) => `${right.code}:${reason}`)] }; pairs.push(row); pairsByKey[row.pairKey] = row; }
  const result = { computedAt, codes, funds, pairs, pairsByKey, source: 'market-collector', validFundCount: Object.values(funds).filter((item) => item.valid).length };
  result.snapshotId = await saveImmutableSwitchSnapshot(env, result);
  await upsertUserKv(env, 'global', 'switch:market-diffs:latest', { snapshotId: result.snapshotId, computedAt, codes, funds, pairs, source: result.source, validFundCount: result.validFundCount });
  console.log('[notify-switch-market-diffs]', JSON.stringify({ snapshotId: result.snapshotId, computedAt, source: result.source, fundCount: codes.length, validFundCount: result.validFundCount, pairCount: pairs.filter((item) => item.valid).length }));
  return result;
}

async function listEffectiveConfigPage(env, options = {}) {
  const owner = text(options.ownerUserId, 96); const clientId = text(options.clientId, 120); const cursorOwner = text(options.cursorOwner, 96); const cursorRecord = text(options.cursorRecord, 240); const limit = Math.max(1, Math.min(Number(options.limit) || CONFIG_PAGE_SIZE, 100));
  let sql = `SELECT owner_user_id, record_id, payload FROM ${TABLE} WHERE record_type='user-kv' AND record_id LIKE ?`; const params = [`${CONFIG_PREFIX}account:%`];
  if (owner) { sql += ` AND owner_user_id=?`; params.push(owner); }
  if (clientId) { sql += ` AND record_id=?`; params.push(switchConfigKey(clientId)); }
  if (cursorOwner) { sql += ` AND (owner_user_id > ? OR (owner_user_id = ? AND record_id > ?))`; params.push(cursorOwner, cursorOwner, cursorRecord); }
  sql += ` ORDER BY owner_user_id, record_id LIMIT ?`; params.push(limit + 1);
  const result = await env.SYNC_DB.prepare(sql).bind(...params).all(); const rows = result?.results || []; const hasMore = rows.length > limit; const page = rows.slice(0, limit);
  const configs = page.map((row) => ({ ownerUserId: text(row.owner_user_id, 96), clientId: text(row.record_id).slice(CONFIG_PREFIX.length), config: normalizeSwitchConfig(parse(row.payload, {})) })).filter((item) => item.ownerUserId && item.clientId && (options.force || item.config.enabled) && getRunnableSwitchRules(options.force ? { ...item.config, enabled: true } : item.config).length);
  const last = page[page.length - 1]; return { configs, nextCursor: hasMore && last ? { ownerUserId: text(last.owner_user_id, 96), recordId: text(last.record_id, 240) } : null };
}

function buildRuleSnapshot(rule, market) {
  const pool = Array.from(new Set([...(rule.benchmarkCodes || []), ...(rule.enabledCodes || [])])); const byBenchmark = [];
  for (const benchmarkCode of rule.benchmarkCodes || []) { const bench = market.funds[benchmarkCode]; const candidates = pool.filter((code) => code !== benchmarkCode).map((code) => { const item = market.funds[code]; return { code, name: item?.name || code, price: item?.price ?? null, nav: item?.iopv ?? null, navDate: item?.asOf || '', premiumPct: item?.premiumPct ?? null, orderBook: item?.orderBook || null, spreadVsBenchmarkPct: pairDiff(market, benchmarkCode, code), candClass: rule.premiumClass?.[code] || null, valid: Boolean(item?.valid) }; }); byBenchmark.push({ benchmarkCode, benchmarkName: bench?.name || benchmarkCode, benchmarkClass: rule.premiumClass?.[benchmarkCode] || null, benchmarkPrice: bench?.price ?? null, benchmarkNav: bench?.iopv ?? null, benchmarkNavDate: bench?.asOf || '', benchmarkPremiumPct: bench?.premiumPct ?? null, benchmarkOrderBook: bench?.orderBook || null, valid: Boolean(bench?.valid), candidates }); }
  return { snapshotId: market.snapshotId, computedAt: market.computedAt, source: market.source, ruleId: rule.id, ruleName: rule.name, premiumClass: rule.premiumClass || {}, intraSellLowerPct: Number(rule.intraSellLowerPct), intraBuyOtherPct: Number(rule.intraBuyOtherPct), byBenchmark, signals: [], triggers: [], ready: byBenchmark.some((group) => group.valid && group.candidates.some((item) => item.valid && Number.isFinite(item.spreadVsBenchmarkPct))) };
}

async function evaluateConfig(env, entry, market, force = false) {
  const previous = (await readUserKv(env, entry.ownerUserId, switchStateKey(entry.clientId))) || {}; const priorByRule = previous.triggerStatesByRule || {}; const nextByRule = {}; const ruleSnapshots = []; const queued = []; const date = shanghaiDate(market.computedAt);
  for (const rule of getRunnableSwitchRules(force ? { ...entry.config, enabled: true } : entry.config, { forceEnabled: force })) {
    const snapshot = buildRuleSnapshot(rule, market); const prior = priorByRule[rule.id] || {}; const next = { ...prior };
    for (const group of snapshot.byBenchmark) { const benchClass = rule.premiumClass?.[group.benchmarkCode]; for (const candidate of group.candidates) { const candidateClass = rule.premiumClass?.[candidate.code]; const rawDiff = candidate.spreadVsBenchmarkPct; if (!group.valid || !candidate.valid || !Number.isFinite(rawDiff)) continue; const gap = benchClass === 'H' ? rawDiff : benchClass === 'L' ? -rawDiff : NaN; const kind = classify(benchClass, candidateClass, gap, Number(rule.intraSellLowerPct), Number(rule.intraBuyOtherPct)); const key = `${group.benchmarkCode}:${candidate.code}`; const old = prior[key] || {}; const priorCount = old.lastTriggeredDate === date && old.lastTriggeredRule === kind ? Number(old.dailyTriggerCount) || 0 : 0; let accepted = false;
      if (kind !== 'none' && priorCount < MAX_DAILY_PUSHES) { const trigger = { pairKey: `${rule.id}:${key}`, rule: kind, ruleId: rule.id, ruleName: rule.name, fromCode: group.benchmarkCode, toCode: candidate.code, fromName: group.benchmarkName, toName: candidate.name, diffPct: gap, gapPct: gap, threshold: kind === 'A' ? Number(rule.intraSellLowerPct) : Number(rule.intraBuyOtherPct), benchClass, candClass: candidateClass }; const notification = buildSwitchTriggerNotification(snapshot, trigger, env); const outbox = await enqueueTriggerOutbox(env, { snapshotId: market.snapshotId, ownerUserId: entry.ownerUserId, clientId: entry.clientId, notification }); accepted = outbox.inserted; if (accepted) { queued.push(trigger); snapshot.triggers.push(trigger); } }
      next[key] = { rule: kind, fromCode: group.benchmarkCode, lastTriggeredDate: accepted ? date : text(old.lastTriggeredDate, 20), lastTriggeredRule: accepted ? kind : text(old.lastTriggeredRule, 20), dailyTriggerCount: accepted ? priorCount + 1 : priorCount, lastDiffPct: rawDiff, lastGapPct: Number.isFinite(gap) ? gap : null, updatedAt: market.computedAt, snapshotId: market.snapshotId, source: market.source };
    } }
    nextByRule[rule.id] = next; ruleSnapshots.push(snapshot);
  }
  const accountSnapshot = { snapshotId: market.snapshotId, computedAt: market.computedAt, source: market.source, activeRuleId: entry.config.activeRuleId, ready: ruleSnapshots.some((item) => item.ready), rules: ruleSnapshots.map((item) => ({ ruleId: item.ruleId, ruleName: item.ruleName, ready: item.ready, triggerCount: item.triggers.length, snapshot: item })), triggers: queued };
  await Promise.all([upsertUserKv(env, entry.ownerUserId, switchStateKey(entry.clientId), { triggerStatesByRule: nextByRule, updatedAt: market.computedAt, snapshotId: market.snapshotId, source: market.source }), upsertUserKv(env, entry.ownerUserId, switchSnapshotKey(entry.clientId), accountSnapshot)]);
  return { clientId: entry.clientId, triggered: queued.length, ruleCount: ruleSnapshots.length };
}

export async function processSwitchMatchJob(env, job = {}) {
  const market = await loadSwitchSnapshot(env, job.snapshotId); const page = await listEffectiveConfigPage(env, { ownerUserId: job.ownerUserId, clientId: job.clientId, cursorOwner: job.cursorOwner, cursorRecord: job.cursorRecord, force: Boolean(job.force) }); const results = [];
  for (const entry of page.configs) results.push(await evaluateConfig(env, entry, market, Boolean(job.force)));
  if (page.nextCursor) await env.NOTIFY_JOBS.send({ id: `switch-match:${market.snapshotId}:${page.nextCursor.ownerUserId}:${page.nextCursor.recordId}`, type: 'switch-match', snapshotId: market.snapshotId, cursorOwner: page.nextCursor.ownerUserId, cursorRecord: page.nextCursor.recordId, ownerUserId: job.ownerUserId || '', clientId: job.clientId || '', force: Boolean(job.force), createdAt: new Date().toISOString() });
  console.log('[notify-switch-config-match]', JSON.stringify({ snapshotId: market.snapshotId, computedAt: market.computedAt, configCount: page.configs.length, triggerCount: results.reduce((sum, item) => sum + item.triggered, 0), hasMore: Boolean(page.nextCursor) }));
  return { snapshotId: market.snapshotId, configCount: page.configs.length, triggered: results.reduce((sum, item) => sum + item.triggered, 0), hasMore: Boolean(page.nextCursor) };
}

export async function runDecoupledSwitchPipeline(env, scheduledMs = Date.now(), options = {}) {
  if (!options.force && !isInTradingSession(new Date(scheduledMs))) return { skipped: 'outside-trading-session' };
  if (!env?.NOTIFY_JOBS?.send) throw new Error('NOTIFY_JOBS queue unavailable');
  const market = await calculateSwitchMarketDiffs(env, scheduledMs);
  await env.NOTIFY_JOBS.send({ id: `switch-match:${market.snapshotId}:start`, type: 'switch-match', snapshotId: market.snapshotId, ownerUserId: text(options.ownerUserId, 96), clientId: text(options.clientId, 120), force: Boolean(options.force), createdAt: new Date().toISOString() });
  return { accepted: true, snapshotId: market.snapshotId, computedAt: market.computedAt, source: market.source, fundCount: market.codes.length, validFundCount: market.validFundCount, pairCount: market.pairs.filter((item) => item.valid).length };
}
