import { useEffect, useMemo, useRef, useState } from 'react';
import { IconChartBar } from '@tabler/icons-react';
import { PageHeader } from '../components/page-header.jsx';
import { cx } from '../components/experience-ui.jsx';
import { BacktestSidePanel } from '../components/markets/BacktestSidePanel.jsx';
import { MarketSymbolSearchBox } from './markets/MarketSymbolSearchBox.jsx';
import { searchSymbols } from './markets/marketsApiLoader.js';
import { normalizeSearchResults, resolveCnFundName } from './markets/marketsCatalog.js';
import { isCnExchangeFundRow } from '../app/cnFundVenue.js';
import { normalizeCnFundCode } from './markets/marketDisplayUtils.js';
import { readSwitchPrefs } from './switchStrategyHelpers.js';
import { SwitchStrategyCollections } from './backtest/SwitchStrategyCollections.jsx';

function isExchangeFundCode(value) {
  const code = normalizeCnFundCode(value);
  return isCnExchangeFundRow({ code, fundVenue: 'exchange' });
}

function isExchangeFundSearchRow(row) {
  return isCnExchangeFundRow(row);
}

function readUrlSymbol() {
  if (typeof window === 'undefined') return '';
  const raw = new URL(window.location.href).searchParams.get('symbol') || '';
  return isExchangeFundCode(raw) ? normalizeCnFundCode(raw) : '';
}

function writeBacktestSymbol(symbol = '') {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'backtest');
  if (symbol) url.searchParams.set('symbol', symbol);
  else url.searchParams.delete('symbol');
  url.hash = '';
  window.history.replaceState({ tab: 'backtest' }, '', url);
}

function resultSymbol(row) {
  return normalizeCnFundCode(row?.symbol || row?.code || row?.ticker);
}

export function BacktestExperience({ embedded = false } = {}) {
  const [selectedSymbol, setSelectedSymbol] = useState(readUrlSymbol);
  const [selectedName, setSelectedName] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchSeqRef = useRef(0);
  const switchPrefs = useMemo(() => readSwitchPrefs(), []);

  useEffect(() => {
    const query = searchValue.trim();
    const sequence = ++searchSeqRef.current;
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError('');
      return undefined;
    }

    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError('');
    const timer = window.setTimeout(() => {
      searchSymbols('cn', query, { limit: 8, signal: controller.signal })
        .then((payload) => {
          if (controller.signal.aborted || sequence !== searchSeqRef.current) return;
          const rows = normalizeSearchResults(
            Array.isArray(payload?.results) ? payload.results : [],
            'cn',
            query
          )
            .filter(isExchangeFundSearchRow)
            .map((row) => ({ ...row, marketLabel: '场内基金' }));
          setSearchResults(rows.slice(0, 8));
        })
        .catch((error) => {
          if (controller.signal.aborted || sequence !== searchSeqRef.current) return;
          setSearchResults([]);
          setSearchError(error?.message ? '搜索失败，请稍后再试' : '没有找到匹配的场内基金');
        })
        .finally(() => {
          if (sequence === searchSeqRef.current) setSearchLoading(false);
        });
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchValue]);

  function selectSymbol(row) {
    const code = resultSymbol(row);
    if (!isExchangeFundSearchRow(row)) return;
    setSelectedSymbol(code);
    setSelectedName(String(row?.name || row?.shortName || row?.displayName || '').trim());
    setSearchValue('');
    setSearchResults([]);
    setSearchError('');
    writeBacktestSymbol(code);
  }

  function selectTypedSymbol() {
    const code = normalizeCnFundCode(searchValue);
    if (!isExchangeFundCode(code)) return;
    selectSymbol({ symbol: code, name: resolveCnFundName(code) });
  }

  function clearSymbol() {
    setSelectedSymbol('');
    setSelectedName('');
    setSearchValue('');
    setSearchResults([]);
    setSearchError('');
    writeBacktestSymbol('');
  }

  const selectedLabel = selectedName || resolveCnFundName(selectedSymbol) || selectedSymbol;
  const shellClass = embedded ? 'px-4 pb-10 sm:px-6' : 'mx-auto max-w-6xl px-4 pb-12 sm:px-6';

  return (
    <div className={cx('space-y-5', shellClass)}>
      <PageHeader
        Icon={IconChartBar}
        title="策略回测"
        description="用历史行情验证单基金持有和溢价差轮动策略，先选择一只场内基金作为主标的。"
      />

      <SwitchStrategyCollections />

      {!selectedSymbol ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-[linear-gradient(120deg,#eef2ff_0%,#ffffff_58%,#ecfdf5_100%)] px-5 py-6 sm:px-8 sm:py-8">
            <div className="max-w-2xl">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--brand-text)]">历史验证台</div>
              <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">先选标的，再看策略是否经得起历史行情</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">回测结果只用于复盘和比较，不代表未来收益。选中主标的后，可以继续添加对手方并调整回测区间、周期和初始资金。</p>
            </div>
          </div>
          <div className="space-y-5 px-5 py-5 sm:px-8 sm:py-7">
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">选择主标的</div>
              <MarketSymbolSearchBox
                autoFocus
                inline
                searchValue={searchValue}
                searchResults={searchResults}
                searchLoading={searchLoading}
                searchError={searchError}
                marketLabel="场内基金"
                onSearchChange={setSearchValue}
                onSearchClear={() => setSearchValue('')}
                onSearchKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    selectTypedSymbol();
                  }
                }}
                onSearchResultSelect={selectSymbol}
                showAddButton={false}
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">支持输入 6 位场内基金代码或名称；例如 513100、159501。</p>
            </div>
            <div className="grid gap-3 border-t border-slate-100 pt-5 text-xs text-slate-500 sm:grid-cols-3">
              <div><span className="font-bold text-[var(--brand-text)]">01</span><span className="ml-2">选择主标的</span></div>
              <div><span className="font-bold text-[var(--brand-text)]">02</span><span className="ml-2">配置对手方</span></div>
              <div><span className="font-bold text-[var(--brand-text)]">03</span><span className="ml-2">运行并比较结果</span></div>
            </div>
          </div>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--brand-text)] bg-[var(--brand-tint)] px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-text)]">当前主标的</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-lg font-bold tabular-nums text-[var(--brand-text)]">{selectedSymbol}</span>
                <span className="truncate text-sm text-[var(--brand-text)]">{selectedLabel}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={clearSymbol}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--brand-text)] bg-white px-3 text-sm font-semibold text-[var(--brand-text)] transition hover:bg-[var(--brand-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-text)]"
            >
              更换标的
            </button>
          </div>
          <BacktestSidePanel
            key={selectedSymbol}
            open
            embedded
            onClose={clearSymbol}
            symbol={selectedSymbol}
            switchPrefs={switchPrefs}
          />
        </>
      )}
    </div>
  );
}

export default BacktestExperience;
