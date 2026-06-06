import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, BarChart3, Bell, BookOpen, Crown, LineChart, ListChecks, Plus, Send, Shuffle, Trash2, Wallet, X } from 'lucide-react';
import { DEFAULT_WORKSPACE_TAB, LEGACY_TAB_REDIRECTS, PRIMARY_TAB_META, PRIMARY_TAB_ORDER, createPageLinks, getPrimaryTabs } from '../app/screens.js';
import { ConsoleLayout } from '../components/console-layout.jsx';
import { AiChatWidget } from '../components/ai-chat/ai-chat-widget.jsx';
import { MobileTabBar } from '../components/mobile-tab-bar.jsx';
import { GlobalSearch } from '../components/global-search.jsx';
import { BrandPreviewBar } from '../components/brand-preview-bar.jsx';
import { startCloudAutoSync } from '../app/cloudSync.js';
import { showToast } from '../app/toast.js';
import { clearDemoData, readDemoDataMeta } from '../app/demoData.js';
import { readWorkspacePrefs } from '../app/workspacePrefs.js';
import { CLOUD_SYNC_SESSION_EVENT, loadCloudSession } from '../app/authClient.js';
import { isAnalyticsAdmin, trackPageEngagement, trackPageView, trackSessionHeartbeat, trackSessionStart } from '../app/analytics.js';

// 各主 tab 使用 React.lazy 按需加载，在 Vite 中会被拆成独立 chunk。
// HomeExperience / DcaExperience 已并入 TradePlansExperience 作为二级 tab，不再在这里顶级 lazy。
const FundSwitchExperience = lazy(() => import('./FundSwitchExperience.jsx').then((m) => ({ default: m.FundSwitchExperience })));
const HoldingsExperience = lazy(() => import('./HoldingsExperience.jsx').then((m) => ({ default: m.HoldingsExperience })));
const NotifyExperience = lazy(() => import('./NotifyExperience.jsx').then((m) => ({ default: m.NotifyExperience })));
const TradePlansExperience = lazy(() => import('./TradePlansExperience.jsx').then((m) => ({ default: m.TradePlansExperience })));
const MarketsExperience = lazy(() => import('./MarketsExperience.jsx').then((m) => ({ default: m.MarketsExperience })));
const StrategyGuideExperience = lazy(() => import('./StrategyGuideExperience.jsx').then((m) => ({ default: m.StrategyGuideExperience })));
const AdminAnalyticsExperience = lazy(() => import('./AdminAnalyticsExperience.jsx').then((m) => ({ default: m.AdminAnalyticsExperience })));
const PremiumExperience = lazy(() => import('./PremiumExperience.jsx').then((m) => ({ default: m.PremiumExperience })));

function readPreferredWorkspaceTab(fallbackTab = DEFAULT_WORKSPACE_TAB) {
  if (typeof window === 'undefined') return fallbackTab;
  return readWorkspacePrefs().homepageTab || fallbackTab;
}

const WORKSPACE_TITLES = {
  strategy: '美股策略助手',
  tradePlans: '交易计划中心',
  fundSwitch: '基金切换收益分析',
  markets: '行情中心',
  premium: '高级版',
  holdings: '持仓总览',
  notify: '通知设置',
  adminData: '数据看板'
};

const SIDEBAR_ICONS = {
  strategy: BookOpen,
  tradePlans: ListChecks,
  fundSwitch: Shuffle,
  markets: LineChart,
  premium: Crown,
  holdings: Wallet,
  notify: Bell,
  adminData: BarChart3
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
    <div role="status" aria-label="页面加载中" className="flex h-full min-h-[40vh] flex-col gap-3 px-4 py-6">
      <div className="h-8 w-1/3 animate-pulse rounded-lg bg-slate-200/70" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
      </div>
      <div className="h-48 w-full animate-pulse rounded-2xl bg-slate-100" />
      <span className="sr-only">加载中…</span>
    </div>
  );
}

