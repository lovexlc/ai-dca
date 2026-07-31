import { ensureStateBinding, readJson, writeJson } from './notifyStorage.js';
import { normalizeSwitchConfig, switchConfigKey } from './switchStrategy.js';

export const SWITCH_NOTIFIED_TOTAL_KEY = 'switch:notified:total';
export const SWITCH_NOTIFIED_MARKER_PREFIX = 'switch:notified:';

function encodeKeyPart(value = '') {
  return encodeURIComponent(String(value || '').trim().slice(0, 160));
}

async function listKeys(env, prefix) {
  ensureStateBinding(env);
  const keys = [];
  let cursor;
  do {
    const result = await env.NOTIFY_STATE.list({ prefix, cursor });
    keys.push(...(result.keys || []).map((item) => String(item.name || '')).filter(Boolean));
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return keys;
}

export function switchNotificationMarkerKey(clientId = '', ruleId = '') {
  return `${SWITCH_NOTIFIED_MARKER_PREFIX}${encodeKeyPart(clientId)}:${encodeKeyPart(ruleId)}`;
}

export function normalizeSwitchNotifiedTotal(value) {
  if (value && typeof value === 'object') {
    return Math.max(0, Math.floor(Number(value.total) || 0));
  }
  return Math.max(0, Math.floor(Number(value) || 0));
}

export async function readSwitchNotifiedTotal(env) {
  return normalizeSwitchNotifiedTotal(await readJson(env, SWITCH_NOTIFIED_TOTAL_KEY, 0));
}

export async function countSwitchNotifiedRulesForClients(env, clientIds = []) {
  const normalizedClientIds = Array.from(new Set((Array.isArray(clientIds) ? clientIds : [])
    .map((clientId) => String(clientId || '').trim())
    .filter(Boolean)));
  let count = 0;
  for (const clientId of normalizedClientIds) {
    const prefix = `${SWITCH_NOTIFIED_MARKER_PREFIX}${encodeKeyPart(clientId)}:`;
    count += (await listKeys(env, prefix)).length;
  }
  return count;
}

function compactPublicText(value = '', maxLength = 80) {
  return String(value || '').trim().slice(0, maxLength);
}

function compactPublicCodes(values = [], max = 8) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim().slice(0, 24))
    .filter(Boolean))).slice(0, max);
}

function toPublicSwitchRule(rule = {}, index = 0) {
  return {
    id: `rule-${index + 1}`,
    name: compactPublicText(rule.name || `切换规则 ${index + 1}`, 40),
    enabled: Boolean(rule.enabled),
    ruleType: rule.ruleType === 'market_watch' ? 'market_watch' : 'holding_switch',
    benchmarkCodes: compactPublicCodes(rule.benchmarkCodes || (rule.holdingFundCode ? [rule.holdingFundCode] : []), 4),
    candidateFundCodes: compactPublicCodes(rule.enabledCodes || rule.candidateFundCodes, 8),
    holdingFundCode: compactPublicText(rule.holdingFundCode, 24),
    holdingFundName: compactPublicText(rule.holdingFundName, 80),
    thresholdMode: rule.thresholdMode === 'fixed' ? 'fixed' : 'backtest'
  };
}

/**
 * Return anonymized, account-associated strategy collections for the public backtest page.
 * Anonymous device records are deliberately excluded. Quantities, notional values,
 * client IDs, secrets and account names never leave this worker.
 */
export async function listPublicSwitchStrategyCollections(env, { limit = 12 } = {}) {
  ensureStateBinding(env);
  const settings = await readJson(env, 'notify:settings', {});
  const clients = settings && typeof settings.clients === 'object' ? settings.clients : {};
  const grouped = new Map();

  await Promise.all(Object.entries(clients).map(async ([storedClientId, client]) => {
    const accountUsername = String(client?.accountUsername || '').trim().toLowerCase();
    const clientId = String(client?.clientId || storedClientId || '').trim();
    if (!accountUsername || !clientId) return;
    const stored = await readJson(env, switchConfigKey(clientId), null);
    const config = stored ? normalizeSwitchConfig(stored) : null;
    if (!config?.rules?.length) return;

    const collection = grouped.get(accountUsername) || {
      rules: [],
      latestUpdatedAt: ''
    };
    collection.rules.push(...config.rules);
    const updatedAt = String(stored?.updatedAt || config.updatedAt || '').trim();
    if (Date.parse(updatedAt) > Date.parse(collection.latestUpdatedAt || '')) {
      collection.latestUpdatedAt = updatedAt;
    }
    grouped.set(accountUsername, collection);
  }));

  const maxCollections = Math.max(1, Math.min(50, Number(limit) || 12));
  return Array.from(grouped.values())
    .filter((collection) => collection.rules.length > 0)
    .sort((left, right) => {
      const countDiff = right.rules.length - left.rules.length;
      if (countDiff) return countDiff;
      return Date.parse(right.latestUpdatedAt || '') - Date.parse(left.latestUpdatedAt || '');
    })
    .slice(0, maxCollections)
    .map((collection, index) => {
      const rules = collection.rules.slice(0, 8).map((rule, ruleIndex) => toPublicSwitchRule(rule, ruleIndex));
      return {
        id: `collection-${index + 1}`,
        title: `用户策略合集 ${String(index + 1).padStart(2, '0')}`,
        strategyCount: collection.rules.length,
        rules
      };
    });
}

/**
 * Count a switch rule the first time one of its notifications is confirmed as delivered.
 * KV has no transaction primitive, so the marker is written before the counter update;
 * repeated deliveries remain idempotent even if the notification loop sees the rule again.
 */
export async function recordSwitchNotificationDelivery(
  env,
  { clientId = '', ruleId = '', deliveredAt = new Date().toISOString() } = {}
) {
  ensureStateBinding(env);
  const normalizedClientId = String(clientId || '').trim();
  const normalizedRuleId = String(ruleId || '').trim();
  if (!normalizedClientId || !normalizedRuleId) {
    return { counted: false, total: await readSwitchNotifiedTotal(env) };
  }

  const markerKey = switchNotificationMarkerKey(normalizedClientId, normalizedRuleId);
  if (await env.NOTIFY_STATE.get(markerKey)) {
    return { counted: false, total: await readSwitchNotifiedTotal(env) };
  }

  await writeJson(env, markerKey, {
    clientId: normalizedClientId,
    ruleId: normalizedRuleId,
    firstDeliveredAt: String(deliveredAt || new Date().toISOString())
  });

  const total = (await readSwitchNotifiedTotal(env)) + 1;
  await writeJson(env, SWITCH_NOTIFIED_TOTAL_KEY, total);
  return { counted: true, total };
}
