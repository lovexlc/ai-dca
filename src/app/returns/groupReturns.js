import { inScope, normalizeReturnInputs, validateReturnInputs } from './returnInputs.js';
import { buildSharesTimeline, resolveEffectiveWindow, valueAtBoundary } from './returnValuation.js';
import { buildSwitchBridgeTimeline, netDailyGroupFlows, resolveSwitchPairs } from './returnCashFlows.js';
import { calculateModifiedDietz } from './returnMath.js';

/** Pure, offline API. Provide the full ledger and dated unadjusted pricesByCode. */
export function calculateGroupReturn(raw = {}) {
  const input = normalizeReturnInputs(raw);
  const validation = validateReturnInputs(input);
  const result = {
    method: 'modifiedDietz',
    scope: input.scope,
    requestedWindow: { from: input.from, to: input.to },
    effectiveWindow: null,
    startMarketValue: null,
    endMarketValue: null,
    startBridgeValue: null,
    endBridgeValue: null,
    startValue: null,
    endValue: null,
    netInvestment: null,
    offsetAmount: null,
    profit: null,
    returnRate: null,
    reason: null,
    dataQuality: 'incomplete',
    diagnostics: validation.diagnostics
  };
  const window = resolveEffectiveWindow(input).window;
  if (!window) return { ...result, reason: 'invalid_window' };
  result.effectiveWindow = window;
  // Unrelated group errors cannot invalidate this group's ledger. Identity errors
  // remain global, because pairing references are resolved across the full ledger.
  const relevant = new Set(
    input.transactions
      .filter((t) => inScope(t, input.scope) && (!t.date || t.date <= input.to))
      .map((t) => t.id)
  );
  result.diagnostics = validation.diagnostics.filter(
    (d) => !d.transactionId || relevant.has(d.transactionId) || d.reason === 'duplicate_id'
  );
  const { pairs, diagnostics: pairDiagnostics } = resolveSwitchPairs(input.transactions, input.scope);
  result.diagnostics.push(...pairDiagnostics.filter((d) => relevant.has(d.transactionId)));
  const scoped = input.transactions.filter((t) => inScope(t, input.scope) && t.date <= input.to);
  const shares = buildSharesTimeline(scoped);
  result.diagnostics.push(...shares.diagnostics);
  const boundary = (date) =>
    valueAtBoundary({
      ...shares,
      date,
      pricesByCode: input.pricesByCode,
      maxPriceAgeDays: input.maxPriceAgeDays
    });
  const start = boundary(window.startValuationDate);
  const end = boundary(window.endValuationDate);
  result.diagnostics.push(...start.diagnostics, ...end.diagnostics);
  const bridge = buildSwitchBridgeTimeline(pairs);
  result.startMarketValue = start.marketValue;
  result.endMarketValue = end.marketValue;
  result.startBridgeValue = bridge.valueAt(window.startValuationDate);
  result.endBridgeValue = bridge.valueAt(window.endValuationDate);
  result.startValue = start.marketValue === null ? null : start.marketValue + result.startBridgeValue;
  result.endValue = end.marketValue === null ? null : end.marketValue + result.endBridgeValue;
  const flows = netDailyGroupFlows({ ...input, pairs });
  Object.assign(result, flows);
  result.switchPairs = pairs;
  result.bridgeEvents = bridge.events;
  result.boundaryValuations = { start: start.valuations, end: end.valuations };
  const error = result.diagnostics.find((d) => d.severity === 'error');
  if (error) return { ...result, reason: error.reason };
  const math = calculateModifiedDietz({
    startValue: result.startValue,
    endValue: result.endValue,
    from: window.startValuationDate,
    to: window.endValuationDate,
    cashFlows: flows.dailyFlows
  });
  Object.assign(result, math);
  result.dataQuality =
    math.returnRate === null ? 'incomplete' : result.diagnostics.length ? 'estimated' : 'complete';
  return result;
}