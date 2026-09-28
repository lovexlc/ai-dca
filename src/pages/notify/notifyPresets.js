// notifyPresets.js
//
// 通知 Tab「预设开关模式」的存储与规则展开逻辑。
//
// 预设是面向用户的"一键开关"，底层复用现有规则存储，worker 侧改动仅限于
// plan/dca 规则支持 notify.enabled 开关（默认开，行为兼容）：
// - daily   → 服务端持仓规则（holdingsRule，走 saveHoldingsNotifyRule）
// - gain/loss → 按持仓标的展开成 holding-alert（打 presetId 标记），需要 holdingCost
// - premium → 按持仓标的展开成 market-alert（alertType=premium），仅 6 位场内代码
// - dca     → 批量开关全部定投计划的 notify.enabled
// - plan    → 批量开关全部交易计划的 notify.enabled
//
// 关闭预设时删除其生成的规则；手工创建的规则（无 presetId）不受预设影响；
// 同一标的已有同类型手工规则时，预设展开跳过该标的，避免重复。

export const NOTIFY_PRESETS_KEY = 'ai-dca-notify-presets-v1';

export const PRESET_DEFS = {
  daily: { kind: 'server', defaultThreshold: null },
  gain: { kind: 'holding-alert', alertType: 'gain', defaultThreshold: 2 },
  loss: { kind: 'holding-alert', alertType: 'loss', defaultThreshold: 2 },
  premium: { kind: 'market-alert', alertType: 'premium', defaultThreshold: 8 },
  dca: { kind: 'plans', defaultThreshold: null },
  plan: { kind: 'plans', defaultThreshold: null },
};

const PRESET_ALERT_IDS = ['gain', 'loss', 'premium'];

export const PRESET_NAMES = {
  daily: '每日收盘汇总',
  gain: '持仓大涨提醒',
  loss: '持仓大跌提醒',
  premium: '溢价异常提醒',
  dca: '定投执行提醒',
  plan: '交易计划提醒',
};

export function defaultNotifyPresets() {
  return {
    daily: { enabled: false },
    gain: { enabled: false, threshold: PRESET_DEFS.gain.defaultThreshold },
    loss: { enabled: false, threshold: PRESET_DEFS.loss.defaultThreshold },
    premium: { enabled: false, threshold: PRESET_DEFS.premium.defaultThreshold },
    dca: { enabled: false },
    plan: { enabled: false },
  };
}

export function readNotifyPresets() {
  const defaults = defaultNotifyPresets();
  if (typeof window === 'undefined') return defaults;
  try {
    const stored = JSON.parse(window.localStorage.getItem(NOTIFY_PRESETS_KEY) || '{}');
    if (!stored || typeof stored !== 'object') return defaults;
    const next = { ...defaults };
    for (const id of Object.keys(defaults)) {
      if (stored[id] && typeof stored[id] === 'object') {
        next[id] = { ...defaults[id], ...stored[id] };
      }
    }
    return next;
  } catch {
    return defaults;
  }
}

export function persistNotifyPresets(presets) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(NOTIFY_PRESETS_KEY, JSON.stringify(presets || {}));
}

export function normalizePresetThreshold(presetId, threshold) {
  const def = PRESET_DEFS[presetId];
  const pct = Number(threshold);
  if (Number.isFinite(pct) && pct > 0) return pct;
  return def?.defaultThreshold ?? 5;
}

// 为一个预设生成应有的 alert 规则列表（纯函数）。
// holdings: [{ symbol, name, holdingCost }]；holdingCost 仅涨跌预设需要。
// manualBySymbol: { [symbol]: Set(alertType) }，手工已配同类型规则的标的会被跳过。
export function buildPresetAlerts(presetId, threshold, holdings, manualBySymbol = {}) {
  const def = PRESET_DEFS[presetId];
  if (!def || !def.alertType) return [];
  const list = Array.isArray(holdings) ? holdings : [];
  const safeThreshold = normalizePresetThreshold(presetId, threshold);
  return list
    .filter((holding) => {
      const symbol = String(holding?.symbol || '').trim();
      if (!symbol) return false;
      if (def.kind === 'holding-alert' && !(Number(holding?.holdingCost) > 0)) return false;
      if (def.kind === 'market-alert' && !/^\d{6}$/.test(symbol)) return false;
      const manual = manualBySymbol[symbol];
      return !(manual && manual.has(def.alertType));
    })
    .map((holding) => {
      const symbol = String(holding.symbol).trim();
      const alert = {
        id: `${def.kind}:preset:${presetId}:${symbol}`,
        type: def.kind,
        presetId,
        symbol,
        name: holding.name || symbol,
        alertType: def.alertType,
        threshold: safeThreshold,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (def.kind === 'holding-alert') {
        alert.holdingCost = Number(holding.holdingCost);
      }
      return alert;
    });
}

// 把预设展开结果合并进现有 alerts：先清掉该预设旧规则，再写入新规则。
// 手工规则（无 presetId）原样保留。
export function mergePresetAlerts(existingAlerts, presetId, presetAlerts) {
  const list = Array.isArray(existingAlerts) ? existingAlerts : [];
  const next = Array.isArray(presetAlerts) ? presetAlerts : [];
  const kept = list.filter((alert) => alert?.presetId !== presetId);
  return [...kept, ...next];
}

export function isPresetAlertId(presetId) {
  return PRESET_ALERT_IDS.includes(presetId);
}

// 从现有 alerts 里统计每个标的手工配置过的 alertType（用于展开时去重）。
export function collectManualAlertTypes(alerts) {
  const map = {};
  for (const alert of Array.isArray(alerts) ? alerts : []) {
    if (alert?.presetId || !alert?.symbol || !alert?.alertType) continue;
    const symbol = String(alert.symbol).trim();
    if (!symbol) continue;
    if (!map[symbol]) map[symbol] = new Set();
    map[symbol].add(alert.alertType);
  }
  return map;
}
