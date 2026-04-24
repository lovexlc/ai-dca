import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, CloudUpload, History, LineChart, ListChecks, Plus, Shuffle, TrendingUp, Wallet } from 'lucide-react';
import { isFundSwitchViewHash } from '../app/fundSwitch.js';
import { PRIMARY_TAB_ORDER, createPageLinks, getPrimaryTabs } from '../app/screens.js';
import { ConsoleLayout } from '../components/console-layout.jsx';
import { BackupExperience } from './BackupExperience.jsx';
import { DcaExperience } from './DcaExperience.jsx';
import { FundSwitchExperience } from './FundSwitchExperience.jsx';
import { HistoryExperience } from './HistoryExperience.jsx';
import { HoldingsExperience } from './HoldingsExperience.jsx';
import { HomeExperience } from './HomeExperience.jsx';
import { TradePlansExperience } from './TradePlansExperience.jsx';

const DEFAULT_WORKSPACE_TAB = 'tradePlans';

const WORKSPACE_TITLES = {
  home: '加仓计划',
  tradePlans: '交易计划中心',
  dca: '定投计划',
  fundSwitch: '基金切换收益分析',
  history: '交易历史',
  holdings: '持仓总览',
  backup: '数据同步 / 备份'
};

const SIDEBAR_ICONS = {
  tradePlans: ListChecks,
  home: TrendingUp,
  dca: CalendarClock,
  fundSwitch: Shuffle,
  history: History,
  holdings: Wallet,
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
  return currentTab ? normalizeWorkspaceTab(currentTab) : normalizeWorkspaceTab(fallbackTab);
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

function SidebarQuickActions({ onSelectNav }) {
  return (
    <div className="console-quick">
      <div className="console-quick__eyebrow">快捷入口</div>
      <button
        type="button"
        className="console-quick__primary"
        onClick={() => onSelectNav?.('tradePlans', { hash: '#new' })}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span>新建建仓计划</span>
      </button>
      <button
        type="button"
        className="console-quick__secondary"
        onClick={() => onSelectNav?.('fundSwitch')}
      >
        <LineChart className="h-4 w-4" aria-hidden="true" />
        <span>基金切换分析</span>
        <ArrowRight className="ml-auto h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function WorkspacePage({ initialTab = DEFAULT_WORKSPACE_TAB, inPagesDir = false }) {
  const links = createPageLinks({ inPagesDir });
  const [activeTab, setActiveTab] = useState(() => readTabFromLocation(initialTab));

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

  function handleSelectTab(nextTab, options = {}) {
    const normalizedTab = normalizeWorkspaceTab(nextTab);
    const hash = typeof options.hash === 'string' ? options.hash : '';
    const alreadyActive = normalizedTab === activeTab;
    const hashMatches = (window.location.hash || '') === hash;
    if (alreadyActive && hashMatches) {
      return;
    }

    const nextUrl = buildWorkspaceUrl(normalizedTab, { inPagesDir });
    if (hash) {
      nextUrl.hash = hash;
    }
    window.history.pushState({ tab: normalizedTab }, '', nextUrl);
    setActiveTab(normalizedTab);
    window.scrollTo({ top: 0, behavior: 'auto' });
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
      case 'dca':
        return <DcaExperience {...sharedProps} />;
      case 'fundSwitch':
        return <FundSwitchExperience {...sharedProps} />;
      case 'history':
        return <HistoryExperience {...sharedProps} />;
      case 'holdings':
        return <HoldingsExperience {...sharedProps} />;
      case 'backup':
        return <BackupExperience {...sharedProps} />;
      case 'home':
      default:
        return <HomeExperience {...sharedProps} />;
    }
  }

  return (
    <ConsoleLayout
      brand="ai-dca"
      sidebarNav={sidebarNav}
      activeKey={activeTab}
      onSelectNav={handleSelectTab}
      sidebarFooter={<SidebarQuickActions onSelectNav={handleSelectTab} />}
    >
      {renderActivePanel()}
    </ConsoleLayout>
  );
}
