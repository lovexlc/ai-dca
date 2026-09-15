import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Calculator,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Layers,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  X
} from 'lucide-react';
import { deleteAccountResourceItem, fetchAccountResource } from '../app/accountApi.js';
import { mergePayloadValueRemoteWins } from '../app/syncMerge.js';
import { loadNotifyStatus, readNotifyClientConfig, sendNotifyTest } from '../app/notifySync.js';
import { buildTradePlanCenter } from '../app/tradePlans.js';
import { deletePlan } from '../app/plan.js';
import { useClickOutside } from '../hooks/useClickOutside.js';
import { deleteSellPlan } from '../app/sellPlans.js';
import { clearDcaState } from '../app/dca.js';
import { showActionToast } from '../app/toast.js';
import { Card, cx, primaryButtonClass } from '../components/experience-ui.jsx';
import { FeatureHelp } from '../components/FeatureHelp.jsx';
import {
  buildRuleDetailUrl,
  extractPurchaseAmount
} from '../app/tradePlansHelpers.js';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';
import { clearMarketActionDraft, readMarketActionDraft } from '../app/marketActionDraft.js';
import { clearWorkspaceReturn, readWorkspaceReturn } from '../app/workspaceReturn.js';
import { confirmAction } from '../app/confirm.js';

// 定投 / 卖出仍按需 lazy 加载，列表页只展示计划分类与卡片。
const NewPlanExperienceLazy = lazy(() => import('./NewPlanExperience.jsx').then((m) => ({ default: m.NewPlanExperience })));
const DcaExperienceLazy = lazy(() => import('./DcaExperience.jsx').then((m) => ({ default: m.DcaExperience })));
const SellPlanExperienceLazy = lazy(() => import('./SellPlanExperience.jsx').then((m) => ({ default: m.SellPlanExperience })));

// 子视图与 URL hash 对应关系：
//   ''  / '#list' → 全部（默认）
//   '#home'      → 加仓分类列表
//   '#dca'       → 定投分类列表
//   '#sell'      → 卖出分类列表
//   '#new'       → 新建加仓 wizard
//   '#dca-new'   → 新建定投表单
//   '#sell-new'  → 新建卖出表单
const SUB_VIEW_HASH = {
  list: '',
  home: '#home',
  dca: '#dca',
  sell: '#sell',
  new: '#new',
  dcaNew: '#dca-new',
  sellNew: '#sell-new'
};

function parseSubViewFromHash(hash = '') {
  if (hash === '#new') return 'new';
  if (hash === '#home') return 'home';
  if (hash === '#dca') return 'dca';
  if (hash === '#sell') return 'sell';
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
  { key: 'list', label: '全部计划', icon: ListChecks },
  { key: 'home', label: '阶梯加仓', icon: TrendingUp },
  { key: 'dca', label: '定投计划', icon: CalendarClock },
  { key: 'sell', label: '止盈卖出', icon: TrendingDown }
];

const TYPE_META = {
  plan: { label: '阶梯加仓', tone: 'indigo' },
  dca: { label: '定投计划', tone: 'emerald' },
  sell: { label: '止盈卖出', tone: 'amber' }
};

const TONE_CLASS = {
  indigo: {
    pill: 'bg-indigo-50 text-indigo-700 border border-indigo-200/70',
    icon: 'bg-indigo-100 text-indigo-600',
    bar: 'bg-indigo-500',
    cardBorder: 'hover:border-indigo-200',
    accentText: 'text-indigo-600'
  },
  emerald: {
    pill: 'bg-emerald-50 text-emerald-700 border border-emerald-200/70',
    icon: 'bg-emerald-100 text-emerald-600',
    bar: 'bg-emerald-500',
    cardBorder: 'hover:border-emerald-200',
    accentText: 'text-emerald-600'
  },
  amber: {
    pill: 'bg-amber-50 text-amber-700 border border-amber-200/70',
    icon: 'bg-amber-100 text-amber-600',
    bar: 'bg-amber-500',
    cardBorder: 'hover:border-amber-200',
    accentText: 'text-amber-600'
  }
};

