import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { readLedgerState } from '../../app/holdingsLedger.js';
import { aggregateByCode } from '../../app/holdingsLedgerCore.js';
import { SWITCH_STRATEGY_ETFS } from '../../app/nasdaqCatalog.js';
import { CN_ETF_WATCHLIST_PRESETS } from '../../app/marketsApi.js';
import { cx, inputClass } from '../experience-ui.jsx';
import { useClickOutside } from '../../hooks/useClickOutside.js';

const EXCHANGE_FUND_PREFIXES = new Set(['15', '50', '51', '52', '53', '54', '56', '58']);

function normalizeFundCode(value) {
  const match = /(\d{6})/.exec(String(value || '').trim());
  return match ? match[1] : '';
}

function isExchangeFundCode(code) {
  return /^\d{6}$/.test(code) && EXCHANGE_FUND_PREFIXES.has(code.slice(0, 2));
}

function readHeldExchangeFunds() {
  try {
    const ledger = readLedgerState();
    return aggregateByCode(ledger.transactions, ledger.snapshotsByCode)
      .filter((agg) => agg.hasPosition && isExchangeFundCode(normalizeFundCode(agg.code)))
      .map((agg) => ({
        code: normalizeFundCode(agg.code),
        name: agg.name || '',
        held: true,
      }));
  } catch {
    return [];
  }
}

function buildCandidateFunds(heldFunds = []) {
  const map = new Map();
  [...SWITCH_STRATEGY_ETFS, ...CN_ETF_WATCHLIST_PRESETS].forEach((item) => {
    const code = normalizeFundCode(item.code || item.symbol);
    if (!isExchangeFundCode(code)) return;
    map.set(code, {
      code,
      name: item.name || code,
      held: false,
    });
  });
  heldFunds.forEach((item) => {
    const code = normalizeFundCode(item.code);
    if (!isExchangeFundCode(code)) return;
    const existing = map.get(code);
    map.set(code, {
      code,
      name: item.name || existing?.name || code,
      held: true,
    });
  });
  return Array.from(map.values()).sort((a, b) => {
    if (a.held !== b.held) return a.held ? -1 : 1;
    return a.code.localeCompare(b.code);
  });
}

export function BacktestCounterpartPicker({
  value,
  currentSymbol,
  onChange,
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  const [heldFunds, setHeldFunds] = useState(() => readHeldExchangeFunds());
  const containerRef = useRef(null);
  useClickOutside(containerRef, () => setOpen(false), open);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = () => setHeldFunds(readHeldExchangeFunds());
    window.addEventListener('holdings:ledger-updated', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('holdings:ledger-updated', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const candidates = useMemo(() => buildCandidateFunds(heldFunds), [heldFunds]);
  const currentCode = normalizeFundCode(currentSymbol);
  const query = String(value || '').trim();
  const visibleCandidates = candidates
    .filter((item) => item.code !== currentCode)
    .filter((item) => !query || item.code.includes(query) || item.name.includes(query))
    .slice(0, 8);

  function commitCode(code) {
    const normalized = normalizeFundCode(code);
    if (!normalized) return;
    onChange?.(normalized);
    onSelect?.(normalized);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor="counterpart-code" className="block text-xs font-semibold text-slate-500">对手方</label>
      <div className="relative mt-2">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          id="counterpart-code"
          className={cx(inputClass, 'pl-9 font-semibold tabular-nums')}
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            const next = event.target.value.replace(/\D/g, '').slice(0, 6);
            onChange?.(next);
            if (next.length === 6) onSelect?.(next);
            setOpen(true);
          }}
          placeholder="输入或选择场内基金"
          inputMode="numeric"
        />
      </div>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {visibleCandidates.length ? visibleCandidates.map((item) => (
            <button
              key={item.code}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
              onClick={() => commitCode(item.code)}
            >
              <span className="min-w-0">
                <span className="block font-mono text-sm font-semibold tabular-nums text-slate-900">{item.code}</span>
                <span className="block truncate text-xs text-slate-500">{item.name}</span>
              </span>
              {item.held ? <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-[#a50e0e]">已持有</span> : null}
            </button>
          )) : (
            <div className="px-3 py-6 text-center text-sm text-slate-500">没有匹配的场内基金</div>
          )}
        </div>
      ) : null}
      <p className="mt-1.5 text-xs leading-5 text-slate-400">
        当前标的会与对手方组成 H/L 组合；已持有基金会优先显示并标注。
      </p>
    </div>
  );
}

export default BacktestCounterpartPicker;
