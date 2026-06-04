const SWITCH_PREFS_KEY = 'aiDcaSwitchStrategyPrefs';

export const DEFAULT_SWITCH_PREFS = {
  benchmarkCodes: ['513100'],
  enabledCodes: [],
  premiumClass: {},
  arbTargetPct: 2,
  intraSellLowerPct: 1,
  intraBuyOtherPct: 3,
  otcPremiumThresholdPct: 8,
  otcMinIntraPremiumLow: 1,
  otcMinIntraPremiumHigh: 2
};

export function readSwitchPrefs(defaults = DEFAULT_SWITCH_PREFS) {
  if (typeof window === 'undefined') return { ...defaults };
  try {
    const raw = window.localStorage?.getItem(SWITCH_PREFS_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    let benchmarkCodes = Array.isArray(parsed?.benchmarkCodes) ? parsed.benchmarkCodes.filter(Boolean) : null;
    if (!benchmarkCodes && typeof parsed?.benchmarkCode === 'string' && parsed.benchmarkCode) {
      benchmarkCodes = [parsed.benchmarkCode];
    }
    if (!Array.isArray(benchmarkCodes) || !benchmarkCodes.length) {
      benchmarkCodes = [...defaults.benchmarkCodes];
    }
    const { benchmarkCode: _legacyBenchmark, ...rest } = parsed || {};
    void _legacyBenchmark;
    const rawClass = (parsed && typeof parsed.premiumClass === 'object' && parsed.premiumClass) ? parsed.premiumClass : {};
    const premiumClass = {};
    for (const [code, value] of Object.entries(rawClass)) {
      const v = String(value || '').trim().toUpperCase();
      if (/^\d{6}$/.test(String(code)) && (v === 'H' || v === 'L')) premiumClass[code] = v;
    }
    return {
      ...defaults,
      ...rest,
      benchmarkCodes,
      enabledCodes: Array.isArray(parsed?.enabledCodes) ? parsed.enabledCodes : [],
      premiumClass
    };
  } catch {
    return { ...defaults };
  }
}

export function writeSwitchPrefs(prefs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(SWITCH_PREFS_KEY, JSON.stringify(prefs));
  } catch (_error) {
    // ignore
  }
}

export function formatSwitchPercent(value, digits = 2, withSign = false) {
  if (value === null || value === undefined || value === '') return '—';
  const v = Number(value);
  if (!Number.isFinite(v)) return '—';
  const fixed = v.toFixed(digits);
  if (withSign && v > 0) return `+${fixed}%`;
  return `${fixed}%`;
}

export function formatSwitchPrice(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return v.toFixed(4);
}

export function formatSwitchDate(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '—';
  const timestamp = Date.parse(rawValue);
  if (!Number.isFinite(timestamp)) return rawValue;
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(timestamp)).replace(/\//g, '-');
  } catch (_error) {
    return rawValue;
  }
}

export function formatSwitchLimitAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 100000000) return `${(n / 100000000).toFixed(2).replace(/\.?0+$/, '')} 亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(2).replace(/\.?0+$/, '')} 万`;
  return n.toLocaleString('zh-CN');
}

export function switchLimitToneFor(buyStatus) {
  switch (buyStatus) {
    case 'open':
      return 'emerald';
    case 'limit_large':
    case 'limit':
      return 'amber';
    case 'suspended':
    case 'closed':
      return 'red';
    default:
      return 'slate';
  }
}

export function switchLimitLabelFor(buyStatus) {
  switch (buyStatus) {
    case 'open':
      return '正常申购';
    case 'limit_large':
      return '限大额';
    case 'limit':
      return '限额';
    case 'suspended':
      return '暂停申购';
    case 'closed':
      return '已关闭';
    default:
      return buyStatus || '未知';
  }
}

export function isAppChannelFund(fund = {}) {
  const shareClass = String(fund?.share_class || '').trim().toUpperCase();
  return Boolean(shareClass) && shareClass !== 'A' && shareClass !== 'C';
}

export function hasAppLimitChannel(limit = {}) {
  const channel = String(limit?.purchaseChannel || limit?.limitChannel || '').trim().toLowerCase();
  if (channel === 'app' || channel === 'direct') return true;
  if (String(limit?.code || '').trim() === '000834' && Number(limit?.maxPurchasePerDay) === 500) return true;
  const text = String(limit?.purchaseChannelText || limit?.limitChannelText || limit?.buyStatusText || '').trim();
  return /直销|APP|App|app|官网|微信公众|直销柜台/.test(text);
}

export function shouldShowAppTag(fund = {}, limit = {}) {
  return isAppChannelFund(fund) || hasAppLimitChannel(limit);
}

export function nowIso() {
  return new Date().toISOString();
}

export function nasdaqListPath(inPagesDir) {
  return inPagesDir ? `../data/all_nasdq.json` : `./data/all_nasdq.json`;
}

export async function loadNasdaqList({ inPagesDir = false } = {}) {
  const response = await fetch(nasdaqListPath(inPagesDir), {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.etfs) ? payload.etfs : [];
}

export function nasdaqOtcListPath(inPagesDir) {
  return inPagesDir ? `../data/all_nasdq_otc.json` : `./data/all_nasdq_otc.json`;
}

export async function loadNasdaqOtcList({ inPagesDir = false } = {}) {
  const response = await fetch(nasdaqOtcListPath(inPagesDir), {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.funds) ? payload.funds : [];
}

export function otcGroupIdOf(fund) {
  if (!fund) return '';
  if (fund.kind === 'etf_link' && fund.link_to) return 'etf:' + fund.link_to;
  const name = String(fund.name || '');
  const m = name.match(/^(摩根|宝盈|南方|国泰|大成|广发|华安|博时|华夏|嘉实|富国|汇添富|华泰柏瑞|招商|易方达)/);
  if (m) return 'qdii:' + m[1];
  return 'self:' + (fund.code || '');
}

export function limitSortValue(limit) {
  if (!limit) return null;
  if (limit.buyStatus === 'suspended' || limit.buyStatus === 'closed') return -Infinity;
  const m = Number(limit.maxPurchasePerDay);
  if (Number.isFinite(m) && m > 0) return m;
  if (limit.buyStatus === 'open') return Infinity;
  return null;
}
