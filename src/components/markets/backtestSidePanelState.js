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
  const code = normalizeCnFundCode(symbol);

  if (!code) {
    const fallbackSymbol = String(symbol || '').trim().toUpperCase();
    return { highCodes: fallbackSymbol ? [fallbackSymbol] : [], lowCodes: [] };
  }

  const switchPair = derivePairFromSwitchPrefs(code, switchPrefs);

  if (switchPair) {
    return switchPair;
  }

  const fallbackPair = DETAIL_BACKTEST_FALLBACK_PAIRS[code];

  if (fallbackPair) {
    return clonePair(fallbackPair);
  }

  return { highCodes: [code], lowCodes: [] };
}

export function selectBacktestBaseCandles({ dailyCandles = [], priceCandles = [], displayCandles = [] } = {}) {
  if (Array.isArray(dailyCandles) && dailyCandles.length >= 2) {
    return dailyCandles;
  }
  if (Array.isArray(priceCandles) && priceCandles.length >= 2) {
    return priceCandles;
  }
  if (Array.isArray(displayCandles) && displayCandles.length >= 2) {
    return displayCandles;
  }
  return [];
}
