// VIX 信号引擎（PR 2a）。
// 锁定阈值（docs/strategy-upgrade-plan.md D5 / D6）：
//   watch=25 / buyIndex=30 / buyAll=40 / heavyBuy=50
// 数据源：复用 markets worker 的 `/quote/^VIX`。

import { fetchQuote } from './marketsApi.js';
import { getUserDataStorage } from './userDataStore.js';

export const VIX_THRESHOLDS = Object.freeze({
  watch: 25,
  buyIndex: 30,
  buyAll: 40,
  heavyBuy: 50
});

export const VIX_STATE_KEY = 'aiDcaVixState';

/**
 * 把 VIX 读数映射为信号等级。完全纯函数、可单测。
 */
export function resolveVixSignal(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) {
    return {
      level: 'unknown',
      levelLabel: '无数据',
      tone: 'slate',
      headline: '尚未获取 VIX 读数',
      actions: ['点击「刷新」拉取最新 VIX']
    };
  }
  if (v >= VIX_THRESHOLDS.heavyBuy) {
    return {
      level: 'heavyBuy',
      levelLabel: '极端恐慌',
      tone: 'red',
      headline: `VIX ≥ ${VIX_THRESHOLDS.heavyBuy}：极端恐慌区`,
      actions: [
        '重仓买入宽基（QQQ/VOO/SPY）',
        '个股制订定投，跳过低位档',
        '保留 10% 现金应对进一步下跳'
      ]
    };
  }
  if (v >= VIX_THRESHOLDS.buyAll) {
    return {
      level: 'buyAll',
      levelLabel: '高恐慌',
      tone: 'orange',
      headline: `VIX ≥ ${VIX_THRESHOLDS.buyAll}：高恐慌区`,
      actions: [
        '加仓宽基 + 个股全开',
        '定投频率可从双周 → 周度',
        '检查单只仓位是否接近 50% 上限'
      ]
    };
  }
  if (v >= VIX_THRESHOLDS.buyIndex) {
    return {
      level: 'buyIndex',
      levelLabel: '中高恐慌',
      tone: 'amber',
      headline: `VIX ≥ ${VIX_THRESHOLDS.buyIndex}：中高恐慌区`,
      actions: [
        '加仓宽基为主，个股按阶梯下跳执行',
        '保留现金处理 PR 1 中的减仓计划开始反向入场'
      ]
    };
  }
  if (v >= VIX_THRESHOLDS.watch) {
    return {
      level: 'watch',
      levelLabel: '警戒',
      tone: 'yellow',
      headline: `VIX ≥ ${VIX_THRESHOLDS.watch}：警戒区`,
      actions: [
        '保持常规定投，个股按计划执行',
        '准备备用资金，等 VIX 跳到 30 以上交主动仁'
      ]
    };
  }
  return {
    level: 'calm',
    levelLabel: '平静',
    tone: 'emerald',
    headline: `VIX < ${VIX_THRESHOLDS.watch}：市场平静`,
    actions: [
      '常规定投，不追高',
      '对已获利 ≥ 15% 的个股可检查 PR 1 卖出计划是否触发'
    ]
  };
}

/**
 * 按阈值表返回静态付表，供 UI 底部参考区列出。
 */
export function listVixLevels() {
  return [
    { level: 'calm', label: '平静', range: `< ${VIX_THRESHOLDS.watch}`, tone: 'emerald', summary: '常规定投，不追高' },
    { level: 'watch', label: '警戒', range: `${VIX_THRESHOLDS.watch} – ${VIX_THRESHOLDS.buyIndex - 0.01}`, tone: 'yellow', summary: '保持计划 + 准备备用' },
    { level: 'buyIndex', label: '中高恐慌', range: `${VIX_THRESHOLDS.buyIndex} – ${VIX_THRESHOLDS.buyAll - 0.01}`, tone: 'amber', summary: '加仓宽基、个股分梯入场' },
    { level: 'buyAll', label: '高恐慌', range: `${VIX_THRESHOLDS.buyAll} – ${VIX_THRESHOLDS.heavyBuy - 0.01}`, tone: 'orange', summary: '宽基 + 个股全开' },
    { level: 'heavyBuy', label: '极端恐慌', range: `≥ ${VIX_THRESHOLDS.heavyBuy}`, tone: 'red', summary: '重仓宽基 + 保留应急现金' }
  ];
}

function normalizeQuotePayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // 尽量兼容不同后端返回形状：{quote: {...}} 或直接 {...}。
  const q = raw.quote || raw;
  const price = Number(q.current_price ?? q.price ?? q.regularMarketPrice ?? q.close);
  if (!Number.isFinite(price)) return null;
  const prev = Number(q.previous_close ?? q.previousClose ?? q.prev_close);
  const change = Number.isFinite(prev) ? price - prev : Number(q.change);
  const changePct = Number.isFinite(prev) && prev !== 0
    ? ((price - prev) / prev) * 100
    : Number(q.change_percent);
  return {
    value: price,
    previousClose: Number.isFinite(prev) ? prev : null,
    change: Number.isFinite(change) ? change : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    asOf: q.as_of || q.timestamp || raw.generated_at || new Date().toISOString(),
    raw: q
  };
}

/**
 * 从 markets worker 拉取 ^VIX 实时报价，并写入 localStorage 做简单缓存。
 * 调用方负责抦错。
 */
export async function fetchVixSnapshot() {
  const raw = await fetchQuote('^VIX');
  const snapshot = normalizeQuotePayload(raw);
  if (snapshot) persistVixSnapshot(snapshot);
  return snapshot;
}

export function readVixSnapshot() {
  if (typeof window === 'undefined' || !getUserDataStorage()) return null;
  try {
    const raw = getUserDataStorage().getItem(VIX_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Number.isFinite(parsed.value)) {
      return parsed;
    }
  } catch (_e) { /* ignore */ }
  return null;
}

export function persistVixSnapshot(snapshot) {
  if (typeof window === 'undefined' || !getUserDataStorage()) return;
  if (!snapshot || !Number.isFinite(snapshot.value)) return;
  try {
    const { raw: _raw, ...slim } = snapshot;
    getUserDataStorage().setItem(VIX_STATE_KEY, JSON.stringify({
      ...slim,
      cachedAt: new Date().toISOString()
    }));
  } catch (_e) { /* ignore */ }
}

export function clearVixSnapshot() {
  if (typeof window === 'undefined' || !getUserDataStorage()) return;
  try { getUserDataStorage().removeItem(VIX_STATE_KEY); } catch (_e) { /* ignore */ }
}
