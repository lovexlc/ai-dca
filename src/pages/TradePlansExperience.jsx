import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Bell, CalendarClock, Calculator, ChevronDown, ChevronUp, ListChecks, MoreHorizontal, Pencil, Plus, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { loadNotifyStatus, readNotifyClientConfig, sendNotifyTest } from '../app/notifySync.js';
import { buildTradePlanCenter } from '../app/tradePlans.js';
import { deletePlan } from '../app/plan.js';
import { deleteSellPlan } from '../app/sellPlans.js';
import { clearDcaState } from '../app/dca.js';
import { showActionToast } from '../app/toast.js';
import { Card, cx, primaryButtonClass } from '../components/experience-ui.jsx';
import { NewPlanExperience } from './NewPlanExperience.jsx';
import { FeatureHelp } from '../components/FeatureHelp.jsx';
import {
  buildRuleDetailUrl,
  extractPurchaseAmount
} from '../app/tradePlansHelpers.js';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';

// 定投 / 卖出 / VIX / 回测仍按需 lazy 加载，列表页只展示计划分类与卡片。
const DcaExperienceLazy = lazy(() => import('./DcaExperience.jsx').then((m) => ({ default: m.DcaExperience })));
const SellPlanExperienceLazy = lazy(() => import('./SellPlanExperience.jsx').then((m) => ({ default: m.SellPlanExperience })));
const VixDashboardLazy = lazy(() => import('./VixDashboard.jsx').then((m) => ({ default: m.VixDashboard })));
const DcaCalculatorExperienceLazy = lazy(() => import('./DcaCalculatorExperience.jsx').then((m) => ({ default: m.DcaCalculatorExperience })));

// 子视图与 URL hash 对应关系：
//   ''  / '#list' → 全部（默认）
//   '#home'      → 加仓分类列表
//   '#dca'       → 定投分类列表
//   '#sell'      → 卖出分类列表
//   '#vix'       → VIX 信号
//   '#calc'      → 回测工具
//   '#new'       → 新建加仓 wizard
//   '#dca-new'   → 新建定投表单
//   '#sell-new'  → 新建卖出表单
const SUB_VIEW_HASH = {
  list: '',
  home: '#home',
  dca: '#dca',
  sell: '#sell',
  vix: '#vix',
  calc: '#calc',
  new: '#new',
  dcaNew: '#dca-new',
  sellNew: '#sell-new'
};

function parseSubViewFromHash(hash = '') {
  if (hash === '#new') return 'new';
  if (hash === '#home') return 'home';
  if (hash === '#dca') return 'dca';
  if (hash === '#sell') return 'sell';
  if (hash === '#vix') return 'vix';
  if (hash === '#calc') return 'calc';
  if (hash === '#dca-new') return 'dcaNew';
  if (hash === '#sell-new') return 'sellNew';
  return 'list';
}

function getInitialSubView() {
  if (typeof window === 'undefined') return 'list';
  return parseSubViewFromHash(window.location.hash || '');
}

function SubViewLoadingFallback() {
  return <Card className="text-sm text-slate-500">正在加载交易计划模块…</Card>;
}

const SUB_TABS = [
  { key: 'list', label: '全部', icon: ListChecks },
  { key: 'home', label: '加仓', icon: TrendingUp },
  { key: 'dca', label: '定投', icon: CalendarClock },
  { key: 'sell', label: '卖出', icon: TrendingDown },
  { key: 'vix', label: 'VIX 信号', icon: Activity },
  { key: 'calc', label: '回测工具', icon: Calculator }
];

const TYPE_META = {
  plan: { label: '加仓', tone: 'indigo' },
  dca: { label: '定投', tone: 'emerald' },
  sell: { label: '卖出', tone: 'amber' }
};

const TONE_CLASS = {
  indigo: {
    pill: 'bg-indigo-50 text-indigo-700',
    icon: 'bg-indigo-100 text-indigo-600',
    bar: 'bg-indigo-500'
  },
  emerald: {
    pill: 'bg-emerald-50 text-emerald-700',
    icon: 'bg-emerald-100 text-emerald-600',
    bar: 'bg-emerald-500'
  },
  amber: {
    pill: 'bg-amber-50 text-amber-700',
    icon: 'bg-amber-100 text-amber-600',
    bar: 'bg-amber-500'
  }
};

