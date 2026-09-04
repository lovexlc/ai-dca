// 访问环境（中国大陆 / 海外）识别与站点切换横幅逻辑。
// 约定：
// - 纯函数不依赖浏览器 API，便于 node --test 覆盖；
// - 浏览器入口统一做 typeof window 守卫，构建期不会报错；
// - 只做提示，不做自动跳转，避免误判导致用户被强制带走。

export const REGION_CN = 'cn';
export const REGION_GLOBAL = 'global';

export const REGION_QUERY_KEY = 'region';
export const REGION_STORAGE_KEY = 'site:region';
export const REGION_BANNER_DISMISS_KEY = 'site:regionBannerDismissed';

// 默认站点域名，可被 VITE_SITE_ORIGIN_CN / VITE_SITE_ORIGIN_GLOBAL 覆盖。
export const DEFAULT_SITE_ORIGIN_GLOBAL = 'https://freebacktrack.tech';
export const DEFAULT_SITE_ORIGIN_CN = 'https://cn.freebacktrack.tech:5000';

// 仅中国大陆时区判定为国内，港澳台按海外处理（海外域名访问更顺畅）。
const CN_TIME_ZONES = new Set([
  'Asia/Shanghai',
  'Asia/Chongqing',
  'Asia/Chungking',
  'Asia/Harbin',
  'Asia/Urumqi',
  'Asia/Kashgar',
  'PRC'
]);

export function normalizeRegion(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (['cn', 'china', 'mainland', 'zh-cn', 'domestic'].includes(raw)) return REGION_CN;
  if (['global', 'overseas', 'intl', 'international', 'en', 'row'].includes(raw)) return REGION_GLOBAL;
  return '';
}

export function regionFromCountryCode(code) {
  const raw = String(code || '').trim().toUpperCase();
  if (!raw || raw === 'XX' || raw === 'T1') return '';
  return raw === 'CN' ? REGION_CN : REGION_GLOBAL;
}

export function regionFromTimeZone(timeZone) {
  const raw = String(timeZone || '').trim();
  if (!raw) return '';
  return CN_TIME_ZONES.has(raw) ? REGION_CN : REGION_GLOBAL;
}

export function regionFromLanguages(languages) {
  const list = Array.isArray(languages) ? languages : [languages];
  for (const item of list) {
    const raw = String(item || '').trim().toLowerCase();
    if (!raw) continue;
    if (raw.startsWith('zh-hant') || raw.startsWith('zh-tw') || raw.startsWith('zh-hk') || raw.startsWith('zh-mo')) {
      return REGION_GLOBAL;
    }
    if (raw === 'zh' || raw.startsWith('zh-cn') || raw.startsWith('zh-hans')) return REGION_CN;
    if (raw.startsWith('zh')) return REGION_CN;
    return REGION_GLOBAL;
  }
  return '';
}

/**
 * 识别优先级：显式 override > 边缘节点国家码 > 本地记忆 > 时区 > 浏览器语言。
 */
export function detectRegionFromEnvironment({
  override,
  countryCode,
  storedRegion,
  timeZone,
  languages
} = {}) {
  return (
    normalizeRegion(override) ||
    regionFromCountryCode(countryCode) ||
    normalizeRegion(storedRegion) ||
    regionFromTimeZone(timeZone) ||
    regionFromLanguages(languages) ||
    ''
  );
}

export function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  try {
    const url = new URL(withProtocol);
    return url.protocol + '//' + url.host;
  } catch {
    return '';
  }
}

