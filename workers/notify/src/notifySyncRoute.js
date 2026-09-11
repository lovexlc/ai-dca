import { evaluatePositionDigest, evaluateSellPlanSignals, evaluateVixSignal } from './evaluator.js';
import { compileNotifyRules, normalizeNotifyPayload } from './rules.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import { readJson, readSettings, writeJson, writeSettings } from './notifyStorage.js';
import {
  buildScopedNotifySettings,
  ensureAuthenticatedClient,
  normalizeClientName,
  upsertClientRecord
} from './clientSettings.js';
import { getClientRecentEvents } from './clientEventState.js';

function splitMarketAlertsByVenue(alerts = []) {
  return (Array.isArray(alerts) ? alerts : []).reduce((groups, alert) => {
    const kind = String(alert?.fundKind || alert?.kind || '').trim().toLowerCase();
    groups[kind === 'otc' || kind === 'qdii' ? 'otc' : 'exchange'].push(alert);
    return groups;
  }, { exchange: [], otc: [] });
}

function evaluateSyncedSignals(env, rawPayload, settings, clientId) {
  const options = (key) => ({
    clientId,
    settings,
    readState: () => readJson(env, key, null),
    writeState: (value) => writeJson(env, key, value)
  });
  env.__notifySettings = buildScopedNotifySettings(settings, clientId);
  env.__notifyCurrentClientId = clientId;
  return Promise.allSettled([
    evaluateVixSignal(env, rawPayload?.vix, options(`vix-state:${clientId}`)),
    evaluateSellPlanSignals(env, rawPayload?.sellPlans, options(`sell-plan-state:${clientId}`)),
    evaluatePositionDigest(env, rawPayload?.positionDigest, options(`position-state:${clientId}`))
  ]).then((results) => {
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error('[notify] deferred sync evaluation failed', JSON.stringify({
          evaluator: ['vix', 'sell', 'position'][index],
          message: result.reason instanceof Error ? result.reason.message : String(result.reason)
        }));
      }
    });
  });
}

export async function handleFastSync(request, env, ctx) {
  const origin = readOrigin(request);
  const rawPayload = await request.json().catch(() => ({}));
  const payload = normalizeNotifyPayload(rawPayload);
  const compiled = compileNotifyRules(payload);
  const currentClientLabel = normalizeClientName(rawPayload?.clientLabel || rawPayload?.notifyClientLabel || '');
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    clientLabel: currentClientLabel,
    accountUsername: rawPayload?.accountUsername || ''
  });
  settings = auth.settings;
  const currentClientId = auth.clientId;
  const existingClient = auth.clientRecord;
  const allowedRuleIds = new Set(compiled.allRules.map((rule) => rule.ruleId));
  allowedRuleIds.add(`${currentClientId}:market-alerts:exchange`);
  allowedRuleIds.add(`${currentClientId}:market-alerts:otc`);
  allowedRuleIds.add(`${currentClientId}:holding-alerts`);
  const ruleStates = Object.entries(existingClient?.state?.ruleStates || {}).reduce((map, [ruleId, state]) => {
    if (allowedRuleIds.has(ruleId)) map[ruleId] = state;
    return map;
  }, {});
  const nextSettings = upsertClientRecord(settings, currentClientId, {
    clientLabel: existingClient.clientLabel || `账号通知 · ${auth.accountUsername || ''}`,
    accountUsername: auth.accountUsername || existingClient.accountUsername,
    ownerUserId: auth.ownerUserId || existingClient.ownerUserId,
    payload,
    state: {
      ...existingClient.state,
      ruleStates,
      recentEvents: getClientRecentEvents(existingClient)
    },
    meta: {
      ...existingClient.meta,
      counts: compiled.summary,
      lastSyncedAt: payload.syncedAt
    }
  });
  await writeSettings(env, nextSettings);
  const alerts = splitMarketAlertsByVenue(payload.marketAlerts);
  await Promise.all([
    writeJson(env, `notify:market-alerts:${currentClientId}:exchange`, alerts.exchange),
    writeJson(env, `notify:market-alerts:${currentClientId}:otc`, alerts.otc)
  ]);

  const background = evaluateSyncedSignals(env, rawPayload, nextSettings, currentClientId);
  if (ctx?.waitUntil) ctx.waitUntil(background);
  else background.catch(() => {});

  return jsonResponse({
    ok: true,
    accepted: true,
    evaluationsDeferred: true,
    clientId: auth.deviceClientId || currentClientId,
    accountClientId: currentClientId,
    counts: compiled.summary,
    lastSyncedAt: payload.syncedAt
  }, { origin });
}
