import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CloudUpload, History, ListChecks, Shuffle, Wallet } from 'lucide-react';
import { isFundSwitchViewHash } from '../app/fundSwitch.js';
import { LEGACY_TAB_REDIRECTS, PRIMARY_TAB_ORDER, createPageLinks, getPrimaryTabs } from '../app/screens.js';
import { ConsoleLayout } from '../components/console-layout.jsx';
import { TourProvider } from '../tour/tour-engine.jsx';
import { TourOverlay } from '../tour/tour-overlay.jsx';
import { TourLauncher } from '../tour/tour-launcher.jsx';

// 各主 tab 使用 React.lazy 按需加载，在 Vite 中会被拆成独立 chunk。
// HomeExperience / DcaExperience 已并入 TradePlansExperience 作为二级 tab，不再在这里顶级 lazy。
const BackupExperience = lazy(() => import('./BackupExperience.jsx').then((m) => ({ default: m.BackupExperience })));
const FundSwitchExperience = lazy(() => import('./FundSwitchExperience.jsx').then((m) => ({ default: m.FundSwitchExperience })));
const HistoryExperience = lazy(() => import('./HistoryExperience.jsx').then((m) => ({ default: m.HistoryExperience })));
const HoldingsExperience = lazy(() => import('./HoldingsExperience.jsx').then((m) => ({ default: m.HoldingsExperience })));
const NotifyExperience = lazy(() => import('./NotifyExperience.jsx').then((m) => ({ default: m.NotifyExperience })));
const TradePlansExperience = lazy(() => import('./TradePlansExperience.jsx').then((m) => ({ default: m.TradePlansExperience })));

const DEFAULT_WORKSPACE_TAB = 'holdings';

const WORKSPACE_TITLES = {
  tradePlans: '交易计划中心',
  fundSwitch: '基金切换收益分析',
  history: '交易历史',
  holdings: '持仓总览',
  notify: '通知设置',
  backup: '数据同步 / 备份'
};

const SIDEBAR_ICONS = {
  tradePlans: ListChecks,
  fundSwitch: Shuffle,
  history: History,
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
  if (tab !== DEFAULT_WORKSPACE_TAB) {
    nextUrl.searchParams.set('tab', tab);
  }
  if (tab === 'fundSwitch' && isFundSwitchViewHash(window.location.hash)) {
    nextUrl.hash = window.location.hash;
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
  const [activeTab, setActiveTab] = useState(() => readTabFromLocation(initialTab));

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 为每个 tab 独立缓存上次的 scrollY，在切换返回时恢复。
  const scrollPositionsRef = useRef(new Map());
  const previousTabRef = useRef(activeTab);

  const sidebarNav = useMemo(
    () =>
      getPrimaryTabs(links).map((tab) => ({
        ...tab,
        icon: SIDEBAR_ICONS[tab.key]
      })),
    [links]
  );
  const heroTitle = WORKSPACE_TITLES[activeTab] || WORKSPACE_TITLES.home;

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
      setActiveTab(readTabFromLocation(initialTab));
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
      case 'tradePlans':
        return <TradePlansExperience {...sharedProps} />;
      case 'fundSwitch':
        return <FundSwitchExperience {...sharedProps} />;
      case 'history':
        return <HistoryExperience {...sharedProps} />;
      case 'notify':
        return <NotifyExperience {...sharedProps} />;
      case 'backup':
        return <BackupExperience {...sharedProps} />;
      case 'holdings':
      default:
        return <HoldingsExperience {...sharedProps} />;
    }
  }

  return (
    <TourProvider navigateToTab={handleSelectTab} currentTab={activeTab}>
      <ConsoleLayout
        brand="ai-dca"
        sidebarNav={sidebarNav}
        activeKey={activeTab}
        onSelectNav={handleSelectTab}
      >
        <Suspense fallback={<TabLoadingFallback />}>{renderActivePanel()}</Suspense>
      </ConsoleLayout>
      <TourOverlay />
      <TourLauncher />
    </TourProvider>
  );
}
