export function numberValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeClass(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'H' || normalized === 'L' ? normalized : '';
}

function findFund(funds, code) {
  return (Array.isArray(funds) ? funds : []).find((fund) => String(fund?.code || '') === String(code || '')) || null;
}

export function premiumOf(fund) {
  return numberValue(fund?.premiumPct ?? fund?.premiumRate);
}

function spreadForClasses(fromFund, toFund, fromClass, toClass) {
  const fromPremium = premiumOf(fromFund);
  const toPremium = premiumOf(toFund);
  if (fromPremium === null || toPremium === null) return null;
  if (fromClass === 'H' && toClass === 'L') return fromPremium - toPremium;
  if (fromClass === 'L' && toClass === 'H') return toPremium - fromPremium;
  return null;
}

function mergeFund(fund, code, name, snapshot = {}) {
  return {
    ...(fund || {}),
    code,
    name: name || fund?.name || code,
    latestNav: numberValue(fund?.latestNav ?? fund?.latestPrice ?? snapshot.price),
    navLatest: numberValue(fund?.navLatest ?? snapshot.nav),
    premiumPct: numberValue(fund?.premiumPct ?? fund?.premiumRate ?? snapshot.premiumPct),
    premiumRate: numberValue(fund?.premiumRate ?? fund?.premiumPct ?? snapshot.premiumPct),
    highPoint: numberValue(fund?.highPoint ?? snapshot.highPoint),
    yearHigh: numberValue(fund?.yearHigh ?? snapshot.yearHigh),
    historicalPercentile: numberValue(fund?.historicalPercentile ?? snapshot.historicalPercentile),
    turnover: numberValue(fund?.turnover ?? fund?.turnoverAmount ?? snapshot.turnover),
    amount: numberValue(fund?.amount ?? fund?.成交额 ?? snapshot.amount),
    asOf: fund?.asOf || snapshot.asOf || snapshot.computedAt || ''
  };
}

export function classifySwitchOpportunity({ fromClass, toClass, gap, sellLower, buyOther }) {
  const normalizedGap = numberValue(gap);
  const lowerThreshold = numberValue(sellLower);
  const upperThreshold = numberValue(buyOther);
  if (normalizedGap === null) return '';
  if (fromClass === 'L' && toClass === 'H' && lowerThreshold !== null && normalizedGap <= lowerThreshold) return 'A';
  if (fromClass === 'H' && toClass === 'L' && upperThreshold !== null && normalizedGap >= upperThreshold) return 'B';
  return '';
}

export function getSwitchOpportunityAdvantage(pair) {
  const gap = numberValue(pair?.spread);
  const threshold = numberValue(pair?.threshold);
  if (gap === null || threshold === null) return null;
  if (pair?.rule === 'A') return threshold - gap;
  if (pair?.rule === 'B') return gap - threshold;
  return null;
}

function comparePairs(a, b) {
  const aAdvantage = getSwitchOpportunityAdvantage(a);
  const bAdvantage = getSwitchOpportunityAdvantage(b);
  if (aAdvantage !== null || bAdvantage !== null) {
    if (aAdvantage === null) return 1;
    if (bAdvantage === null) return -1;
    if (aAdvantage !== bAdvantage) return bAdvantage - aAdvantage;
  }
  const aSpread = numberValue(a?.spread);
  const bSpread = numberValue(b?.spread);
  if (aSpread === null) return bSpread === null ? 0 : 1;
  if (bSpread === null) return -1;
  return bSpread - aSpread;
}

function inferClasses(rule, fromClass, toClass) {
  if (fromClass && toClass) return { fromClass, toClass };
  if (rule === 'A') return { fromClass: fromClass || 'L', toClass: toClass || 'H' };
  if (rule === 'B') return { fromClass: fromClass || 'H', toClass: toClass || 'L' };
  return { fromClass, toClass };
}

function mergeAvailable(base = {}, next = {}) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === undefined || value === '') continue;
    merged[key] = value;
  }
  return merged;
}

