import { round, normalizeFundKind } from './holdingsLedgerBasics.js';

function buildChainId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `chain-${Date.now().toString(36)}-${rand}`;
}

export function normalizeSwitchChain(raw = {}) {
  const id = String(raw?.id || '').trim() || buildChainId();
  const name = String(raw?.name || '').trim();
  const rawLegs = Array.isArray(raw?.legs) ? raw.legs : [];
  const legs = rawLegs
    .map((leg) => ({
      buyTxId: String(leg?.buyTxId || '').trim(),
      sellTxId: leg?.sellTxId ? String(leg.sellTxId).trim() : ''
    }))
    .filter((leg) => leg.buyTxId);
  return { id, name, legs };
}

export function normalizeSwitchChains(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(normalizeSwitchChain);
}

function emptyChainMetrics(extra = {}) {
  return {
    segments: [],
    valid: false,
    validationError: '',
    chainReturn: 0,
    chainMultiple: 1,
    baselineCode: '',
    baselineStartPrice: 0,
    baselineEndPrice: 0,
    baselineEndSource: '',
    baselineAlignedToChainEnd: false,
    baselineReturn: 0,
    baselineMultiple: 1,
    advantage: 0,
    multipleAdvantage: 0,
    missingPriceCodes: [],
    initialCapital: 0,
    chainFinalValue: 0,
    chainProfit: 0,
    chainProfitRate: 0,
    baselineFinalValue: 0,
    baselineProfit: 0,
    advantageProfit: 0,
    cashFlowValid: false,
    cashFlowNote: '',
    ...extra
  };
}