const EMPTY_STATE = {
  list: {
    icon: ListChecks,
    title: '暂无交易计划',
    description: '创建第一个计划，开始管理交易提醒',
    cta: '新建计划',
    type: 'menu',
    tone: 'indigo',
    links: []
  },
  home: {
    icon: TrendingUp,
    title: '暂无加仓计划',
    description: '在价格下跌时分批买入，降低持仓成本',
    cta: '创建加仓策略',
    type: 'plan',
    tone: 'indigo',
    links: [
      { label: '设置定投', type: 'dca' },
      { label: '设置卖出规则', type: 'sell' }
    ]
  },
  dca: {
    icon: CalendarClock,
    title: '暂无定投计划',
    description: '定期定额投资，平滑市场波动',
    cta: '设置定投',
    type: 'dca',
    tone: 'emerald',
    links: [
      { label: '创建加仓', type: 'plan' },
      { label: '设置卖出', type: 'sell' }
    ]
  },
  sell: {
    icon: TrendingDown,
    title: '暂无卖出计划',
    description: '达到目标收益率时分批止盈',
    cta: '设置卖出规则',
    type: 'sell',
    tone: 'amber',
    links: [
      { label: '创建加仓', type: 'plan' },
      { label: '设置定投', type: 'dca' }
    ]
  }
};

