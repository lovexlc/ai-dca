let navServiceModulePromise = null;

function loadNavServiceModule() {
  if (!navServiceModulePromise) {
    navServiceModulePromise = import('../../app/navService.js');
  }
  return navServiceModulePromise;
}

export async function getNavSnapshotsForMarkets(...args) {
  const module = await loadNavServiceModule();
  return module.getNavSnapshots(...args);
}

export async function getNavSnapshotForMarkets(...args) {
  const module = await loadNavServiceModule();
  return module.getNavSnapshot(...args);
}

export async function getNavHistoryForMarkets(...args) {
  const module = await loadNavServiceModule();
  return module.getNavHistory(...args);
}

export async function getCnEtfPremiumSnapshotForMarkets(...args) {
  const module = await loadNavServiceModule();
  return module.getCnEtfPremiumSnapshot(...args);
}

export async function loadRealtimePricePushToolsForMarkets() {
  const module = await loadNavServiceModule();
  return {
    cacheRealtimeSnapshotItems: module.cacheRealtimeSnapshotItems,
    mergePricePushItems: module.mergePricePushItems
  };
}
