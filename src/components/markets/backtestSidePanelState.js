import { SWITCH_STRATEGY_ETFS } from '../../app/nasdaqCatalog.js';
import { normalizeCnFundCode } from '../../pages/markets/marketDisplayUtils.js';

const DETAIL_BACKTEST_FALLBACK_PAIRS = Object.freeze({
  '513100': { highCodes: ['513100'], lowCodes: ['159501'] },
  '159501': { highCodes: ['513100'], lowCodes: ['159501'] },
});

const ETF_INDEX_BY_CODE = Object.freeze(Object.fromEntries(
  SWITCH_STRATEGY_ETFS
    .map((item) => {
      const code = normalizeCnFundCode(item?.code);
      return code ? [code, String(item?.index_key || '').trim()] : null;
    })
    .filter(Boolean)
));

function uniqueCodes(list = []) {
  return Array.from(new Set(
    (Array.isArray(list) ? list : [])
      .map((item) => normalizeCnFundCode(item))
      .filter(Boolean)
  ));
}

function clonePair(pair) {
  return {
    highCodes: [...(pair?.highCodes || [])],
    lowCodes: [...(pair?.lowCodes || [])]
  };
}

function derivePairFromSwitchPrefs(code, switchPrefs = null) {
  if (!switchPrefs || typeof switchPrefs !== 'object') return null;

  const premiumClass = switchPrefs?.premiumClass && typeof switchPrefs.premiumClass === 'object'
    ? Object.fromEntries(Object.entries(switchPrefs.premiumClass)
      .map(([rawCode, rawClass]) => [normalizeCnFundCode(rawCode), String(rawClass || '').trim().toUpperCase()])
      .filter(([normalizedCode, normalizedClass]) => normalizedCode && (normalizedClass === 'H' || normalizedClass === 'L')))
    : {};

  const currentClass = premiumClass[code];
  if (currentClass !== 'H' && currentClass !== 'L') return null;

  const targetClass = currentClass === 'H' ? 'L' : 'H';
  const configuredCodes = uniqueCodes([
    ...(switchPrefs?.benchmarkCodes || []),
    ...(switchPrefs?.enabledCodes || []),
    ...Object.keys(premiumClass),
  ]);

  const candidates = configuredCodes.filter((item) => item !== code && premiumClass[item] === targetClass);
  if (!candidates.length) return null;

  const indexKey = ETF_INDEX_BY_CODE[code] || '';
  const sameIndexCandidates = indexKey
    ? candidates.filter((item) => ETF_INDEX_BY_CODE[item] === indexKey)
    : [];
  const counterpart = (sameIndexCandidates[0] || candidates[0] || '').trim();
  if (!counterpart) return null;

  return currentClass === 'H'
    ? { highCodes: [code], lowCodes: [counterpart] }
    : { highCodes: [counterpart], lowCodes: [code] };
}

export function deriveDefaultBacktestCodes(symbol, { switchPrefs = null } = {}) {
  console.log('[backtestState] deriveDefaultBacktestCodes called:', { symbol, switchPrefs });

  const code = normalizeCnFundCode(symbol);
  console.log('[backtestState] normalized code:', code);

  if (!code) {
    const fallbackSymbol = String(symbol || '').trim().toUpperCase();
    const result = { highCodes: fallbackSymbol ? [fallbackSymbol] : [], lowCodes: [] };
    console.log('[backtestState] no code, returning fallback:', result);
    return result;
  }

  const switchPair = derivePairFromSwitchPrefs(code, switchPrefs);
  console.log('[backtestState] switchPair from prefs:', switchPair);

  if (switchPair) {
    console.log('[backtestState] returning switchPair');
    return switchPair;
  }

  const fallbackPair = DETAIL_BACKTEST_FALLBACK_PAIRS[code];
  console.log('[backtestState] fallbackPair:', fallbackPair);

  if (fallbackPair) {
    const cloned = clonePair(fallbackPair);
    console.log('[backtestState] returning cloned fallbackPair:', cloned);
    return cloned;
  }

  const result = { highCodes: [code], lowCodes: [] };
  console.log('[backtestState] returning default pair:', result);
  return result;
}

export function selectBacktestBaseCandles({ dailyCandles = [], priceCandles = [], displayCandles = [] } = {}) {
  console.log('[backtestState] selectBacktestBaseCandles called:', {
    dailyCandlesLength: dailyCandles?.length,
    priceCandlesLength: priceCandles?.length,
    displayCandlesLength: displayCandles?.length
  });

  if (Array.isArray(dailyCandles) && dailyCandles.length >= 2) {
    console.log('[backtestState] selecting dailyCandles');
    return dailyCandles;
  }
  if (Array.isArray(priceCandles) && priceCandles.length >= 2) {
    console.log('[backtestState] selecting priceCandles');
    return priceCandles;
  }
  if (Array.isArray(displayCandles) && displayCandles.length >= 2) {
    console.log('[backtestState] selecting displayCandles');
    return displayCandles;
  }
  console.log('[backtestState] no valid candles found, returning empty array');
  return [];
}
