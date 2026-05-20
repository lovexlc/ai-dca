import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BookOpen, CloudUpload, LineChart, ListChecks, Plus, RefreshCw, Send, Shuffle, Trash2, Wallet } from 'lucide-react';
import { DEFAULT_WORKSPACE_TAB, LEGACY_TAB_REDIRECTS, PRIMARY_TAB_ORDER, createPageLinks, getPrimaryTabs } from '../app/screens.js';
import { ConsoleLayout } from '../components/console-layout.jsx';
import { AiChatWidget } from '../components/ai-chat/ai-chat-widget.jsx';
import { MobileTabBar } from '../components/mobile-tab-bar.jsx';
import { GlobalSearch } from '../components/global-search.jsx';
import { clearDemoData, readDemoDataMeta } from '../app/demoData.js';
import { readWorkspacePrefs } from '../app/workspacePrefs.js';

// 各主 tab 使用 React.lazy 按需加载，在 Vite 中会被拆成独立 chunk。
// HomeExperience / DcaExperience 已并入 TradePlansExperience 作为二级 tab，不再在这里顶级 lazy。
const BackupExperience = lazy(() => import('./BackupExperience.jsx').then((m) => ({ default: m.BackupExperience })));
const FundSwitchExperience = lazy(() => import('./FundSwitchExperience.jsx').then((m) => ({ default: m.FundSwitchExperience })));
const HoldingsExperience = lazy(() => import('./HoldingsExperience.jsx').then((m) => ({ default: m.HoldingsExperience })));
const NotifyExperience = lazy(() => import('./NotifyExperience.jsx').then((m) => ({ default: m.NotifyExperience })));
const TradePlansExperience = lazy(() => import('./TradePlansExperience.jsx').then((m) => ({ default: m.TradePlansExperience })));
const MarketsExperience = lazy(() => import('./MarketsExperience.jsx').then((m) => ({ default: m.MarketsExperience })));
const StrategyGuideExperience = lazy(() => import('./StrategyGuideExperience.jsx').then((m) => ({ default: m.StrategyGuideExperience })));

function readPreferredWorkspaceTab(fallbackTab = DEFAULT_WORKSPACE_TAB) {
  if (typeof window === 'undefined') return fallbackTab;
  return readWorkspacePrefs().homepageTab || fallbackTab;
}

const WORKSPACE_TITLES = {
  strategy: '美股策略助手',
  tradePlans: '交易计划中心',
  fundSwitch: '基金切换收益分析',
  markets: '行情中心',
  holdings: '持仓总览',
  notify: '通知设置',
  backup: '数据同步 / 备份'
};

const SIDEBAR_ICONS = {
  strategy: BookOpen,
  tradePlans: ListChecks,
  fundSwitch: Shuffle,
  markets: LineChart,
  holdings: Wallet,
  notify: Bell,
  backup: CloudUpload
};

function normalizeWorkspaceTab(value = '') {
  return PRIMARY_TAB_ORDER.includes(value) ? value : DEFAULT_WORKSPACE_TAB;
}

function readTabFromLocation(fallbackTab = DEFAULT_WORKSPACE_TAB) {
  if (typeof window === 'undefined') {
    return normalizeWorkspaceTab(fallbackTab);
  }
  const params = new URLSearchParams(window.location.search);
  const currentTab = params.get('tab');
  // Legacy ?tab=home / ?tab=dca 重定向到交易计划的二级 tab。
  if (currentTab && Object.prototype.hasOwnProperty.call(LEGACY_TAB_REDIRECTS, currentTab)) {
    return LEGACY_TAB_REDIRECTS[currentTab].tab;
  }
  return currentTab ? normalizeWorkspaceTab(currentTab) : normalizeWorkspaceTab(fallbackTab);
}

// 如果 URL 带了 legacy ?tab=home / ?tab=dca，返回应该在 tradePlans 中选中的 hash（'#home' / '#dca'）；否则返回空字符串。
function readLegacyHashFromLocation() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const currentTab = params.get('tab');
  if (currentTab && Object.prototype.hasOwnProperty.call(LEGACY_TAB_REDIRECTS, currentTab)) {
    return LEGACY_TAB_REDIRECTS[currentTab].hash || '';
  }
  return '';
}

