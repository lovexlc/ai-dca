// notifyRecommendations.js
//
// 通知 Tab「为你推荐」：基于持仓 + 实时行情自动生成推荐配置。
//
// 设计约束：
// - 推荐只映射到现有预设（daily/gain/loss/premium/dca），不新增提醒类型；
//   开启一条推荐 = 调用现有 handleTogglePreset(presetId, true)，worker 零改动。
// - 已开启对应预设时不再推荐；用户点 x 关闭后不再出现（localStorage 记录）。
// - 行情拉取失败时降级：只生成不依赖行情的推荐。

import { aggregateByCode } from '../../app/holdingsLedgerCore.js';
import { readLedgerState } from '../../app/holdingsLedger.js';
import { resolvePremiumPercent } from '../markets/marketDisplayUtils.js';
import { PRESET_DEFS } from './notifyPresets.js';

export const NOTIFY_REC_DISMISSED_KEY = 'ai-dca-notify-rec-dismissed-v1';
// 持仓标的当前溢价达到该值（%）才生成溢价推荐
export const PREMIUM_REC_TRIGGER = 5;
// 溢价推荐最多展示条数（按溢价从高到低取）
export const PREMIUM_REC_LIMIT = 2;
// 单次推荐最多拉取行情的标的数量
export const REC_QUOTE_SYMBOL_LIMIT = 50;

const ON_EXCHANGE_RE = /^\d{6}$/;

// 有持仓的标的 [{ symbol, name, holdingCost }]，与 useNotifyPresets.getPresetHoldings 口径一致。
export function readHoldingPositions() {
  try {
    const ledger = readLedgerState();
    const aggregates = aggregateByCode(ledger?.transactions || [], ledger?.snapshotsByCode || {});
    return (Array.isArray(aggregates) ? aggregates : [])
      .filter((item) => item?.hasPosition)
      .map((item) => ({
        symbol: String(item.code || '').trim(),
        name: item.name || String(item.code || '').trim(),
        holdingCost: Number(item.avgCost) || 0,
      }))
      .filter((item) => item.symbol);
  } catch {
    return [];
  }
}

export function readDismissedRecommendationIds() {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = JSON.parse(window.localStorage.getItem(NOTIFY_REC_DISMISSED_KEY) || '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function dismissRecommendation(id) {
  if (typeof window === 'undefined' || !id) return;
  const next = readDismissedRecommendationIds();
  next.add(String(id));
  try {
    window.localStorage.setItem(NOTIFY_REC_DISMISSED_KEY, JSON.stringify([...next]));
  } catch {
    // 存储失败时仅本次会话生效
  }
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

// 生成推荐列表（纯函数；dismissedIds 可注入，便于测试）。
// positions: [{ symbol, name, holdingCost }]
// quotesBySymbol: { [symbol]: 行情对象 }（键为标的代码）
// presets: 预设状态（含 enabled/threshold）
// dcaCount: 定投计划数量
// 返回按展示顺序排列的 [{ id, presetId, title, data, threshold, unit }]。
export function buildNotifyRecommendations({
  positions = [],
  quotesBySymbol = {},
  presets = {},
  dcaCount = 0,
  dismissedIds = null,
} = {}) {
  const dismissed = dismissedIds instanceof Set ? dismissedIds : readDismissedRecommendationIds();
  const list = Array.isArray(positions) ? positions : [];
  const quotes = quotesBySymbol && typeof quotesBySymbol === 'object' ? quotesBySymbol : {};
  const recs = [];
  const usable = (id) => !dismissed.has(id);
  const presetOff = (presetId) => !presets?.[presetId]?.enabled;
  const thresholdOf = (presetId) => {
    const stored = Number(presets?.[presetId]?.threshold);
    if (Number.isFinite(stored) && stored > 0) return stored;
    return PRESET_DEFS[presetId]?.defaultThreshold ?? null;
  };

  // 1. 溢价推荐：持仓场内标的当前溢价达到触发线，按溢价从高到低取前 N 条
  if (presetOff('premium')) {
    const candidates = list
      .filter((position) => ON_EXCHANGE_RE.test(position.symbol))
      .map((position) => ({
        symbol: position.symbol,
        name: position.name,
        premium: resolvePremiumPercent(quotes[position.symbol]),
      }))
      .filter((candidate) => Number.isFinite(candidate.premium) && candidate.premium >= PREMIUM_REC_TRIGGER)
      .sort((a, b) => b.premium - a.premium)
      .slice(0, PREMIUM_REC_LIMIT);
    for (const candidate of candidates) {
      const id = `premium:${candidate.symbol}`;
      if (!usable(id)) continue;
      recs.push({
        id,
        presetId: 'premium',
        title: `${candidate.symbol} ${candidate.name}`,
        data: { premium: round1(candidate.premium) },
        threshold: thresholdOf('premium'),
        unit: '%',
      });
    }
  }

  // 2/3. 涨跌推荐：有成本持仓且对应预设未开
  const pricedCount = list.filter((position) => Number(position.holdingCost) > 0).length;
  if (pricedCount > 0 && presetOff('gain') && usable('gain:all')) {
    recs.push({
      id: 'gain:all',
      presetId: 'gain',
      title: '持仓大涨提醒',
      data: { count: pricedCount },
      threshold: thresholdOf('gain'),
      unit: '%',
    });
  }
  if (pricedCount > 0 && presetOff('loss') && usable('loss:all')) {
    recs.push({
      id: 'loss:all',
      presetId: 'loss',
      title: '持仓大跌提醒',
      data: { count: pricedCount },
      threshold: thresholdOf('loss'),
      unit: '%',
    });
  }

  // 4. 每日收盘汇总：有持仓且未开
  if (list.length > 0 && presetOff('daily') && usable('daily:all')) {
    recs.push({ id: 'daily:all', presetId: 'daily', title: '每日收盘汇总', data: {}, threshold: null, unit: '' });
  }

  // 5. 定投执行提醒：有定投计划且未开
  if (Number(dcaCount) > 0 && presetOff('dca') && usable('dca:all')) {
    recs.push({
      id: 'dca:all',
      presetId: 'dca',
      title: '定投执行提醒',
      data: { count: Number(dcaCount) },
      threshold: null,
      unit: '',
    });
  }

  return recs;
}

export default buildNotifyRecommendations;