export function TradePlansExperience({ links, inPagesDir = false, embedded = false }) {
  const [subView, setSubView] = useState(getInitialSubView);
  const [testingRowId, setTestingRowId] = useState('');
  const [channelConfigured, setChannelConfigured] = useState(true);
  const notifyClientId = useMemo(() => readNotifyClientConfig().notifyClientId || '', []);
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const [expandedRowIds, setExpandedRowIds] = useState(() => new Set());
  const [editingPlan, setEditingPlan] = useState(null);
  const [editingDca, setEditingDca] = useState(null);
  const { previewRows = [] } = useMemo(() => {
    void planRefreshKey;
    return buildTradePlanCenter();
  }, [planRefreshKey]);
  const typeCounts = useMemo(() => ({
    list: previewRows.length,
    home: previewRows.filter((row) => row.sourceType === 'plan').length,
    dca: previewRows.filter((row) => row.sourceType === 'dca').length,
    sell: previewRows.filter((row) => row.sourceType === 'sell').length
  }), [previewRows]);
  const planCountLabel = `共 ${previewRows.length} 个计划`;
  const visibleRows = useMemo(() => {
    if (subView === 'home') return previewRows.filter((row) => row.sourceType === 'plan');
    if (subView === 'dca') return previewRows.filter((row) => row.sourceType === 'dca');
    if (subView === 'sell') return previewRows.filter((row) => row.sourceType === 'sell');
    return previewRows;
  }, [previewRows, subView]);
  const hasVisiblePlans = visibleRows.length > 0;
  const tradePlansMeta = () => ({
    subView,
    totalCount: previewRows.length,
    visibleCount: visibleRows.length,
    planCount: typeCounts.home,
    dcaCount: typeCounts.dca,
    sellCount: typeCounts.sell,
    channelConfigured,
    embedded
  });

  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [openMenuRowId, setOpenMenuRowId] = useState('');
  const menuContainerRef = useRef(null);
  const createMenuRef = useRef(null);
  const [openMenuPlacement, setOpenMenuPlacement] = useState('below');

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
    if (nextView === 'new' || nextView === 'dcaNew' || nextView === 'sellNew') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function enterNewPlanView() {
    setEditingPlan(null);
    setEditingDca(null);
    gotoSubView('new', { push: true });
  }

  function enterCreateView(type) {
    setCreateMenuOpen(false);
    trackFeatureEvent('trade_plans', 'create_open', {
      type,
      ...tradePlansMeta()
    });
    if (type === 'dca') {
      setEditingDca(null);
      gotoSubView('dcaNew', { push: true });
      return;
    }
    if (type === 'sell') {
      gotoSubView('sellNew', { push: true });
      return;
    }
    if (type === 'calc') {
      gotoSubView('calc', { push: true });
      return;
    }
    enterNewPlanView();
  }

  function exitNewPlanView() {
    setEditingPlan(null);
    setPlanRefreshKey((value) => value + 1);
    if (typeof window !== 'undefined' && window.location.hash === '#new') {
      window.history.back();
      return;
    }
    gotoSubView('list');
  }

  function handleSelectSubTab(nextView) {
    if (nextView === subView) return;
    setCreateMenuOpen(false);
    gotoSubView(nextView);
    trackFeatureEvent('trade_plans', 'subtab_select', {
      from: subView,
      to: nextView,
      ...tradePlansMeta()
    });
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

  useEffect(() => {
    let cancelled = false;
    async function refreshChannelStatus() {
      try {
        const status = await loadNotifyStatus(notifyClientId);
        if (cancelled) return;
        const barkConfigured = Boolean(status?.configured?.bark);
        const serverChan3Configured = Boolean(status?.configured?.serverChan3 || status?.setup?.serverChan3?.configured);
        const pcConfigured = Boolean(status?.configured?.webWs || status?.setup?.webWsCurrentClientRegistrationCount);
        setChannelConfigured(barkConfigured || serverChan3Configured || pcConfigured);
      } catch {
        if (!cancelled) setChannelConfigured(true);
      }
    }
    refreshChannelStatus();
    return () => {
      cancelled = true;
    };
  }, [notifyClientId]);

  useEffect(() => {
    if (!openMenuRowId && !createMenuOpen) return undefined;
    function handleClickOutside(event) {
      const rowNode = menuContainerRef.current;
      const createNode = createMenuRef.current;
      if (rowNode && !rowNode.contains(event.target)) {
        setOpenMenuRowId('');
      }
      if (createNode && !createNode.contains(event.target)) {
        setCreateMenuOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpenMenuRowId('');
        setCreateMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuRowId, createMenuOpen]);

  function handleDeletePlanRow(row) {
    if (!row) return;
    if (typeof window !== 'undefined') {
      const label = row.planName || row.detailTitle || '该交易计划';
      if (!window.confirm(`确认删除「${label}」？删除后本地计划无法恢复。`)) {
        setOpenMenuRowId('');
        return;
      }
    }
    const meta = {
      sourceType: row.sourceType || '',
      rowIdLength: String(row.id || '').length,
      hasNotifyRule: Boolean(row.ruleId),
      ...tradePlansMeta()
    };
    if (row.sourceType === 'dca') {
      clearDcaState(row.sourceId);
      showActionToast('删除定投计划', 'success');
    } else if (row.sourceType === 'sell' && row.sourceId) {
      deleteSellPlan(row.sourceId);
      showActionToast('删除卖出计划', 'success');
    } else if (row.sourceType === 'plan' && row.sourceId) {
      const removed = deletePlan(row.sourceId);
      if (!removed) return;
      showActionToast('删除加仓计划', 'success');
    } else {
      return;
    }
    setOpenMenuRowId('');
    setPlanRefreshKey((value) => value + 1);
    trackActionResult('trade_plans', 'delete', 'success', meta);
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
      eventType: row?.sourceType === 'sell' ? 'sell-plan-test' : 'plan-test',
      ruleId: normalizedRuleId,
      symbol: String(row?.symbol || '').trim(),
      strategyName: normalizedPlanName,
      triggerCondition: String(row?.triggerLabel || '').trim(),
      purchaseAmount,
      detailUrl,
      title: '交易计划测试提醒',
      summary: `${normalizedPlanName} 测试提醒`,
      body: `这是「${normalizedPlanName}」的测试通知。已触发您设置的条件${row?.triggerLabel ? `（${row.triggerLabel}）` : ''}，请前往网页查看当前投资策略。`
    };
  }

  async function handleTestNotify(row) {
    if (!row?.id) return;
    setOpenMenuRowId('');
    setTestingRowId(row.id);
    const startedAt = Date.now();
    trackFeatureEvent('trade_plans', 'notify_test_start', {
      sourceType: row.sourceType || '',
      hasRuleId: Boolean(row.ruleId),
      hasSymbol: Boolean(row.symbol),
      channelConfigured,
      ...tradePlansMeta()
    });
    try {
      await sendNotifyTest({
        clientId: notifyClientId,
        ...buildRowTestPayload(row)
      });
      showActionToast('测试通知', 'success', {
        description: `已发送「${row.planName}」的测试通知。`
      });
      trackActionResult('trade_plans', 'notify_test', 'success', {
        sourceType: row.sourceType || '',
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '测试通知发送失败';
      showActionToast('测试通知', 'error', {
        description: `${message}。请到《消息通知》页面检查推送通道接入。`
      });
      trackActionResult('trade_plans', 'notify_test', 'error', {
        sourceType: row.sourceType || '',
        durationMs: Date.now() - startedAt,
        errorMessage: message
      });
    } finally {
      setTestingRowId('');
    }
  }

  function handleEditRow(row) {
    setOpenMenuRowId('');
    trackFeatureEvent('trade_plans', 'edit_open', {
      sourceType: row?.sourceType || '',
      rowIdLength: String(row?.id || '').length,
      ...tradePlansMeta()
    });
    if (row?.sourceType === 'dca') {
      setEditingDca(row.editPayload || null);
      gotoSubView('dcaNew', { push: true });
      return;
    }
    if (row?.sourceType === 'sell') {
      gotoSubView('sellNew', { push: true });
      return;
    }
    if (row?.sourceType === 'plan') {
      setEditingPlan(row.editPayload || null);
      gotoSubView('new', { push: true });
    }
  }

  function toggleRowExpanded(rowId = '') {
    setExpandedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }

  function renderCreateMenu() {
    const options = [
      { label: '加仓策略（按回撤/均线）', type: 'plan', icon: TrendingUp },
      { label: '定投计划', type: 'dca', icon: CalendarClock },
      { label: '卖出计划', type: 'sell', icon: TrendingDown },
      { label: '从回测结果创建...', type: 'calc', icon: Calculator, separated: true }
    ];

    return (
      <div className="relative" ref={createMenuRef}>
        <button
          type="button"
          onClick={() => setCreateMenuOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={createMenuOpen}
          className={cx(primaryButtonClass, 'min-h-10 px-3.5 py-2')}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          新建计划
          <ChevronDown className={cx('h-4 w-4 transition-transform', createMenuOpen ? 'rotate-180' : '')} aria-hidden="true" />
        </button>
        {createMenuOpen ? (
          <div role="menu" className="absolute right-0 top-12 z-20 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white py-2 shadow-xl shadow-slate-900/10">
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <div key={option.type}>
                  {option.separated ? <div className="my-1 h-px bg-slate-100" /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => enterCreateView(option.type)}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    {option.label}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  function renderPageHeader() {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">TRADE PLANS</div>
            <div className="mt-1 flex items-center gap-1.5">
              <h1 className="text-2xl font-bold tracking-tight text-slate-950">交易计划</h1>
              <FeatureHelp topic="trade-plans" />
            </div>
            <p className="mt-1 text-sm text-slate-500">{planCountLabel} · {channelConfigured ? '通知已就绪' : '通知未配置'}</p>
          </div>
          {renderCreateMenu()}
        </div>
        <div className="mt-5">{renderSubTabBar()}</div>
      </div>
    );
  }

  function renderSubTabBar() {
    return (
      <div className="scroll-fade-x overflow-x-auto border-b border-slate-200" role="tablist" aria-label="交易计划分类">
        <div className="flex min-w-max items-center gap-0">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = subView === tab.key;
            const count = typeCounts[tab.key];
            const label = typeof count === 'number' ? `${tab.label} · ${count}` : tab.label;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleSelectSubTab(tab.key)}
                role="tab"
                id={`trade-plan-tab-${tab.key}`}
                aria-selected={isActive}
                aria-controls={`trade-plan-panel-${tab.key}`}
                className={cx(
                  'inline-flex min-h-12 shrink-0 items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-semibold transition-all duration-200',
                  isActive
                    ? 'border-indigo-500 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
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
            if (isOpen) {
              setOpenMenuRowId('');
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
            const estimatedMenuHeight = window.matchMedia?.('(min-width: 640px)')?.matches ? 180 : 210;
            setOpenMenuPlacement(viewportHeight - rect.bottom < estimatedMenuHeight + 12 ? 'above' : 'below');
            setOpenMenuRowId(row.id);
          }}
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
        {isOpen ? (
          <>
            <button
              type="button"
              aria-label="关闭操作菜单"
              className="fixed inset-0 z-[110] cursor-default bg-transparent sm:hidden"
              onClick={() => setOpenMenuRowId('')}
            />
            <div
              role="menu"
              className={cx(
                'absolute right-0 z-[120] w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/15 sm:right-0 sm:top-10 sm:z-10 sm:w-44 sm:p-0 sm:shadow-lg',
                openMenuPlacement === 'above' ? 'bottom-10 sm:bottom-auto' : 'top-10'
              )}
            >
              <button
                type="button"
                role="menuitem"
                disabled={isTesting}
                onClick={() => handleTestNotify(row)}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:gap-2 sm:rounded-none sm:font-normal"
              >
                <Bell className="h-4 w-4 text-slate-400" />
                {isTesting ? '正在发送' : '测试通知'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => handleEditRow(row)}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:min-h-0 sm:gap-2 sm:rounded-none sm:font-normal"
              >
                <Pencil className="h-4 w-4 text-slate-400" />
                编辑
              </button>
              <div className="my-1 h-px bg-slate-100 sm:my-0" />
              <button
                type="button"
                role="menuitem"
                onClick={() => handleDeletePlanRow(row)}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 sm:min-h-0 sm:gap-2 sm:rounded-none sm:font-normal"
              >
                <Trash2 className="h-4 w-4" />
                删除
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  function renderEmptyState() {
    const config = EMPTY_STATE[subView] || EMPTY_STATE.list;
    const Icon = config.icon;
    const tone = TONE_CLASS[config.tone] || TONE_CLASS.indigo;
    return (
      <Card className="min-w-0">
        <div className="rounded-3xl border border-dashed border-indigo-200 bg-slate-50 px-6 py-10 text-center">
          <div className={cx('mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl', tone.icon)}>
            <Icon className="h-8 w-8" aria-hidden="true" />
          </div>
          <div className="text-lg font-bold text-slate-950">{config.title}</div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{config.description}</p>
          <div className="mt-6">
            <button type="button" onClick={() => enterCreateView(config.type)} className={cx(primaryButtonClass, 'min-h-10 px-4 py-2')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {config.cta}
            </button>
          </div>
          {config.links.length ? (
            <div className="mt-5 text-sm text-slate-500">
              <span>或者从其他类型开始：</span>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                {config.links.map((link) => (
                  <button
                    key={link.type}
                    type="button"
                    onClick={() => enterCreateView(link.type)}
                    className="inline-flex min-h-8 items-center rounded-lg px-2 font-semibold text-indigo-600 underline-offset-4 hover:bg-indigo-50 hover:underline"
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    );
  }

  function renderPlanCard(row) {
    const meta = TYPE_META[row.sourceType] || { label: row.cardTypeLabel || row.typeLabel, tone: row.cardTone || 'indigo' };
    const tone = TONE_CLASS[row.cardTone || meta.tone] || TONE_CLASS.indigo;
    const progressValue = Math.max(0, Math.min(100, Number(row.progressValue || 0) * 100));
    const progressItems = Array.isArray(row.progressItems) ? row.progressItems : [];
    const detailItems = Array.isArray(row.detailItems) ? row.detailItems : [];
    const isExpanded = expandedRowIds.has(row.id);
    const isTesting = testingRowId === row.id;

    return (
      <div key={row.id} className="relative min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-lg hover:shadow-slate-200/70 sm:px-5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold', tone.pill)}>{row.cardTypeLabel || meta.label}</span>
              <span className="line-clamp-2 min-w-0 flex-1 basis-0 text-sm font-bold leading-5 text-slate-950 sm:truncate" title={row.planName}>{row.planName}</span>
            </div>
            <div className="mt-2 flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500">
              <span className="shrink-0 font-bold text-slate-700">{row.symbol || '--'}</span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="min-w-0 max-w-full break-words leading-5">{row.progressLabel || row.triggerLabel}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="hidden h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex"
              aria-label="测试通知"
              title="测试通知"
              disabled={isTesting}
              onClick={() => handleTestNotify(row)}
            >
              <Bell className={cx('h-4 w-4', isTesting ? 'animate-pulse' : '')} />
            </button>
            <button
              type="button"
              className="hidden h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:inline-flex"
              aria-label="编辑计划"
              title="编辑计划"
              onClick={() => handleEditRow(row)}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="hidden h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 sm:inline-flex"
              aria-label="删除计划"
              title="删除计划"
              onClick={() => handleDeletePlanRow(row)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
            {renderRowMenu(row)}
          </div>
        </div>

        <div className="mt-4 min-w-0 space-y-2">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className={cx('h-full rounded-full', tone.bar)} style={{ width: `${progressValue}%` }} />
            </div>
            <span className="block min-w-0 max-w-full break-words text-xs font-semibold leading-5 text-slate-500 sm:max-w-[45%] sm:shrink-0 sm:truncate" title={row.progressCaption || row.nextExecutionLabel}>{row.progressCaption || row.nextExecutionLabel}</span>
          </div>
          {progressItems.length ? (
            <div className="grid min-w-0 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {progressItems.map((item, index) => (
                <div key={`${row.id}-${item.label}-${index}`} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <div className="break-words font-semibold text-slate-700">{item.label}{item.detail ? `（${item.detail}）` : ''}</div>
                  <div className="mt-1 break-words text-slate-400">{item.status}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-4 min-w-0 border-t border-slate-100 pt-3 text-xs font-medium text-slate-500">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 max-w-full break-words leading-5 sm:truncate" title={row.footerLabel || `${row.triggerLabel} · ${row.nextExecutionLabel}`}>{row.footerLabel || `${row.triggerLabel} · ${row.nextExecutionLabel}`}</span>
            {detailItems.length ? (
              <button
                type="button"
                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-700"
                onClick={() => toggleRowExpanded(row.id)}
                aria-expanded={isExpanded}
              >
                {isExpanded ? '收起层级' : '展开层级'}
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            ) : null}
          </div>
        </div>
        {isExpanded && detailItems.length ? (
          <div className="mt-3 min-w-0 overflow-hidden rounded-xl border border-slate-200">
            <div className="hidden grid-cols-[0.8fr_0.8fr_0.9fr_1.3fr_0.8fr] gap-3 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 sm:grid">
              <span>层级</span>
              <span>价格</span>
              <span>金额</span>
              <span>触发条件</span>
              <span>状态</span>
            </div>
            <div className="divide-y divide-slate-100 bg-white">
              {detailItems.map((item, index) => (
                <div key={`${row.id}-detail-${item.id || index}`} className="grid min-w-0 grid-cols-1 gap-1 px-3 py-3 text-xs text-slate-600 sm:grid-cols-[0.8fr_0.8fr_0.9fr_1.3fr_0.8fr] sm:gap-3 sm:items-center">
                  <div className="break-words font-semibold text-slate-800">{item.label}{item.detail ? `（${item.detail}）` : ''}</div>
                  <div className="break-words">{item.price || '--'}</div>
                  <div className="break-words font-semibold text-slate-900">{item.amount || '--'}</div>
                  <div className="break-words">{item.trigger || '--'}</div>
                  <div className="break-words font-semibold text-indigo-600">{item.status || '待执行'}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderPlansList() {
    if (!hasVisiblePlans) {
      return renderEmptyState();
    }

    return (
      <Card className="min-w-0 p-4 sm:p-5">
        <div className="grid gap-3">
          {visibleRows.map((row) => renderPlanCard(row))}
        </div>
      </Card>
    );
  }

  if (subView === 'new') {
    return (
      <NewPlanExperience
        links={links}
        embedded
        initialPlan={editingPlan}
        mode={editingPlan?.id ? 'replace' : 'create'}
        onBack={exitNewPlanView}
      />
    );
  }

  if (subView === 'dcaNew') {
    return (
      <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
        <Suspense fallback={<SubViewLoadingFallback />}>
          <DcaExperienceLazy
            links={links}
            inPagesDir={inPagesDir}
            embedded
            initialDca={editingDca}
            mode={editingDca?.id ? 'replace' : 'create'}
            onCancel={() => {
              setEditingDca(null);
              gotoSubView('dca');
            }}
            onAfterSave={() => {
              setEditingDca(null);
              setPlanRefreshKey((value) => value + 1);
              gotoSubView('dca');
            }}
          />
        </Suspense>
      </div>
    );
  }

  if (subView === 'sellNew') {
    return (
      <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
        <Suspense fallback={<SubViewLoadingFallback />}>
          <SellPlanExperienceLazy
            links={links}
            embedded
            onAfterSave={() => gotoSubView('sell')}
          />
        </Suspense>
      </div>
    );
  }

  if (subView === 'vix' || subView === 'calc') {
    return (
      <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
        {renderPageHeader()}
        <div role="tabpanel" id={`trade-plan-panel-${subView}`} aria-labelledby={`trade-plan-tab-${subView}`} className="trade-plan-tab-panel">
          <Suspense fallback={<SubViewLoadingFallback />}>
            {subView === 'vix' ? <VixDashboardLazy embedded /> : <DcaCalculatorExperienceLazy embedded />}
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      {renderPageHeader()}

      {channelConfigured ? null : (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <Bell className="h-4 w-4 text-amber-600" />
          <span>通知未配置 · 测试 / 触发通知不会推送。</span>
          <a
            className="ml-auto inline-flex items-center gap-1 font-semibold text-amber-700 underline-offset-4 hover:underline"
            href={links.notify}
          >
            去设置
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      )}

      <div role="tabpanel" id={`trade-plan-panel-${subView}`} aria-labelledby={`trade-plan-tab-${subView}`} className="trade-plan-tab-panel">
        {renderPlansList()}
      </div>
    </div>
  );
}
