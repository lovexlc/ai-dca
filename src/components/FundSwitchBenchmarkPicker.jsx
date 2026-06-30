import { useMemo, useState } from 'react';
import { trackFeatureEvent } from '../app/analytics.js';

const BENCHMARK_PICKER_DISMISSED_KEY = 'fundSwitch:benchmarkPickerDismissed';

export function FundSwitchBenchmarkPicker({
  fundsWithPremium,
  exchangeFunds,
  activeRule,
  setCodeClass,
  setCodeBenchmark
}) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(BENCHMARK_PICKER_DISMISSED_KEY) === 'true';
    } catch (_error) {
      return false;
    }
  });

  const options = useMemo(() => {
    const heldCodes = new Set(exchangeFunds.map((fund) => fund.code));
    const heldFunds = fundsWithPremium.filter((fund) => heldCodes.has(fund.code));
    const otherFunds = fundsWithPremium.filter((fund) => !heldCodes.has(fund.code));
    return [...heldFunds, ...otherFunds].slice(0, 8);
  }, [fundsWithPremium, exchangeFunds]);

  const activeBenchmarkCodes = Array.isArray(activeRule?.benchmarkCodes)
    ? activeRule.benchmarkCodes
    : [];
  const visible = !dismissed && activeBenchmarkCodes.length === 0 && options.length > 0;
  if (!visible) return null;

  function handlePick(code) {
    if (!code) return;
    trackFeatureEvent('switch_strategy', 'benchmark_picker_select', { code });
    setCodeClass(code, 'H');
    setCodeBenchmark(code, true);
  }

  function handleDismiss() {
    trackFeatureEvent('switch_strategy', 'benchmark_picker_dismiss', {});
    setDismissed(true);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(BENCHMARK_PICKER_DISMISSED_KEY, 'true');
    } catch (_error) {
      // ignore
    }
  }

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
      <div className="text-sm font-medium text-indigo-900">
        你目前持有哪只纳指 ETF？（选一个作为监控持仓）
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {options.map((fund) => (
          <button
            key={fund.code}
            type="button"
            onClick={() => handlePick(fund.code)}
            className="inline-flex items-center rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-100"
          >
            <span className="font-mono">{fund.code}</span>
            {fund.name ? <span className="ml-1.5 text-slate-500">{fund.name}</span> : null}
          </button>
        ))}
        <button
          type="button"
          onClick={handleDismiss}
          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          还没持有，先看模拟
        </button>
      </div>
    </div>
  );
}
