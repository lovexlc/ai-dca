import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Bell, CalendarClock, Calculator, ListChecks, MoreHorizontal, Plus, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { loadNotifyStatus, readNotifyClientConfig, sendNotifyTest } from '../app/notifySync.js';
import { buildTradePlanCenter } from '../app/tradePlans.js';
import { deletePlan } from '../app/plan.js';
import { clearDcaState } from '../app/dca.js';
import { showActionToast } from '../app/toast.js';
import { Card, Pill, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';
import { NewPlanExperience } from './NewPlanExperience.jsx';
import {
  buildRuleDetailUrl,
  extractPurchaseAmount
} from '../app/tradePlansHelpers.js';

// 加仓计划 / 定投计划已合并为本 tab 的二级视图，按需 lazy 加载。
const HomeExperienceLazy = lazy(() => import('./HomeExperience.jsx').then((m) => ({ default: m.HomeExperience })));
const DcaExperienceLazy = lazy(() => import('./DcaExperience.jsx').then((m) => ({ default: m.DcaExperience })));
const SellPlanExperienceLazy = lazy(() => import('./SellPlanExperience.jsx').then((m) => ({ default: m.SellPlanExperience })));
const VixDashboardLazy = lazy(() => import('./VixDashboard.jsx').then((m) => ({ default: m.VixDashboard })));
const DcaCalculatorExperienceLazy = lazy(() => import('./DcaCalculatorExperience.jsx').then((m) => ({ default: m.DcaCalculatorExperience })));

// 子视图与 URL hash 对应关系：
//   ''  / '#list' → 列表（默认）
//   '#home'      → 加仓
//   '#dca'       → 定投
//   '#sell'      → 卖出
//   '#vix'       → VIX 面板
//   '#calc'      → DCA 回测
//   '#new'       → 新建（覆盖整个 tab，独占视图）
// 说明：原 '#ledger'（台账）/ '#position'（仓位）已迁至「持仓总览 → 交易记录 / 持仓分析」子页，
//   旧 hash 进入时回落到默认列表视图。
const SUB_VIEW_HASH = {
  list: '',
  home: '#home',
  dca: '#dca',
  sell: '#sell',
  vix: '#vix',
  calc: '#calc',
  new: '#new'
};

function parseSubViewFromHash(hash = '') {
  if (hash === '#new') return 'new';
  if (hash === '#home') return 'home';
  if (hash === '#dca') return 'dca';
  if (hash === '#sell') return 'sell';
  if (hash === '#vix') return 'vix';
  if (hash === '#calc') return 'calc';
  return 'list';
}

function getInitialSubView() {
  if (typeof window === 'undefined') return 'list';
  return parseSubViewFromHash(window.location.hash || '');
}

function SubViewLoadingFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-slate-500">
      加载中…
    </div>
  );
}

const SUB_TABS = [
  { key: 'list', label: '列表', icon: ListChecks },
  { key: 'home', label: '加仓', icon: TrendingUp },
  { key: 'dca', label: '定投', icon: CalendarClock },
  { key: 'sell', label: '卖出', icon: TrendingDown },
  { key: 'vix', label: 'VIX', icon: Activity },
  { key: 'calc', label: '回测', icon: Calculator }
];

