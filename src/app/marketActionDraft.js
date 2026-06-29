export const MARKET_ACTION_DRAFT_KEY = 'aiDcaMarketActionDraft';

const VALID_ACTIONS = new Set(['holding-buy', 'plan-new', 'dca-new', 'sell-new']);

function normalizeKind(value = '') {
  const kind = String(value || '').trim();
  if (kind === 'exchange' || kind === 'qdii') return kind;
  return 'otc';
}

export function buildMarketActionDraft({
  action = '',
  symbol = '',
  name = '',
  market = '',
  kind = '',
  price = 0,
  source = 'markets-detail',
} = {}) {
  const normalizedAction = VALID_ACTIONS.has(action) ? action : '';
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!normalizedAction || !normalizedSymbol) return null;
  return {
    action: normalizedAction,
    symbol: normalizedSymbol,
    name: String(name || '').trim(),
    market: String(market || '').trim(),
    kind: normalizeKind(kind),
    price: Number(price) > 0 ? Number(price) : 0,
    source: String(source || 'markets-detail'),
    createdAt: new Date().toISOString(),
  };
}

export function writeMarketActionDraft(draft) {
  if (typeof window === 'undefined' || !draft) return false;
  try {
    window.sessionStorage.setItem(MARKET_ACTION_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function readMarketActionDraft() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(MARKET_ACTION_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return buildMarketActionDraft(parsed);
  } catch {
    return null;
  }
}

export function clearMarketActionDraft() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(MARKET_ACTION_DRAFT_KEY);
  } catch {
    // ignore
  }
}
