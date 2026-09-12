import { fetchSwitchCollectorSnapshot } from './switchMarketCollector.js';
import { getRunnableSwitchRules, normalizeSwitchConfig } from './switchStrategy.js';

function text(value = '', max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function activeRuleOnlyConfig(inputConfig = {}) {
  const normalized = normalizeSwitchConfig({ ...inputConfig, enabled: true });
  const activeRule = (normalized.rules || []).find((rule) => rule.id === normalized.activeRuleId)
    || normalized.rules?.[0]
    || null;
  if (!activeRule) return normalizeSwitchConfig({ ...normalized, enabled: true, rules: [] });
  return normalizeSwitchConfig({
    ...normalized,
    enabled: true,
    activeRuleId: activeRule.id,
    rules: [{ ...activeRule, enabled: true }]
  });
}

function collectCodes(config) {
  const codes = [];
  const seen = new Set();
  for (const rule of config.rules || []) {
    for (const code of [...(rule.benchmarkCodes || []), ...(rule.enabledCodes || [])]) {
      const normalized = text(code, 12);
      if (!/^\d{6}$/.test(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      codes.push(normalized);
      if (codes.length >= 30) return codes;
    }
  }
  return codes;
}

function pairDiff(pairsByKey, from, to) {
  const row = pairsByKey[pairKey(from, to)];
  if (!row || !Number.isFinite(row.diffPct)) return null;
  return row.leftCode === from ? row.diffPct : -row.diffPct;
}

function classify(benchClass, candidateClass, gap, sellLower, buyOther) {
  if (!Number.isFinite(gap) || !['H', 'L'].includes(benchClass) || !['H', 'L'].includes(candidateClass) || benchClass === candidateClass) return 'none';
  if (benchClass === 'L' && gap <= sellLower) return 'A';
  if (benchClass === 'H' && gap >= buyOther) return 'B';
  return 'none';
}

function buildMarketView(collector, codes) {
  const funds = {};
  for (const code of codes) {
    const item = collector.funds?.[code] || {};
    funds[code] = {
      code,
      name: text(item.name || code, 80),
      price: Number.isFinite(item.price) ? item.price : null,
      iopv: Number.isFinite(item.iopv) ? item.iopv : null,
      premiumPct: item.valid && Number.isFinite(item.premiumPct) ? item.premiumPct : null,
      asOf: item.asOf || '',
      expiresAt: item.expiresAt || '',
      source: item.source || 'market-collector',
      valid: Boolean(item.valid),
      invalidReasons: item.invalidReasons || []
    };
  }
  const pairs = [];
  const pairsByKey = {};
  for (let i = 0; i < codes.length; i += 1) {
    for (let j = i + 1; j < codes.length; j += 1) {
      const left = funds[codes[i]];
      const right = funds[codes[j]];
      const valid = left.valid && right.valid && Number.isFinite(left.premiumPct) && Number.isFinite(right.premiumPct);
      const row = {
        pairKey: pairKey(left.code, right.code),
        leftCode: left.code,
        rightCode: right.code,
        diffPct: valid ? Number((left.premiumPct - right.premiumPct).toFixed(4)) : null,
        valid
      };
      pairs.push(row);
      pairsByKey[row.pairKey] = row;
    }
  }
  return {
    computedAt: collector.generatedAt || new Date().toISOString(),
    source: 'market-collector',
    codes,
    funds,
    pairs,
    pairsByKey,
    validFundCount: Object.values(funds).filter((item) => item.valid).length
  };
}

function buildRulePreview(rule, market) {
  const pool = Array.from(new Set([...(rule.benchmarkCodes || []), ...(rule.enabledCodes || [])]));
  const byBenchmark = [];
  const triggers = [];
  for (const benchmarkCode of rule.benchmarkCodes || []) {
    const bench = market.funds[benchmarkCode];
    const benchClass = rule.premiumClass?.[benchmarkCode] || null;
    const candidates = [];
    for (const code of pool) {
      if (code === benchmarkCode) continue;
      const item = market.funds[code];
      const candidateClass = rule.premiumClass?.[code] || null;
      const rawDiff = pairDiff(market.pairsByKey, benchmarkCode, code);
      const gap = benchClass === 'H' ? rawDiff : benchClass === 'L' && Number.isFinite(rawDiff) ? -rawDiff : NaN;
      const kind = classify(benchClass, candidateClass, gap, Number(rule.intraSellLowerPct), Number(rule.intraBuyOtherPct));
      const candidate = {
        code,
        name: item?.name || code,
        premiumPct: item?.premiumPct ?? null,
        spreadVsBenchmarkPct: rawDiff,
        candClass: candidateClass,
        valid: Boolean(item?.valid)
      };
      candidates.push(candidate);
      if (bench?.valid && item?.valid && kind !== 'none') {
        triggers.push({
          pairKey: `${rule.id}:${benchmarkCode}:${code}`,
          rule: kind,
          ruleId: rule.id,
          ruleName: rule.name,
          fromCode: benchmarkCode,
          toCode: code,
          fromName: bench?.name || benchmarkCode,
          toName: item?.name || code,
          diffPct: gap,
          gapPct: gap,
          threshold: kind === 'A' ? Number(rule.intraSellLowerPct) : Number(rule.intraBuyOtherPct),
          benchClass,
          candClass: candidateClass
        });
      }
    }
    byBenchmark.push({
      benchmarkCode,
      benchmarkName: bench?.name || benchmarkCode,
      benchmarkClass: benchClass,
      benchmarkPremiumPct: bench?.premiumPct ?? null,
      valid: Boolean(bench?.valid),
      candidates
    });
  }
  const ready = byBenchmark.some((group) => group.valid && group.candidates.some((item) => item.valid && Number.isFinite(item.spreadVsBenchmarkPct)));
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ready,
    premiumClass: rule.premiumClass || {},
    intraSellLowerPct: Number(rule.intraSellLowerPct),
    intraBuyOtherPct: Number(rule.intraBuyOtherPct),
    byBenchmark,
    triggers
  };
}

export async function runSwitchConfigDryRun(env, inputConfig = {}) {
  const config = activeRuleOnlyConfig(inputConfig);
  const rules = getRunnableSwitchRules(config, { forceEnabled: true });
  const codes = collectCodes(config);
  if (!rules.length) {
    const error = new Error('当前配置没有可运行的换基规则。');
    error.status = 400;
    error.code = 'SWITCH_TEST_RULE_REQUIRED';
    throw error;
  }
  if (codes.length < 2) {
    const error = new Error('测试至少需要 2 只已分类基金。');
    error.status = 400;
    error.code = 'SWITCH_TEST_CODES_REQUIRED';
    throw error;
  }
  const collector = await fetchSwitchCollectorSnapshot(env, codes);
  const market = buildMarketView(collector, codes);
  const rulePreviews = rules.map((rule) => buildRulePreview(rule, market));
  const triggers = rulePreviews.flatMap((item) => item.triggers || []);
  const snapshot = {
    computedAt: market.computedAt,
    source: market.source,
    activeRuleId: config.activeRuleId,
    ready: rulePreviews.some((item) => item.ready),
    rules: rulePreviews.map((item) => ({
      ruleId: item.ruleId,
      ruleName: item.ruleName,
      ready: item.ready,
      triggerCount: item.triggers.length,
      snapshot: item
    })),
    triggers
  };
  return {
    snapshot,
    summary: {
      ready: snapshot.ready,
      triggered: triggers.length,
      ruleCount: rulePreviews.length,
      readyRuleCount: rulePreviews.filter((item) => item.ready).length,
      fundCount: market.codes.length,
      validFundCount: market.validFundCount
    }
  };
}
