// incomeProbe.js
//
// 暂时的 dev-only 探针：把 navHistoryClient + portfolioSeries 连起来，
// 给 console 入口，方便在浏览器里试 「某个镜头的收益率」。
// 1.4 冲烟通过后由后续 commit 删掉。
//
// 使用（打开 DevTools）：
//   await window.__incomeProbe('ytd')              // YTD
//   await window.__incomeProbe('week')             // 本周
//   await window.__incomeProbe('lastMonth')        // 上月
//   await window.__incomeProbe('sinceInception')   // 投资以来
//   await window.__incomeProbe('custom', { custom: { from: '2025-01-01', to: '2025-03-31' } })
//
// 安静原则：
//   - 仅在 window 存在时挂载；SSR/Node 环境 no-op。
//   - 不在生产路径中被调用 — 需手动打开 DevTools 吃。
//   - 不修改 ledger / nav cache；只读。

import { fetchNavHistory } from './navHistoryClient.js';
import { buildPortfolioSeries, resolveRangeWindow } from './portfolioSeries.js';

function uniqCodes(txs) {
  const set = new Set();
  for (const tx of txs || []) {
    if (tx?.code) set.add(String(tx.code).trim());
  }
  return Array.from(set).filter(Boolean);
}

function firstBuyDate(txs) {
  let min = null;
  for (const tx of txs || []) {
    if (tx?.type !== 'BUY' || !tx?.date) continue;
    const iso = String(tx.date).slice(0, 10);
    if (!min || iso < min) min = iso;
  }
  return min;
}

async function fetchAllNav(codes, from, to) {
  const map = {};
  await Promise.all(
    codes.map(async (code) => {
      try {
        const res = await fetchNavHistory({ code, from, to });
        map[code] = res.items || [];
      } catch (e) {
        console.warn(`[incomeProbe] nav fetch failed for ${code}:`, e);
        map[code] = [];
      }
    })
  );
  return map;
}

export function installIncomeProbe(getLedger) {
  if (typeof window === 'undefined') return () => {};
  const fn = async (range, opts = {}) => {
    const ledger = typeof getLedger === 'function' ? getLedger() : null;
    const txs = ledger?.transactions || [];
    if (!txs.length) {
      console.warn('[incomeProbe] 当前 ledger 里没有 transactions。');
      return null;
    }
    const inception = firstBuyDate(txs);
    let window_;
    try {
      window_ = resolveRangeWindow(range, {
        today: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
        inceptionDate: inception,
        custom: opts.custom
      });
    } catch (e) {
      console.error('[incomeProbe] 镜头解析失败：', e);
      return null;
    }
    // NAV 拉取区间略微带点 padding，避免起点在周末时查不到当日 NAV。
    const codes = uniqCodes(txs);
    const navMap = await fetchAllNav(codes, window_.from, window_.to);
    const series = buildPortfolioSeries({
      tx: txs,
      navByCode: navMap,
      from: window_.from,
      to: window_.to
    });
    console.log('[incomeProbe]', range, window_, {
      startValue: series.startValue,
      endValue: series.endValue,
      netCashFlow: series.netCashFlow,
      profit: series.profit,
      returnRate: series.returnRate,
      annualizedReturn: series.annualizedReturn,
      days: series.window.days,
      missingNav: series.diagnostics
    });
    return series;
  };
  window.__incomeProbe = fn;
  return () => {
    if (window.__incomeProbe === fn) delete window.__incomeProbe;
  };
}