const EMPTY_STATE = {
  list: {
    icon: ListChecks,
    title: '暂无交易计划',
    description: '创建第一个计划，支持金字塔梯度加仓、Smart DCA 动态定投与分档止盈卖出',
    cta: '新建计划',
    type: 'menu',
    tone: 'indigo',
    links: []
  },
  home: {
    icon: TrendingUp,
    title: '暂无阶梯加仓计划',
    description: '在价格回调时分批建立阶梯买入网格，有效平摊持仓成本',
    cta: '创建加仓策略',
    type: 'plan',
    tone: 'indigo',
    links: [
      { label: '设置定投计划', type: 'dca' },
      { label: '设置止盈卖出', type: 'sell' }
    ]
  },
  dca: {
    icon: CalendarClock,
    title: '暂无定投计划',
    description: '设定买入频率（每日/每周/双周/每月/每季）与扣款节点，定期定额或智能动态加仓',
    cta: '创建定投计划',
    type: 'dca',
    tone: 'emerald',
    links: [
      { label: '创建阶梯加仓', type: 'plan' },
      { label: '设置止盈卖出', type: 'sell' }
    ]
  },
  sell: {
    icon: TrendingDown,
    title: '暂无止盈卖出计划',
    description: '达到预期目标收益率时分档落袋，避免利润坐过山车',
    cta: '设置止盈规则',
    type: 'sell',
    tone: 'amber',
    links: [
      { label: '创建阶梯加仓', type: 'plan' },
      { label: '设置定投计划', type: 'dca' }
    ]
  }
};

