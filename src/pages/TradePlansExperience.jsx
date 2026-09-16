import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Layers,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
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
  { key: 'list', label: '全部', icon: ListChecks },
  { key: 'home', label: '加仓', icon: TrendingUp },
  { key: 'dca', label: '定投', icon: CalendarClock },
  { key: 'sell', label: '止盈', icon: TrendingDown }
];

const TYPE_META = {
  plan: { label: '加仓', tone: 'indigo' },
  dca: { label: '定投', tone: 'emerald' },
  sell: { label: '卖出', tone: 'amber' }
};

const TONE_CLASS = {
  indigo: {
    pill: 'bg-indigo-50 text-indigo-700 border border-indigo-200/70',
    icon: 'bg-indigo-100 text-indigo-600',
    bar: 'bg-indigo-600',
    cardBorder: 'hover:border-indigo-300'
  },
  emerald: {
    pill: 'bg-emerald-50 text-emerald-700 border border-emerald-200/70',
    icon: 'bg-emerald-100 text-emerald-600',
    bar: 'bg-emerald-500',
    cardBorder: 'hover:border-emerald-300'
  },
  amber: {
    pill: 'bg-amber-50 text-amber-700 border border-amber-200/70',
    icon: 'bg-amber-100 text-amber-600',
    bar: 'bg-amber-500',
    cardBorder: 'hover:border-amber-300'
  }
};

const EMPTY_STATE = {
  list: {
    icon: ListChecks,
    title: '暂无交易计划',
    description: '创建第一个计划，开始管理金字塔加仓、智能定投与分档止盈',
    cta: '新建计划',
    type: 'menu',
    tone: 'indigo',
    links: []
  },
  home: {
    icon: TrendingUp,
    title: '暂无阶梯加仓计划',
    description: '在价格下跌或跌破均线时阶梯分批买入，有效平摊持仓成本',
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
    description: '达到预期目标收益率时分档落袋，锁定投资利润',
    cta: '设置止盈规则',
    type: 'sell',
    tone: 'amber',
    links: [
      { label: '创建阶梯加仓', type: 'plan' },
      { label: '设置定投计划', type: 'dca' }
    ]
  }
};

function resolveMarketLabel(symbol = '') {
  const sym = String(symbol || '').trim().toUpperCase();
  if (/^5[0-9]{5}|^6[0-9]{5}/.test(sym)) return '沪市';
  if (/^1[0-9]{5}|^0[0-9]{5}|^3[0-9]{5}/.test(sym)) return '深市';
  if (sym.length > 0 && /^[A-Z]/.test(sym)) return '美股';
  return '标的';
}

function resolveCurrency(symbol = '') {
  const sym = String(symbol || '').trim().toUpperCase();
  if (/^[0-9]{6}/.test(sym)) return '¥';
  return '$';
}

