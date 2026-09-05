import { useCallback, useEffect, useMemo, useState } from 'react';
import { BETA_TAB_QUERY_KEY, disableBeta, readBetaTabOverride } from '../app/betaEnvironment.js';
import HoldingsDetailScreen from './HoldingsDetailScreen.jsx';
import HoldingsScreen from './HoldingsScreen.jsx';
import HomeScreen from './HomeScreen.jsx';
import MarketDetailScreen from './MarketDetailScreen.jsx';
import MarketsScreen from './MarketsScreen.jsx';
import PlansScreen from './PlansScreen.jsx';
import ProfileScreen from './ProfileScreen.jsx';
import { BETA_TAB_META, getBetaTabs, getPagesForTab, normalizeBetaTab } from './betaScreens.js';

/**
 * BetaApp - beta（小程序版）网页外壳。
 * 结构对齐小程序：顶部标题栏 + 底部 5 个 tab。
 * 五个 tab 主页都已接上真实数据；二级页正在分批搬（已有：持仓明细、行情明细）。
 */
const TAB_SCREENS = {
  home: HomeScreen,
  markets: MarketsScreen,
  holdings: HoldingsScreen,
  tradeplans: PlansScreen,
  profile: ProfileScreen
};

function syncTabToUrl(tab) {
  if (typeof window === 'undefined') return;
  if (!window.history || typeof window.history.replaceState !== 'function') return;
  const params = new URLSearchParams(window.location.search);
  params.set(BETA_TAB_QUERY_KEY, tab);
  const query = params.toString();
  const next = window.location.pathname + (query ? '?' + query : '') + window.location.hash;
  window.history.replaceState(null, '', next);
}

export function BetaApp() {
  const [tab, setTab] = useState(() => normalizeBetaTab(
    typeof window === 'undefined' ? null : readBetaTabOverride(window.location.search)
  ));
  // 二级页只在自己 tab 内生效：切 tab 自动回主页，也不会把持仓子页漏到行情 tab 上。
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    syncTabToUrl(tab);
  }, [tab]);

  const handleSelect = useCallback((key) => {
    setTab(normalizeBetaTab(key));
    setDetail(null);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetail(null);
  }, []);

  const handleOpenHolding = useCallback((code) => {
    const next = String(code || '');
    if (next) setDetail({ tab: 'holdings', code: next });
  }, []);

  const handleOpenFund = useCallback((code) => {
    const next = String(code || '');
    if (next) setDetail({ tab: 'markets', code: next });
  }, []);

  const tabs = getBetaTabs();
  const pages = getPagesForTab(tab);
  const Screen = TAB_SCREENS[tab] || null;

  const detailScreen = useMemo(() => {
    if (!detail || detail.tab !== tab) return null;
    if (detail.tab === 'holdings') {
      return <HoldingsDetailScreen code={detail.code} onBack={handleCloseDetail} />;
    }
    if (detail.tab === 'markets') {
      return <MarketDetailScreen code={detail.code} onBack={handleCloseDetail} />;
    }
    return null;
  }, [detail, tab, handleCloseDetail]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 pb-16">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">BETA</span>
          <h1 className="text-base font-semibold text-slate-900">小鱼的手记工具</h1>
        </div>
        <button
          type="button"
          onClick={disableBeta}
          className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
        >
          返回正式版
        </button>
      </header>

      <main className="flex-1 px-4 py-4">
        {detailScreen ? (
          detailScreen
        ) : Screen ? (
          <Screen onOpenHolding={handleOpenHolding} onOpenFund={handleOpenFund} />
        ) : (
          <>
            <h2 className="text-sm font-semibold text-slate-900">{BETA_TAB_META[tab].label}</h2>
            <p className="mt-1 text-xs text-slate-500">小程序版页面正在分批搬运，下面是本 tab 的页面清单。</p>
            <ul className="mt-3 space-y-2">
              {pages.map((page) => (
                <li
                  key={page.key}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                >
                  <span className="text-sm text-slate-800">{page.label}</span>
                  <span className="text-xs font-medium text-slate-400">待搬运</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-20 flex border-t border-slate-200 bg-white">
        {tabs.map((item) => {
          const isActive = item.key === tab;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleSelect(item.key)}
              className={'flex-1 py-2.5 text-xs font-semibold transition-colors ' + (isActive ? 'text-[var(--brand-text)]' : 'text-slate-500 hover:text-slate-800')}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default BetaApp;
