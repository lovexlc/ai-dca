/**
 * Legacy premium-spread row adapters.
 *
 * These helpers only translate the historical demo row shape into the unified
 * engine input shape. They do not implement backtest logic.
 */

function epochSecFromDate(date, offsetSec = 0) {
  return Math.floor(Date.parse(`${date}T01:30:00Z`) / 1000) + offsetSec;
}

function normalizeDate(value) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function positiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Convert old premium row data into runBacktest() inputs.
 *
 * Old rows look like:
 * { date, sellBid, sellAsk, sellIOPV, buyBid, buyAsk, buyIOPV }
 *
 * @param {Array<Object>} rows
 * @param {Object} symbols
 * @param {string} symbols.highCode
 * @param {string} symbols.lowCode
 * @returns {{historyByCode: Object, navHistoryByCode: Object}}
 */
export function buildPremiumSpreadInputFromLegacyRows(rows = [], symbols = {}) {
  const highCode = String(symbols.highCode || symbols.sellSymbol || '159513').trim();
  const lowCode = String(symbols.lowCode || symbols.buySymbol || '513100').trim();
  const historyByCode = {
    [highCode]: [],
    [lowCode]: []
  };
  const navHistoryByCode = {
    [highCode]: [],
    [lowCode]: []
  };

  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const date = normalizeDate(row?.date);
    if (!date) return;

    const t = epochSecFromDate(date, index * 60);
    const highClose = positiveNumber(row?.sellBid) ?? positiveNumber(row?.sellAsk) ?? positiveNumber(row?.sellIOPV);
    const lowClose = positiveNumber(row?.buyBid) ?? positiveNumber(row?.buyAsk) ?? positiveNumber(row?.buyIOPV);
    const highNav = positiveNumber(row?.sellIOPV);
    const lowNav = positiveNumber(row?.buyIOPV);

    if (highClose != null) {
      historyByCode[highCode].push({
        t,
        date,
        c: highClose,
        bidPrice: positiveNumber(row?.sellBid),
        askPrice: positiveNumber(row?.sellAsk)
      });
    }
    if (lowClose != null) {
      historyByCode[lowCode].push({
        t,
        date,
        c: lowClose,
        bidPrice: positiveNumber(row?.buyBid),
        askPrice: positiveNumber(row?.buyAsk)
      });
    }
    if (highNav != null) navHistoryByCode[highCode].push({ date, nav: highNav });
    if (lowNav != null) navHistoryByCode[lowCode].push({ date, nav: lowNav });
  });

  return { historyByCode, navHistoryByCode };
}
