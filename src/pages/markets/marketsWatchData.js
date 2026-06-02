import { normalizeCnFundCode } from './marketDisplayUtils.js';

export async function loadWatchQuotesWithEnhancements({
  symbols,
  market,
  fetchQuotes,
  getNavSnapshots,
  fetchFundFees,
  buildOtcFundQuoteFromSnapshot,
  hasNasdaqOtcFund,
}) {
  const list = Array.isArray(symbols) ? symbols : [];
  const quotePayload = await fetchQuotes(list);
  const quotes = { ...(quotePayload.quotes || {}) };
  const navSnapshots = {};
  const fundFees = {};

  if (market !== 'cn') {
    return { quotes, navSnapshots, fundFees };
  }

  const otcCodes = list.map((sym) => normalizeCnFundCode(sym)).filter(hasNasdaqOtcFund);
  if (otcCodes.length) {
    try {
      const snapshotsPayload = await getNavSnapshots(otcCodes);
      (snapshotsPayload.items || []).forEach((item) => {
        if (item?.code) navSnapshots[item.code] = item;
      });
      otcCodes.forEach((code) => {
        const existing = quotes[code] || quotes[`SZ${code}`] || quotes[`SH${code}`] || {};
        const quote = buildOtcFundQuoteFromSnapshot(code, navSnapshots[code], existing);
        if (quote) quotes[code] = quote;
      });
    } catch (_error) {
      // 场外基金净值是增强信息，失败时仍展示行情源返回的结果。
    }
  }

  const feeCodes = list.map((sym) => normalizeCnFundCode(sym)).filter((code) => /^\d{6}$/.test(code));
  if (feeCodes.length) {
    try {
      const feePayload = await fetchFundFees(feeCodes);
      (feePayload.items || []).forEach((item) => {
        if (item?.ok && item?.data?.code) fundFees[item.data.code] = item.data;
      });
    } catch (_error) {
      // 费率是增强信息，失败时保留行情与本地 fallback。
    }
  }

  return { quotes, navSnapshots, fundFees };
}
