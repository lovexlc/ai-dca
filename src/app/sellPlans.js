// 卖出计划本地存储：依据策略升级文档 D14 锁定 key = aiDcaSellPlanStore。
// 数据结构与 plan.js 类似：Array<SellPlanState>。

import { buildSellPlan, defaultSellPlanState } from './sellStrategy.js';
import { getUserDataStorage } from './userDataStore.js';

export const SELL_PLAN_STORE_KEY = 'aiDcaSellPlanStore';
export const SELL_PLAN_DRAFT_KEY = 'aiDcaSellPlanDraft';

function safeRead(key) {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(getUserDataStorage().getItem(key) || 'null');
  } catch (_e) {
    return null;
  }
}

function safeWrite(key, value) {
  if (typeof window === 'undefined') return;
  try {
    getUserDataStorage().setItem(key, JSON.stringify(value));
  } catch (_e) {
    /* localStorage 不可用时静默失败 */
  }
}

function buildId() {
  return `sell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeArray(arr, fallback) {
  if (!Array.isArray(arr) || !arr.length) return [...fallback];
  return arr.map((v, i) => (Number.isFinite(Number(v)) ? Number(v) : fallback[i] || 0));
}

function normalize(saved = {}) {
  return {
    id: String(saved.id || ''),
    name: String(saved.name || ''),
    symbol: String(saved.symbol || ''),
    linkedPlanId: String(saved.linkedPlanId || ''),
    holdingCost: Number(saved.holdingCost) || 0,
    holdingShares: Number(saved.holdingShares) || 0,
    gainTriggers: normalizeArray(saved.gainTriggers, defaultSellPlanState.gainTriggers),
    sellRatios: normalizeArray(saved.sellRatios, defaultSellPlanState.sellRatios),
    trailingStopPct: Number(saved.trailingStopPct) || 0,
    isConfigured: typeof saved.isConfigured === 'boolean' ? saved.isConfigured : true,
    createdAt: String(saved.createdAt || ''),
    updatedAt: String(saved.updatedAt || '')
  };
}

export function readSellPlanList() {
  const raw = safeRead(SELL_PLAN_STORE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalize);
}

export function readSellPlanDraft() {
  const raw = safeRead(SELL_PLAN_DRAFT_KEY);
  if (!raw || typeof raw !== 'object') return { ...defaultSellPlanState };
  return { ...defaultSellPlanState, ...normalize({ ...raw, isConfigured: false }) };
}

export function persistSellPlanDraft(state) {
  safeWrite(SELL_PLAN_DRAFT_KEY, normalize({ ...state, isConfigured: false }));
}

export function clearSellPlanDraft() {
  if (typeof window === 'undefined') return;
  try { getUserDataStorage().removeItem(SELL_PLAN_DRAFT_KEY); } catch (_e) { /* noop */ }
}

export function saveSellPlan(state) {
  const now = new Date().toISOString();
  const list = readSellPlanList();
  const id = state.id || buildId();
  const next = normalize({
    ...state,
    id,
    isConfigured: true,
    createdAt: state.createdAt || now,
    updatedAt: now
  });
  const idx = list.findIndex((p) => p.id === id);
  if (idx >= 0) list[idx] = next; else list.push(next);
  safeWrite(SELL_PLAN_STORE_KEY, list);
  clearSellPlanDraft();
  return next;
}

export function deleteSellPlan(id) {
  const list = readSellPlanList().filter((p) => p.id !== id);
  safeWrite(SELL_PLAN_STORE_KEY, list);
}

export function findSellPlanBySymbol(symbol) {
  const code = String(symbol || '').trim();
  if (!code) return null;
  return readSellPlanList().find((p) => p.symbol === code) || null;
}

export function buildSellPlanById(id) {
  const plan = readSellPlanList().find((p) => p.id === id);
  if (!plan) return null;
  return { plan, computed: buildSellPlan(plan) };
}
