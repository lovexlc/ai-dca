import { runNotificationCycle } from './evaluator.js';
import {
  readAccountSettings,
  readSettings,
  writeAccountSettings,
  writeSettings
} from './notifyStorage.js';
import { compileNotifyRules } from './rules.js';
import {
  appendClientRunSummary,
  buildEmptyRunSummary
} from './clientEventState.js';
import {
  buildScopedNotifySettings,
  getClientRecord,
  normalizeClientId,
  normalizeNotifyAccountSettings,
  normalizeNotifyAccountUsername,
  resolveNotifyClientAccountUsername,
  upsertClientRecord
} from './clientSettings.js';

function applyAccountSettingsRemovals(accountSettings, removals = []) {
  const next = normalizeNotifyAccountSettings(accountSettings, accountSettings?.username);

  for (const removal of Array.isArray(removals) ? removals : []) {
    const configType = String(removal?.configType || '').trim();
    if (configType === 'bark-account') {
      next.barkDeviceKey = '';
    } else if (configType === 'serverchan3-account') {
      next.serverChan3 = { uid: '', sendKey: '' };
    }
  }

  return next;
}

export async function runClientDetection(
  env,
  settings,
  clientRecord,
  {
    reason = 'manual-run',
    testPayload = null,
    targetChannels = null,
    accountSettings = null,
    accountUsername: requestedAccountUsername = ''
  } = {}
) {
  const currentClientId = normalizeClientId(clientRecord?.clientId);
  const accountUsername = normalizeNotifyAccountUsername(
    requestedAccountUsername
      || accountSettings?.username
      || resolveNotifyClientAccountUsername(clientRecord)
  );

  if (!currentClientId) {
    return {
      settings,
      summary: buildEmptyRunSummary()
    };
  }

  const currentAccount = accountSettings
    || await readAccountSettings(env, accountUsername)
    || normalizeNotifyAccountSettings({}, accountUsername);
  env.__notifySettings = buildScopedNotifySettings(settings, currentClientId, currentAccount);
  env.__notifyCurrentClientId = currentClientId;
  const cycle = await runNotificationCycle(env, currentAccount.payload, clientRecord.state, {
    reason,
    testPayload,
    targetChannels
  });
  let nextSettings = settings;
  let nextAccount = currentAccount;

  if (Array.isArray(cycle.settingsRemovals) && cycle.settingsRemovals.length) {
    nextAccount = applyAccountSettingsRemovals(nextAccount, cycle.settingsRemovals);
  }

  const refreshedClient = getClientRecord(nextSettings, currentClientId, clientRecord.clientLabel);
  const nowIso = new Date().toISOString();
  const isManualTest = reason === 'manual-test';
  nextSettings = upsertClientRecord(nextSettings, currentClientId, {
    clientLabel: refreshedClient.clientLabel || clientRecord.clientLabel,
    state: cycle.state,
    meta: {
      ...refreshedClient.meta,
      counts: testPayload ? refreshedClient.meta.counts : compileNotifyRules(nextAccount.payload).summary,
      lastCheckedAt: isManualTest ? refreshedClient.meta.lastCheckedAt : nowIso,
      lastTestedAt: isManualTest ? nowIso : refreshedClient.meta.lastTestedAt
    }
  });

  nextAccount = {
    ...nextAccount,
    username: accountUsername,
    meta: {
      ...nextAccount.meta,
      counts: testPayload ? nextAccount.meta.counts : compileNotifyRules(nextAccount.payload).summary,
      lastCheckedAt: isManualTest ? nextAccount.meta.lastCheckedAt : nowIso,
      lastTestedAt: isManualTest ? nowIso : nextAccount.meta.lastTestedAt
    }
  };
  if (accountUsername) {
    await writeAccountSettings(env, accountUsername, nextAccount);
  }

  return {
    settings: nextSettings,
    accountSettings: nextAccount,
    summary: {
      ...cycle.summary,
      clientId: currentClientId,
      clientLabel: refreshedClient.clientLabel || clientRecord.clientLabel
    }
  };
}

export async function runDetection(env, reason = 'manual-run', options = {}) {
  console.log('[notify] runDetection enter', JSON.stringify({
    reason,
    clientId: options?.clientId || null
  }));
  let settings = await readSettings(env);
  const requestedClientId = normalizeClientId(options?.clientId);
  const clientRecords = requestedClientId
    ? [getClientRecord(settings, requestedClientId)]
    : Object.values(settings.clients || {}).filter((client) => normalizeClientId(client?.clientId));
  let summary = buildEmptyRunSummary();
  const handledAccounts = new Set();

  for (const clientRecord of clientRecords) {
    const accountUsername = resolveNotifyClientAccountUsername(clientRecord);
    if (accountUsername && handledAccounts.has(accountUsername)) continue;
    if (accountUsername) handledAccounts.add(accountUsername);
    const result = await runClientDetection(env, settings, clientRecord, {
      reason
    });
    settings = result.settings;
    summary = appendClientRunSummary(summary, result.summary);
  }

  await writeSettings(env, settings);
  return summary;
}
