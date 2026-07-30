function uniqueSymbols(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function activeWatchlist(watchlist = {}) {
  const lists = Array.isArray(watchlist?.lists) ? watchlist.lists : [];
  return lists.find((item) => item.id === watchlist.activeListId) || lists[0] || watchlist;
}

function configuredCount(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => item && item.isConfigured !== false).length;
}

export function buildPortalStats({
  watchlist = {},
  plans = [],
  dcaPlans = [],
  sellPlans = [],
  holdingCodes = [],
  signalCount = 0,
} = {}) {
  const activeList = activeWatchlist(watchlist || {});
  const monitoredSymbols = uniqueSymbols([...(activeList?.cn || []), ...(activeList?.us || [])]);
  const listCount = Array.isArray(watchlist?.lists) ? watchlist.lists.length : monitoredSymbols.length ? 1 : 0;
  const strategyCount = configuredCount(plans) + configuredCount(dcaPlans) + configuredCount(sellPlans);

  return [
    { key: 'monitored', label: '监控标的', value: monitoredSymbols.length },
    { key: 'watchlists', label: '自选列表', value: listCount },
    { key: 'strategies', label: '策略计划', value: strategyCount },
    { key: 'holdings', label: '持仓标的', value: uniqueSymbols(holdingCodes).length },
    { key: 'signals', label: '今日信号', value: Math.max(0, Number(signalCount) || 0) },
  ];
}

export function readPortalSnapshot(readers = {}) {
  const read = (key, fallback) => {
    try {
      return typeof readers[key] === 'function' ? readers[key]() : fallback;
    } catch {
      return fallback;
    }
  };

  const watchlist = read('watchlist', {});
  const ledger = read('ledger', {});
  const transactions = Array.isArray(ledger?.transactions) ? ledger.transactions : [];

  return {
    watchlist,
    plans: read('plans', []),
    dcaPlans: read('dcaPlans', []),
    sellPlans: read('sellPlans', []),
    holdingCodes: uniqueSymbols(transactions.map((item) => item?.code)),
  };
}
