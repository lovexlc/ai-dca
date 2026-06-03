import { DCA_KEY, readDcaState } from './dca.js';
import { readPlanList } from './plan.js';
import { readSellPlanList } from './sellPlans.js';
import { readTradeLedger } from './tradeLedger.js';
import { groupCostBasisBySymbol } from './costTracker.js';
import { calculatePositions } from './positionManager.js';
import { readVixSnapshot, resolveVixSignal, VIX_THRESHOLDS } from './vixSignal.js';
import { trackAnalyticsEvent } from './analytics.js';

const NOTIFY_ENDPOINT = '/api/notify';
const NOTIFY_CLIENT_CONFIG_KEY = 'aiDcaNotifyClientConfig';
const NOTIFY_CLIENT_SECRET_HEADER = 'x-notify-client-secret';

function buildDefaultNotifyClientConfig() {
  return {
    barkDeviceKey: '',
    serverChan3Uid: '',
    serverChan3SendKey: '',
    notifyClientId: '',
    notifyClientLabel: '',
    notifyClientSecret: ''
  };
}

function createNotifyClientId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return `web:${window.crypto.randomUUID()}`;
  }

  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return `web:${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
  }

  return `web:${Date.now().toString(36)}`;
}

function normalizeNotifyClientId(value = '') {
  return String(value || '').trim().slice(0, 120);
}

function normalizeNotifyClientLabel(value = '') {
  return String(value || '').trim().slice(0, 120);
}

function normalizeNotifyClientSecret(value = '') {
  return String(value || '').trim().slice(0, 240);
}

function buildDefaultNotifyClientLabel() {
  if (typeof window === 'undefined') {
    return 'Web 控制台';
  }

  const hostname = String(window.location?.hostname || '').trim();
  return hostname ? `Web 控制台 @ ${hostname}` : 'Web 控制台';
}

function createNotifyClientSecret() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return `${window.crypto.randomUUID()}${window.crypto.randomUUID()}`.replace(/-/g, '');
  }

  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function readNotifyClientConfig() {
  if (typeof window === 'undefined') {
    return buildDefaultNotifyClientConfig();
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(NOTIFY_CLIENT_CONFIG_KEY) || 'null');
    const nextConfig = {
      ...buildDefaultNotifyClientConfig(),
      barkDeviceKey: String(saved?.barkDeviceKey || '').trim(),
      serverChan3Uid: String(saved?.serverChan3Uid || '').trim(),
      serverChan3SendKey: String(saved?.serverChan3SendKey || '').trim()
    };

    nextConfig.notifyClientId = normalizeNotifyClientId(saved?.notifyClientId) || createNotifyClientId();
    nextConfig.notifyClientLabel = normalizeNotifyClientLabel(saved?.notifyClientLabel) || buildDefaultNotifyClientLabel();
    nextConfig.notifyClientSecret = normalizeNotifyClientSecret(saved?.notifyClientSecret) || createNotifyClientSecret();
    window.localStorage.setItem(NOTIFY_CLIENT_CONFIG_KEY, JSON.stringify(nextConfig));

    return nextConfig;
  } catch (_error) {
    const nextConfig = {
      ...buildDefaultNotifyClientConfig(),
      notifyClientId: createNotifyClientId(),
      notifyClientLabel: buildDefaultNotifyClientLabel(),
      notifyClientSecret: createNotifyClientSecret()
    };

    window.localStorage.setItem(NOTIFY_CLIENT_CONFIG_KEY, JSON.stringify(nextConfig));
    return nextConfig;
  }
}

export function persistNotifyClientConfig(nextConfig = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const current = readNotifyClientConfig();
  const { _skipTrack, ...storedNextConfig } = nextConfig || {};
  const payload = {
    ...current,
    ...storedNextConfig,
    barkDeviceKey: String(storedNextConfig.barkDeviceKey ?? current.barkDeviceKey ?? '').trim(),
    serverChan3Uid: String(storedNextConfig.serverChan3Uid ?? current.serverChan3Uid ?? '').trim(),
    serverChan3SendKey: String(storedNextConfig.serverChan3SendKey ?? current.serverChan3SendKey ?? '').trim(),
    notifyClientId: normalizeNotifyClientId(storedNextConfig.notifyClientId ?? current.notifyClientId ?? '') || current.notifyClientId,
    notifyClientLabel: normalizeNotifyClientLabel(storedNextConfig.notifyClientLabel ?? current.notifyClientLabel ?? '') || current.notifyClientLabel,
    notifyClientSecret: normalizeNotifyClientSecret(storedNextConfig.notifyClientSecret ?? current.notifyClientSecret ?? '') || current.notifyClientSecret
  };

  window.localStorage.setItem(NOTIFY_CLIENT_CONFIG_KEY, JSON.stringify(payload));
  if (_skipTrack) {
    return;
  }
  const platforms = [];
  if (payload.barkDeviceKey) platforms.push('ios');
  if ((storedNextConfig && storedNextConfig._hasServerChan3) || Boolean(payload.serverChan3Uid && payload.serverChan3SendKey)) platforms.push('serverchan3');
  if (storedNextConfig && storedNextConfig._hasPC) platforms.push('pc');
  trackAnalyticsEvent('notify_enabled', {
    hasBark: Boolean(payload.barkDeviceKey),
    clientId: payload.notifyClientId,
    platforms
  });
}

export function mergeNotifyStatusIntoClientConfig(statusPayload = {}, currentConfig = readNotifyClientConfig()) {
  const setup = statusPayload?.setup && typeof statusPayload.setup === 'object' ? statusPayload.setup : {};
  const serverChan3 = setup.serverChan3 && typeof setup.serverChan3 === 'object' ? setup.serverChan3 : {};
  const serverChan3Configured = Boolean(statusPayload?.configured?.serverChan3 || serverChan3.configured);
  const nextConfig = {
    barkDeviceKey: String(currentConfig.barkDeviceKey || setup.barkDeviceKey || '').trim(),
    serverChan3Uid: String(currentConfig.serverChan3Uid || serverChan3.uid || '').trim(),
    serverChan3SendKey: String(currentConfig.serverChan3SendKey || '').trim()
  };

  if (setup.clientId) {
    nextConfig.notifyClientId = setup.clientId;
  }
  if (setup.clientLabel) {
    nextConfig.notifyClientLabel = setup.clientLabel;
  }

  if (serverChan3Configured && serverChan3.uid && serverChan3.uid !== currentConfig.serverChan3Uid) {
    nextConfig.serverChan3Uid = String(serverChan3.uid).trim();
  }

  persistNotifyClientConfig({
    ...nextConfig,
    _hasServerChan3: serverChan3Configured,
    _hasPC: false,
    _skipTrack: true
  });

  return {
    ...currentConfig,
    ...nextConfig
  };
}

function resolveNotifyClientConfig(payload = {}) {
  const current = readNotifyClientConfig();

  return {
    clientId: normalizeNotifyClientId(payload?.clientId || payload?.notifyClientId || current.notifyClientId),
    clientLabel: normalizeNotifyClientLabel(payload?.clientLabel || payload?.clientName || payload?.notifyClientLabel || current.notifyClientLabel),
    clientSecret: normalizeNotifyClientSecret(payload?.clientSecret || payload?.notifyClientSecret || current.notifyClientSecret) || current.notifyClientSecret
  };
}

async function readJsonResponse(response) {
  const rawText = await response.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return {
      error: rawText
    };
  }
}

function buildNotifyUrl(path, query = {}) {
  const url = new URL(`${NOTIFY_ENDPOINT}${path}`, typeof window === 'undefined' ? 'https://localhost' : window.location.origin);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    url.searchParams.set(key, String(value));
  });

  return `${url.pathname}${url.search}`;
}

async function requestNotify(path, init = {}) {
  const headers = new Headers(init.headers || {});
  const clientSecret = normalizeNotifyClientSecret(init.clientConfig?.clientSecret);

  if (clientSecret) {
    headers.set(NOTIFY_CLIENT_SECRET_HEADER, clientSecret);
  }

  const response = await fetch(buildNotifyUrl(path, init.query), {
    ...init,
    query: undefined,
    clientConfig: undefined,
    headers
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(payload.error || `通知服务请求失败：状态 ${response.status}`);
  }

  const platform = path.includes('/ws/') ? 'pc' : path.includes('/settings') ? 'serverchan3' : 'ios';
  trackAnalyticsEvent('notify_used', { path, platform });
  return payload;
}

function hasPersistedDca() {
  if (typeof window === 'undefined') {
    return false;
  }

  return Boolean(window.localStorage.getItem(DCA_KEY));
}

// PR 4.5：weight_alert 规则 — 生成仓位占比摘要（不上传总资产/价格，仅传权重 %）。
// worker 只需 weightPct 就能发 “X 超 50% 仓位上限” 提醒。
// PR 2b：vix_signal 规则 — 上传当前 VIX 读数 + 阈值表，让 worker 能发 “跳到 30 / 40 / 50 ” 的跨阈值提醒。
function buildVixDigest() {
  const snapshot = readVixSnapshot();
  if (!snapshot || !Number.isFinite(snapshot.value)) return null;
  const signal = resolveVixSignal(snapshot.value);
  return {
    version: 1,
    value: Number(snapshot.value),
    level: signal.level,
    levelLabel: signal.levelLabel,
    cachedAt: snapshot.cachedAt || null,
    thresholds: {
      watch: VIX_THRESHOLDS.watch,
      buyIndex: VIX_THRESHOLDS.buyIndex,
      buyAll: VIX_THRESHOLDS.buyAll,
      heavyBuy: VIX_THRESHOLDS.heavyBuy
    }
  };
}

function buildPositionDigest() {
  if (typeof window === 'undefined') return null;
  let snapshot;
  try {
    snapshot = JSON.parse(window.localStorage.getItem('aiDcaPositionSnapshot') || 'null');
  } catch (_e) { return null; }
  if (!snapshot || typeof snapshot !== 'object') return null;

  const totalAssets = Number(snapshot.totalAssets) || 0;
  const prices = (snapshot.prices && typeof snapshot.prices === 'object') ? snapshot.prices : {};
  if (totalAssets <= 0) return null;

  const trades = readTradeLedger();
  const grouped = groupCostBasisBySymbol(trades);
  const shares = {};
  for (const [sym, payload] of Object.entries(grouped)) {
    if (payload.summary.remainingShares > 0) {
      shares[sym] = payload.summary.remainingShares;
    }
  }

  const positions = calculatePositions({ totalAssets, prices, shares });
  const rows = (positions.rows || [])
    .filter((row) => row && row.symbol)
    .map((row) => ({
      symbol: String(row.symbol),
      type: row.type === 'index' ? 'index' : 'stock',
      weightPct: Number(row.weightPct) || 0,
      exceedsCap: Boolean(row.exceedsCap)
    }));
  if (!rows.length) return null;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    cashWeightPct: Number(positions.cashWeightPct) || 0,
    rows
  };
}

export function buildNotifySyncPayload() {
  const plans = readPlanList();
  const dca = hasPersistedDca() ? readDcaState() : null;
  // PR 1.5：worker 计算盈利% 需要当前价。从 positionSnapshot.prices 拿（用户在 PositionManager / Holdings 页上刷价后写入）。
  let snapshotPrices = {};
  try {
    const snap = JSON.parse(window.localStorage.getItem('aiDcaPositionSnapshot') || 'null');
    if (snap && typeof snap === 'object' && snap.prices && typeof snap.prices === 'object') {
      snapshotPrices = snap.prices;
    }
  } catch (_e) { /* ignore */ }
  // PR 1.5：sell_layer 规则 — 上传已保存的卖出计划列表，让 worker 能生成“盈利 X% → 卖 Y%”提醒。
  // 只传一个精简快照，并附带 currentPrice 供 worker 计算盈利%。
  const sellPlans = readSellPlanList().map((plan) => {
    const sym = String(plan.symbol || '').trim().toUpperCase();
    const px = Number(snapshotPrices[sym]);
    return {
      id: plan.id,
      name: plan.name,
      symbol: plan.symbol,
      holdingCost: plan.holdingCost,
      holdingShares: plan.holdingShares,
      gainTriggers: plan.gainTriggers,
      sellRatios: plan.sellRatios,
      currentPrice: Number.isFinite(px) && px > 0 ? px : null,
      updatedAt: plan.updatedAt
    };
  });
  const positionDigest = buildPositionDigest();
  const vixDigest = buildVixDigest();

  return {
    plans,
    dca,
    sellPlans,
    positionDigest,
    vix: vixDigest,
    syncedAt: new Date().toISOString()
  };
}

export function loadNotifyStatus(clientId = '') {
  const clientConfig = resolveNotifyClientConfig({
    clientId
  });

  return requestNotify('/status', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    }
  });
}

export function loadNotifyEvents(clientId = '') {
  const clientConfig = resolveNotifyClientConfig({
    clientId
  });

  return requestNotify('/events', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    }
  });
}

export function syncTradePlanRules(payload = buildNotifySyncPayload()) {
  const clientConfig = resolveNotifyClientConfig(payload);

  return requestNotify('/sync', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      clientId: clientConfig.clientId,
      clientLabel: clientConfig.clientLabel
    })
  });
}

export function sendNotifyTest(payload = {}) {
  const clientConfig = resolveNotifyClientConfig(payload);
  const savedConfig = readNotifyClientConfig();
  const serverChan3Uid = String(payload.serverChan3Uid ?? savedConfig.serverChan3Uid ?? '').trim();
  const serverChan3SendKey = String(payload.serverChan3SendKey ?? savedConfig.serverChan3SendKey ?? '').trim();
  const serverChan3 = payload.serverChan3 && typeof payload.serverChan3 === 'object'
    ? payload.serverChan3
    : (serverChan3Uid && serverChan3SendKey ? { uid: serverChan3Uid, sendKey: serverChan3SendKey } : undefined);

  return requestNotify('/test', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      clientId: clientConfig.clientId,
      clientLabel: clientConfig.clientLabel,
      ...(serverChan3 ? { serverChan3 } : {}),
      title: String(payload.title || '交易计划测试提醒'),
      body: String(payload.body || '这是一条测试通知，用来校验当前已接入的提醒通道是否可用。'),
      summary: String(payload.summary || '测试通知'),
      ruleId: String(payload.ruleId || 'test')
    })
  });
}

export function saveNotifySettings(payload = {}) {
  const clientConfig = resolveNotifyClientConfig(payload);

  return requestNotify('/settings', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      clientId: clientConfig.clientId,
      clientLabel: clientConfig.clientLabel
    })
  });
}

function normalizeHoldingsDigest(digest) {
  const result = { version: 1, generatedAt: '', exchange: [], otc: [] };
  if (!digest || typeof digest !== 'object') return result;
  if (digest.generatedAt) result.generatedAt = String(digest.generatedAt);
  for (const bucket of ['exchange', 'otc']) {
    const list = Array.isArray(digest[bucket]) ? digest[bucket] : [];
    for (const entry of list) {
      const code = String(entry?.code || '').trim();
      const weight = Number(entry?.weight);
      if (!/^\d{6}$/.test(code)) continue;
      if (!Number.isFinite(weight) || weight <= 0) continue;
      const rawKind = String(entry?.kind || '').trim().toLowerCase();
      const kind = rawKind === 'exchange' || rawKind === 'qdii' || rawKind === 'otc'
        ? rawKind
        : (bucket === 'exchange' ? 'exchange' : 'otc');
      result[bucket].push({ code, weight, kind });
    }
  }
  // 组合层 totals 已不再传输：workers/notify/src/index.js 出于隐私考虑统一丢弃 totals（只依赖 code/weight 加权计算收益率）。
  // Phase 2: 此处同步清理 client 端白名单，避免代码层继续依赖旧 totals 字段名。
  return result;
}

/** 读取当前 client 的「持仓当日总收益」通知规则；未配置时返回禁用状态。 */
export function loadHoldingsNotifyRule() {
  const clientConfig = resolveNotifyClientConfig();

  return requestNotify('/holdings-rule', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    }
  });
}

/**
 * 保存当前 client 的「持仓当日总收益」通知规则。
 * 仅同步代码 + 持仓类型 + 组合权重，不上传份额/成本/金额。
 */
export function saveHoldingsNotifyRule({ enabled = false, digest = null } = {}) {
  const clientConfig = resolveNotifyClientConfig();
  const normalizedDigest = normalizeHoldingsDigest(digest);

  return requestNotify('/holdings-rule', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      clientId: clientConfig.clientId,
      clientLabel: clientConfig.clientLabel,
      enabled: Boolean(enabled),
      digest: normalizedDigest
    })
  });
}
