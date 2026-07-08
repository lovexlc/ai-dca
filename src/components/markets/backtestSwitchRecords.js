function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildSwitchRecords(trades = [], signals = []) {
  const signalByTs = new Map(
    (Array.isArray(signals) ? signals : [])
      .map((signal) => [Number(signal.ts), signal])
      .filter(([ts]) => Number.isFinite(ts))
  );
  const groups = new Map();
  for (const trade of Array.isArray(trades) ? trades : []) {
    const ts = Number(trade?.ts ?? trade?.date);
    if (!Number.isFinite(ts)) continue;
    const list = groups.get(ts) || [];
    list.push(trade);
    groups.set(ts, list);
  }
  return Array.from(groups.entries())
    .sort(([leftTs], [rightTs]) => leftTs - rightTs)
    .map(([ts, list]) => {
      const sell = list.find((trade) => trade?.type === 'sell');
      const buy = list.find((trade) => trade?.type === 'buy');
      if (!sell || !buy) return null;
      const signal = signalByTs.get(ts) || {};
      return { ts, sell, buy, signal };
    })
    .filter(Boolean);
}

export function buildSwitchRecordsCsv(records = [], { formatDate = (value) => value } = {}) {
  const header = ['日期', '规则', 'H-L溢价差', '卖出代码', '卖出价格', '卖出份额', '卖出金额', '卖出费用', '卖出净额', '卖出盈亏', '买入代码', '买入价格', '买入份额', '买入金额', '买入费用', '买入总成本'];
  const body = (Array.isArray(records) ? records : []).map(({ ts, sell = {}, buy = {}, signal = {} }) => [
    formatDate(signal.datetime || signal.date || ts),
    signal.rule || '',
    Number.isFinite(Number(signal.gapPct)) ? Number(signal.gapPct).toFixed(4) : '',
    sell.code || '',
    Number.isFinite(Number(sell.price)) ? Number(sell.price).toFixed(6) : '',
    Number.isFinite(Number(sell.shares)) ? Number(sell.shares).toFixed(4) : '',
    Number.isFinite(Number(sell.amount)) ? Number(sell.amount).toFixed(2) : '',
    Number.isFinite(Number(sell.fee)) ? Number(sell.fee).toFixed(2) : '',
    Number.isFinite(Number(sell.netProceeds)) ? Number(sell.netProceeds).toFixed(2) : '',
    Number.isFinite(Number(sell.profit)) ? Number(sell.profit).toFixed(2) : '',
    buy.code || '',
    Number.isFinite(Number(buy.price)) ? Number(buy.price).toFixed(6) : '',
    Number.isFinite(Number(buy.shares)) ? Number(buy.shares).toFixed(4) : '',
    Number.isFinite(Number(buy.amount)) ? Number(buy.amount).toFixed(2) : '',
    Number.isFinite(Number(buy.fee)) ? Number(buy.fee).toFixed(2) : '',
    Number.isFinite(Number(buy.totalCost)) ? Number(buy.totalCost).toFixed(2) : ''
  ].map(csvCell).join(','));
  return [header.map(csvCell).join(','), ...body].join('\n');
}

export function downloadSwitchRecordsCsv(records = [], { filename = 'switch-records.csv', formatDate } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const blob = new Blob([`\ufeff${buildSwitchRecordsCsv(records, { formatDate })}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}
