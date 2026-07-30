import { CN_ETF_WATCHLIST_PRESETS, CN_OTC_WATCHLIST_PRESETS, US_INDICATOR_WATCHLIST_PRESETS } from '../../app/marketsWatchlistStorage.js';
import { resolveHighDrawdown } from '../markets/marketHighDrawdown.js';
import { normalizeCnFundCode } from '../markets/marketDisplayUtils.js';

const NAME_BY_SYMBOL = new Map([
  ...CN_ETF_WATCHLIST_PRESETS.map((item) => [item.symbol, item.name]),
  ...CN_OTC_WATCHLIST_PRESETS.map((item) => [item.symbol, item.name]),
  ...US_INDICATOR_WATCHLIST_PRESETS.map((item) => [item.symbol, item.name]),
]);

function normalizedSymbol(value = '') {
  const raw = String(value || '').trim();
  const cnCode = normalizeCnFundCode(raw);
  return cnCode || raw.toUpperCase();
}
function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function quoteForSymbol(quotes = {}, symbol = '') {
  const target = normalizedSymbol(symbol);
  const direct = quotes[symbol] || quotes[target] || quotes[`SH${target}`] || quotes[`SZ${target}`];
  if (direct && !direct.error) return direct;
  return Object.entries(quotes || {}).find(([key, value]) => !value?.error && normalizedSymbol(key) === target)?.[1] || null;
}

function buildRows(symbols = [], quotes = {}, market = 'cn') {
  return symbols.map((symbol) => {
    const quote = quoteForSymbol(quotes, symbol);
    const price = finiteNumber(quote?.price, quote?.currentPrice, quote?.close, quote?.latestNav);
    if (!quote || !(price > 0)) return null;
    const normalized = normalizedSymbol(symbol);
    const changePercent = finiteNumber(quote.changePercent, quote.changePct, quote.change_percent);
    const drawdown = resolveHighDrawdown({
      ...quote,
      symbol: normalized,
      code: normalized,
      market,
      fundKind: market === 'cn' ? 'exchange' : '',
      price,
    });
    return {
      symbol: normalized,
      name: String(quote.name || quote.shortName || quote.displayName || NAME_BY_SYMBOL.get(normalized) || normalized).trim(),
      price,
      changePercent,
      drawdownPercent: drawdown ? -Math.abs(drawdown.drawdownPct) : null,
      highSource: drawdown?.highSource || '',
    };
  }).filter(Boolean);
}

export function buildPortalRankings({ symbols = [], quotes = {}, market = 'cn', limit = 4 } = {}) {
  const rows = buildRows(symbols, quotes, market);
  const safeLimit = Math.max(1, Number(limit) || 4);
  const movers = rows
    .filter((row) => Number.isFinite(row.changePercent))
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, safeLimit);
  const drawdowns = rows
    .filter((row) => Number.isFinite(row.drawdownPercent))
    .sort((a, b) => a.drawdownPercent - b.drawdownPercent)
    .slice(0, safeLimit);
  const maxDrawdown = Math.max(...drawdowns.map((row) => Math.abs(row.drawdownPercent)), 1);

  return {
    rows,
    movers,
    drawdowns: drawdowns.map((row) => ({
      ...row,
      drawdownWidth: Math.min(100, Math.max(8, (Math.abs(row.drawdownPercent) / maxDrawdown) * 100)),
    })),
  };
}
