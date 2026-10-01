import { cents, daysBetween, validDate } from './returnInputs.js';

const failure = (reason) => ({ returnRate: null, reason });
export function calculateModifiedDietz({ startValue, endValue, from, to, cashFlows = [] }) {
  if (!validDate(from) || !validDate(to) || daysBetween(from, to) <= 0) return failure('invalid_duration');
  if (
    ![startValue, endValue].every(Number.isFinite) ||
    cashFlows.some((f) => !Number.isFinite(f.amount) || !validDate(f.date) || f.date < from || f.date > to)
  )
    return failure('invalid_values_or_flows');
  const duration = daysBetween(from, to);
  const netInvestment = cashFlows.reduce((sum, f) => sum + cents(f.amount), 0) / 100;
  const weightedFlows = cashFlows.map((f) => ({ ...f, weight: daysBetween(f.date, to) / duration }));
  const denominator = startValue + weightedFlows.reduce((sum, f) => sum + f.weight * f.amount, 0);
  const profit = (cents(endValue) - cents(startValue) - cents(netInvestment)) / 100;
  return {
    returnRate: denominator > 0 ? profit / denominator : null,
    reason: denominator > 0 ? null : 'non_positive_denominator',
    profit,
    netInvestment,
    denominator,
    weightedFlows
  };
}

// Each point is a complete closing valuation; flows occur at that day's close.
export function calculateTwr({ valuations = [], cashFlows = [], from, to }) {
  if (valuations.length < 2) return failure('missing_segment_valuations');
  const sorted = [...valuations].sort((a, b) => a.date.localeCompare(b.date));
  if ((from && sorted[0].date !== from) || (to && sorted.at(-1).date !== to))
    return failure('missing_segment_valuations');
  if (
    sorted.some(
      (p, i) =>
        !validDate(p.date) ||
        !Number.isFinite(p.value) ||
        p.value < 0 ||
        (i > 0 && daysBetween(sorted[i - 1].date, p.date) !== 1)
    )
  )
    return failure('missing_segment_valuations');
  if (
    cashFlows.some(
      (f) =>
        !validDate(f.date) ||
        !Number.isFinite(f.amount) ||
        f.date <= sorted[0].date ||
        f.date > sorted.at(-1).date ||
        (f.timing && f.timing !== 'endOfDay')
    )
  )
    return failure('invalid_flow_timing');
  let product = 1;
  const dailyReturns = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].value <= 0) return failure('non_positive_denominator');
    const flow =
      cashFlows.filter((f) => f.date === sorted[i].date).reduce((sum, f) => sum + cents(f.amount), 0) / 100;
    const rate = (sorted[i].value - flow) / sorted[i - 1].value - 1;
    if (rate < -1) return failure('invalid_segment_value');
    dailyReturns.push({ date: sorted[i].date, returnRate: rate });
    product *= 1 + rate;
  }
  return { returnRate: product - 1, reason: null, dailyReturns };
}

// Solve in log(1+r), isolating roots recursively at derivative roots.
// For exponential sums this avoids missing tangent roots or choosing one of multiple roots.
function rootsOfExponential(terms, low, high) {
  if (terms.length < 2) return [];
  const firstExponent = terms[0].t;
  const shifted = terms.map((p) => ({ a: p.a, t: p.t - firstExponent }));
  const evaluate = (x) => {
    const scale = Math.max(...shifted.map((p) => -p.t * x));
    return shifted.reduce((sum, p) => sum + p.a * Math.exp(-p.t * x - scale), 0);
  };
  const derivative = shifted.slice(1).map((p) => ({ a: -p.t * p.a, t: p.t }));
  const critical = rootsOfExponential(derivative, low, high);
  const boundaries = [low, ...critical, high];
  const roots = [];
  const tolerance = shifted.reduce((sum, p) => sum + Math.abs(p.a), 0) * 1e-12;
  for (const x of critical) if (Math.abs(evaluate(x)) <= tolerance) roots.push(x);
  for (let i = 1; i < boundaries.length; i++) {
    let left = boundaries[i - 1];
    let right = boundaries[i];
    let fl = evaluate(left);
    const fr = evaluate(right);
    if (Math.abs(fl) <= tolerance) roots.push(left);
    if (Math.abs(fr) <= tolerance) roots.push(right);
    if (fl * fr >= 0) continue;
    for (let n = 0; n < 160 && right - left > 1e-13; n++) {
      const mid = (left + right) / 2;
      const fm = evaluate(mid);
      if (fl * fm <= 0) right = mid;
      else {
        left = mid;
        fl = fm;
      }
    }
    roots.push((left + right) / 2);
  }
  return roots.sort((a, b) => a - b).filter((x, i, all) => i === 0 || Math.abs(x - all[i - 1]) > 1e-7);
}

export function solveXirr(cashFlows = []) {
  if (cashFlows.some((f) => !validDate(f.date) || !Number.isFinite(f.amount)))
    return failure('invalid_values_or_flows');
  const grouped = new Map();
  for (const f of cashFlows) grouped.set(f.date, (grouped.get(f.date) || 0) + cents(f.amount));
  const flows = [...grouped]
    .map(([date, amount]) => ({ date, amount: amount / 100 }))
    .filter((f) => f.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (grouped.size < 2) return failure('zero_duration');
  if (!flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0))
    return failure('missing_positive_or_negative_flow');
  const terms = flows.map((f) => ({ a: f.amount, t: daysBetween(flows[0].date, f.date) / 365 }));
  const roots = rootsOfExponential(terms, -30, 30);
  if (roots.length !== 1)
    return {
      ...failure(roots.length ? 'multiple_roots' : 'no_root_in_search_range'),
      roots: roots.map(Math.expm1),
      searchRange: { logOnePlusRate: [-30, 30] }
    };
  const returnRate = Math.expm1(roots[0]);
  const residual = terms.reduce((sum, p) => sum + p.a * Math.exp(-p.t * roots[0]), 0);
  if (
    !Number.isFinite(residual) ||
    Math.abs(residual) > Math.max(1e-7, flows.reduce((sum, f) => sum + Math.abs(f.amount), 0) * 1e-8)
  )
    return failure('numerical_residual');
  return { returnRate, reason: null, residual, annualized: true, searchRange: { logOnePlusRate: [-30, 30] } };
}