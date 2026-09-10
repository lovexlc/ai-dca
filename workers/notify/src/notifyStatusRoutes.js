import { jsonResponse, readOrigin } from './notifyHttp.js';
import { readSettings, writeSettings } from './notifyStorage.js';
import {
  attachClientDeliveryAcks,
  getClientDeliveryFailures,
  getClientRecentEvents
} from './clientEventState.js';
import { buildPublicGcmSetup } from './gcmPresentation.js';
import { maskServerChan3SendKey } from './channels/serverChan3.js';
import { maskEmailAddress, normalizeEmailConfig } from './channels/email.js';
import {
  buildAccountClientId,
  ensureAuthenticatedClient,
  getClientRecord
} from './clientSettings.js';
import { readVerifiedNotifyAccount } from './notifyAccountAuth.js';
import { promoteVerifiedEmailToAccount } from './emailRoutes.js';

function splitPublicWebWsSetup(webWsSetup = {}) {
  const {
    notifyGroupMemberClientIds: _notifyGroupMemberClientIds,
    webWsRegistrations: _webWsRegistrations,
    webWsCurrentClientRegistrations: _webWsCurrentClientRegistrations,
    ...summary
  } = webWsSetup;
  return summary;
}

function normalizePublicTimestamp(value = '') {
  const normalized = String(value || '').trim();
  return normalized || null;
}

async function loadStatusContext(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  const account = readVerifiedNotifyAccount(request);
  const accountClientId = buildAccountClientId(account.userId);
  const boundSettings = promoteVerifiedEmailToAccount(settings, accountClientId, account);
  const didBindEmail = boundSettings !== settings;
  settings = boundSettings;

  if (auth.didUpdate || didBindEmail) {
    await writeSettings(env, settings);
  }

  const clientRecord = getClientRecord(settings, accountClientId);
  const recentEvents = getClientRecentEvents(clientRecord);
  const deliveryFailures = getClientDeliveryFailures(clientRecord);
  const emailConfig = normalizeEmailConfig(clientRecord.email || {});
  const webWsSetup = buildPublicGcmSetup(settings, env, {
    clientId: auth.deviceClientId || auth.clientId
  });

  return {
    origin,
    settings,
    auth,
    account,
    accountClientId,
    clientRecord,
    recentEvents,
    deliveryFailures,
    emailConfig,
    webWsSetup
  };
}

function buildWebSocketSummary(webWsSetup = {}, clientRecord = {}) {
  const publicSetup = splitPublicWebWsSetup(webWsSetup);
  return {
    groupId: String(publicSetup.notifyGroupId || clientRecord.notifyGroupId || ''),
    groupMemberCount: Number(publicSetup.notifyGroupMemberCount) || 0,
    registrationCount: Number(publicSetup.webWsRegistrationCount) || 0,
    currentClientId: String(publicSetup.webWsCurrentClientId || ''),
    currentClientRegistrationCount: Number(publicSetup.webWsCurrentClientRegistrationCount) || 0,
    pairedRegistrationCount: Number(publicSetup.webWsPairedRegistrationCount) || 0,
    unpairedRegistrationCount: Number(publicSetup.webWsUnpairedRegistrationCount) || 0
  };
}

function buildStatusData(context) {
  const {
    auth,
    account,
    accountClientId,
    clientRecord,
    emailConfig,
    webWsSetup,
    recentEvents,
    deliveryFailures
  } = context;
  const webSockets = buildWebSocketSummary(webWsSetup, clientRecord);
  const clientId = auth.deviceClientId || clientRecord.clientId;
  const clientLabel = getClientRecord(
    context.settings,
    auth.deviceClientId || auth.clientId
  ).clientLabel || clientRecord.clientLabel;

  return {
    account: {
      clientId: String(clientId || ''),
      accountClientId: String(accountClientId || clientRecord.clientId || ''),
      username: String(account.username || clientRecord.accountUsername || ''),
      label: String(clientLabel || ''),
      notifyGroupId: webSockets.groupId
    },
    channels: {
      bark: {
        configured: Boolean(clientRecord.barkDeviceKey),
        deviceKey: String(clientRecord.barkDeviceKey || '')
      },
      serverChan3: {
        uid: String(clientRecord.serverChan3?.uid || ''),
        sendKeyMasked: maskServerChan3SendKey(clientRecord.serverChan3?.sendKey || ''),
        configured: Boolean(clientRecord.serverChan3?.uid && clientRecord.serverChan3?.sendKey)
      },
      email: {
        maskedAddress: maskEmailAddress(emailConfig.address),
        verified: emailConfig.verified,
        verifiedAt: normalizePublicTimestamp(emailConfig.verifiedAt),
        enabled: emailConfig.enabled,
        configured: Boolean(emailConfig.address && emailConfig.verified && emailConfig.enabled)
      },
      webWs: {
        configured: Boolean(webSockets.currentClientRegistrationCount)
      }
    },
    rules: {
      planRuleCount: Number(clientRecord?.meta?.counts?.planRuleCount) || 0,
      dcaRuleCount: Number(clientRecord?.meta?.counts?.dcaRuleCount) || 0,
      totalRuleCount: Number(clientRecord?.meta?.counts?.totalRuleCount) || 0
    },
    timestamps: {
      lastSyncedAt: normalizePublicTimestamp(clientRecord?.meta?.lastSyncedAt),
      lastCheckedAt: normalizePublicTimestamp(clientRecord?.meta?.lastCheckedAt),
      lastTestedAt: normalizePublicTimestamp(clientRecord?.meta?.lastTestedAt)
    },
    delivery: {
      eventCount: recentEvents.length,
      failureCount: deliveryFailures.length
    },
    webSockets
  };
}

export async function handleStatusSummary(request, env) {
  const context = await loadStatusContext(request, env);
  return jsonResponse({
    ok: true,
    schemaVersion: 1,
    data: buildStatusData(context)
  }, { origin: context.origin });
}

export async function handleStatusDetails(request, env) {
  const context = await loadStatusContext(request, env);
  const { auth, recentEvents, deliveryFailures, webWsSetup } = context;
  const lastEvent = recentEvents[0]
    ? attachClientDeliveryAcks(recentEvents[0], context.clientRecord)
    : null;
  const publicWebWsSetup = splitPublicWebWsSetup(webWsSetup);

  return jsonResponse({
    ok: true,
    schemaVersion: 1,
    data: {
      account: {
        clientId: String(auth.deviceClientId || context.clientRecord.clientId || ''),
        accountClientId: String(context.accountClientId || context.clientRecord.clientId || '')
      },
      delivery: {
        eventCount: recentEvents.length,
        lastEvent,
        failureCount: deliveryFailures.length,
        failures: deliveryFailures
      },
      webSockets: {
        groupMemberClientIds: webWsSetup.notifyGroupMemberClientIds || [],
        registrations: publicWebWsSetup.webWsRegistrations || [],
        currentClientRegistrations: publicWebWsSetup.webWsCurrentClientRegistrations || []
      }
    }
  }, { origin: context.origin });
}
