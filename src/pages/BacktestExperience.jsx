import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';
import { BacktestSidePanel } from '../components/markets/BacktestSidePanel.jsx';
import { MarketSymbolSearchBox } from './markets/MarketSymbolSearchBox.jsx';
import { searchSymbols } from './markets/marketsApiLoader.js';
import { normalizeSearchResults, resolveCnFundName } from './markets/marketsCatalog.js';
import { isCnExchangeFundRow } from '../app/cnFundVenue.js';
import { normalizeCnFundCode } from './markets/marketDisplayUtils.js';
import { readSwitchPrefs } from './switchStrategyHelpers.js';

function isExchangeFundCode(value) {
  const code = normalizeCnFundCode(value);
  return isCnExchangeFundRow({ code, fundVenue: 'exchange' });
}

function readUrlSymbol() {
  if (typeof window === 'undefined') return '';
  const raw = new URL(window.location.href).searchParams.get('symbol') || '';
  return isExchangeFundCode(raw) ? normalizeCnFundCode(raw) : '';
}

function writeBacktestSymbol(symbol = '') {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'fundSwitch');
  url.searchParams.set('view', 'backtest');
  if (symbol) url.searchParams.set('symbol', symbol);
  else url.searchParams.delete('symbol');
  url.hash = '';
  window.history.replaceState({ tab: 'fundSwitch', view: 'backtest' }, '', url);
}

function resultSymbol(row) {
  return normalizeCnFundCode(row?.symbol || row?.code || row?.ticker);
}

const POPULAR_HOT_PAIRS = [
  { code: '513100', label: '纳指科技 ETF', counterpart: '159632' },
  { code: '159632', label: '纳指ETF', counterpart: '513100' },
  { code: '513500', label: '标普500 ETF', counterpart: '159612' },
  { code: '513050', label: '中概互联网 ETF', counterpart: '159605' },
];

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
          const rows = normalizeSearchResults(Array.isArray(payload?.results) ? payload.results : [], 'cn', query)
            .filter(isCnExchangeFundRow)
            .map((row) => ({ ...row, marketLabel: '场内基金' }));
          setSearchResults(rows.slice(0, 8));
        })
        .catch(() => {
          if (controller.signal.aborted || sequence !== searchSeqRef.current) return;
          setSearchResults([]);
          setSearchError('搜索失败，请稍后再试');
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
    if (!isCnExchangeFundRow(row) || !code) return;
    setSelectedSymbol(code);
    setSelectedName(String(row?.name || row?.shortName || row?.displayName || '').trim());
    setSearchValue('');
    setSearchResults([]);
    setSearchError('');
    writeBacktestSymbol(code);
  }

  function selectTypedSymbol() {
    const code = normalizeCnFundCode(searchValue);
    if (isExchangeFundCode(code)) {
      selectSymbol({ symbol: code, code, fundVenue: 'exchange', name: resolveCnFundName(code) });
    }
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
  const shellClass = embedded ? 'pb-8' : 'mx-auto max-w-7xl px-3 sm:px-5 pb-12';

  return (
    <div className={cx('space-y-4', shellClass)}>
      {!selectedSymbol ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-[linear-gradient(120deg,#eef2ff_0%,#ffffff_58%,#ecfdf5_100%)] px-5 py-6 sm:px-8 sm:py-8">
            <div className="max-w-2xl">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600">历史验证台</div>
              <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                先选标的，再看换基策略是否经得起历史行情
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                回测结果只用于复盘和比较，不代表未来收益。支持 8×8 自动网格寻优，锁定最佳切回/切出阈值对与最大夏普比率。
              </p>
            </div>
          </div>
          <div className="space-y-5 px-5 py-5 sm:px-8 sm:py-7">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-800">
                <span>选择主标的</span>
                <span className="text-xs font-normal text-slate-400">支持 6 位场内基金代码或名称</span>
              </div>
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
              {/* 快捷热门对子点选 */}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400 font-medium">热门推荐:</span>
                {POPULAR_HOT_PAIRS.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => selectSymbol({ symbol: item.code, code: item.code, fundVenue: 'exchange', name: item.label })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition"
                  >
                    <span className="font-mono font-bold text-slate-900">{item.code}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 border-t border-slate-100 pt-5 text-xs text-slate-500 sm:grid-cols-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 font-mono text-[11px] font-bold text-indigo-600">01</span>
                <span>点选或输入主标的</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 font-mono text-[11px] font-bold text-indigo-600">02</span>
                <span>自动网格寻优黄金阈值</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 font-mono text-[11px] font-bold text-indigo-600">03</span>
                <span>对比基准并一键应用方案</span>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="space-y-3.5">
          {/* 顶栏：标的信息 + 热门切换胶囊（严格单行不换行） */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:px-4 sm:py-3 shadow-xs">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold text-[10px] uppercase tracking-wider font-mono">
                当前主标的
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-base sm:text-lg font-black tabular-nums text-slate-900">
                  {selectedSymbol}
                </span>
                <span className="truncate text-xs sm:text-sm font-bold text-slate-700">
                  {selectedLabel}
                </span>
              </div>
            </div>

            {/* 热门对子快速点选（强制单行，根据屏幕宽度动态隐藏末尾标的） */}
            <div className="flex items-center flex-nowrap whitespace-nowrap gap-1.5 text-xs shrink-0 overflow-hidden">
              <span className="text-slate-400 text-[11px] hidden sm:inline shrink-0">热门对子:</span>
              {POPULAR_HOT_PAIRS.map((item, idx) => {
                const isCurrent = item.code === selectedSymbol;
                const hideClass = idx === 3 ? 'hidden xl:inline-flex' : idx === 2 ? 'hidden md:inline-flex' : 'inline-flex';
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => selectSymbol({ symbol: item.code, code: item.code, fundVenue: 'exchange', name: item.label })}
                    className={cx(
                      'px-2 py-1 rounded-lg text-xs font-mono font-semibold transition cursor-pointer shrink-0',
                      hideClass,
                      isCurrent
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
                    )}
                  >
                    {item.code} {item.label.slice(0, 4)}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={clearSymbol}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-indigo-300 hover:text-indigo-600 flex items-center gap-1 cursor-pointer shrink-0 transition"
              >
                <Search className="h-3 w-3 text-slate-400" />
                <span>更换标的</span>
              </button>
            </div>
          </div>

          {/* 全宽量化工作台 */}
          <div className="w-full">
            <BacktestSidePanel
              key={selectedSymbol}
              open
              onClose={clearSymbol}
              symbol={selectedSymbol}
              switchPrefs={switchPrefs}
              layout="workbench"
              autoRun
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default BacktestExperience;