export function TradePlansExperience({ links, inPagesDir = false, embedded = false }) {
  const [subView, setSubView] = useState(getInitialSubView);
  const [testingRowId, setTestingRowId] = useState('');
  const [channelConfigured, setChannelConfigured] = useState(true);
  const notifyClientId = useMemo(() => readNotifyClientConfig().notifyClientId || '', []);
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!['list', 'home', 'dca', 'sell'].includes(subView)) return undefined;
    let cancelled = false;
    const resourceMap = {
      home: [['plans/store', 'aiDcaPlanStore']],
      dca: [['dca/store', 'aiDcaDcaStore']],
      sell: [['sell-plans/store', 'aiDcaSellPlanStore']],
      list: [
        ['plans/store', 'aiDcaPlanStore'],
        ['dca/store', 'aiDcaDcaStore'],
        ['sell-plans/store', 'aiDcaSellPlanStore']
      ]
    };
    Promise.all(resourceMap[subView].map(async ([resource, storageKey]) => {
      const result = await fetchAccountResource(resource);
      if (cancelled || result?.data === undefined) return;
      const remoteRaw = result.data === null ? null : JSON.stringify(result.data);
      const localRaw = window.localStorage.getItem(storageKey);
      // 账号接口可能短暂返回空聚合结果。按资源既有规则合并，
      // 让远端更新覆盖同 id 记录，同时保留刚保存但尚未出现在远端的本地记录。
      const mergedRaw = mergePayloadValueRemoteWins(storageKey, remoteRaw, localRaw);
      if (mergedRaw !== null && mergedRaw !== undefined && mergedRaw !== localRaw) {
        window.localStorage.setItem(storageKey, mergedRaw);
      }
    }))
      .then(() => {
        if (!cancelled) setPlanRefreshKey((value) => value + 1);
      })
      .catch((error) => {
        if (!cancelled) showActionToast('交易计划加载失败', 'error', {
          description: error instanceof Error ? error.message : '请稍后重试。'
        });
      });
    return () => { cancelled = true; };
  }, [subView]);

  const [expandedRowIds, setExpandedRowIds] = useState(() => new Set());
  const [editingPlan, setEditingPlan] = useState(null);
  const [editingDca, setEditingDca] = useState(null);
  const [editingSell, setEditingSell] = useState(null);

  const { previewRows = [], summary = {} } = useMemo(() => {
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

  const nearestPricePlan = useMemo(() => previewRows.find((row) => row.sourceType === 'plan') || null, [previewRows]);
  const nextDcaPlan = useMemo(() => previewRows.find((row) => row.sourceType === 'dca') || null, [previewRows]);
  const nextSellPlan = useMemo(() => previewRows.find((row) => row.sourceType === 'sell') || null, [previewRows]);

  const visibleRows = useMemo(() => {
    if (subView === 'home') return previewRows.filter((row) => row.sourceType === 'plan');
    if (subView === 'dca') return previewRows.filter((row) => row.sourceType === 'dca');
    if (subView === 'sell') return previewRows.filter((row) => row.sourceType === 'sell');
    return previewRows;
  }, [previewRows, subView]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return visibleRows;
    return visibleRows.filter((row) => {
      const sym = String(row.symbol || '').toLowerCase();
      const name = String(row.planName || '').toLowerCase();
      const trig = String(row.triggerLabel || '').toLowerCase();
      const exec = String(row.nextExecutionLabel || '').toLowerCase();
      return sym.includes(q) || name.includes(q) || trig.includes(q) || exec.includes(q);
    });
  }, [visibleRows, searchQuery]);

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
  const [workspaceReturn, setWorkspaceReturn] = useState(() => readWorkspaceReturn('tradePlans'));
  const menuContainerRef = useRef(null);
  const createMenuRef = useRef(null);
  const [openMenuPlacement, setOpenMenuPlacement] = useState('below');

  useClickOutside(menuContainerRef, () => setOpenMenuRowId(''), !!openMenuRowId);
  useClickOutside(createMenuRef, () => setCreateMenuOpen(false), createMenuOpen);

  useEffect(() => {
    if (!openMenuRowId && !createMenuOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpenMenuRowId('');
        setCreateMenuOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuRowId, createMenuOpen]);

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
    setEditingSell(null);
    gotoSubView('new', { push: true });
  }

  function handleWorkspaceReturn() {
    if (!workspaceReturn?.tab) return;
    const target = workspaceReturn;
    clearWorkspaceReturn();
    setWorkspaceReturn(null);
    window.dispatchEvent(new CustomEvent('workspace:navigate', {
      detail: {
        tab: target.tab,
        hash: target.hash || '',
        search: target.search || '',
        recordReturn: false,
      }
    }));
  }

  function enterCreateView(type) {
    setCreateMenuOpen(false);
    trackFeatureEvent('trade_plans', 'create_open', {
      type,
      ...tradePlansMeta()
    });
    if (type === 'dca') {
      setEditingDca(null);
      setEditingSell(null);
      gotoSubView('dcaNew', { push: true });
      return;
    }
    if (type === 'sell') {
      setEditingSell(null);
      gotoSubView('sellNew', { push: true });
      return;
    }
    if (type === 'calc') {
      gotoSubView('calc', { push: true });
      return;
    }
    enterNewPlanView();
  }

  useEffect(() => {
    const actionDraft = readMarketActionDraft();
    if (!actionDraft || !['plan-new', 'dca-new', 'sell-new'].includes(actionDraft.action)) return;
    clearMarketActionDraft();
    const symbol = String(actionDraft.symbol || '').trim().toUpperCase();
    if (!symbol) return;
    const label = actionDraft.name || symbol;
    setCreateMenuOpen(false);
    if (actionDraft.action === 'plan-new') {
      setEditingPlan({
        symbol,
        name: `${label} · 加仓策略`,
      });
      gotoSubView('new');
    } else if (actionDraft.action === 'dca-new') {
      setEditingDca({
        symbol,
        name: `${label} · 定投计划`,
        currentPrice: actionDraft.price > 0 ? actionDraft.price : 0,
      });
      gotoSubView('dcaNew');
    } else {
      setEditingSell({
        symbol,
        name: `${label} · 卖出计划`,
        holdingCost: actionDraft.price > 0 ? actionDraft.price : 0,
      });
      gotoSubView('sellNew');
    }
    showActionToast('已带入行情标的', 'success', {
      description: `${symbol}${actionDraft.name ? ` · ${actionDraft.name}` : ''}`,
    });
    trackFeatureEvent('trade_plans', 'prefill_from_markets', {
      action: actionDraft.action,
      symbolLength: symbol.length,
      hasPrice: actionDraft.price > 0,
    });
  }, []);

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
        const emailConfigured = Boolean(status?.configured?.email || (status?.setup?.email?.verified && status?.setup?.email?.enabled));
        setChannelConfigured(barkConfigured || serverChan3Configured || pcConfigured || emailConfigured);
      } catch {
        if (!cancelled) setChannelConfigured(true);
      }
    }
    refreshChannelStatus();
    return () => {
      cancelled = true;
    };
  }, [notifyClientId]);

  async function handleDeletePlanRow(row) {
    if (!row) return;
    const label = row.planName || row.detailTitle || '该交易计划';

    // 采用全项目统一的 Radix UI confirmAction 弹窗
    const confirmed = await confirmAction({
      title: '确认删除交易计划',
      description: `确认删除「${label}」？删除后本地计划无法恢复。`,
      confirmText: '确认删除',
      cancelText: '取消',
      tone: 'danger'
    });

    if (!confirmed) {
      setOpenMenuRowId('');
      return;
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
      try {
        await deleteAccountResourceItem('plans/store', row.sourceId);
      } catch {
        showActionToast('账号数据同步失败', 'warning', { description: '加仓计划已从本地删除。' });
      }
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
      setEditingSell(row.editPayload || null);
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
      { label: '阶梯加仓策略（按回撤/均线）', type: 'plan', icon: TrendingUp },
      { label: '定投计划（多频动态联动）', type: 'dca', icon: CalendarClock },
      { label: '分档止盈卖出计划', type: 'sell', icon: TrendingDown },
      { label: '从回测结果快速创建...', type: 'calc', icon: Calculator, separated: true }
    ];

    return (
      <div className="relative" ref={createMenuRef}>
        <button
          type="button"
          onClick={() => setCreateMenuOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={createMenuOpen}
          className={cx(primaryButtonClass, 'min-h-10 px-4 py-2 shadow-sm shadow-indigo-200')}
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

  // 顶部看板概览指标卡（支持桌面端 4 列与移动端紧凑自适应排版）
  function renderMetricsOverview() {
    const kpiCards = [
      {
        id: 'total',
        label: '全部监控计划',
        value: `${previewRows.length} 个`,
        sub: `${typeCounts.home} 加仓 · ${typeCounts.dca} 定投 · ${typeCounts.sell} 止盈`,
        tone: 'indigo',
        icon: ListChecks
      },
      {
        id: 'pyramid',
        label: '加仓临近监控',
        value: nearestPricePlan ? nearestPricePlan.symbol : '暂无加仓',
        sub: nearestPricePlan ? (nearestPricePlan.triggerLabel || '监控中') : '跌幅/均线分批建仓',
        tone: 'indigo',
        icon: TrendingUp
      },
      {
        id: 'dca',
        label: '下次定投扣款',
        value: nextDcaPlan ? nextDcaPlan.symbol : '暂无定投',
        sub: nextDcaPlan ? (nextDcaPlan.nextExecutionLabel || nextDcaPlan.triggerLabel) : '平滑波动定期买入',
        tone: 'emerald',
        icon: CalendarClock
      },
      {
        id: 'sell',
        label: '分档止盈监控',
        value: nextSellPlan ? nextSellPlan.symbol : '暂无卖出',
        sub: nextSellPlan ? (nextSellPlan.triggerLabel || '分档待触发') : '目标收益率分档落袋',
        tone: 'amber',
        icon: TrendingDown
      }
    ];

    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          const tone = TONE_CLASS[kpi.tone] || TONE_CLASS.indigo;
          return (
            <div
              key={kpi.id}
              className="relative min-w-0 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm transition-all hover:border-slate-300 sm:p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{kpi.label}</span>
                <span className={cx('inline-flex h-7 w-7 items-center justify-center rounded-xl', tone.icon)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="mt-2 text-base font-bold tracking-tight text-slate-900 sm:text-lg">{kpi.value}</div>
              <div className="mt-1 truncate text-xs text-slate-500 font-medium" title={kpi.sub}>{kpi.sub}</div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderPageHeader() {
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">TRADE PLANS CENTER</div>
              <div className="mt-1 flex items-center gap-1.5">
                <h1 className="text-2xl font-bold tracking-tight text-slate-950">交易计划监控看板</h1>
                <FeatureHelp topic="trade-plans" />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {planCountLabel} · {channelConfigured ? '通知推送已就绪' : '通知通道未配置'}
              </p>
            </div>
            {renderCreateMenu()}
          </div>
        </div>

        {renderMetricsOverview()}

        {/* 筛选与搜索控制栏 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="scroll-fade-x overflow-x-auto pb-1 sm:pb-0" role="tablist" aria-label="交易计划分类">
            <div className="flex min-w-max items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-100/80 p-1.5">
              {SUB_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = subView === tab.key;
                const count = typeCounts[tab.key];
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
                      'inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all',
                      isActive
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{tab.label}</span>
                    <span className={cx('ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-semibold', isActive ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600')}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 实时搜索框 */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索标的代码、计划或触发条件..."
              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-8 text-xs text-slate-800 placeholder-slate-400 outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:text-slate-600"
                aria-label="清空搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function renderWorkspaceReturnBar() {
    if (!workspaceReturn?.tab) return null;
    return (
      <div className="flex">
        <button
          type="button"
          onClick={handleWorkspaceReturn}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
        >
          <ArrowLeft className="h-4 w-4" />
          返回{workspaceReturn.label || '上一页'}
        </button>
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
            const estimatedMenuHeight = 180;
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
                'absolute right-0 z-[120] w-48 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl',
                openMenuPlacement === 'above' ? 'bottom-10' : 'top-10'
              )}
            >
              <button
                type="button"
                role="menuitem"
                disabled={isTesting}
                onClick={() => handleTestNotify(row)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Bell className="h-4 w-4 text-slate-400" />
                {isTesting ? '正在发送...' : '测试通知推送'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => handleEditRow(row)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Pencil className="h-4 w-4 text-slate-400" />
                编辑计划策略
              </button>
              <div className="my-1 h-px bg-slate-100" />
              <button
                type="button"
                role="menuitem"
                onClick={() => handleDeletePlanRow(row)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" />
                删除计划
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
        <div className="rounded-3xl border border-dashed border-indigo-200 bg-slate-50/70 px-6 py-10 text-center">
          <div className={cx('mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl', tone.icon)}>
            <Icon className="h-8 w-8" aria-hidden="true" />
          </div>
          <div className="text-lg font-bold text-slate-950">{config.title}</div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{config.description}</p>
          <div className="mt-6">
            <button type="button" onClick={() => enterCreateView(config.type)} className={cx(primaryButtonClass, 'min-h-10 px-4 py-2 shadow-sm')}>
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

  // 渲染交易计划卡片（全面消除移动端字形拉升畸变，增加多行自适应和底栏快捷操作）
  function renderPlanCard(row) {
    const meta = TYPE_META[row.sourceType] || { label: row.cardTypeLabel || row.typeLabel, tone: row.cardTone || 'indigo' };
    const tone = TONE_CLASS[row.cardTone || meta.tone] || TONE_CLASS.indigo;
    const progressValue = Math.max(0, Math.min(100, Number(row.progressValue || 0) * 100));
    const progressItems = Array.isArray(row.progressItems) ? row.progressItems : [];
    const detailItems = Array.isArray(row.detailItems) ? row.detailItems : [];
    const isExpanded = expandedRowIds.has(row.id);
    const isTesting = testingRowId === row.id;

    return (
      <div
        key={row.id}
        className={cx(
          'relative min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white p-4 transition-all duration-200 sm:p-5',
          tone.cardBorder,
          'hover:shadow-md hover:shadow-slate-200/50'
        )}
      >
        {/* 卡片头部第一行：徽章、标的代码与右侧状态/桌面端快捷操作 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold', tone.pill)}>
              {row.cardTypeLabel || meta.label}
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-800">
              {row.symbol || '--'}
            </span>
            <span className="rounded-md bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
              {row.statusLabel || '监控中'}
            </span>
          </div>

          {/* 桌面端快捷操作按钮组 */}
          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="测试通知"
              title="测试通知推送"
              disabled={isTesting}
              onClick={() => handleTestNotify(row)}
            >
              <Bell className={cx('h-4 w-4', isTesting ? 'animate-pulse text-indigo-600' : '')} />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="编辑计划"
              title="编辑计划"
              onClick={() => handleEditRow(row)}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
              aria-label="删除计划"
              title="删除计划"
              onClick={() => handleDeletePlanRow(row)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
            {renderRowMenu(row)}
          </div>
        </div>

        {/* 卡片头部第二行：完整标题（消除 flex 挤压，独占全宽，彻底避免单字垂直折行） */}
        <div className="mt-2.5">
          <h3 className="text-base font-bold leading-snug text-slate-900 break-words" title={row.planName}>
            {row.planName}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 font-medium">
            <span>触发机制：{row.triggerLabel || row.typeLabel}</span>
            <span className="text-slate-300">·</span>
            <span>下次节奏：{row.nextExecutionLabel || '等待条件达成'}</span>
          </div>
        </div>

        {/* 进度条与执行节点 */}
        <div className="mt-3.5 space-y-2">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className={cx('h-full rounded-full transition-all duration-300', tone.bar)} style={{ width: `${progressValue}%` }} />
            </div>
            <span className="shrink-0 text-xs font-semibold text-slate-600" title={row.progressCaption || row.nextExecutionLabel}>
              {row.progressCaption || row.progressLabel}
            </span>
          </div>

          {/* 进度/分批节点指标芯片 */}
          {progressItems.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {progressItems.map((item, index) => (
                <div key={`${row.id}-${item.label}-${index}`} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <div className="font-bold text-slate-800 truncate">{item.label}{item.detail ? ` (${item.detail})` : ''}</div>
                  <div className="mt-0.5 font-medium text-slate-400">{item.status}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* 卡片底栏信息 */}
        <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="font-medium text-slate-500 truncate" title={row.footerLabel}>
            {row.footerLabel}
          </div>

          {/* 桌面端展开/收起按钮 */}
          {detailItems.length ? (
            <button
              type="button"
              className="hidden sm:inline-flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-700"
              onClick={() => toggleRowExpanded(row.id)}
              aria-expanded={isExpanded}
            >
              {isExpanded ? '收起策略层级' : '展开策略层级'}
              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </div>

        {/* 移动端专属快捷操作底栏（无需在三点菜单中寻找，直接大拇指触达） */}
        <div className="mt-3 flex items-center gap-2 border-t border-slate-100/80 pt-3 sm:hidden">
          <button
            type="button"
            onClick={() => handleTestNotify(row)}
            disabled={isTesting}
            className="flex-1 inline-flex min-h-9 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 active:bg-slate-100 disabled:opacity-50"
          >
            <Bell className={cx('h-3.5 w-3.5', isTesting ? 'animate-pulse text-indigo-600' : 'text-slate-500')} />
            {isTesting ? '正在发送' : '测试'}
          </button>

          {detailItems.length ? (
            <button
              type="button"
              onClick={() => toggleRowExpanded(row.id)}
              className="flex-1 inline-flex min-h-9 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 active:bg-slate-100"
            >
              <Layers className="h-3.5 w-3.5 text-slate-500" />
              {isExpanded ? '收起' : '层级'}
              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => handleEditRow(row)}
            className="flex-1 inline-flex min-h-9 items-center justify-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50/60 text-xs font-semibold text-indigo-700 active:bg-indigo-100"
          >
            <Pencil className="h-3.5 w-3.5 text-indigo-600" />
            编辑
          </button>

          <button
            type="button"
            onClick={() => handleDeletePlanRow(row)}
            className="flex-1 inline-flex min-h-9 items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50/60 text-xs font-semibold text-rose-600 active:bg-rose-100"
          >
            <Trash2 className="h-3.5 w-3.5 text-rose-600" />
            删除
          </button>
        </div>

        {/* 展开的层级详情 */}
        {isExpanded && detailItems.length ? (
          <div className="mt-3.5 overflow-hidden rounded-xl border border-slate-200">
            {/* 桌面端表格 */}
            <div className="hidden sm:block">
              <div className="grid grid-cols-[0.8fr_0.8fr_0.9fr_1.3fr_0.8fr] gap-3 bg-slate-50 px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>层级</span>
                <span>参考价格</span>
                <span>金额/份额</span>
                <span>触发条件</span>
                <span>执行状态</span>
              </div>
              <div className="divide-y divide-slate-100 bg-white">
                {detailItems.map((item, index) => (
                  <div key={`${row.id}-detail-${item.id || index}`} className="grid grid-cols-[0.8fr_0.8fr_0.9fr_1.3fr_0.8fr] gap-3 px-3.5 py-2.5 text-xs text-slate-600 items-center">
                    <div className="font-bold text-slate-800">{item.label}{item.detail ? ` (${item.detail})` : ''}</div>
                    <div>{item.price || '--'}</div>
                    <div className="font-bold text-slate-900">{item.amount || '--'}</div>
                    <div className="truncate" title={item.trigger}>{item.trigger || '--'}</div>
                    <div className="font-semibold text-indigo-600">{item.status || '待执行'}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 移动端卡片堆叠（避免表格水平挤压与文字拉升） */}
            <div className="divide-y divide-slate-100 bg-white sm:hidden">
              {detailItems.map((item, index) => (
                <div key={`${row.id}-m-detail-${item.id || index}`} className="p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800">{item.label}{item.detail ? ` (${item.detail})` : ''}</span>
                    <span className="rounded bg-indigo-50 px-2 py-0.5 font-bold text-indigo-700">{item.status || '待执行'}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-500">
                    <span>金额: <strong className="text-slate-900">{item.amount || '--'}</strong></span>
                    <span>参考价: {item.price || '--'}</span>
                  </div>
                  <div className="text-slate-500 truncate pt-0.5">
                    条件: {item.trigger || '--'}
                  </div>
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

    if (filteredRows.length === 0) {
      return (
        <Card className="min-w-0 p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Search className="h-6 w-6" />
          </div>
          <div className="text-sm font-bold text-slate-800">未找到匹配的交易计划</div>
          <p className="mt-1 text-xs text-slate-500">尝试更换搜索关键词，或清空搜索条件以查看全部计划。</p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="inline-flex min-h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              清空搜索
            </button>
          </div>
        </Card>
      );
    }

    return (
      <div className="grid gap-3.5">
        {filteredRows.map((row) => renderPlanCard(row))}
      </div>
    );
  }

  if (subView === 'new') {
    return (
      <div className="space-y-3">
        <div className={cx('mx-auto max-w-7xl', embedded ? 'px-4 pt-4 sm:px-6' : 'px-6 pt-4')}>
          {renderWorkspaceReturnBar()}
        </div>
        <Suspense fallback={<SubViewLoadingFallback />}>
          <NewPlanExperienceLazy
            links={links}
            embedded
            initialPlan={editingPlan}
            mode={editingPlan?.id ? 'replace' : 'create'}
            onBack={exitNewPlanView}
          />
        </Suspense>
      </div>
    );
  }

  if (subView === 'dcaNew') {
    return (
      <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
        {renderWorkspaceReturnBar()}
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
        {renderWorkspaceReturnBar()}
        <Suspense fallback={<SubViewLoadingFallback />}>
          <SellPlanExperienceLazy
            links={links}
            embedded
            initialSell={editingSell}
            onAfterSave={() => {
              setEditingSell(null);
              gotoSubView('sell');
            }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      {renderWorkspaceReturnBar()}
      {renderPageHeader()}

      {channelConfigured ? null : (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <Bell className="h-4 w-4 text-amber-600" />
          <span>通知通道未配置 · 测试或价格触发将无法在微信/Bark收到提醒。</span>
          <a
            className="ml-auto inline-flex items-center gap-1 font-semibold text-amber-700 underline-offset-4 hover:underline"
            href={links.notify}
          >
            立即前往配置
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
