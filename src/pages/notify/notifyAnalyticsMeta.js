export function buildNotifyMeta({
  embedded = false,
  notifyPlatform = '',
  barkConfigured = false,
  serverChan3Configured = false,
  pcConfigured = false,
  pcFeaturesAvailable = false,
  webNotifySupported = false,
  webNotifyPermission = '',
  webNotifyEnabled = false,
  notifyWsStatus = '',
  holdingsRule = null,
  visibleEvents = [],
  pairedWebWsDevices = [],
  marketAlerts = [],
  holdingAlerts = [],
} = {}) {
  return {
    embedded,
    platformTab: notifyPlatform,
    barkConfigured,
    serverChan3Configured,
    pcConfigured,
    webNotifySupported: pcFeaturesAvailable && webNotifySupported,
    webNotifyPermission,
    webNotifyEnabled,
    wsStatus: notifyWsStatus,
    holdingsRuleEnabled: Boolean(holdingsRule?.enabled),
    visibleEventCount: visibleEvents.length,
    pairedWebWsCount: pairedWebWsDevices.length,
    marketAlertCount: marketAlerts.length,
    holdingAlertCount: holdingAlerts.length
  };
}
