const HOME_DASHBOARD_KEY = 'aiDcaHomeDashboardState';
const HOME_DASHBOARD_SOURCE = 'qqq-home-dashboard';
const FUND_CODE_PATTERN = /^\d{6}$/;

function normalizeCodes(codes = [], availableCodes = []) {
  const available = new Set(Array.isArray(availableCodes) ? availableCodes.filter(Boolean) : []);
  const hasAvailabilityGuard = available.size > 0;

  return [...new Set(
    (Array.isArray(codes) ? codes : [])
      .map((code) => String(code || '').trim())
      .filter((code) => FUND_CODE_PATTERN.test(code))
      .filter((code) => !hasAvailabilityGuard || available.has(code))
  )];
}

export function buildHomeDashboardState(overrides = {}) {
  return {
    watchlistCodes: [],
    selectedCode: '',
    ...overrides
  };
}

export function normalizeHomeDashboardState(rawState, { availableCodes = [], defaultCodes = [] } = {}) {
  const normalizedDefaultCodes = normalizeCodes(defaultCodes, availableCodes);
  const normalizedWatchlistCodes = normalizeCodes(rawState?.watchlistCodes, availableCodes);
  const watchlistCodes = normalizedWatchlistCodes.length ? normalizedWatchlistCodes : normalizedDefaultCodes;
  const selectedCode = watchlistCodes.includes(String(rawState?.selectedCode || '').trim())
    ? String(rawState?.selectedCode || '').trim()
    : watchlistCodes[0] || '';

  return buildHomeDashboardState({
    watchlistCodes,
    selectedCode
  });
}

export function readHomeDashboardState() {
  if (typeof window === 'undefined') {
    return buildHomeDashboardState();
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(HOME_DASHBOARD_KEY) || 'null');
    return normalizeHomeDashboardState(saved);
  } catch {
    return buildHomeDashboardState();
  }
}

export function persistHomeDashboardState(state) {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = {
    source: HOME_DASHBOARD_SOURCE,
    version: 1,
    watchlistCodes: normalizeCodes(state?.watchlistCodes),
    selectedCode: String(state?.selectedCode || '').trim(),
    updatedAt: new Date().toISOString()
  };

  window.localStorage.setItem(HOME_DASHBOARD_KEY, JSON.stringify(payload));
}

export function exportHomeDashboardState(state) {
  return JSON.stringify({
    source: HOME_DASHBOARD_SOURCE,
    version: 1,
    watchlistCodes: normalizeCodes(state?.watchlistCodes),
    selectedCode: String(state?.selectedCode || '').trim(),
    exportedAt: new Date().toISOString()
  }, null, 2);
}

export function importHomeDashboardState(rawText, { availableCodes = [], defaultCodes = [] } = {}) {
  let parsed;

  try {
    parsed = JSON.parse(String(rawText || ''));
  } catch {
    throw new Error('导入文件不是合法的 JSON。');
  }

  const normalized = normalizeHomeDashboardState(parsed, { availableCodes, defaultCodes });
  if (!normalized.watchlistCodes.length) {
    throw new Error('导入文件里没有可用的 6 位基金代码。');
  }

  return normalized;
}