export function TradePlansExperience({ links, inPagesDir = false, embedded = false }) {
  // 子视图（list / home / dca / new）通过 URL hash 持久化，方便刷新和浏览器前进后退。
  const [subView, setSubView] = useState(getInitialSubView);
  const [testingRowId, setTestingRowId] = useState('');
  // 仅判断是否已配置任一推送通道，未配置时在顶部提示一行链接。
  const [channelConfigured, setChannelConfigured] = useState(true);
  const notifyClientId = useMemo(() => readNotifyClientConfig().notifyClientId || '', []);
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const { previewRows, hasPlans } = useMemo(() => {
    void planRefreshKey;
    return buildTradePlanCenter();
  }, [planRefreshKey]);
  const planCountLabel = `${previewRows.length} 个计划`;

  const [openMenuRowId, setOpenMenuRowId] = useState('');
  const menuContainerRef = useRef(null);

  function gotoSubView(nextView, { push = false } = {}) {
    if (typeof window === 'undefined') {
      setSubView(nextView);
      return;
    }
    const targetHash = SUB_VIEW_HASH[nextView] ?? '';
    const currentHash = window.location.hash || '';
    const baseUrl = `${window.location.pathname}${window.location.search}${targetHash}`;
    if (currentHash !== targetHash) {
      if (push) {
        window.history.pushState({ subView: nextView }, '', baseUrl);
      } else {
        window.history.replaceState({ subView: nextView }, '', baseUrl);
      }
    }
    setSubView(nextView);
    if (nextView === 'new') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function enterNewPlanView() {
    gotoSubView('new', { push: true });
  }

  function exitNewPlanView() {
    if (typeof window !== 'undefined' && window.location.hash === '#new') {
      window.history.back();
      return;
    }
    gotoSubView('list');
  }

  function handleSelectSubTab(nextView) {
    if (nextView === subView) return;
    gotoSubView(nextView);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function syncSubViewFromHash() {
      setSubView(parseSubViewFromHash(window.location.hash || ''));
    }
    window.addEventListener('hashchange', syncSubViewFromHash);
    window.addEventListener('popstate', syncSubViewFromHash);
    return () => {
      window.removeEventListener('hashchange', syncSubViewFromHash);
      window.removeEventListener('popstate', syncSubViewFromHash);
    };
  }, []);

  // 拉取一次通知状态，仅用于决定是否展示顶部「未配置」提示行。
  useEffect(() => {
    let cancelled = false;
    async function refreshChannelStatus() {
      try {
        const status = await loadNotifyStatus(notifyClientId);
        if (cancelled) return;
        const barkConfigured = Boolean(status?.configured?.bark);
        const androidConfigured = Array.isArray(status?.setup?.gcmCurrentClientRegistrations)
          && status.setup.gcmCurrentClientRegistrations.length > 0;
        setChannelConfigured(barkConfigured || androidConfigured);
      } catch {
        if (!cancelled) setChannelConfigured(true);
      }
    }
    refreshChannelStatus();
    return () => {
      cancelled = true;
    };
  }, [notifyClientId]);

  // 点击外部关闭 row 的 ··· 菜单。
  useEffect(() => {
    if (!openMenuRowId) return undefined;
    function handleClickOutside(event) {
      const node = menuContainerRef.current;
      if (node && !node.contains(event.target)) {
        setOpenMenuRowId('');
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpenMenuRowId('');
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuRowId]);

  function handleDeletePlanRow(row) {
    if (!row) return;
    if (row.sourceType === 'dca') {
      clearDcaState();
      showActionToast('删除定投计划', 'success');
    } else if (row.sourceType === 'plan' && row.sourceId) {
      const removed = deletePlan(row.sourceId);
      if (!removed) return;
      showActionToast('删除加仓计划', 'success');
    } else {
      return;
    }
    setOpenMenuRowId('');
    setPlanRefreshKey((value) => value + 1);
  }

  function buildRowTestPayload(row) {
    const normalizedRuleId = String(row?.ruleId || '').trim() || 'test';
    const normalizedPlanName = String(row?.planName || row?.detailTitle || '交易计划').trim();
    const purchaseAmount = extractPurchaseAmount(row);
    const detailUrl = buildRuleDetailUrl(row);

    if (row?.sourceType === 'dca') {
      return {
        eventId: `${normalizedRuleId}:manual-test:${Date.now()}`,
        eventType: 'dca-test',
        ruleId: normalizedRuleId,
        symbol: String(row?.symbol || '').trim(),
        strategyName: normalizedPlanName,
        triggerCondition: String(row?.triggerLabel || '').trim(),
        purchaseAmount,
        detailUrl,
        title: '定投计划测试提醒',
        summary: `${normalizedPlanName} 测试提醒`,
        body: `这是「${normalizedPlanName}」的测试通知。已到达您设定的定投日，请前往网页查看本期投资策略。`
      };
    }

    return {
      eventId: `${normalizedRuleId}:manual-test:${Date.now()}`,
      eventType: 'plan-test',
      ruleId: normalizedRuleId,
      symbol: String(row?.symbol || '').trim(),
      strategyName: normalizedPlanName,
      triggerCondition: String(row?.triggerLabel || '').trim(),
      purchaseAmount,
      detailUrl,
      title: '交易计划测试提醒',
      summary: `${normalizedPlanName} 测试提醒`,
      body: `这是「${normalizedPlanName}」的测试通知。已触发您设置的购买条件${row?.triggerLabel ? `（${row.triggerLabel}）` : ''}，请前往网页查看当前投资策略。`
    };
  }

  async function handleTestNotify(row) {
    if (!row?.id) return;
    setOpenMenuRowId('');
    setTestingRowId(row.id);
    try {
      await sendNotifyTest({
        clientId: notifyClientId,
        ...buildRowTestPayload(row)
      });
      showActionToast('测试通知', 'success', {
        description: `已发送「${row.planName}」的测试通知。`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '测试通知发送失败';
      showActionToast('测试通知', 'error', {
        description: `${message}。请到《消息通知》页面检查推送通道接入。`
      });
    } finally {
      setTestingRowId('');
    }
  }

  function handleViewMore(row) {
    setOpenMenuRowId('');
    if (row?.actionKey === 'home' || row?.actionKey === 'dca' || row?.actionKey === 'sell') {
      handleSelectSubTab(row.actionKey);
    }
  }

  function renderSubTabBar() {
    return (
      <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-100/70 p-1" role="tablist" aria-label="交易计划分类">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = subView === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleSelectSubTab(tab.key)}
              role="tab"
              id={`trade-plan-tab-${tab.key}`}
              aria-selected={isActive}
              aria-pressed={isActive}
              aria-controls={`trade-plan-panel-${tab.key}`}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-colors',
                isActive
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:bg-white/60 hover:text-slate-700'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>
    );
  }

  function renderRowMenu(row) {
    const isOpen = openMenuRowId === row.id;
    const isTesting = testingRowId === row.id;
    return (
      <div className="relative" ref={isOpen ? menuContainerRef : null}>
        <button
          type="button"
          aria-label="更多操作"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          onClick={(event) => {
            event.stopPropagation();
            setOpenMenuRowId(isOpen ? '' : row.id);
          }}
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
        {isOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-10 z-10 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              disabled={isTesting}
              onClick={() => handleTestNotify(row)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Bell className="h-4 w-4 text-slate-400" />
              {isTesting ? '正在发送' : '测试通知'}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => handleViewMore(row)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <ArrowRight className="h-4 w-4 text-slate-400" />
              查看更多
            </button>
            <div className="h-px bg-slate-100" />
            <button
              type="button"
              role="menuitem"
              onClick={() => handleDeletePlanRow(row)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              删除
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderPlansList() {
    if (!hasPlans) {
      return (
        <Card className="min-w-0">
          <div className="rounded-2xl border border-dashed border-indigo-200 bg-slate-50 px-6 py-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <ListChecks className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="text-base font-bold text-slate-900">选择一个目标开始</div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <button type="button" onClick={enterNewPlanView} className={cx(primaryButtonClass, 'w-full min-h-10 px-3 py-2 text-xs')}>
                按回撤加仓
              </button>
              <button type="button" onClick={() => handleSelectSubTab('dca')} className={cx(secondaryButtonClass, 'w-full min-h-10 px-3 py-2 text-xs')}>
                设置定投
              </button>
              <button type="button" onClick={() => handleSelectSubTab('sell')} className={cx(secondaryButtonClass, 'w-full min-h-10 px-3 py-2 text-xs')}>
                设置卖出规则
              </button>
              <button type="button" onClick={() => handleSelectSubTab('vix')} className={cx(secondaryButtonClass, 'w-full min-h-10 px-3 py-2 text-xs')}>
                查看 VIX 规则
              </button>
            </div>
          </div>
        </Card>
      );
    }

    return (
      <Card className="min-w-0">
        <div className="grid gap-3">
          {previewRows.map((row) => (
            <div
              key={row.id}
              className="relative w-full rounded-xl border border-slate-200 bg-white px-4 py-3 transition-colors hover:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={row.statusTone}>{row.statusLabel}</Pill>
                    <Pill tone="slate">{row.typeLabel}</Pill>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-bold text-slate-900">{row.planName}</span>
                    <span className="text-xs text-slate-400">{row.symbol}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                    <span>{row.triggerLabel}</span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span>{row.nextExecutionLabel}</span>
                  </div>
                </div>
                {renderRowMenu(row)}
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  // 《新建计划》子视图直接覆盖当前内容。
  if (subView === 'new') {
    return (
      <NewPlanExperience
        links={links}
        embedded
        onBack={exitNewPlanView}
      />
    );
  }

  // 加仓 / 定投 二级视图：外层共享二级 tab 切换，内嵌各自的 Experience 组件。
  if (subView === 'home' || subView === 'dca' || subView === 'sell' || subView === 'vix' || subView === 'calc') {
    return (
      <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
        {renderSubTabBar()}
        <div role="tabpanel" id={`trade-plan-panel-${subView}`} aria-labelledby={`trade-plan-tab-${subView}`}>
        <Suspense fallback={<SubViewLoadingFallback />}>
          {subView === 'home' ? (
            <HomeExperienceLazy links={links} inPagesDir={inPagesDir} embedded />
          ) : subView === 'dca' ? (
            <DcaExperienceLazy
              links={links}
              inPagesDir={inPagesDir}
              embedded
              onAfterSave={() => gotoSubView('list')}
            />
          ) : subView === 'sell' ? (
            <SellPlanExperienceLazy
              links={links}
              embedded
              onAfterSave={() => gotoSubView('list')}
            />
          ) : subView === 'vix' ? (
            <VixDashboardLazy embedded />
          ) : (
            <DcaCalculatorExperienceLazy embedded />
          )}
        </Suspense>
        </div>
      </div>
    );
  }

  // 默认：列表视图.
  return (
    <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
      <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Trade Plans</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">交易计划</h1>
          <p className="mt-1 text-sm text-slate-500">{planCountLabel} · {channelConfigured ? '通知已就绪' : '通知未配置'}</p>
        </div>
        <button type="button" onClick={enterNewPlanView} className={primaryButtonClass}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          新建加仓策略
        </button>
      </header>

      {renderSubTabBar()}

      {channelConfigured ? null : (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <Bell className="h-4 w-4 text-amber-600" />
          <span>通知通道尚未配置，测试 / 触发通知不会推送。</span>
          <a
            className="ml-auto inline-flex items-center gap-1 font-semibold text-amber-700 underline-offset-4 hover:underline"
            href={links.notify}
          >
            去配置
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      )}

      <div role="tabpanel" id="trade-plan-panel-list" aria-labelledby="trade-plan-tab-list">
        {renderPlansList()}
      </div>
    </div>
  );
}
