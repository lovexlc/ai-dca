import { trackFeatureEvent } from './analytics.js';
import { loadCloudSession } from './authSession.js';

export const CONVERSION_PROMPT_EVENT = 'ai-dca:conversion-prompt';
export const CONVERSION_PROMPT_STATE_KEY = 'aiDcaConversionPromptState_v1';
export const CONVERSION_LAST_ACCEPTED_KEY = 'aiDcaConversionLastAccepted_v1';

const DAY_MS = 24 * 60 * 60 * 1000;
const DISMISS_COOLDOWN_MS = 7 * DAY_MS;
const GLOBAL_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_RECENT_ACTIONS = 20;

const PROMPT_CONFIGS = {
  markets_symbol_select: {
    minCount: 2,
    title: '保存你的行情关注',
    description: '登录后自选列表、筛选视图和最近查看的标的会自动同步，换设备也能继续看。',
    ctaLabel: '注册并保存',
    secondaryLabel: '稍后'
  },
  markets_watchlist_save: {
    minCount: 1,
    title: '自选列表已准备好',
    description: '把当前自选和列表配置保存到账号，后续手机和电脑会自动同步。',
    ctaLabel: '保存到账号',
    secondaryLabel: '稍后'
  },
  markets_view_preset_save: {
    minCount: 1,
    title: '保留这个筛选视图',
    description: '登录后筛选视图会进入云端备份，换设备也不用重新配置列和排序。',
    ctaLabel: '保存视图',
    secondaryLabel: '稍后'
  },
  markets_backtest_run_success: {
    minCount: 1,
    title: '保存回测后的策略上下文',
    description: '登录后可把自选、交易计划和通知规则一起同步，方便下次继续验证。',
    ctaLabel: '注册保存',
    secondaryLabel: '稍后'
  },
  fund_switch_view_open: {
    minCount: 1,
    title: '保存你的切换规则偏好',
    description: '登录后切换规则和基金池会自动同步，后续可接通知规则持续跟踪。',
    ctaLabel: '保存规则',
    secondaryLabel: '稍后'
  },
  holdings_transaction_save: {
    minCount: 1,
    title: '别让交易流水只留在本机',
    description: '登录后持仓、交易记录和账户分配会自动加密同步，换设备也不丢。',
    ctaLabel: '同步持仓',
    secondaryLabel: '稍后'
  },
  holdings_import_success: {
    minCount: 1,
    title: '导入结果可以自动备份',
    description: '登录后 OCR 或粘贴导入的持仓数据会自动加密同步到云端。',
    ctaLabel: '备份数据',
    secondaryLabel: '稍后'
  },
  notify_config_success: {
    minCount: 1,
    title: '保存通知规则到账号',
    description: '登录后通知配置和规则会保留在云端，换设备也能继续接收提醒。',
    ctaLabel: '保存通知',
    secondaryLabel: '稍后'
  },
  notify_test_success: {
    minCount: 1,
    title: '通知已打通，保存规则更稳',
    description: '登录后交易计划、持仓提醒和通知配置会自动同步到云端。',
    ctaLabel: '保存规则',
    secondaryLabel: '稍后'
  }
};

function todayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function readState() {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(CONVERSION_PROMPT_STATE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(state = {}) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(CONVERSION_PROMPT_STATE_KEY, JSON.stringify(state));
  } catch {
    // Local persistence is best-effort only.
  }
}

function sanitizeMeta(meta = {}) {
  const out = {};
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (value == null) return;
    if (typeof value === 'boolean' || typeof value === 'number') {
      out[key] = value;
      return;
    }
    if (typeof value === 'string') {
      out[key] = value.slice(0, 160);
    }
  });
  return out;
}

export function getConversionPromptConfig(trigger = '') {
  return PROMPT_CONFIGS[String(trigger || '')] || null;
}

export function triggerConversionPrompt(trigger, meta = {}) {
  if (typeof window === 'undefined') return false;
  if (loadCloudSession()?.accessToken) return false;
  const normalizedTrigger = String(trigger || '').trim();
  const config = getConversionPromptConfig(normalizedTrigger);
  if (!config) return false;

  const now = Date.now();
  const state = readState();
  const counts = { ...(state.counts || {}) };
  const shown = { ...(state.shown || {}) };
  const dismissed = { ...(state.dismissed || {}) };
  const count = (Number(counts[normalizedTrigger]) || 0) + 1;
  counts[normalizedTrigger] = count;

  const recentActions = [
    { trigger: normalizedTrigger, meta: sanitizeMeta(meta), createdAt: new Date(now).toISOString() },
    ...(Array.isArray(state.recentActions) ? state.recentActions : [])
  ].slice(0, MAX_RECENT_ACTIONS);

  const nextState = { ...state, counts, recentActions };
  writeState(nextState);

  if (count < (Number(config.minCount) || 1)) return false;
  if (shown[normalizedTrigger] === todayKey(now)) return false;
  const dismissedAt = Number(dismissed[normalizedTrigger]) || 0;
  if (dismissedAt && now - dismissedAt < DISMISS_COOLDOWN_MS) return false;
  const lastShownAt = Number(state.lastShownAt) || 0;
  if (lastShownAt && now - lastShownAt < GLOBAL_COOLDOWN_MS) return false;

  const prompt = {
    id: `${normalizedTrigger}:${now}`,
    trigger: normalizedTrigger,
    title: config.title,
    description: config.description,
    ctaLabel: config.ctaLabel,
    secondaryLabel: config.secondaryLabel,
    meta: sanitizeMeta(meta),
    createdAt: now
  };

  writeState({
    ...nextState,
    shown: { ...shown, [normalizedTrigger]: todayKey(now) },
    lastShownAt: now
  });
  trackFeatureEvent('conversion', 'prompt_view', {
    trigger: normalizedTrigger,
    ...prompt.meta
  });
  window.dispatchEvent(new CustomEvent(CONVERSION_PROMPT_EVENT, { detail: prompt }));
  return true;
}

export function acceptConversionPrompt(prompt = {}) {
  const trigger = String(prompt.trigger || '').trim();
  if (!trigger) return;
  const payload = {
    trigger,
    meta: sanitizeMeta(prompt.meta),
    acceptedAt: Date.now()
  };
  try {
    window.localStorage?.setItem(CONVERSION_LAST_ACCEPTED_KEY, JSON.stringify(payload));
  } catch {
    // Best effort attribution.
  }
  trackFeatureEvent('conversion', 'prompt_click', {
    trigger,
    ...payload.meta
  });
}

export function dismissConversionPrompt(prompt = {}) {
  const trigger = String(prompt.trigger || '').trim();
  if (!trigger) return;
  const state = readState();
  writeState({
    ...state,
    dismissed: {
      ...(state.dismissed || {}),
      [trigger]: Date.now()
    }
  });
  trackFeatureEvent('conversion', 'prompt_dismiss', {
    trigger,
    ...sanitizeMeta(prompt.meta)
  });
}

export function consumeAcceptedConversionPrompt({ maxAgeMs = DAY_MS } = {}) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage?.getItem(CONVERSION_LAST_ACCEPTED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const acceptedAt = Number(parsed?.acceptedAt);
    if (!Number.isFinite(acceptedAt) || Date.now() - acceptedAt > maxAgeMs) {
      window.localStorage?.removeItem(CONVERSION_LAST_ACCEPTED_KEY);
      return null;
    }
    window.localStorage?.removeItem(CONVERSION_LAST_ACCEPTED_KEY);
    return {
      trigger: String(parsed?.trigger || ''),
      meta: sanitizeMeta(parsed?.meta)
    };
  } catch {
    return null;
  }
}
