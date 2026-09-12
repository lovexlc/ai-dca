import { fetchSwitchCollectorSnapshot } from './switchMarketCollector.js';
import { buildSwitchTriggerNotification, getRunnableSwitchRules, isInTradingSession, normalizeSwitchConfig, switchConfigKey, switchSnapshotKey, switchStateKey } from './switchStrategy.js';

const TABLE = 'notify_user_records';
const CONFIG_PREFIX = 'switch:config:';
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
  const codes = fundCodes(env);
  const collector = await fetchSwitchCollectorSnapshot(env, codes);
  const computedAt = collector.generatedAt || new Date(scheduledMs).toISOString();
  const funds = {};
  for (const code of codes) {
    const item = collector.funds[code] || {};
    funds[code] = {
      code,
      name: text(item.name || code, 80),
      price: Number.isFinite(item.price) ? item.price : null,
      iopv: Number.isFinite(item.iopv) ? item.iopv : null,
      premiumPct: item.valid && Number.isFinite(item.premiumPct) ? item.premiumPct : null,
      asOf: item.asOf || '',
      expiresAt: item.expiresAt || '',
      source: item.source || 'market-collector',
      orderBook: item.orderBook || null,
      valid: Boolean(item.valid),
      invalidReasons: item.invalidReasons || []
    };
  }
  const pairs = [];
  const pairsByKey = {};
  for (let i = 0; i < codes.length; i += 1) {
    for (let j = i + 1; j < codes.length; j += 1) {
      const left = funds[codes[i]];
      const right = funds[codes[j]];
      const valid = left.valid && right.valid && Number.isFinite(left.premiumPct) && Number.isFinite(right.premiumPct);
      const row = { pairKey: pairKey(left.code, right.code), leftCode: left.code, rightCode: right.code, diffPct: valid ? Number((left.premiumPct - right.premiumPct).toFixed(4)) : null, valid, invalidReasons: valid ? [] : [...(left.invalidReasons || []).map((reason) => `${left.code}:${reason}`), ...(right.invalidReasons || []).map((reason) => `${right.code}:${reason}`)] };
      pairs.push(row);
      pairsByKey[row.pairKey] = row;
    }
  }
  const result = { computedAt, codes, funds, pairs, pairsByKey, source: 'market-collector', validFundCount: Object.values(funds).filter((item) => item.valid).length };
  await upsertUserKv(env, 'global', 'switch:market-diffs:latest', { computedAt, codes, funds, pairs, source: result.source, validFundCount: result.validFundCount });
  console.log('[notify-switch-market-diffs]', JSON.stringify({ computedAt, source: result.source, fundCount: codes.length, validFundCount: result.validFundCount, pairCount: pairs.filter((item) => item.valid).length }));
  return result;
}

async function listEffectiveConfigs(env, onlyOwner = '', onlyClientId = '', force = false) {
  if (onlyOwner && onlyClientId) {
    const config = await readUserKv(env, onlyOwner, switchConfigKey(onlyClientId));
    return config ? [{ ownerUserId: onlyOwner, clientId: onlyClientId, config: normalizeSwitchConfig(force ? { ...config, enabled: true } : config) }] : [];
  }
  const rows = await env.SYNC_DB.prepare(`SELECT owner_user_id, record_id, payload FROM ${TABLE} WHERE record_type='user-kv' AND record_id LIKE ? ORDER BY owner_user_id`).bind(`${CONFIG_PREFIX}account:%`).all();
  return (rows?.results || []).map((row) => ({ ownerUserId: text(row.owner_user_id, 96), clientId: text(row.record_id).slice(CONFIG_PREFIX.length), config: normalizeSwitchConfig(parse(row.payload, {})) })).filter((item) => item.ownerUserId && item.clientId && item.config.enabled && getRunnableSwitchRules(item.config).length);
}

function buildRuleSnapshot(rule, market) {
  const pool = Array.from(new Set([...(rule.benchmarkCodes || []), ...(rule.enabledCodes || [])]));
  const byBenchmark = [];
  for (const benchmarkCode of rule.benchmarkCodes || []) {
    const bench = market.funds[benchmarkCode];
    const candidates = pool.filter((code) => code !== benchmarkCode).map((code) => {
      const item = market.funds[code];
      return { code, name: item?.name || code, price: item?.price ?? null, nav: item?.iopv ?? null, navDate: item?.asOf || '', premiumPct: item?.premiumPct ?? null, orderBook: item?.orderBook || null, spreadVsBenchmarkPct: pairDiff(market, benchmarkCode, code), candClass: rule.premiumClass?.[code] || null, valid: Boolean(item?.valid) };
    });
    byBenchmark.push({ benchmarkCode, benchmarkName: bench?.name || benchmarkCode, benchmarkClass: rule.premiumClass?.[benchmarkCode] || null, benchmarkPrice: bench?.price ?? null, benchmarkNav: bench?.iopv ?? null, benchmarkNavDate: bench?.asOf || '', benchmarkPremiumPct: bench?.premiumPct ?? null, benchmarkOrderBook: bench?.orderBook || null, valid: Boolean(bench?.valid), candidates });
  }
  return { computedAt: market.computedAt, source: market.source, ruleId: rule.id, ruleName: rule.name, premiumClass: rule.premiumClass || {}, intraSellLowerPct: Number(rule.intraSellLowerPct), intraBuyOtherPct: Number(rule.intraBuyOtherPct), byBenchmark, signals: [], triggers: [], ready: byBenchmark.some((group) => group.valid && group.candidates.some((item) => item.valid && Number.isFinite(item.spreadVsBenchmarkPct))) };
}

