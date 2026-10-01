import { inScope, normalizeReturnInputs, validateReturnInputs } from './returnInputs.js';
import { buildSharesTimeline, resolveEffectiveWindow, valueAtBoundary } from './returnValuation.js';
import { netDailyGroupFlows } from './returnCashFlows.js';
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
  const resolved = resolveEffectiveWindow(input);
  const window = resolved.window;
  result.diagnostics.push(...resolved.diagnostics);
  if (!window) return { ...result, reason: resolved.diagnostics[0].reason };
  result.effectiveWindow = window;
  const relevant = new Set(
    input.transactions
      .filter((t) => inScope(t, input.scope) && (!t.date || t.date <= window.to))
      .map((t) => t.id)
  );
  result.diagnostics = result.diagnostics.filter(
    (d) => !d.transactionId || relevant.has(d.transactionId) || d.unassignable
  );
  const scoped = input.transactions.filter((t) => inScope(t, input.scope) && t.date <= window.to);
  const shares = buildSharesTimeline(scoped);
  result.diagnostics.push(...shares.diagnostics);
  const boundary = (date) =>
    valueAtBoundary({
      ...shares,
      date,
      pricesByCode: input.pricesByCode,
      maxPriceAgeDays: input.maxPriceAgeDays,
      closedDatesByAsset: input.closedDatesByAsset
    });
  const start = boundary(window.startValuationDate);
  const end = boundary(window.endValuationDate);
  result.diagnostics.push(...start.diagnostics, ...end.diagnostics);
  result.startMarketValue = result.startValue = start.marketValue;
  result.endMarketValue = result.endValue = end.marketValue;
  const flows = netDailyGroupFlows({ ...input, to: window.to });
  Object.assign(result, flows);
  result.boundaryValuations = { start: start.valuations, end: end.valuations };
  const error = result.diagnostics.find((d) => d.severity === 'error');
  if (error)
    return {
      ...result,
      reason: error.reason,
      dataQuality: ['pending_transaction', 'unknown_confirmation_date'].includes(error.reason)
        ? 'provisional'
        : 'incomplete'
    };
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