export function TradePlansExperience({ links, inPagesDir = false, embedded = false }) {
  const [subView, setSubView] = useState(getInitialSubView);
  const [testingRowId, setTestingRowId] = useState('');
  const [channelConfigured, setChannelConfigured] = useState(true);
  const [activeChannels, setActiveChannels] = useState(() => {
    try {
      const cfg = readNotifyClientConfig();
      const list = [];
      if (cfg?.serverChan3Uid && (cfg?.serverChan3SendKey || cfg?._hasServerChan3)) list.push('微信');
      if (cfg?.barkDeviceKey) list.push('Bark');
      return list;
    } catch {
      return [];
    }
  });
  const notifyClientId = useMemo(() => readNotifyClientConfig().notifyClientId || '', []);
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

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

  const uniqueSymbols = useMemo(() => {
    return new Set(previewRows.map((r) => r.symbol).filter(Boolean)).size;
  }, [previewRows]);

  const totalLayers = useMemo(() => {
    return previewRows.reduce((acc, row) => acc + (row.detailItems?.length || 1), 0);
  }, [previewRows]);

  const nearestPricePlan = useMemo(() => previewRows.find((row) => row.sourceType === 'plan') || null, [previewRows]);
  const nextDcaPlan = useMemo(() => previewRows.find((row) => row.sourceType === 'dca') || null, [previewRows]);
  const nextSellPlan = useMemo(() => previewRows.find((row) => row.sourceType === 'sell') || null, [previewRows]);

  const activeEventText = useMemo(() => {
    if (nearestPricePlan) {
      return `${nearestPricePlan.symbol} · ${nearestPricePlan.triggerLabel}`;
    }
    if (nextDcaPlan) {
      return `${nextDcaPlan.symbol} · ${nextDcaPlan.nextExecutionLabel || nextDcaPlan.triggerLabel}`;
    }
    if (nextSellPlan) {
      return `${nextSellPlan.symbol} · ${nextSellPlan.triggerLabel}`;
    }
    return '暂无待执行事件';
  }, [nearestPricePlan, nextDcaPlan, nextSellPlan]);

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
  const [workspaceReturn, setWorkspaceReturn] = useState(() => readWorkspaceReturn('tradePlans'));
  const createMenuRef = useRef(null);

  useClickOutside(createMenuRef, () => setCreateMenuOpen(false), createMenuOpen);

  useEffect(() => {
    if (!createMenuOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape') setCreateMenuOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [createMenuOpen]);

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

  function exitDcaPlanView() {
    setEditingDca(null);
    setPlanRefreshKey((value) => value + 1);
    if (typeof window !== 'undefined' && window.location.hash === '#dca-new') {
      window.history.back();
      return;
    }
    gotoSubView('dca');
  }

  function exitSellPlanView() {
    setEditingSell(null);
    setPlanRefreshKey((value) => value + 1);
    if (typeof window !== 'undefined' && window.location.hash === '#sell-new') {
      window.history.back();
      return;
    }
    gotoSubView('sell');
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
        const clientCfg = readNotifyClientConfig();
        const barkConfigured = Boolean(status?.configured?.bark || clientCfg?.barkDeviceKey);
        const serverChan3Configured = Boolean(status?.configured?.serverChan3 || status?.setup?.serverChan3?.configured || (clientCfg?.serverChan3Uid && (clientCfg?.serverChan3SendKey || clientCfg?._hasServerChan3)));
        const pcConfigured = Boolean(status?.configured?.webWs || status?.setup?.webWsCurrentClientRegistrationCount);
        const emailConfigured = Boolean(status?.configured?.email || (status?.setup?.email?.verified && status?.setup?.email?.enabled));

        const channels = [];
        if (serverChan3Configured) channels.push('微信');
        if (barkConfigured) channels.push('Bark');
        if (emailConfigured) channels.push('邮件');
        if (pcConfigured) channels.push('网页');

        setActiveChannels(channels);
        setChannelConfigured(channels.length > 0);
      } catch {
        if (!cancelled) {
          const clientCfg = readNotifyClientConfig();
          const fallbackChannels = [];
          if (clientCfg?.serverChan3Uid) fallbackChannels.push('微信');
          if (clientCfg?.barkDeviceKey) fallbackChannels.push('Bark');
          setActiveChannels(fallbackChannels);
          setChannelConfigured(fallbackChannels.length > 0);
        }
      }
    }
    refreshChannelStatus();
    return () => {
      cancelled = true;
    };
  }, [notifyClientId]);

  async function handleSyncRefresh() {
    setIsSyncing(true);
    setPlanRefreshKey((v) => v + 1);
    setTimeout(() => {
      setIsSyncing(false);
      showActionToast('已同步最新数据', 'success');
    }, 600);
  }

  async function handleDeletePlanRow(row) {
    if (!row) return;
    const label = row.planName || row.detailTitle || '该交易计划';

    const confirmed = await confirmAction({
      title: '确认删除交易计划',
      description: `确认删除「${label}」？删除后本地计划无法恢复。`,
      confirmText: '确认删除',
      cancelText: '取消',
      tone: 'danger'
    });

    if (!confirmed) return;

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
      showActionToast('测试通知已送达', 'success', {
        description: `已成功发送「${row.planName}」的测试通知。`
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
      { label: '分档止盈卖出计划', type: 'sell', icon: TrendingDown }
    ];

    return (
      <div className="relative" ref={createMenuRef}>
        <button
          type="button"
          onClick={() => setCreateMenuOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={createMenuOpen}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-500/20 transition-all flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          新建计划
          <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', createMenuOpen ? 'rotate-180' : '')} aria-hidden="true" />
        </button>
        {createMenuOpen ? (
          <div role="menu" className="absolute right-0 top-11 z-30 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 shadow-xl shadow-slate-900/10">
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <div key={option.type}>
                  {option.separated ? <div className="my-1 h-px bg-slate-100" /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => enterCreateView(option.type)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
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

  // 顶部 4 项核心策略监控看板卡片（1:1 复刻原型设计）
  function renderMetricsOverview() {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="text-xs text-slate-500 font-bold flex justify-between">
            <span>监控标的</span>
            <span>🎯</span>
          </div>
          <div className="text-xl font-bold text-slate-950 mt-1">
            {uniqueSymbols} <span className="text-xs font-normal text-slate-400">只标的</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="text-xs text-slate-500 font-bold flex justify-between">
            <span>阶梯档位数</span>
            <span>📊</span>
          </div>
          <div className="text-xl font-bold text-emerald-600 mt-1">
            {totalLayers} <span className="text-xs font-normal text-slate-400">个档位</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="text-xs text-slate-500 font-bold flex justify-between">
            <span>待执行事件</span>
            <span>⚡</span>
          </div>
          <div className="text-xs font-bold text-amber-600 mt-1 truncate" title={activeEventText}>
            {activeEventText}
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="text-xs text-slate-500 font-bold flex justify-between">
            <span>推送通道</span>
            <span>🔔</span>
          </div>
          {activeChannels.length > 0 ? (
            <div className="text-xs font-bold text-emerald-600 mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              {activeChannels.join(' / ')}已就绪
            </div>
          ) : (
            <div className="text-xs font-bold text-slate-400 mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
              通道未配置
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderPageHeader() {
    return (
      <div className="space-y-4">
        {/* Header Title and Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              PLAN MONITOR BOARD
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-950 mt-1 flex items-center gap-2.5">
              交易计划监控看板
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700 font-bold">
                {previewRows.length} 个计划
              </span>
              <FeatureHelp topic="trade-plans" />
            </h2>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleSyncRefresh}
              disabled={isSyncing}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
            >
              <RotateCcw className={cx('w-3.5 h-3.5 text-slate-500', isSyncing ? 'animate-spin text-indigo-600' : '')} />
              {isSyncing ? '同步中...' : '同步云端'}
            </button>

            {renderCreateMenu()}
          </div>
        </div>

        {renderMetricsOverview()}

        {/* Filter Tabs & Search Bar (1:1 原型布局) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-xl overflow-x-auto no-scrollbar" role="tablist">
            {SUB_TABS.map((tab) => {
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
                  className={cx(
                    'px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0',
                    isActive ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {tab.label} ({count})
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="输入代码 / 策略名..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label="清空搜索"
              >
                <X className="w-3.5 h-3.5" />
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

  // 1:1 精准复刻原型卡片架构
  function renderPlanCard(row) {
    const isExpanded = expandedRowIds.has(row.id);
    const isTesting = testingRowId === row.id;
    const meta = TYPE_META[row.sourceType] || { label: row.cardTypeLabel || row.typeLabel, tone: row.cardTone || 'indigo' };
    const progressValue = Math.max(0, Math.min(100, Number(row.progressValue || 0) * 100));
    const detailItems = Array.isArray(row.detailItems) ? row.detailItems : [];
    const market = resolveMarketLabel(row.symbol);
    const currency = resolveCurrency(row.symbol);

    const badgeClass = row.sourceType === 'plan'
      ? 'bg-indigo-600 text-white'
      : row.sourceType === 'dca'
      ? 'bg-emerald-600 text-white'
      : 'bg-amber-600 text-white';

    const toneBg = row.sourceType === 'plan'
      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
      : row.sourceType === 'dca'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : 'bg-amber-50 border-amber-200 text-amber-700';

    return (
      <div
        key={row.id}
        className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 hover:border-indigo-300 transition-all shadow-xs space-y-3"
      >
        {/* Top: Left avatar + Info, Right explicit text buttons */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-3.5">
            {/* Square Market/Symbol Avatar */}
            <div className={cx('w-12 h-12 rounded-xl border flex flex-col items-center justify-center font-bold shrink-0', toneBg)}>
              <span className="text-[9px] uppercase font-mono leading-none">{market}</span>
              <span className="text-xs font-bold mt-0.5">{row.symbol || '--'}</span>
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-bold', badgeClass)}>
                  {row.cardTypeLabel || meta.label}
                </span>
                <h3 className="text-base font-bold text-slate-950 leading-snug break-words" title={row.planName}>
                  {row.planName}
                </h3>
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  {row.statusLabel || '🟢 监控中'}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2">
                <span className="font-bold text-slate-800">{row.symbol || '--'}</span>
                <span>·</span>
                <span>{row.progressLabel || (detailItems.length ? `${detailItems.length}档策略` : '进行中')}</span>
                <span>·</span>
                <span className="text-indigo-600 font-semibold">{row.triggerLabel}</span>
              </div>
            </div>
          </div>

          {/* Explicit Text Action Buttons (Desktop) */}
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={isTesting}
              onClick={() => handleTestNotify(row)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 text-xs font-semibold transition-all disabled:opacity-50"
            >
              {isTesting ? '发送中...' : '测试通知'}
            </button>
            <button
              type="button"
              onClick={() => handleEditRow(row)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-semibold transition-all"
            >
              编辑参数
            </button>
            <button
              type="button"
              onClick={() => handleDeletePlanRow(row)}
              className="px-3 py-1.5 rounded-lg border border-rose-100 hover:bg-rose-50 text-rose-600 text-xs font-semibold transition-all"
            >
              删除
            </button>
          </div>
        </div>

        {/* Progress Bar Container with Expand Button */}
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-3 flex-1">
            <span className="font-bold text-slate-700 shrink-0">执行进度</span>
            <div className="w-full max-w-sm h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                style={{ width: `${progressValue || 25}%` }}
              />
            </div>
            <span className="text-slate-500 shrink-0 text-xs truncate">
              {row.progressCaption || row.nextExecutionLabel || '价格满足条件后提醒'}
            </span>
          </div>

          {detailItems.length ? (
            <button
              type="button"
              onClick={() => toggleRowExpanded(row.id)}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 shrink-0 self-end sm:self-auto"
            >
              {isExpanded ? '收起阶梯明细' : `查看阶梯分档 (${detailItems.length}档)`}
              <ChevronDown className={cx('w-3.5 h-3.5 transition-transform', isExpanded ? 'rotate-180' : '')} />
            </button>
          ) : null}
        </div>

        {/* Mobile Action Bar (Direct thumb-friendly touch targets) */}
        <div className="flex sm:hidden items-center justify-end gap-1.5 pt-2 border-t border-slate-100 text-xs">
          <button
            type="button"
            disabled={isTesting}
            onClick={() => handleTestNotify(row)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-semibold active:bg-indigo-50 text-xs"
          >
            {isTesting ? '发送中' : '测试'}
          </button>
          <button
            type="button"
            onClick={() => handleEditRow(row)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-semibold active:bg-slate-100 text-xs"
          >
            编辑参数
          </button>
          <button
            type="button"
            onClick={() => handleDeletePlanRow(row)}
            className="px-2.5 py-1.5 rounded-lg border border-rose-100 bg-rose-50 text-rose-600 font-semibold active:bg-rose-100 text-xs"
          >
            删除
          </button>
        </div>

        {/* Expanded Layer Details (Desktop Table + Mobile Cards) */}
        {isExpanded && detailItems.length ? (
          <div className="mt-3 border border-slate-200 rounded-xl overflow-hidden animate-fade-in">
            {/* Desktop Table */}
            <div className="hidden sm:block">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-4">执行层级</th>
                    <th className="py-2.5 px-4">触发条件</th>
                    <th className="py-2.5 px-4">参考价格</th>
                    <th className="py-2.5 px-4">计划投入 / 回收</th>
                    <th className="py-2.5 px-4">当前状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {detailItems.map((l, index) => {
                    const isFirstPending = index === 0;
                    return (
                      <tr key={`${row.id}-detail-${l.id || index}`} className={isFirstPending ? 'bg-indigo-50/40' : 'hover:bg-slate-50'}>
                        <td className="py-2.5 px-4 font-bold text-slate-900">{l.label}{l.detail ? ` (${l.detail})` : ''}</td>
                        <td className="py-2.5 px-4 font-medium text-slate-700">{l.trigger || '--'}</td>
                        <td className="py-2.5 px-4 font-mono font-bold text-indigo-600">{l.price ? `${currency} ${l.price}` : '--'}</td>
                        <td className="py-2.5 px-4 font-semibold text-slate-900">{l.amount || '--'}</td>
                        <td className="py-2.5 px-4">
                          <span className={cx(
                            'px-2 py-0.5 rounded-full text-[11px] font-bold',
                            isFirstPending ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                          )}>
                            {isFirstPending ? '当前监控' : (l.status || '待执行')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Items */}
            <div className="divide-y divide-slate-100 bg-white sm:hidden">
              {detailItems.map((l, index) => (
                <div key={`${row.id}-m-${l.id || index}`} className="p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{l.label}{l.detail ? ` (${l.detail})` : ''}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      {index === 0 ? '当前监控' : (l.status || '待执行')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-500">
                    <span>参考价: <strong className="font-mono text-indigo-600">{l.price ? `${currency} ${l.price}` : '--'}</strong></span>
                    <span>金额: <strong className="font-mono text-slate-900">{l.amount || '--'}</strong></span>
                  </div>
                  <div className="text-slate-500 text-[11px] pt-0.5">
                    条件: {l.trigger || '--'}
                  </div>
                </div>
              ))}
            </div>
          </div>
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
        <div className="rounded-3xl border border-dashed border-indigo-200 bg-slate-50 px-6 py-12 text-center">
          <div className={cx('mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl shadow-xs', tone.icon)}>
            <Icon className="h-8 w-8" aria-hidden="true" />
          </div>
          <div className="text-lg font-bold text-slate-950">{config.title}</div>
          <p className="mx-auto mt-2 max-w-md text-xs sm:text-sm leading-relaxed text-slate-500">{config.description}</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => enterCreateView(config.type === 'menu' ? 'plan' : config.type)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-500/20 hover:bg-indigo-700 transition-all"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {config.cta}
            </button>
          </div>
          {config.links && config.links.length > 0 && (
            <div className="mt-5 text-xs text-slate-500">
              <span>或者从其他策略体系开始：</span>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                {config.links.map((link) => (
                  <button
                    key={link.type}
                    type="button"
                    onClick={() => enterCreateView(link.type)}
                    className="inline-flex min-h-8 items-center rounded-lg px-2.5 py-1 font-bold text-indigo-600 underline-offset-4 hover:bg-indigo-50 hover:underline"
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>
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
      <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 pt-4 sm:px-6' : 'px-6 pt-4')}>
        {renderWorkspaceReturnBar()}
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
      <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 pt-4 sm:px-6' : 'px-6 pt-4')}>
        {renderWorkspaceReturnBar()}
        <Suspense fallback={<SubViewLoadingFallback />}>
          <DcaExperienceLazy
            links={links}
            inPagesDir={inPagesDir}
            embedded
            initialDca={editingDca}
            mode={editingDca?.id ? 'replace' : 'create'}
            onBack={exitDcaPlanView}
            onCancel={exitDcaPlanView}
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
      <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 pt-4 sm:px-6' : 'px-6 pt-4')}>
        {renderWorkspaceReturnBar()}
        <Suspense fallback={<SubViewLoadingFallback />}>
          <SellPlanExperienceLazy
            links={links}
            embedded
            initialSell={editingSell}
            onBack={exitSellPlanView}
            onCancel={exitSellPlanView}
            onAfterSave={() => {
              setEditingSell(null);
              setPlanRefreshKey((value) => value + 1);
              gotoSubView('sell');
            }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className={cx('mx-auto max-w-7xl space-y-5', embedded ? 'px-4 sm:px-6' : 'px-6')}>
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
