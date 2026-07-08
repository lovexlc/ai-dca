let marketsApiModulePromise = null;
let directMarketDataModulePromise = null;

function loadMarketsApiModule() {
  if (!marketsApiModulePromise) {
    marketsApiModulePromise = import('../../app/marketsApi.js');
  }
  return marketsApiModulePromise;
}

function loadDirectMarketDataModule() {
  if (!directMarketDataModulePromise) {
    directMarketDataModulePromise = import('../../app/directMarketData.js');
  }
  return directMarketDataModulePromise;
}

export async function fetchEarnings(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchEarnings(...args);
}

export async function fetchFundFees(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchFundFees(...args);
}

export async function fetchFinancials(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchFinancials(...args);
}

export async function fetchXueqiuFundData(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchXueqiuFundData(...args);
}

export async function fetchKline(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchKline(...args);
}

export async function fetchQuote(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchQuote(...args);
}

export async function fetchNews(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchNews(...args);
}

export async function fetchMarketSummary(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchMarketSummary(...args);
}

export async function fetchQuotes(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchQuotes(...args);
}

export async function fetchWorkerQuotes(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchWorkerQuotes(...args);
}

export async function fetchSectors(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchSectors(...args);
}

export async function fetchSummary(...args) {
  const module = await loadMarketsApiModule();
  return module.fetchSummary(...args);
}

export async function searchSymbols(...args) {
  const module = await loadMarketsApiModule();
  return module.searchSymbols(...args);
}

export async function cacheRealtimeDirectQuotesForMarkets(...args) {
  const module = await loadDirectMarketDataModule();
  return module.cacheRealtimeDirectQuotes(...args);
}