export function computeSwitchChainMetrics(chain, transactions = [], snapshotsByCode = {}) {
  if (!chain || !Array.isArray(chain.legs) || chain.legs.length === 0) {
    return emptyChainMetrics({ validationError: '链路至少需要一段。' });
  }

  const txById = new Map();
  for (const tx of transactions || []) {
    if (tx && tx.id) txById.set(tx.id, tx);
  }

  const segments = [];
  const missingPriceCodes = new Set();
  let segmentsValid = true;

  for (let i = 0; i < chain.legs.length; i += 1) {
    const leg = chain.legs[i];
    const buyTx = txById.get(leg.buyTxId);
    if (!buyTx) {
      return emptyChainMetrics({ validationError: `第 ${i + 1} 段未找到买入交易。` });
    }
    if (buyTx.type !== 'BUY') {
      return emptyChainMetrics({
        validationError: `第 ${i + 1} 段需选择 BUY 交易（${buyTx.code}）。`
      });
    }

    const sellTx = leg.sellTxId ? txById.get(leg.sellTxId) : null;
    if (leg.sellTxId && !sellTx) {
      return emptyChainMetrics({ validationError: `第 ${i + 1} 段未找到卖出交易。` });
    }
    if (sellTx) {
      if (sellTx.type !== 'SELL') {
        return emptyChainMetrics({
          validationError: `第 ${i + 1} 段需选择 SELL 交易（${sellTx.code}）。`
        });
      }
      if (sellTx.code !== buyTx.code) {
        return emptyChainMetrics({
          validationError: `第 ${i + 1} 段买卖代码不一致（${buyTx.code} vs ${sellTx.code}）。`
        });
      }
      if (sellTx.date && buyTx.date && sellTx.date < buyTx.date) {
        return emptyChainMetrics({
          validationError: `第 ${i + 1} 段卖出日期早于买入日期。`
        });
      }
    }

    const segStart = Number(buyTx.price) || 0;
    let segEnd = 0;
    let segEndDate = '';
    let segEndSource = sellTx ? 'sell' : 'latestNav';

    if (sellTx) {
      segEnd = Number(sellTx.price) || 0;
      segEndDate = sellTx.date || '';
    } else {
      const snap = snapshotsByCode?.[buyTx.code] || null;
      segEnd = resolveSnapshotCurrentPrice(snap, buyTx.kind, buyTx.code, buyTx.name || snap?.name || '');
      segEndDate = String(snap?.latestNavDate || '');
      if (!(segEnd > 0)) missingPriceCodes.add(buyTx.code);
    }

    if (!(segStart > 0)) {
      missingPriceCodes.add(buyTx.code);
    }

    const segValid = segStart > 0 && segEnd > 0;
    const segMultiple = segValid ? segEnd / segStart : 1;
    const segReturn = segValid ? segMultiple - 1 : 0;
    if (!segValid) segmentsValid = false;

    segments.push({
      buyTxId: leg.buyTxId,
      sellTxId: leg.sellTxId || '',
      code: buyTx.code,
      name: buyTx.name || '',
      kind: buyTx.kind,
      buyDate: buyTx.date || '',
      buyPrice: round(segStart, 6),
      sellDate: segEndDate,
      sellPrice: round(segEnd, 6),
      segEndSource,
      segMultiple: round(segMultiple, 6),
      segReturn: round(segReturn, 6),
      buyShares: Number(buyTx.shares) || 0,
      sellShares: sellTx ? (Number(sellTx.shares) || 0) : 0,
      valid: segValid
    });
  }

  let chainMultiple = 1;
  for (const seg of segments) {
    chainMultiple *= seg.valid ? seg.segMultiple : 1;
  }
  const chainReturn = chainMultiple - 1;

  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];
  const baselineCode = firstSeg.code;
  const baselineStartPrice = firstSeg.buyPrice;

  let baselineEndPrice = 0;
  let baselineEndSource = '';
  let baselineAlignedToChainEnd = false;

  if (lastSeg.code === baselineCode && lastSeg.segEndSource === 'sell') {
    baselineEndPrice = lastSeg.sellPrice;
    baselineEndSource = 'leg-end';
    baselineAlignedToChainEnd = true;
  } else {
    const snap = snapshotsByCode?.[baselineCode] || null;
    baselineEndPrice = resolveSnapshotCurrentPrice(snap, firstSeg.kind, baselineCode, firstSeg.name);
    baselineEndSource = 'latestNav';
    if (!(baselineEndPrice > 0)) missingPriceCodes.add(baselineCode);
  }

  const baselineValid = baselineStartPrice > 0 && baselineEndPrice > 0;
  const baselineMultiple = baselineValid ? baselineEndPrice / baselineStartPrice : 1;
  const baselineReturn = baselineValid ? baselineMultiple - 1 : 0;

  const valid = segmentsValid && baselineValid;
  const advantage = valid ? chainReturn - baselineReturn : 0;
  const multipleAdvantage = valid ? chainMultiple - baselineMultiple : 0;

  let initialCapital = 0;
  let chainFinalValue = 0;
  let chainProfit = 0;
  let chainProfitRate = 0;
  let baselineFinalValue = 0;
  let baselineProfit = 0;
  let advantageProfit = 0;
  let cashFlowValid = false;
  let cashFlowNote = '';

  if (valid && firstSeg.buyShares > 0) {
    initialCapital = firstSeg.buyShares * firstSeg.buyPrice;
    let theoreticalShares = firstSeg.buyShares;
    let cashOnHand = 0;
    cashFlowValid = true;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (i === 0) {
        theoreticalShares = seg.buyShares;
      } else {
        if (!(seg.buyPrice > 0)) {
          cashFlowValid = false;
          cashFlowNote = `第 ${i + 1} 段买价为 0，无法换算份额。`;
          break;
        }
        theoreticalShares = cashOnHand / seg.buyPrice;
      }
      if (seg.segEndSource === 'sell') {
        if (i === 0 && seg.sellShares > 0) {
          cashOnHand = seg.sellShares * seg.sellPrice;
        } else {
          cashOnHand = theoreticalShares * seg.sellPrice;
        }
      } else {
        cashOnHand = theoreticalShares * seg.sellPrice;
      }
    }
    if (cashFlowValid) {
      chainFinalValue = cashOnHand;
      chainProfit = chainFinalValue - initialCapital;
      chainProfitRate = initialCapital > 0 ? chainProfit / initialCapital : 0;
      baselineFinalValue = firstSeg.buyShares * baselineEndPrice;
      baselineProfit = baselineFinalValue - initialCapital;
      advantageProfit = chainProfit - baselineProfit;
    }
  } else if (!valid) {
    cashFlowNote = '缺净值或段不完整，无法计算实际盈亏。';
  } else {
    cashFlowNote = '首段买入份额为 0，无法计算实际盈亏。';
  }

  return {
    segments,
    valid,
    validationError: '',
    chainReturn: round(chainReturn, 6),
    chainMultiple: round(chainMultiple, 6),
    baselineCode,
    baselineStartPrice: round(baselineStartPrice, 6),
    baselineEndPrice: round(baselineEndPrice, 6),
    baselineEndSource,
    baselineAlignedToChainEnd,
    baselineReturn: round(baselineReturn, 6),
    baselineMultiple: round(baselineMultiple, 6),
    advantage: round(advantage, 6),
    multipleAdvantage: round(multipleAdvantage, 6),
    missingPriceCodes: Array.from(missingPriceCodes),
    initialCapital: round(initialCapital, 4),
    chainFinalValue: round(chainFinalValue, 4),
    chainProfit: round(chainProfit, 4),
    chainProfitRate: round(chainProfitRate, 6),
    baselineFinalValue: round(baselineFinalValue, 4),
    baselineProfit: round(baselineProfit, 4),
    advantageProfit: round(advantageProfit, 4),
    cashFlowValid,
    cashFlowNote
  };
}
