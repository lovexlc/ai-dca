import { fetchKline } from '../marketsApi.js';
import { fetchNavHistoryBatch } from '../navHistoryClient.js';
import { normalizeFundKind } from '../holdingsLedgerCore.js';

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function shanghaiDateFromEpochSec(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  try {
    return new Date(seconds * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }
}

function codeMetaByCode(transactions = []) {
  const map = new Map();
  for (const tx of Array.isArray(transactions) ? transactions : []) {
    const code = String(tx?.code || '').trim();
    if (!code) continue;
    const previous = map.get(code) || {};
    map.set(code, {
      kind: previous.kind || normalizeFundKind(tx?.kind, code, tx?.name || ''),
      name: previous.name || String(tx?.name || '').trim(),
    });
  }
  return map;
}

function normalizePriceHistory(candles = [], from = '', to = '') {
  return (Array.isArray(candles) ? candles : [])
    .map((candle) => ({
      date: shanghaiDateFromEpochSec(candle?.t),
      nav: Number(candle?.c),
    }))
    .filter((item) => (
      isIsoDate(item.date)
      && Number.isFinite(item.nav)
      && item.nav > 0
      && (!from || item.date >= from)
      && (!to || item.date <= to)
    ))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function mapLimit(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const output = new Array(list.length);
  let cursor = 0;
  async function run() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => run()));
  return output;
}

/**
 * 收益页历史数据统一入口：场内按交易价格，场外/QDII 按公布 NAV。
 * 详情页才允许调用，避免列表页预拉历史序列。
 */
export async function fetchIncomeHistory({ transactions = [], codes = [], from, to } = {}) {
  const inputCodes = Array.from(new Set(
    (Array.isArray(codes) ? codes : [])
      .map((code) => String(code || '').trim())
      .filter((code) => /^\d{6}$/.test(code))
  ));
  if (!inputCodes.length) return { navByCode: {}, stale: false, errors: {}, sourceByCode: {} };

  const meta = codeMetaByCode(transactions);
  const exchangeCodes = inputCodes.filter((code) => meta.get(code)?.kind === 'exchange');
  const navCodes = inputCodes.filter((code) => !exchangeCodes.includes(code));
  const navResultPromise = navCodes.length
    ? fetchNavHistoryBatch({ codes: navCodes, from, to })
    : Promise.resolve({ navByCode: {}, stale: false, errors: {} });
  const priceResultsPromise = mapLimit(exchangeCodes, 4, async (code) => {
    try {
      const payload = await fetchKline(code, { timeframe: '1d', market: 'cn' });
      const items = normalizePriceHistory(payload?.candles, from, to);
      return { code, items, error: items.length ? null : '场内日线价格为空' };
    } catch (error) {
      return { code, items: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  const [navResult, priceResults] = await Promise.all([navResultPromise, priceResultsPromise]);
  const navByCode = { ...(navResult?.navByCode || {}) };
  const errors = { ...(navResult?.errors || {}) };
  const sourceByCode = {};
  for (const code of navCodes) sourceByCode[code] = 'nav';
  for (const result of priceResults) {
    navByCode[result.code] = result.items;
    sourceByCode[result.code] = 'price';
    if (result.error) errors[result.code] = result.error;
  }
  return {
    navByCode,
    stale: Boolean(navResult?.stale),
    errors,
    sourceByCode,
  };
}

export function findIncomeHistoryMissingDates(transactions = []) {
  return (Array.isArray(transactions) ? transactions : []).filter((tx) => (
    String(tx?.code || '').trim()
    && Number(tx?.shares) > 0
    && !isIsoDate(String(tx?.date || '').slice(0, 10))
  ));
}

export const __internals = { codeMetaByCode, normalizePriceHistory, shanghaiDateFromEpochSec };