/** host 比对时忽略 www. 前缀，避免同一站点被误判为需要跳转。 */
function hostKey(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

/**
 * 读取站点地区配置（Vite 环境变量，留空时用默认域名）。
 * - VITE_SITE_REGION：当前部署面向的地区（cn / global），留空则按域名判断。
 * - VITE_SITE_ORIGIN_CN：国内站点域名。
 * - VITE_SITE_ORIGIN_GLOBAL：海外站点域名。
 */
export function readSiteRegionConfig(env = {}) {
  return {
    siteRegion: normalizeRegion(env.VITE_SITE_REGION),
    cnOrigin: normalizeOrigin(env.VITE_SITE_ORIGIN_CN || DEFAULT_SITE_ORIGIN_CN),
    globalOrigin: normalizeOrigin(env.VITE_SITE_ORIGIN_GLOBAL || DEFAULT_SITE_ORIGIN_GLOBAL)
  };
}

export function originForRegion(config, region) {
  const target = normalizeRegion(region);
  if (!target) return '';
  return target === REGION_CN ? (config?.cnOrigin || '') : (config?.globalOrigin || '');
}

/** 跳转时保留当前 path / query / hash，避免用户丢失上下文。 */
export function buildRegionTargetUrl(origin, currentHref = '') {
  const base = normalizeOrigin(origin);
  if (!base) return '';
  try {
    const current = new URL(currentHref);
    const target = new URL(base);
    target.pathname = current.pathname;
    target.search = current.search;
    target.hash = current.hash;
    return target.toString();
  } catch {
    return base;
  }
}

const BANNER_COPY = {
  [REGION_CN]: {
    title: '检测到你正在中国大陆访问',
    description: '国内站点访问更快更稳定，点击立即切换',
    actionLabel: '前往国内站点'
  },
  [REGION_GLOBAL]: {
    title: 'Looks like you are visiting from outside mainland China',
    description: 'Our global site loads faster for you. Click to switch.',
    actionLabel: 'Go to global site'
  }
};

/**
 * 计算是否需要展示顶部横幅；返回 null 表示不展示。
 * 不展示的情况：地区未知、用户已关闭、当前站点已匹配访客地区、目标域名未配置。
 */
export function resolveRegionBanner({ region, config, currentHref = '', dismissed = false } = {}) {
  const visitorRegion = normalizeRegion(region);
  if (!visitorRegion || dismissed) return null;

  const siteRegion = normalizeRegion(config?.siteRegion);
  if (siteRegion && siteRegion === visitorRegion) return null;

  const targetUrl = buildRegionTargetUrl(originForRegion(config, visitorRegion), currentHref);
  if (!targetUrl) return null;

  try {
    if (currentHref && hostKey(new URL(currentHref).host) === hostKey(new URL(targetUrl).host)) return null;
  } catch {
    /* currentHref 不可解析时按需展示 */
  }

  return { region: visitorRegion, targetUrl, ...BANNER_COPY[visitorRegion] };
}

/* ------------------------------ 浏览器侧入口 ------------------------------ */

export function readRegionOverride(href = '') {
  try {
    const url = new URL(href);
    return normalizeRegion(url.searchParams.get(REGION_QUERY_KEY));
  } catch {
    return '';
  }
}

export function readStoredRegion() {
  if (typeof window === 'undefined') return '';
  try {
    return normalizeRegion(window.localStorage.getItem(REGION_STORAGE_KEY));
  } catch {
    return '';
  }
}

export function persistRegion(region) {
  const normalized = normalizeRegion(region);
  if (!normalized || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REGION_STORAGE_KEY, normalized);
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function isRegionBannerDismissed() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(REGION_BANNER_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissRegionBanner() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REGION_BANNER_DISMISS_KEY, '1');
  } catch {
    /* 隐私模式下忽略 */
  }
}

/** 同步兜底识别：override > 本地记忆 > 时区 > 语言。 */
export function detectRegionSync() {
  if (typeof window === 'undefined') return '';
  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    timeZone = '';
  }
  return detectRegionFromEnvironment({
    override: readRegionOverride(window.location?.href || ''),
    storedRegion: readStoredRegion(),
    timeZone,
    languages: Array.isArray(navigator?.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator?.language]
  });
}

/** 通过同源 /cdn-cgi/trace 拿到边缘节点国家码（Cloudflare），失败时返回空串。 */
export async function fetchEdgeCountryCode({ timeoutMs = 2500 } = {}) {
  if (typeof fetch !== 'function') return '';
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch('/cdn-cgi/trace', {
      signal: controller?.signal,
      cache: 'no-store',
      credentials: 'omit'
    });
    if (!res.ok) return '';
    const text = await res.text();
    return parseTraceCountryCode(text);
  } catch {
    return '';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function parseTraceCountryCode(text = '') {
  const match = /(?:^|\n)loc=([A-Za-z]{2})/.exec(String(text));
  return match ? match[1].toUpperCase() : '';
}