export function WorkspacePage({ initialTab = DEFAULT_WORKSPACE_TAB, inPagesDir = false }) {
  const links = createPageLinks({ inPagesDir });
  const [activeTab, setActiveTab] = useState(() => readTabFromLocation(readPreferredWorkspaceTab(initialTab)));
  const [demoMeta, setDemoMeta] = useState(() => readDemoDataMeta());
  const [tabHistory, setTabHistory] = useState([]);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [cloudSession, setCloudSession] = useState(() => loadCloudSession());

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


  useEffect(() => {
    function handleSessionChanged(event) {
      const nextSession = event?.detail?.session || loadCloudSession();
      setCloudSession(nextSession);
    }
    window.addEventListener(CLOUD_SYNC_SESSION_EVENT, handleSessionChanged);
    return () => window.removeEventListener(CLOUD_SYNC_SESSION_EVENT, handleSessionChanged);
  }, []);

  useEffect(() => {
    trackPageView(activeTab);
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    trackSessionStart({ entryTab: activeTabRef.current });
    const timer = window.setInterval(() => {
      trackSessionHeartbeat({ activeTab: activeTabRef.current });
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const startedAt = Date.now();
    let activeTimeMs = 0;
    let lastActiveAt = document.visibilityState === 'visible' ? startedAt : 0;
    let visibilityChanges = 0;
    let maxScrollPct = 0;

    function updateScrollDepth() {
      const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const pct = Math.max(0, Math.min(100, (window.scrollY / scrollable) * 100));
      maxScrollPct = Math.max(maxScrollPct, pct);
    }

    function handleVisibilityChange() {
      visibilityChanges += 1;
      const now = Date.now();
      if (document.visibilityState === 'hidden') {
        if (lastActiveAt) activeTimeMs += now - lastActiveAt;
        lastActiveAt = 0;
      } else {
        lastActiveAt = now;
      }
    }

    updateScrollDepth();
    window.addEventListener('scroll', updateScrollDepth, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      updateScrollDepth();
      if (lastActiveAt) activeTimeMs += Date.now() - lastActiveAt;
      trackPageEngagement({
        tab: activeTab,
        durationMs: Date.now() - startedAt,
        activeTimeMs,
        maxScrollPct,
        visibilityChanges
      });
      window.removeEventListener('scroll', updateScrollDepth);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeTab]);

  useEffect(() => {
    function handleScroll() {
      setShowScrollTop(window.scrollY > 520);
    }
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 为每个 tab 独立缓存上次的 scrollY，在切换返回时恢复。
  const scrollPositionsRef = useRef(new Map());
  const previousTabRef = useRef(activeTab);
  const restoreScrollOnNextTabRef = useRef(false);
  const activeTabRef = useRef(activeTab);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const isAdminUser = isAnalyticsAdmin(cloudSession);
  const currentPageLabel = PRIMARY_TAB_META[activeTab]?.label || '';

  const quickAction = useMemo(() => {
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
      getPrimaryTabs(links)
        .filter((tab) => !PRIMARY_TAB_META[tab.key]?.adminOnly || isAdminUser)
        .map((tab) => ({
          ...tab,
          icon: SIDEBAR_ICONS[tab.key]
        })),
    [links, isAdminUser]
  );
  const heroTitle = WORKSPACE_TITLES[activeTab] || WORKSPACE_TITLES.strategy;

  useEffect(() => {
    if (PRIMARY_TAB_META[activeTab]?.adminOnly && !isAdminUser) {
      setActiveTab(DEFAULT_WORKSPACE_TAB);
    }
  }, [activeTab, isAdminUser]);

  useEffect(() => {
    document.title = heroTitle;
  }, [heroTitle]);

  useEffect(() => {
    startCloudAutoSync();
  }, []);

  // 未登录用户提示注册/登录以启用云同步
  useEffect(() => {
    if (!cloudSession?.accessToken) {
      const toastKey = 'aiDcaLoginPromptShown';
      try {
        if (sessionStorage.getItem(toastKey)) return;
        sessionStorage.setItem(toastKey, '1');
      } catch { /* ignore */ }
      setTimeout(() => {
        showToast({
          title: '登录账号自动同步数据',
          description: '点击右上角登录，数据变更后自动同步到云端，换设备也不丢。',
          tone: 'indigo',
          durationMs: 6000
        });
      }, 1500);
    }
  }, []);

  useEffect(() => {
    const canonicalUrl = buildWorkspaceUrl(activeTab, { inPagesDir });
    if (activeTab === 'tradePlans' && window.location.hash) {
      canonicalUrl.hash = window.location.hash;
    }
    if (window.location.href !== canonicalUrl.href) {
      window.history.replaceState({ tab: activeTab }, '', canonicalUrl);
    }
  }, [activeTab, inPagesDir]);

  useEffect(() => {
    function handlePopState() {
      const nextTab = readTabFromLocation(readPreferredWorkspaceTab(initialTab));
      scrollPositionsRef.current.set(activeTab, window.scrollY);
      restoreScrollOnNextTabRef.current = true;
      setTabHistory((current) => current.filter((item) => item !== nextTab));
      setActiveTab(nextTab);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab, initialTab]);

  // 普通 tab 切换始终回到顶部，避免新 tab 在 lazy/短内容阶段套用旧 scrollY 后出现大块空白。
  // 只有浏览器返回/移动端返回这类“回到上一个页面”的动作才恢复该 tab 的旧位置。
  useEffect(() => {
    const shouldRestore = restoreScrollOnNextTabRef.current;
    restoreScrollOnNextTabRef.current = false;
    const saved = shouldRestore ? scrollPositionsRef.current.get(activeTab) : 0;
    const targetY = typeof saved === 'number' ? Math.max(0, saved) : 0;
    const id = window.requestAnimationFrame(() => {
      const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({ top: Math.min(targetY, maxY), behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [activeTab]);

  function handleSelectTab(nextTab, options = {}) {
    const normalizedTab = normalizeWorkspaceTab(nextTab);
    if (PRIMARY_TAB_META[normalizedTab]?.adminOnly && !isAdminUser) {
      return;
    }
    const hash = typeof options.hash === 'string' ? options.hash : '';
    const alreadyActive = normalizedTab === activeTab;
    const hashMatches = (window.location.hash || '') === hash;
    if (alreadyActive && hashMatches) {
      return;
    }

    // 在离开当前 tab 之前记录其 scrollY，并保存移动端返回路径。
    if (!alreadyActive) {
      restoreScrollOnNextTabRef.current = options.restoreScroll === true;
      scrollPositionsRef.current.set(previousTabRef.current, window.scrollY);
      if (options.recordHistory !== false) {
        setTabHistory((current) => {
          const withoutCurrent = current.filter((item) => item !== activeTab);
          return [...withoutCurrent, activeTab].slice(-8);
        });
      }
      previousTabRef.current = normalizedTab;
    }

    const nextUrl = buildWorkspaceUrl(normalizedTab, { inPagesDir });
    if (hash) {
      nextUrl.hash = hash;
    }
    window.history.pushState({ tab: normalizedTab }, '', nextUrl);
    setActiveTab(normalizedTab);
    // 记录侧边 tab 点击，供「策略指南 · Recently visited」读取。
    try {
      const RECENT_KEY = 'aiDcaRecentGuideAnchors';
      const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]');
      const list = Array.isArray(raw) ? raw.filter(Boolean) : [];
      list.unshift({ id: `tab:${normalizedTab}`, ts: Date.now() });
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
    } catch {
      // 忽略最近访问记录写入失败，不影响 tab 切换。
    }
    // 合并后：侧边栏《新建建仓计划》通过 #new hash 跳进《交易计划》的新建子视图。
    // 由于 TradePlansExperience 在 mount 时才读 hash，手动触发 hashchange 用于已 mount 的情况。
    if (hash && alreadyActive) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  function handleMobileBack() {
    const previousTab = tabHistory[tabHistory.length - 1];
    if (!previousTab) return;
    setTabHistory((current) => current.slice(0, -1));
    handleSelectTab(previousTab, { recordHistory: false, restoreScroll: true });
  }

  function handleScrollTop() {
    const headerOffset = 64;
    const probeY = Math.min(window.innerHeight - 120, Math.max(140, window.innerHeight * 0.38));
    const cards = Array.from(document.querySelectorAll('[data-scroll-card="true"]'));
    const activeCard = cards.find((card) => {
      const rect = card.getBoundingClientRect();
      return rect.top <= probeY && rect.bottom >= probeY + 80;
    });
    if (activeCard) {
      const targetTop = Math.max(0, window.scrollY + activeCard.getBoundingClientRect().top - headerOffset);
      if (window.scrollY > targetTop + 24) {
        window.scrollTo({ top: targetTop, behavior: 'smooth' });
        return;
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      case 'premium':
        return <PremiumExperience {...sharedProps} />;
      case 'notify':
        return <NotifyExperience {...sharedProps} />;
      case 'adminData':
        return isAdminUser ? <AdminAnalyticsExperience {...sharedProps} /> : <StrategyGuideExperience {...sharedProps} onNavigate={handleSelectTab} onDemoDataChange={setDemoMeta} />;
      case 'holdings':
        return <HoldingsExperience {...sharedProps} />;
      default:
        return <StrategyGuideExperience {...sharedProps} onNavigate={handleSelectTab} onDemoDataChange={setDemoMeta} />;
    }
  }

  return (
    <>
      <BrandPreviewBar
        currentPageLabel={currentPageLabel}
        onOpenNav={() => window.dispatchEvent(new CustomEvent('console:open-mobile-nav'))}
        onJoinGroup={() => setShowQrModal(true)}
        onShowDisclaimer={() => setShowDisclaimer(true)}
      />
      <ConsoleLayout
        brand="美股策略助手"
        sidebarNav={sidebarNav}
        activeKey={activeTab}
        onSelectNav={handleSelectTab}
        showMobileBar={false}
      >
        {demoMeta ? (
          <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>当前正在使用演示数据。建议先配置一次手机通知，完整体验策略触发提醒。</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 shadow-sm transition-colors hover:bg-amber-100" onClick={() => handleSelectTab('notify')}>配置通知</button>
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
        <div className="pt-4">
          <Suspense fallback={<TabLoadingFallback />}>{renderActivePanel()}</Suspense>
        </div>
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
      {(tabHistory.length > 0 || showScrollTop) ? (
        <div className="fixed bottom-24 right-4 z-40 flex flex-col gap-2 sm:hidden" aria-label="页面快捷操作">
          {tabHistory.length > 0 ? (
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-lg shadow-slate-900/10 backdrop-blur active:bg-slate-100"
              aria-label="返回上一页"
              title="返回上一页"
              onClick={handleMobileBack}
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          {showScrollTop ? (
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-lg shadow-slate-900/10 backdrop-blur active:bg-slate-100"
              aria-label="回到顶部"
              title="回到顶部"
              onClick={handleScrollTop}
            >
              <ArrowUp className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
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
      {showQrModal ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/70 p-4" role="dialog" aria-modal="true" aria-label="加入群聊二维码" onClick={() => setShowQrModal(false)}>
          <div className="relative w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="关闭" className="absolute -top-3 -right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 shadow-md transition-colors hover:bg-slate-100" onClick={() => setShowQrModal(false)}>
              <X className="h-4 w-4" />
            </button>
            <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
              <img src="https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAAEVAAFzaiDsh2MouwAB7FlBu5fAAAGdN8BCBAACFCAAAktMCVV0D52WNhozXDsE.png" alt="加入群聊二维码" className="block w-full" />
              <p className="px-4 py-3 text-center text-xs text-slate-600">使用微信扫码加入群聊</p>
            </div>
          </div>
        </div>
      ) : null}
      {showDisclaimer ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" onClick={() => setShowDisclaimer(false)}>
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="关闭" className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setShowDisclaimer(false)}>
              <X className="h-4 w-4" />
            </button>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">免责声明</div>
            <h3 className="mt-1 text-lg font-bold text-slate-900">非官方、非投资建议</h3>
            <p className="mt-4 text-sm leading-7 text-slate-500">本工具中的部分策略说明由公开的金渐成公众号文章整理、总结和结构化而来，仅用于个人学习、记录和辅助决策。本工具与金渐成本人及其公众号无官方关联、无授权关系，也不代表金渐成本人观点或服务。页面中的计划、提醒、演示数据和计算结果均为辅助工具输出，不构成任何投资建议。投资有风险，请独立判断并自行承担决策结果。</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
