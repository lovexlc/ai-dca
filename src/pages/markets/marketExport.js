export function escapeMarketCsvValue(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function buildMarketCsv(rows = []) {
  const headers = ['代码', '名称', '指数分类', '最新价', '今日涨跌额', '今日涨跌幅', '溢价率', '更新时间'];
  const lines = rows.map((row) => [
    row.symbol,
    row.name,
    row.indexCategory,
    row.price,
    row.change,
    row.changePercent,
    row.premiumPercent ?? row.premium_rate,
    row.latestNavDate || row.updatedAt,
  ].map(escapeMarketCsvValue).join(','));
  return [headers.map(escapeMarketCsvValue).join(','), ...lines].join('\n');
}