async function evaluateConfig(env, entry, market) {
  const previous = (await readUserKv(env, entry.ownerUserId, switchStateKey(entry.clientId))) || {};
  const priorByRule = previous.triggerStatesByRule || {};
  const nextByRule = {};
  const ruleSnapshots = [];
  const queued = [];
  const date = shanghaiDate(market.computedAt);
  for (const rule of getRunnableSwitchRules(entry.config)) {
    const snapshot = buildRuleSnapshot(rule, market);
    const prior = priorByRule[rule.id] || {};
    const next = { ...prior };
    for (const group of snapshot.byBenchmark) {
      const benchClass = rule.premiumClass?.[group.benchmarkCode];
      for (const candidate of group.candidates) {
        const candidateClass = rule.premiumClass?.[candidate.code];
        const rawDiff = candidate.spreadVsBenchmarkPct;
        if (!group.valid || !candidate.valid || !Number.isFinite(rawDiff)) continue;
        const gap = benchClass === 'H' ? rawDiff : benchClass === 'L' ? -rawDiff : NaN;
        const kind = classify(benchClass, candidateClass, gap, Number(rule.intraSellLowerPct), Number(rule.intraBuyOtherPct));
        const key = `${group.benchmarkCode}:${candidate.code}`;
        const old = prior[key] || {};
        const priorCount = old.lastTriggeredDate === date && old.lastTriggeredRule === kind ? Number(old.dailyTriggerCount) || 0 : 0;
        const trigger = kind !== 'none' && priorCount < MAX_DAILY_PUSHES ? { pairKey: `${rule.id}:${key}`, rule: kind, ruleId: rule.id, ruleName: rule.name, fromCode: group.benchmarkCode, toCode: candidate.code, fromName: group.benchmarkName, toName: candidate.name, diffPct: gap, gapPct: gap, threshold: kind === 'A' ? Number(rule.intraSellLowerPct) : Number(rule.intraBuyOtherPct), benchClass, candClass: candidateClass } : null;
        if (trigger) {
          const notification = buildSwitchTriggerNotification(snapshot, trigger, env);
          await env.NOTIFY_JOBS.send({ id: `notify-switch:${notification.eventId}`, type: 'notify-deliver', ownerUserId: entry.ownerUserId, clientId: entry.clientId, notification, createdAt: new Date().toISOString() });
          queued.push(trigger);
          snapshot.triggers.push(trigger);
        }
        next[key] = { rule: kind, fromCode: group.benchmarkCode, lastTriggeredDate: trigger ? date : text(old.lastTriggeredDate, 20), lastTriggeredRule: trigger ? kind : text(old.lastTriggeredRule, 20), dailyTriggerCount: trigger ? priorCount + 1 : priorCount, lastDiffPct: rawDiff, lastGapPct: Number.isFinite(gap) ? gap : null, updatedAt: market.computedAt, source: market.source };
      }
    }
    nextByRule[rule.id] = next;
    ruleSnapshots.push(snapshot);
  }
  const snapshot = { computedAt: market.computedAt, source: market.source, activeRuleId: entry.config.activeRuleId, ready: ruleSnapshots.some((item) => item.ready), rules: ruleSnapshots.map((item) => ({ ruleId: item.ruleId, ruleName: item.ruleName, ready: item.ready, triggerCount: item.triggers.length, snapshot: item })), triggers: queued };
  await Promise.all([upsertUserKv(env, entry.ownerUserId, switchStateKey(entry.clientId), { triggerStatesByRule: nextByRule, updatedAt: market.computedAt, source: market.source }), upsertUserKv(env, entry.ownerUserId, switchSnapshotKey(entry.clientId), snapshot)]);
  return { clientId: entry.clientId, triggered: queued.length, ruleCount: ruleSnapshots.length };
}

export async function matchSwitchConfigsAndQueue(env, market, options = {}) {
  const configs = await listEffectiveConfigs(env, options.ownerUserId || '', options.clientId || '', Boolean(options.force));
  const results = [];
  for (const entry of configs) results.push(await evaluateConfig(env, entry, market));
  console.log('[notify-switch-config-match]', JSON.stringify({ computedAt: market.computedAt, source: market.source, configCount: configs.length, triggerCount: results.reduce((sum, item) => sum + item.triggered, 0) }));
  return results;
}

export async function runDecoupledSwitchPipeline(env, scheduledMs = Date.now(), options = {}) {
  if (!options.force && !isInTradingSession(new Date(scheduledMs))) return { skipped: 'outside-trading-session' };
  if (!env?.NOTIFY_JOBS?.send) throw new Error('NOTIFY_JOBS queue unavailable');
  const market = await calculateSwitchMarketDiffs(env, scheduledMs);
  const results = await matchSwitchConfigsAndQueue(env, market, options);
  return { computedAt: market.computedAt, source: market.source, fundCount: market.codes.length, validFundCount: market.validFundCount, pairCount: market.pairs.filter((item) => item.valid).length, configCount: results.length, triggered: results.reduce((sum, item) => sum + item.triggered, 0), results };
}
