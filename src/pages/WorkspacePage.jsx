import { useEffect, useMemo, useState } from 'react';
import { PRIMARY_TAB_ORDER, createPageLinks, getPrimaryTabs } from '../app/screens.js';
import { PageHero, PageShell, PageTabs } from '../components/experience-ui.jsx';
import { DcaExperience } from './DcaExperience.jsx';
import { FundSwitchExperience } from './FundSwitchExperience.jsx';
import { HistoryExperience } from './HistoryExperience.jsx';
import { HomeExperience } from './HomeExperience.jsx';
import { TradePlansExperience } from './TradePlansExperience.jsx';

const WORKSPACE_TITLES = {
  home: '建仓策略总览',
  tradePlans: '交易计划中心',
  dca: '定投计划',
  fundSwitch: '基金切换收益分析',
  history: '交易历史'
};

function normalizeWorkspaceTab(value = '') {
  return PRIMARY_TAB_ORDER.includes(value) ? value : 'home';
}

function readTabFromLocation() {
  if (typeof window === 'undefined') {
    return 'home';
  }

  const params = new URLSearchParams(window.location.search);
  return normalizeWorkspaceTab(params.get('tab') || 'home');
}

function buildWorkspaceUrl(tab, { inPagesDir = false } = {}) {
  const nextUrl = new URL(inPagesDir ? '../index.html' : './index.html', window.location.href);
  if (tab !== 'home') {
    nextUrl.searchParams.set('tab', tab);
  }
  return nextUrl;
}

export function WorkspacePage({ initialTab = 'home', inPagesDir = false }) {
  const links = createPageLinks({ inPagesDir });
  const [activeTab, setActiveTab] = useState(() => {
    const locationTab = readTabFromLocation();
    return locationTab !== 'home' || initialTab === 'home'
      ? locationTab
      : normalizeWorkspaceTab(initialTab);
  });

  const tabs = useMemo(() => getPrimaryTabs(links), [links]);
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
      setActiveTab(readTabFromLocation());
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function handleSelectTab(nextTab) {
    const normalizedTab = normalizeWorkspaceTab(nextTab);
    if (normalizedTab === activeTab) {
      return;
    }

    const nextUrl = buildWorkspaceUrl(normalizedTab, { inPagesDir });
    window.history.pushState({ tab: normalizedTab }, '', nextUrl);
    setActiveTab(normalizedTab);
    window.scrollTo({ top: 0, behavior: 'auto' });
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
      case 'home':
      default:
        return <HomeExperience {...sharedProps} />;
    }
  }

  return (
    <PageShell>
        <PageHero eyebrow="股票建仓策略看板" title={heroTitle}>
          <PageTabs activeKey={activeTab} onSelect={handleSelectTab} tabs={tabs} />
        </PageHero>
      {renderActivePanel()}
    </PageShell>
  );
}