export function buildFundSwitchOpportunityModel({ snapshot = null, signals = [], funds = [], prefs = {}, otcSignal = null } = {}) {
  const classMap = prefs?.premiumClass && typeof prefs.premiumClass === 'object' ? prefs.premiumClass : {};
  const sellLower = numberValue(snapshot?.intraSellLowerPct ?? prefs?.intraSellLowerPct);
  const buyOther = numberValue(snapshot?.intraBuyOtherPct ?? prefs?.intraBuyOtherPct);
  const candidates = [];
  const pairByKey = new Map();
  const signalByKey = new Map();

  for (const signal of Array.isArray(signals) ? signals : []) {
    const from = String(signal?.from || signal?.fromCode || '').trim();
    const to = String(signal?.to || signal?.toCode || '').trim();
    if (!from || !to) continue;
    signalByKey.set(`${from}:${to}`, signal);
  }

  function addPair(input) {
    const from = String(input?.from || '').trim();
    const to = String(input?.to || '').trim();
    if (!from || !to || from === to) return;
    const key = `${from}:${to}`;
    const signal = signalByKey.get(key) || input?.signal || null;
    const signalRule = String(signal?.kind || signal?.rule || '').trim().toUpperCase();
    const initialFromClass = normalizeClass(classMap[from] || input?.fromClass);
    const initialToClass = normalizeClass(classMap[to] || input?.toClass);
    const classes = inferClasses(signalRule, initialFromClass, initialToClass);
    if (!classes.fromClass || !classes.toClass || classes.fromClass === classes.toClass) return;
    const fromFund = mergeFund(findFund(funds, from), from, input?.fromName, input?.fromSnapshot);
    const toFund = mergeFund(findFund(funds, to), to, input?.toName, input?.toSnapshot);
    const spread = numberValue(signal?.gapPct ?? signal?.diffPct ?? input?.spread)
      ?? spreadForClasses(fromFund, toFund, classes.fromClass, classes.toClass);
    const computedRule = classifySwitchOpportunity({
      fromClass: classes.fromClass,
      toClass: classes.toClass,
      gap: spread,
      sellLower,
      buyOther
    });
    const signalMatchesClasses = (signalRule === 'A' && classes.fromClass === 'L' && classes.toClass === 'H')
      || (signalRule === 'B' && classes.fromClass === 'H' && classes.toClass === 'L');
    const rule = signalMatchesClasses ? signalRule : computedRule;
    const threshold = (signalMatchesClasses ? numberValue(signal?.threshold) : null)
      ?? (rule === 'A' ? sellLower : rule === 'B' ? buyOther : null);
    const pair = {
      from,
      fromName: fromFund.name,
      fromClass: classes.fromClass,
      to,
      toName: toFund.name,
      toClass: classes.toClass,
      fromFund,
      toFund,
      spread,
      threshold,
      rule,
      description: String(signal?.description || '').trim(),
      computedAt: signal?.computedAt || input?.computedAt || snapshot?.computedAt || ''
    };
    const existing = pairByKey.get(key);
    if (existing) {
      const merged = {
        ...mergeAvailable(existing, pair),
        fromFund: mergeAvailable(existing.fromFund, pair.fromFund),
        toFund: mergeAvailable(existing.toFund, pair.toFund)
      };
      pairByKey.set(key, merged);
      candidates[candidates.indexOf(existing)] = merged;
      return;
    }
    pairByKey.set(key, pair);
    candidates.push(pair);
  }

  for (const group of Array.isArray(snapshot?.byBenchmark) ? snapshot.byBenchmark : []) {
    const benchmarkCode = String(group?.benchmarkCode || '').trim();
    const benchmarkClass = normalizeClass(classMap[benchmarkCode] || group?.benchmarkClass);
    if (!benchmarkCode || !benchmarkClass) continue;
    const benchmarkSnapshot = {
      price: group.benchmarkPrice,
      nav: group.benchmarkNav,
      premiumPct: group.benchmarkPremiumPct,
      highPoint: group.benchmarkHighPoint,
      yearHigh: group.benchmarkYearHigh,
      historicalPercentile: group.benchmarkHistoricalPercentile,
      turnover: group.benchmarkTurnover,
      amount: group.benchmarkAmount,
      computedAt: snapshot?.computedAt
    };
    for (const candidate of Array.isArray(group?.candidates) ? group.candidates : []) {
      const candidateCode = String(candidate?.code || '').trim();
      const candidateClass = normalizeClass(classMap[candidateCode] || candidate?.candClass);
      const rawDiff = numberValue(candidate?.spreadVsBenchmarkPct);
      const gap = rawDiff === null ? null : (benchmarkClass === 'H' ? rawDiff : -rawDiff);
      addPair({
        from: benchmarkCode,
        fromName: group?.benchmarkName,
        fromClass: benchmarkClass,
        fromSnapshot: benchmarkSnapshot,
        to: candidateCode,
        toName: candidate?.name,
        toClass: candidateClass,
        toSnapshot: candidate,
        spread: gap,
        computedAt: snapshot?.computedAt
      });
    }
  }

  const benchmarkCodes = Array.isArray(prefs?.benchmarkCodes) ? prefs.benchmarkCodes.map(String) : [];
  const enabledCodes = Array.isArray(prefs?.enabledCodes) ? prefs.enabledCodes.map(String) : [];
  const pool = Array.from(new Set([...benchmarkCodes, ...enabledCodes]));
  for (const benchmarkCode of benchmarkCodes) {
    const benchmarkClass = normalizeClass(classMap[benchmarkCode]);
    if (!benchmarkClass) continue;
    for (const candidateCode of pool) {
      const candidateClass = normalizeClass(classMap[candidateCode]);
      if (!candidateClass || candidateCode === benchmarkCode || candidateClass === benchmarkClass) continue;
      addPair({
        from: benchmarkCode,
        fromClass: benchmarkClass,
        to: candidateCode,
        toClass: candidateClass
      });
    }
  }

  for (const [key, signal] of signalByKey) {
    if (pairByKey.has(key)) continue;
    addPair({
      from: signal?.from || signal?.fromCode,
      fromName: signal?.fromName,
      to: signal?.to || signal?.toCode,
      toName: signal?.toName,
      spread: signal?.gapPct ?? signal?.diffPct,
      signal
    });
  }

  const candidatePairs = candidates.sort(comparePairs);
  const opportunityPairs = candidatePairs.filter((pair) => pair.rule === 'A' || pair.rule === 'B').sort(comparePairs);
  const hasOtcOpportunity = Boolean(otcSignal?.ready && otcSignal?.triggered);
  return {
    candidatePairs,
    opportunityPairs,
    candidateCount: candidatePairs.length,
    opportunityCount: opportunityPairs.length + (hasOtcOpportunity ? 1 : 0),
    hasOtcOpportunity
  };
}
