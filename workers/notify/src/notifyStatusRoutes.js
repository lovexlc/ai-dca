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
  ensureAuthenticatedClient,
  getClientRecord
} from './clientSettings.js';

function splitPublicWebWsSetup(webWsSetup = {}) {
  const {
    notifyGroupMemberClientIds: _notifyGroupMemberClientIds,
    webWsRegistrations: _webWsRegistrations,
    webWsCurrentClientRegistrations: _webWsCurrentClientRegistrations,
    ...summary
  } = webWsSetup;
  return summary;
}

async function loadStatusContext(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;

  if (auth.didUpdate) {
    await writeSettings(env, settings);
  }

  const clientRecord = auth.clientRecord;
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
    clientRecord,
    recentEvents,
    deliveryFailures,
    emailConfig,
    webWsSetup
  };
}

function buildCoreStatus(context) {
  const {
    auth,
    clientRecord,
    emailConfig,
    webWsSetup,
    recentEvents,
    deliveryFailures
  } = context;

  return {
    configured: {
      bark: Boolean(clientRecord.barkDeviceKey),
      serverChan3: Boolean(clientRecord.serverChan3?.uid && clientRecord.serverChan3?.sendKey),
      email: Boolean(emailConfig.address && emailConfig.verified && emailConfig.enabled),
      webWs: Boolean(webWsSetup.webWsCurrentClientRegistrationCount)
    },
    counts: {
      planRuleCount: Number(clientRecord?.meta?.counts?.planRuleCount) || 0,
      dcaRuleCount: Number(clientRecord?.meta?.counts?.dcaRuleCount) || 0,
      totalRuleCount: Number(clientRecord?.meta?.counts?.totalRuleCount) || 0
    },
    lastSyncedAt: String(clientRecord?.meta?.lastSyncedAt || ''),
    lastCheckedAt: String(clientRecord?.meta?.lastCheckedAt || ''),
    lastTestedAt: String(clientRecord?.meta?.lastTestedAt || ''),
    eventCount: recentEvents.length,
    deliveryFailureCount: deliveryFailures.length,
    setup: {
      barkDeviceKey: clientRecord.barkDeviceKey,
      serverChan3: {
        uid: String(clientRecord.serverChan3?.uid || ''),
        sendKeyMasked: maskServerChan3SendKey(clientRecord.serverChan3?.sendKey || ''),
        configured: Boolean(clientRecord.serverChan3?.uid && clientRecord.serverChan3?.sendKey)
      },
      email: {
        maskedAddress: maskEmailAddress(emailConfig.address),
        verified: emailConfig.verified,
        verifiedAt: emailConfig.verifiedAt,
        enabled: emailConfig.enabled
      },
      clientId: auth.deviceClientId || clientRecord.clientId,
      accountClientId: clientRecord.clientId,
      accountUsername: clientRecord.accountUsername,
      clientLabel: getClientRecord(
        context.settings,
        auth.deviceClientId || auth.clientId
      ).clientLabel || clientRecord.clientLabel,
      ...splitPublicWebWsSetup(webWsSetup)
    }
  };
}

export async function handleStatusSummary(request, env) {
  const context = await loadStatusContext(request, env);
  return jsonResponse(buildCoreStatus(context), { origin: context.origin });
}

export async function handleStatusDetails(request, env) {
  const context = await loadStatusContext(request, env);
  const { auth, recentEvents, deliveryFailures, webWsSetup } = context;
  const lastEvent = recentEvents[0]
    ? attachClientDeliveryAcks(recentEvents[0], context.clientRecord)
    : null;

  return jsonResponse({
    ok: true,
    clientId: auth.deviceClientId || context.clientRecord.clientId,
    accountClientId: context.clientRecord.clientId,
    eventCount: recentEvents.length,
    lastEvent,
    deliveryFailureCount: deliveryFailures.length,
    deliveryFailures,
    setup: {
      notifyGroupMemberClientIds: webWsSetup.notifyGroupMemberClientIds,
      webWsRegistrations: webWsSetup.webWsRegistrations,
      webWsCurrentClientRegistrations: webWsSetup.webWsCurrentClientRegistrations
    }
  }, { origin: context.origin });
}
