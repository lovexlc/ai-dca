const DEFAULT_PROBE_TIMEOUT_MS = 4000;
export const SITE_UPDATE_NOTICE_ID = '2026-09-17-site-update';
export const SITE_UPDATE_TARGETS = [
  {
    id: 'cn',
    label: 'CN 国内站',
    shortLabel: 'CN',
    url: 'https://cn.freebacktrack.tech:5000',
    priority: 1
  },
  {
    id: 'fast',
    label: 'Fast 站点',
    shortLabel: 'Fast',
    url: 'https://fast.freebacktrack.tech',
    priority: 2
  }
];

function normalizeTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_PROBE_TIMEOUT_MS;
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function buildSiteUpdateUrl(origin, currentHref = '') {
  const rawOrigin = String(origin || '').trim();
  if (!rawOrigin) return '';
  try {
    const target = new URL(rawOrigin);
    if (currentHref) {
      const current = new URL(currentHref);
      target.pathname = current.pathname || '/';
      target.search = current.search;
      target.hash = current.hash;
    }
    return target.toString();
  } catch {
    return rawOrigin;
  }
}

export function isSiteUpdateTarget(href = '') {
  const currentHref = String(href || (typeof window !== 'undefined' ? window.location.href : '')).trim();
  if (!currentHref) return false;
  try {
    const currentOrigin = new URL(currentHref).origin;
    return SITE_UPDATE_TARGETS.some((target) => new URL(target.url).origin === currentOrigin);
  } catch {
    return false;
  }
}

function createProbeController(timeoutMs, externalSignal) {
  if (typeof AbortController === 'undefined') {
    return {
      signal: externalSignal,
      cancel() {}
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let onAbort = null;
  if (externalSignal) {
    onAbort = () => controller.abort();
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
      if (externalSignal && onAbort) {
        externalSignal.removeEventListener('abort', onAbort);
      }
    }
  };
}

function errorReason(error, timeoutMs) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return '连接超时（' + Math.round(timeoutMs / 1000) + ' 秒）';
  }
  return error?.message || '网络连接失败';
}

export async function probeSite(target, {
  fetchImpl = typeof globalThis !== 'undefined' ? globalThis.fetch : null,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  currentHref = typeof window !== 'undefined' ? window.location.href : '',
  signal
} = {}) {
  const requester = fetchImpl;
  const timeout = normalizeTimeout(timeoutMs);
  const startedAt = nowMs();
  const targetUrl = buildSiteUpdateUrl(target?.url, currentHref);

  if (!target?.url || typeof requester !== 'function') {
    return {
      ...target,
      targetUrl,
      ok: false,
      status: 0,
      latencyMs: 0,
      error: '浏览器不支持网络探活'
    };
  }

  const probeUrl = new URL(target.url);
  probeUrl.searchParams.set('site_probe', String(Date.now()));
  const controller = createProbeController(timeout, signal);

  try {
    const response = await requester(probeUrl.toString(), {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal
    });
    return {
      ...target,
      targetUrl,
      ok: true,
      status: Number(response?.status) || 0,
      latencyMs: Math.max(1, Math.round(nowMs() - startedAt)),
      error: ''
    };
  } catch (error) {
    return {
      ...target,
      targetUrl,
      ok: false,
      status: 0,
      latencyMs: Math.max(1, Math.round(nowMs() - startedAt)),
      error: errorReason(error, timeout)
    };
  } finally {
    controller.cancel();
  }
}

async function runSiteUpdateProbe(options = {}) {
  const currentHref = options.currentHref || (typeof window !== 'undefined' ? window.location.href : '');
  const results = await Promise.all(
    SITE_UPDATE_TARGETS.map((target) => probeSite(target, { ...options, currentHref }))
  );
  const recommended = results
    .filter((result) => result.ok)
    .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0))[0] || null;

  return {
    noticeId: SITE_UPDATE_NOTICE_ID,
    checkedAt: new Date().toISOString(),
    results,
    recommended
  };
}

let inFlightProbe = null;

export function probeSiteUpdates(options = {}) {
  const hasCustomRequester = Object.prototype.hasOwnProperty.call(options, 'fetchImpl')
    || Object.prototype.hasOwnProperty.call(options, 'signal')
    || Object.prototype.hasOwnProperty.call(options, 'currentHref');

  if (hasCustomRequester) {
    return runSiteUpdateProbe(options);
  }
  if (inFlightProbe) return inFlightProbe;

  inFlightProbe = runSiteUpdateProbe(options).finally(() => {
    inFlightProbe = null;
  });
  return inFlightProbe;
}

export function __resetSiteUpdateProbeForTests() {
  inFlightProbe = null;
}