function buildWorkspaceUrl(tab, { inPagesDir = false } = {}) {
  const nextUrl = new URL(inPagesDir ? '../index.html' : './index.html', window.location.href);
  const preferredTab = readPreferredWorkspaceTab(DEFAULT_WORKSPACE_TAB);
  if (tab !== preferredTab) {
    nextUrl.searchParams.set('tab', tab);
  }
  return nextUrl;
}

function TabLoadingFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-slate-500">
      加载中…
    </div>
  );
}

export function WorkspacePage({ initialTab = DEFAULT_WORKSPACE_TAB, inPagesDir = false }) {
  const links = createPageLinks({ inPagesDir });
  const [activeTab, setActiveTab] = useState(() => readTabFromLocation(readPreferredWorkspaceTab(initialTab)));
  const [demoMeta, setDemoMeta] = useState(() => readDemoDataMeta());

  // Legacy ?tab=home / ?tab=dca 进来时，重写为 ?tab=tradePlans + hash，使二级 tab 能在 mount 时被选中。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const legacyHash = readLegacyHashFromLocation();
    if (!legacyHash) return;
    const params = new URLSearchParams(window.location.search);
    params.set('tab', 'tradePlans');
    const nextUrl = new URL(
      `${window.location.pathname}?${params.toString()}${legacyHash}`,
      window.location.href
    );
    window.history.replaceState({ tab: 'tradePlans' }, '', nextUrl);
    // 让 TradePlansExperience 读到新 hash。
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, []);

  // 为每个 tab 独立缓存上次的 scrollY，在切换返回时恢复。
  const scrollPositionsRef = useRef(new Map());
  const previousTabRef = useRef(activeTab);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  const quickAction = useMemo(() => {
    if (activeTab === 'backup') {
      return {
        label: '刷新预览',
        icon: RefreshCw,
        mode: 'custom',
        action: () => window.dispatchEvent(new CustomEvent('backup:refresh-preview'))
      };
    }
    if (activeTab === 'notify') {
      return {
        label: '测试通知',
        icon: Send,
        mode: 'custom',
        action: () => window.dispatchEvent(new CustomEvent('notify:test-pc'))
      };
    }
    if (activeTab === 'tradePlans') {
      return {
        label: '新建策略',
        icon: ListChecks,
        mode: 'custom',
        action: () => {
          handleSelectTab('tradePlans');
          setTimeout(() => {
            window.history.pushState({ subView: 'new' }, '', `${window.location.pathname}${window.location.search}#new`);
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          }, 80);
        }
      };
    }
    if (activeTab === 'fundSwitch') {
      return {
        label: '查看机会',
        icon: Shuffle,
        mode: 'custom',
        action: () => window.scrollTo({ top: 0, behavior: 'smooth' })
      };
    }
    return { label: '新增交易', icon: Plus, mode: 'add', action: null };
  }, [activeTab]);

  const sidebarNav = useMemo(
    () =>
      getPrimaryTabs(links).map((tab) => ({
        ...tab,
        icon: SIDEBAR_ICONS[tab.key]
      })),
    [links]
  );
  const heroTitle = WORKSPACE_TITLES[activeTab] || WORKSPACE_TITLES.strategy;

  useEffect(() => {
    document.title = heroTitle;
  }, [heroTitle]);

  useEffect(() => {
    const canonicalUrl = buildWorkspaceUrl(activeTab, { inPagesDir });
    if (window.location.href !== canonicalUrl.href) {
      window.history.replaceState({ tab: activeTab }, '', canonicalUrl);
    }
  }, [activeTab, inPagesDir]);

  useEffect(() => {
    function handlePopState() {
      setActiveTab(readTabFromLocation(readPreferredWorkspaceTab(initialTab)));
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [initialTab]);

  // tab 变化后，恢复该 tab 以前的 scrollY（如果有）。
  // 使用 requestAnimationFrame 等新内容进入一个 paint 后再跳，避免在 lazy 加载过程中跳到 0。
  useEffect(() => {
    const saved = scrollPositionsRef.current.get(activeTab);
    const targetY = typeof saved === 'number' ? saved : 0;
    const id = window.requestAnimationFrame(() => {
      window.scrollTo({ top: targetY, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [activeTab]);

  function handleSelectTab(nextTab, options = {}) {
    const normalizedTab = normalizeWorkspaceTab(nextTab);
    const hash = typeof options.hash === 'string' ? options.hash : '';
    const alreadyActive = normalizedTab === activeTab;
    const hashMatches = (window.location.hash || '') === hash;
    if (alreadyActive && hashMatches) {
      return;
    }

    // 在离开当前 tab 之前记录其 scrollY。
    if (!alreadyActive) {
      scrollPositionsRef.current.set(previousTabRef.current, window.scrollY);
      previousTabRef.current = normalizedTab;
    }

    const nextUrl = buildWorkspaceUrl(normalizedTab, { inPagesDir });
    if (hash) {
      nextUrl.hash = hash;
    }
    window.history.pushState({ tab: normalizedTab }, '', nextUrl);
    setActiveTab(normalizedTab);
    // 合并后：侧边栏《新建建仓计划》通过 #new hash 跳进《交易计划》的新建子视图。
    // 由于 TradePlansExperience 在 mount 时才读 hash，手动触发 hashchange 用于已 mount 的情况。
    if (hash && alreadyActive) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  function renderActivePanel() {
    const sharedProps = { links, inPagesDir, embedded: true };
    switch (activeTab) {
      case 'strategy':
        return <StrategyGuideExperience {...sharedProps} onNavigate={handleSelectTab} onDemoDataChange={setDemoMeta} />;
      case 'tradePlans':
        return <TradePlansExperience {...sharedProps} />;
      case 'fundSwitch':
        return <FundSwitchExperience {...sharedProps} />;
      case 'markets':
        return <MarketsExperience {...sharedProps} />;
      case 'notify':
        return <NotifyExperience {...sharedProps} />;
      case 'backup':
        return <BackupExperience {...sharedProps} />;
      case 'holdings':
        return <HoldingsExperience {...sharedProps} />;
      default:
        return <StrategyGuideExperience {...sharedProps} onNavigate={handleSelectTab} onDemoDataChange={setDemoMeta} />;
    }
  }

  return (
    <>
      <ConsoleLayout
        brand="美股策略助手"
        sidebarNav={sidebarNav}
        activeKey={activeTab}
        onSelectNav={handleSelectTab}
      >
        {demoMeta ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>当前正在使用演示数据。建议先配置一次手机通知，完整体验策略触发提醒。</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-amber-800 shadow-sm" onClick={() => handleSelectTab('notify')}>配置通知</button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow-sm"
                  onClick={() => {
                    if (window.confirm('确认清除演示数据？')) {
                      clearDemoData();
                      setDemoMeta(null);
                      window.location.reload();
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  清除演示数据
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <Suspense fallback={<TabLoadingFallback />}>{renderActivePanel()}</Suspense>
      </ConsoleLayout>
      <AiChatWidget currentTab={activeTab} />
      <MobileTabBar
        quickActionLabel={quickAction.label}
        quickActionIcon={quickAction.icon}
        quickActionMode={quickAction.mode}
        onQuickAction={quickAction.action}
        onSearch={() => setGlobalSearchOpen(true)}
        onAi={() => window.dispatchEvent(new CustomEvent('aichat:open'))}
        onNew={() => {
          handleSelectTab('holdings');
          setTimeout(() => window.dispatchEvent(new CustomEvent('holdings:new')), 80);
        }}
        onPasteImport={() => {
          handleSelectTab('holdings');
          setTimeout(() => window.dispatchEvent(new CustomEvent('holdings:import-paste')), 80);
        }}
        onOcrImport={() => {
          handleSelectTab('holdings');
          setTimeout(() => window.dispatchEvent(new CustomEvent('holdings:import-ocr')), 80);
        }}
      />
      <GlobalSearch
        open={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        onSelectTab={(key) => handleSelectTab(key)}
        onSelectFund={(code) => {
          handleSelectTab('holdings');
          setTimeout(
            () => window.dispatchEvent(new CustomEvent('holdings:select-fund', { detail: { code } })),
            80,
          );
        }}
      />
    </>
  );
}
