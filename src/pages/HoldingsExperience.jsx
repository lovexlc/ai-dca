import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { formatCurrency } from '../app/accumulation.js';
import { getAccountAllocation, readAccountAllocationSettings, updateAccountAllocationSettings } from '../app/accountManager.js';
import { applyCashYieldToPortfolioSummary } from '../app/cashYield.js';
import { useIncomeRoute } from '../app/incomeRoute.js';
import { syncTradePlanRules } from '../app/notifySync.js';
import { HoldingsOverviewShell } from './holdings/HoldingsOverviewShell.jsx';
import { COMPACT_HOLDINGS_COLUMN_VISIBILITY, createAggregateHoldingsColumns } from './holdings/aggregateHoldingsColumns.jsx';
import { buildAggregateHoldingsTsv } from './holdings/holdingsClipboardExport.js';
import { useHoldingsStorageSync } from './holdings/useHoldingsStorageSync.js';
import { useHoldingAlerts } from './holdings/useHoldingAlerts.js';
import { AlertRuleDialog } from '../components/AlertRuleDialog.jsx';
import { WorkspaceReturnBar } from '../components/WorkspaceReturnBar.jsx';
import {
  aggregateByCode,
  buildLedgerRows,
  buildSoldLots,
  getExpectedLatestNavDate,
  getTodayShanghaiDate,
  getTransactionErrors,
  normalizeFundCode,
  normalizeFundKind,
  normalizeTransaction,
  parseExcelPaste,
  sanitizeTransactions,
  summarizePortfolio,
  summarizeSoldLots,
  summarizeTransactionErrors
} from '../app/holdingsLedgerCore.js';
import {
  buildNavMetaFromResult,
  mergeSnapshotsFromNavResult,
  persistLedgerState,
  readLedgerState,
  recognizeLedgerFile
} from '../app/holdingsLedger.js';
import { showActionToast } from '../app/toast.js';
import { cacheRealtimeSnapshotItems, getNavSnapshots, mergePricePushItems } from '../app/navService.js';
import { cacheRealtimeDirectQuotes } from '../app/directMarketData.js';
import { useHoldingsQuickTransaction } from './holdings/useHoldingsQuickTransaction.js';
import { useCashYieldLookup } from './holdings/useCashYieldLookup.js';
import {
  KIND_FILTER_KEYS,
  KIND_FILTER_LABELS,
  createOcrState,
  emptyDraft,
  formatNav,
  formatShares,
  nowIso,
  sanitizeCodeInput,
  sanitizeDecimalInput,
  transactionToDraft
} from '../app/holdingsHelpers.js';
import { readTradeLedger } from '../app/tradeLedger.js';
import { groupCostBasisBySymbol } from '../app/costTracker.js';
import { hasPotentialUserData, installDemoData } from '../app/demoData.js';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';
import { triggerConversionPrompt } from '../app/conversionPrompts.js';
import { getCodeFromUrl, updateCodeInUrl } from './holdings/holdingsUrlSync.js';
import { clearAllLocalDataAsync, getDataStats, getClearDataConfirmMessage } from '../app/clearAllData.js';
import { clearMarketActionDraft, readMarketActionDraft } from '../app/marketActionDraft.js';
import { buildAggregatesTableData } from './holdings/buildAggregatesTableData.js';
import { getAutoNavRefreshCodes, getManualNavRefreshCodes } from './holdings/holdingsNavRefreshPolicy.js';
import { useTodaySignals } from './holdings/useTodaySignals.js';
import { readColumnFilterValue } from './holdings/tableFilters.js';
import { computeOtcAutoFillContext, prepareTransactionDraftForSubmit, updateTransactionDraftField } from './holdings/transactionDraftState.js';

function buildCodeKindMap(codes, transactions) {
  const map = {};
  if (!Array.isArray(codes) || !codes.length) return map;
  for (const code of codes) {
    if (!code) continue;
    const normalized = normalizeFundCode(code);
    // 以该代码最新一笔有效交易的 kind 为准；没有交易时让后端按代码前缀推断。
    const latestTx = transactions
      .filter((tx) => normalizeFundCode(tx.code) === normalized && tx.kind)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    if (latestTx?.kind) {
      map[normalized] = latestTx.kind;
    }
  }
  return map;
}

export function HoldingsExperience({ links = {}, inPagesDir = false, embedded = false } = {}) {
  const { recordTransaction } = useHoldingsQuickTransaction();
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const { holdingAlerts, alertDialogOpen, selectedHolding, handleOpenAlertDialog, handleSaveAlert, handleCloseAlertDialog } = useHoldingAlerts(() => setSidePanelOpen(false));
  const totalAlertCount = holdingAlerts.length;
  const isFirstAlert = totalAlertCount === 0;
  const [ledger, setLedger] = useState(() => readLedgerState());
  // v7.6: 移除交易日自动过滤场内数据的逻辑，避免出现不必要的"重置过滤"按钮
  const [columnFilters, setColumnFilters] = useState([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [sidePanelTab, setSidePanelTab] = useState('summary');
  const [draft, setDraft] = useState(() => emptyDraft());
  const [draftMode, setDraftMode] = useState('create');
  const [navStatus, setNavStatus] = useState('idle');
  const [ocrState, setOcrState] = useState(() => createOcrState());
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const pendingCodeHandledRef = useRef('');
  const summarizeHoldings = () => ({
    transactionCount: Array.isArray(transactions) ? transactions.length : 0,
    aggregateCount: Array.isArray(aggregates) ? aggregates.length : 0,
    activePositionCount: Array.isArray(aggregatesTableData) ? aggregatesTableData.length : 0,
    soldLotCount: Array.isArray(soldLots) ? soldLots.length : 0,
    hasSearch: Boolean(String(readColumnFilterValue(columnFilters, 'name') || '').trim()),
    kindFilter: (() => {
      const value = readColumnFilterValue(columnFilters, 'kind');
      return Array.isArray(value) && value.length ? value.join(',') : 'all';
    })(),
    selected: Boolean(selectedCode),
    embedded
  });
  // v7.6: 移除交易日自动应用场内过滤的 useEffect
  useEffect(() => {
    function onMobileNew() {
      // 4.2: 已卖出 tab 已移除 (迁移到 #/liquidation)，默认留 BUY
      resetDraft(emptyDraft({ type: 'BUY' }));
      setSidePanelTab('create');
      setSidePanelOpen(true);
      trackFeatureEvent('holdings', 'quick_new_open', { source: 'mobile_event' });
    }
    function onMobilePaste() { openPasteModal('mobile_event'); }
    function onMobileOcr() { openOcrModal('mobile_event'); }
    function onSelectFund(event) {
      const code = event && event.detail && event.detail.code;
      if (!code) return;
      setSelectedCode(code);
      setSidePanelTab('summary');
      setSidePanelOpen(true);
      trackFeatureEvent('holdings', 'fund_summary_open', { source: 'mobile_event', codeLength: String(code).length });
    }
    window.addEventListener('holdings:new', onMobileNew);
    window.addEventListener('holdings:import-paste', onMobilePaste);
    window.addEventListener('holdings:import-ocr', onMobileOcr);
    window.addEventListener('holdings:select-fund', onSelectFund);
    return () => {
      window.removeEventListener('holdings:new', onMobileNew);
      window.removeEventListener('holdings:import-paste', onMobilePaste);
      window.removeEventListener('holdings:import-ocr', onMobileOcr);
      window.removeEventListener('holdings:select-fund', onSelectFund);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 从 URL 读取 code 参数并打开持仓详情
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const code = getCodeFromUrl();
    if (!code || pendingCodeHandledRef.current === code) return;
    pendingCodeHandledRef.current = code;
    setSelectedCode(code);
    setSidePanelTab('summary');
    setSidePanelOpen(true);
    trackFeatureEvent('holdings', 'fund_summary_open', { source: 'url_param', codeLength: String(code).length });
  }, []);
  useEffect(() => {
    const actionDraft = readMarketActionDraft();
    if (!actionDraft || actionDraft.action !== 'holding-buy') return;
    clearMarketActionDraft();
    const code = normalizeFundCode(actionDraft.symbol);
    if (!code) return;
    const kind = normalizeFundKind(actionDraft.kind, code, actionDraft.name);
    resetDraft(emptyDraft({
      type: 'BUY',
      code,
      name: actionDraft.name,
      kind,
      date: getTodayShanghaiDate(),
      price: kind === 'exchange' && actionDraft.price > 0 ? String(actionDraft.price) : '',
      before3pm: kind === 'exchange' ? false : true,
    }));
    setSelectedCode(code);
    setSidePanelTab('create');
    setSidePanelOpen(true);
    showActionToast('已带入行情标的', 'success', {
      description: `${code}${actionDraft.name ? ` · ${actionDraft.name}` : ''}`,
    });
    trackFeatureEvent('holdings', 'prefill_from_markets', {
      action: actionDraft.action,
      kind,
      codeLength: code.length,
      hasPrice: actionDraft.price > 0,
    });
  }, []);
  // 选中基金时更新 URL
  useEffect(() => { updateCodeInUrl(selectedCode); }, [selectedCode]);
  const [pasteResult, setPasteResult] = useState(null);
  const [ocrModalOpen, setOcrModalOpen] = useState(false);
  const [ocrPreview, setOcrPreview] = useState(null);
  const [ocrWarningsExpanded, setOcrWarningsExpanded] = useState(false);
  const [ocrPreviewIndex, setOcrPreviewIndex] = useState(0);
  const [pastePreviewIndex, setPastePreviewIndex] = useState(0);
  useEffect(() => {
    const total = ocrPreview && Array.isArray(ocrPreview.rows) ? ocrPreview.rows.length : 0;
    setOcrPreviewIndex((prev) => {
      if (total <= 0) return 0;
      if (prev >= total) return total - 1;
      if (prev < 0) return 0;
      return prev;
    });
  }, [ocrPreview]);
  useEffect(() => {
    const total = pasteResult && Array.isArray(pasteResult.rows) ? pasteResult.rows.length : 0;
    setPastePreviewIndex((prev) => {
      if (total <= 0) return 0;
      if (prev >= total) return total - 1;
      if (prev < 0) return 0;
      return prev;
    });
  }, [pasteResult]);
  const [switchPickerOpen, setSwitchPickerOpen] = useState(false);
  const [switchPickerSearch, setSwitchPickerSearch] = useState('');
  const [switchPickerSelectedIds, setSwitchPickerSelectedIds] = useState(() => new Set());
  const fileInputRef = useRef(null);
  const autoNavTriggeredRef = useRef(false);
  const navAttemptedCodesRef = useRef(new Set());
  useEffect(() => {
    persistLedgerState(ledger);
  }, [ledger]);
  const [tradeLedgerEntries, setTradeLedgerEntries] = useState(() => readTradeLedger());
  const [accountSettings, setAccountSettings] = useState(() => readAccountAllocationSettings());
  const accountSettingsSyncTimerRef = useRef(null);
  useHoldingsStorageSync({ setLedger, setAccountSettings, setTradeLedgerEntries });
  const transactions = ledger.transactions;
  const inceptionDate = useMemo(() => {
    if (!Array.isArray(transactions) || transactions.length === 0) return null;
    let earliest = null;
    for (const tx of transactions) {
      if (tx?.type !== 'BUY' || !tx.date) continue;
      if (!earliest || tx.date < earliest) earliest = tx.date;
    }
    return earliest;
  }, [transactions]);
  const { route: incomeRoute } = useIncomeRoute();
  // 交易记录独立子页化后，主页只保留基金汇总表格；编辑入口由 IncomeSection 传入 onEditTransaction。
  const snapshotsByCode = ledger.snapshotsByCode;
  const ledgerRows = useMemo(
    () => buildLedgerRows(transactions, snapshotsByCode),
    [transactions, snapshotsByCode]
  );
  const aggregates = useMemo(
    () => aggregateByCode(transactions, snapshotsByCode),
    [transactions, snapshotsByCode]
  );
  const aggregateByCodeMap = useMemo(() => {
    const map = new Map();
    for (const agg of aggregates) map.set(agg.code, agg);
    return map;
  }, [aggregates]);
  const soldLots = useMemo(() => buildSoldLots(transactions), [transactions]);
  const soldSummary = useMemo(() => summarizeSoldLots(soldLots), [soldLots]);
  // portfolio 要拿 soldSummary 拼接「累计收益」（持仓未实现 + 已卖出累计已实现），
  // 因此放在 soldSummary 之后计算。
  const basePortfolio = useMemo(
    () => summarizePortfolio(aggregates, soldSummary),
    [aggregates, soldSummary]
  );
  const costBasisBySymbol = useMemo(
    () => groupCostBasisBySymbol(tradeLedgerEntries),
    [tradeLedgerEntries],
  );
  const aggregatesTableData = useMemo(
    () => buildAggregatesTableData({ aggregates, costBasisBySymbol }),
    [aggregates, costBasisBySymbol],
  );
  const todaySignals = useTodaySignals({ links, aggregatesTableData, setSelectedCode, setSidePanelTab, setSidePanelOpen });
  const numericSortFn = (rowA, rowB, columnId) => {
    const a = rowA.getValue(columnId);
    const b = rowB.getValue(columnId);
    const aN = a == null || Number.isNaN(a);
    const bN = b == null || Number.isNaN(b);
    if (aN && bN) return 0;
    if (aN) return 1;
    if (bN) return -1;
    return a - b;
  };
  const kindFilterOptions = useMemo(
    () => KIND_FILTER_KEYS.filter((k) => k !== 'all').map((k) => ({
      value: k,
      label: KIND_FILTER_LABELS[k],
    })),
    [],
  );
  const cashYieldLookup = useCashYieldLookup(accountSettings, setAccountSettings);
  const accountAllocation = useMemo(
    () => getAccountAllocation(basePortfolio, { ...accountSettings, cashYieldLookupStatus: cashYieldLookup.status }),
    [accountSettings, cashYieldLookup.status, basePortfolio],
  );
  const portfolio = useMemo(
    () => applyCashYieldToPortfolioSummary(basePortfolio, accountAllocation, inceptionDate, getTodayShanghaiDate()),
    [accountAllocation, basePortfolio, inceptionDate]
  );
  function handleAccountSettingsChange(updates) {
    const next = updateAccountAllocationSettings(updates, accountSettings);
    setAccountSettings(next);
    if (typeof window !== 'undefined') {
      window.clearTimeout(accountSettingsSyncTimerRef.current);
      accountSettingsSyncTimerRef.current = window.setTimeout(() => syncTradePlanRules().catch(() => {}), 600);
    }
    trackFeatureEvent('holdings', 'account_allocation_settings_update', {
      changedKeys: Object.keys(updates || {}).join(','),
      targetInvestmentPct: next.targetInvestmentPct,
      targetCashPct: next.targetCashPct,
      rebalanceThresholdPct: next.rebalanceThresholdPct,
      notifyEnabled: next.notifyEnabled,
      ...summarizeHoldings()
    });
  }
  function handleInstallDemoData() {
    if (typeof window !== 'undefined' && hasPotentialUserData() && !window.confirm('检测到已有本地数据。生成演示数据会覆盖当前持仓、计划和定投数据。建议先登录账号完成云同步。确认继续？')) return;
    installDemoData();
    setLedger(readLedgerState());
    setAccountSettings(readAccountAllocationSettings());
    setTradeLedgerEntries(readTradeLedger());
    showActionToast('生成 Demo 数据', 'success', {
      description: '已生成纳指 ETF 模拟持仓，买入价锚定 2026-03-01。'
    });
    trackFeatureEvent('holdings', 'demo_install', { hadExistingData: hasPotentialUserData() });
  }
  async function handleClearAllData() {
    if (typeof window === 'undefined' || !window.localStorage) {
      showActionToast('清除数据失败', 'error', { description: '无法访问本地存储。' });
      return;
    }
    const stats = getDataStats({ transactions, aggregates, tradeLedgerEntries });
    if (!window.confirm(getClearDataConfirmMessage(stats))) {
      trackFeatureEvent('holdings', 'clear_all_data_cancel', stats);
      return;
    }
    const startedAt = Date.now();
    try {
      await clearAllLocalDataAsync();
      setLedger(readLedgerState());
      setAccountSettings(readAccountAllocationSettings());
      setTradeLedgerEntries(readTradeLedger());
      setSelectedCode('');
      setSidePanelOpen(false);
      showActionToast('已清除所有数据', 'success', { description: '所有持仓、交易、计划数据已清空。' });
      trackActionResult('holdings', 'clear_all_data', 'success', { ...stats, durationMs: Date.now() - startedAt });
    } catch (error) {
      showActionToast('清除数据失败', 'error', { description: error?.message || '清除过程中出现错误。' });
      trackActionResult('holdings', 'clear_all_data', 'error', { ...stats, durationMs: Date.now() - startedAt, errorMessage: error?.message || '' });
    }
  }
  const aggregateColumns = useMemo(() => createAggregateHoldingsColumns({
    kindFilterOptions,
    numericSortFn,
    onNavigateToMarkets: navigateToMarkets,
  }), [kindFilterOptions, links.markets]);
  // v7.6: 简化过滤逻辑，移除交易日强制场内过滤
  const aggregatesTable = useReactTable({
    data: aggregatesTableData,
    columns: aggregateColumns,
    state: {
      columnFilters,
    },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      sorting: [{ id: 'marketValue', desc: true }],
      pagination: { pageSize: 50 },
      columnVisibility: COMPACT_HOLDINGS_COLUMN_VISIBILITY,
    },
    autoResetAll: false,
    autoResetPageIndex: false,
  });
  const selectedAggregate = selectedCode ? aggregateByCodeMap.get(selectedCode) : null;
  const needsDateBackfill = useMemo(
    () => transactions.some((tx) => !tx.date),
    [transactions]
  );
  const migrationNoticeVisible = Boolean(ledger.migratedFromLegacy) && needsDateBackfill;
  useEffect(() => {
    // 进入页面时只自动刷新当前仍需要展示实时净值的活跃持仓。
    // autoNavTriggeredRef 保证整个 mount 周期内只跑一次；手动刷新走 handleManualRefresh，独立于此。
    if (autoNavTriggeredRef.current) return;
    const codes = getAutoNavRefreshCodes(transactions);
    if (!codes.length) return;
    autoNavTriggeredRef.current = true;
    for (const code of codes) navAttemptedCodesRef.current.add(code);
    void refreshNavForCodes(codes, { silent: true, fundKinds: buildCodeKindMap(codes, transactions) });
  }, [transactions]);
  useEffect(() => {
    const codes = getAutoNavRefreshCodes(transactions);
    if (!codes.length) return;
    if (typeof window !== 'undefined' && typeof window.__aiDcaSubscribeMarketData === 'function') {
      window.__aiDcaSubscribeMarketData(codes, { scope: 'holdings' });
      trackFeatureEvent('holdings', 'market_subscribe', {
        symbolCount: codes.length,
        source: 'holdings'
      });
    }
  }, [transactions]);
  // ---- WS 行情推送：接收实时价格更新 ----
  useEffect(() => {
    function handlePricePush(event) {
      const items = event?.detail?.items;
      if (!Array.isArray(items) || !items.length) return;
      trackFeatureEvent('holdings', 'price_push_receive', {
        itemCount: items.length,
        subscribedPositionCount: aggregatesTableData.length
      });
      setLedger((prev) => {
        const existingItems = Object.entries(prev.snapshotsByCode || {}).map(([code, snap]) => ({ code, ...snap }));
        const merged = mergePricePushItems(existingItems, items);
        if (merged === existingItems) return prev;
        cacheRealtimeSnapshotItems(merged);
        cacheRealtimeDirectQuotes(merged);
        const nextSnapshotsByCode = { ...(prev.snapshotsByCode || {}) };
        for (const item of merged) {
          const code = String(item?.code || '').trim();
          if (code) nextSnapshotsByCode[code] = item;
        }
        return { ...prev, snapshotsByCode: nextSnapshotsByCode };
      });
    }
    window.addEventListener('ai-dca-price-push', handlePricePush);
    return () => window.removeEventListener('ai-dca-price-push', handlePricePush);
  }, []);
  async function refreshNavForCodes(codes, { silent = false, forceRefresh = false, fundKinds = null } = {}) {
    const safeCodes = (Array.isArray(codes) ? codes : []).filter(Boolean);
    if (!safeCodes.length) {
      if (!silent) showActionToast('净值刷新', 'warning', { description: '当前没有可刷新的基金代码。' });
      return;
    }
    setNavStatus('loading');
    const startedAt = Date.now();
    trackFeatureEvent('holdings', 'nav_refresh_start', {
      codeCount: safeCodes.length,
      silent,
      forceRefresh,
      ...summarizeHoldings()
    });
    try {
      const navResult = await getNavSnapshots(safeCodes, { forceRefresh, fundKinds });
      let mergeErrors = [];
      let nextMeta = null;
      // 用函数式 setState 基于最新 prev 合并，避免并发刷新互相覆盖。
      setLedger((prev) => {
        const merged = mergeSnapshotsFromNavResult(prev.snapshotsByCode, navResult);
        mergeErrors = merged.errors;
        nextMeta = buildNavMetaFromResult(navResult, merged.errors);
        return {
          ...prev,
          snapshotsByCode: merged.snapshotsByCode,
          lastNavMeta: nextMeta
        };
      });
      const errors = mergeErrors;
      if (!nextMeta) nextMeta = buildNavMetaFromResult(navResult, errors);
      // 失败的代码允许下一次重新尝试（拉黑只针对成功的）。
      const failedSet = new Set(errors.map((e) => e.code));
      for (const code of safeCodes) {
        if (failedSet.has(code)) navAttemptedCodesRef.current.delete(code);
      }
      setNavStatus('idle');
      if (!silent) {
        if (errors.length && nextMeta.successCount === 0) {
          showActionToast('净值刷新', 'error', { description: errors[0]?.message || '全部代码均未能获取净值。' });
        } else if (errors.length) {
          showActionToast('净值刷新', 'warning', { description: `${nextMeta.successCount} 条成功 / ${errors.length} 条失败` });
        } else {
          showActionToast('净值刷新', 'success', { description: `成功更新 ${nextMeta.successCount} 个基金净值。` });
        }
      }
      trackActionResult('holdings', 'nav_refresh', errors.length && nextMeta.successCount === 0 ? 'error' : errors.length ? 'partial' : 'success', {
        codeCount: safeCodes.length,
        successCount: nextMeta?.successCount || 0,
        failureCount: errors.length,
        silent,
        forceRefresh,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      setNavStatus('error');
      // 网络异常允许下次重试。
      for (const code of safeCodes) navAttemptedCodesRef.current.delete(code);
      if (!silent) {
        showActionToast('净值刷新', 'error', { description: error?.message || '净值服务暂时不可用。' });
      }
      trackActionResult('holdings', 'nav_refresh', 'error', {
        codeCount: safeCodes.length,
        silent,
        forceRefresh,
        durationMs: Date.now() - startedAt,
        errorMessage: error?.message || ''
      });
    }
  }
  function handleManualRefresh() {
    // 手动刷新：所有交易代码 + 切换链路里出现过的代码，保证已卖出/清仓记录也能同步确认 NAV。
    const codes = getManualNavRefreshCodes(transactions);
    // 批次成本法改造后，前端数据全部本地存储，服务端不会自动推送新口径。
    // 这里先在本地静默重算一遍派生字段（avgCost / totalCost / 未实现收益等），
    // 让用户即便没拉到新净值也能立刻看到新口径下的均价。再异步刷新最新净值。
    setLedger((prev) => {
      const prevTxs = Array.isArray(prev.transactions) ? prev.transactions : [];
      // sanitizeTransactions 会重新跑一遍 normalizeTransaction：触发 useMemo
      // 重新执行 aggregateByCode，以最新的摊薄成本法重算 avgCost / totalCost。
      const nextTxs = sanitizeTransactions(prevTxs, { filterInvalid: false });
      return { ...prev, transactions: nextTxs };
    });
    // 手动刷新清空已尝试集合，所有代码都重新走一遍。
    navAttemptedCodesRef.current.clear();
    trackFeatureEvent('holdings', 'manual_refresh_click', { codeCount: codes.length, ...summarizeHoldings() });
    void refreshNavForCodes(codes, { silent: false, forceRefresh: true, fundKinds: buildCodeKindMap(codes, transactions) });
  }
  function resetDraft(nextDraft = emptyDraft()) {
    setDraft(nextDraft);
    setDraftMode('create');
  }
  // 扫描所有「价格为空 / 0」的场外/QDII 交易，如果快照中能找到与 tx.date 匹配的
  // latestNavDate 或 previousNavDate，则自动回填净值。场内不走净值路径、跳过。
  // 由「点击基金汇总 / 已卖出 tab」等 useEffect 触发。
  function autoFillTransactionPricesFromSnapshots() {
    const snapMap = snapshotsByCode || {};
    setLedger((prev) => {
      const list = Array.isArray(prev.transactions) ? prev.transactions : [];
      let changed = false;
      const nextList = list.map((tx) => {
        const existingPrice = Number.isFinite(Number(tx?.price)) ? Number(tx.price) : 0;
        const kind = String(tx?.kind || '').toLowerCase();
        if (kind === 'exchange') return tx;
        const code = normalizeFundCode(tx?.code || '');
        if (!code) return tx;
        const txDate = String(tx?.date || '');
        if (!txDate) return tx;
        let resolved = existingPrice;
        if (resolved === 0) {
          const snap = snapMap[code];
          if (!snap) return tx;
          if (String(snap.latestNavDate || '') === txDate && Number(snap.latestNav) > 0) {
            resolved = Number(snap.latestNav);
          } else if (String(snap.previousNavDate || '') === txDate && Number(snap.previousNav) > 0) {
            resolved = Number(snap.previousNav);
          }
        }
        if (resolved === 0) return tx;
        const amount = Number(tx?.amount) || 0;
        const shares = Number(tx?.shares) || 0;
        const nextShares = tx?.type === 'BUY' && amount > 0 && resolved > 0 && !(shares > 0)
          ? Number((amount / resolved).toFixed(4))
          : shares;
        const nextPrice = Number(resolved.toFixed(4));
        if (nextPrice === existingPrice && nextShares === shares) return tx;
        changed = true;
        return { ...tx, price: nextPrice, shares: nextShares };
      });
      if (!changed) return prev;
      return { ...prev, transactions: nextList };
    });
  }
  // 净值快照更新后，立即扫描交易记录，把价格为空 / 0 且日期匹配的场外/QDII 买卖单回填确认 NAV。
  // 这样已卖出/清仓记录不需要用户再打开某个弹窗，也能在刷新净值后自动修正收益。
  useEffect(() => {
    autoFillTransactionPricesFromSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotsByCode]);
  // 从「该基金汇总」弹窗点击 买入 / 卖出：预填代码/名称/标签。
  // 场外/QDII 默认「三点前」= true；场内不展示三点前选项，日期默认今天、成交价留空手填。
  function openBuyOrSellFromSummary(aggSrc, type) {
    if (!aggSrc) return;
    const kind = aggSrc.kind || 'otc';
    const code = normalizeFundCode(aggSrc.code || '');
    const ctx = computeOtcAutoFillContext({ kind, before3pm: true });
    const next = emptyDraft({
      code,
      name: aggSrc.name || '',
      kind,
      type,
      before3pm: kind === 'exchange' ? false : true,
      date: ctx.confirmDate || getTodayShanghaiDate(),
      price: ''
    });
    resetDraft(next);
    setSidePanelTab('create');
    setSidePanelOpen(true);
    trackFeatureEvent('holdings', 'trade_from_summary_open', {
      type,
      kind,
      codeLength: code.length,
      hasPosition: Boolean(aggSrc.hasPosition)
    });
  }
  function handleDraftChange(field, value) {
    setDraft((prev) => updateTransactionDraftField(prev, field, value, { aggregateByCodeMap }));
  }
  function submitDraft() {
    const prepared = prepareTransactionDraftForSubmit(draft);
    const errors = getTransactionErrors(prepared);
    if (Object.keys(errors).length) {
      showActionToast('保存失败', 'error', { description: summarizeTransactionErrors(errors) });
      trackActionResult('holdings', 'transaction_save', 'validation_error', {
        mode: draftMode,
        errorFields: Object.keys(errors),
        type: prepared.type,
        kind: prepared.kind,
        hasSwitchAllocations: Array.isArray(draft.switchAllocations) && draft.switchAllocations.length > 0
      });
      return;
    }
    const normalized = normalizeTransaction({
      ...prepared,
      id: draftMode === 'edit' && draft.id ? draft.id : undefined
    });
    // SELL 如果本地已有持仓，就必须校验可卖份额；costPrice 只作为清仓成本覆盖，不再让基金汇总跳过扣减。
    if (normalized.type === 'SELL') {
      const targetAgg = aggregateByCodeMap.get(normalized.code);
      let available = targetAgg ? targetAgg.totalShares : 0;
      if (draftMode === 'edit' && draft.id) {
        const existing = transactions.find((tx) => tx.id === draft.id);
        if (existing && existing.code === normalized.code) {
          if (existing.type === 'SELL') available += existing.shares;
          else if (existing.type === 'BUY') available -= existing.shares;
        }
      }
      const allowStandaloneCostPrice = normalized.costPrice > 0 && available <= 1e-6;
      if (!allowStandaloneCostPrice && normalized.shares > available + 1e-6) {
        showActionToast('保存失败', 'error', {
          description: `SELL 份额 ${formatShares(normalized.shares)} 超过当前持仓 ${formatShares(Math.max(available, 0))}。`
        });
        trackActionResult('holdings', 'transaction_save', 'validation_error', {
          mode: draftMode,
          type: normalized.type,
          kind: normalized.kind,
          reason: 'sell_exceeds_available'
        });
        return;
      }
    }
    setLedger((prev) => {
      const list = Array.isArray(prev.transactions) ? prev.transactions : [];
      const previousTx = draftMode === 'edit' && draft.id ? list.find((tx) => tx.id === draft.id) : null;
      const previousPairId = previousTx?.switchPairId || '';
      const newPairId = normalized.switchPairId || '';
      const remapSingle = (tx) => {
        if (previousPairId && previousPairId !== newPairId && tx.id === previousPairId && tx.switchPairId === normalized.id) {
          return { ...tx, switchPairId: '' };
        }
        return tx;
      };
      if (draftMode === 'edit') {
        return {
          ...prev,
          transactions: list.map((tx) => (tx.id === normalized.id ? normalized : remapSingle(tx)))
        };
      }
      return { ...prev, transactions: [...list.map(remapSingle), normalized] };
    });
    showActionToast(draftMode === 'edit' ? '交易已更新' : '交易已新增', 'success', {
      description: normalized.shares > 0
        ? `${normalized.code} ${normalized.type} ${formatShares(normalized.shares)} 份 @ ${formatNav(normalized.price)}`
        : `${normalized.code} ${normalized.type} ${formatCurrency(normalized.amount, '¥', 2)}`
    });
    recordTransaction(normalized, draftMode);
    resetDraft();
    setSelectedCode(normalized.code);
    setSidePanelTab('summary');
    setSidePanelOpen(false);
    trackActionResult('holdings', 'transaction_save', 'success', {
      mode: draftMode,
      type: normalized.type,
      kind: normalized.kind,
      codeLength: normalized.code.length,
      hasCostPrice: normalized.costPrice > 0,
      hasSwitchPair: Boolean(normalized.switchPairId)
    });
    triggerConversionPrompt('holdings_transaction_save', {
      mode: draftMode,
      type: normalized.type,
      kind: normalized.kind,
      codeLength: normalized.code.length
    });
  }
  function handleDeleteTransaction(txId) {
    if (!txId) return false;
    const tx = transactions.find((item) => item.id === txId);
    if (!tx) return false;
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && !window.confirm(`确认删除 ${tx.code} ${tx.type} ${formatShares(tx.shares)} 份？`)) {
      return false;
    }
    setLedger((prev) => ({
      ...prev,
      transactions: (prev.transactions || [])
        .filter((item) => item.id !== txId)
        .map((item) => (item.switchPairId === txId ? { ...item, switchPairId: '' } : item))
    }));
    showActionToast('交易已删除', 'success');
    trackActionResult('holdings', 'transaction_delete', 'success', {
      type: tx.type,
      kind: tx.kind,
      codeLength: String(tx.code || '').length,
      hadSwitchPair: Boolean(tx.switchPairId)
    });
    return true;
  }
  // 第五刀 v6: 供 IncomeTransactionsPage 子页调用 — 点击明细行后用 sidePanel 编辑该 tx。
  // sidePanel 是 fixed overlay，不需 navigate 回主页即可覆盖在 #/transactions 上方。
  function handleEditTransaction(txId) {
    if (!txId) return;
    const list = (ledger?.transactions || []);
    const tx = list.find((t) => t && t.id === txId);
    if (!tx) return;
    setDraft(transactionToDraft(tx));
    setDraftMode('edit');
    setSidePanelTab('create');
    setSidePanelOpen(true);
    trackFeatureEvent('holdings', 'transaction_edit_open', {
      type: tx.type,
      kind: tx.kind,
      codeLength: String(tx.code || '').length,
      source: 'side_panel'
    });
  }
  // ---- Copy visible table to clipboard ----
  async function writeClipboard(text) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to legacy fallback
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
  function buildAggregateTsv() {
    const visibleAggregates = aggregatesTable.getFilteredRowModel().rows.map((row) => row.original);
    return buildAggregateHoldingsTsv({ aggregates: visibleAggregates, kindFilter: 'all', searchText: '' });
  }
  async function handleCopyVisibleTable() {
    const payload = buildAggregateTsv();
    const label = '基金汇总';
    if (payload.count === 0) {
      showActionToast('复制表格', 'warning', { description: '当前没有可复制的行。' });
      trackActionResult('holdings', 'copy_table', 'empty', { ...summarizeHoldings() });
      return;
    }
    const ok = await writeClipboard(payload.tsv);
    if (ok) {
      showActionToast('已复制', 'success', { description: `${label} ${payload.count} 行已复制为 TSV。` });
    } else {
      showActionToast('复制失败', 'error', { description: '浏览器拒绝写入剪贴板，请手动复制。' });
    }
    trackActionResult('holdings', 'copy_table', ok ? 'success' : 'error', {
      rowCount: payload.count,
      ...summarizeHoldings()
    });
  }
  // ---- OCR import ----
  function handleTriggerOcr() {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
    trackFeatureEvent('holdings', 'ocr_file_picker_open');
  }
  async function handleOcrFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const startedAt = Date.now();
    trackFeatureEvent('holdings', 'ocr_file_selected', {
      fileType: String(file.type || '').slice(0, 80),
      fileSizeBucket: file.size > 2_000_000 ? 'gt_2m' : file.size > 500_000 ? '500k_2m' : 'lte_500k'
    });
    // 「截图 OCR」现改为弹窗内预览流程：识别后仅填充预览表格，用户确认后才会写入 ledger。
    if (!ocrModalOpen) setOcrModalOpen(true);
    setOcrPreview(null);
    setOcrState(createOcrState({ status: 'loading', progress: 10, message: '正在识别持仓截图...' }));
    try {
      const result = await recognizeLedgerFile(file, (progress) => {
        setOcrState((prev) => ({
          ...prev,
          status: 'loading',
          progress: Number(progress?.progress) || prev.progress,
          message: progress?.message || prev.message
        }));
      });
      const drafts = Array.isArray(result.draftTransactions) ? result.draftTransactions : [];
      // 以「预览行」的形式装入 modal（与 parseExcelPaste 一致），让 UI 可重用预览表格。
      const previewRows = drafts.map((draft, index) => ({
        index,
        draft,
        errors: getTransactionErrors(draft)
      }));
      if (!drafts.length) {
        setOcrState(createOcrState({
          status: 'error',
          error: '未能识别出有效的持仓记录，请重试或手动录入。'
        }));
        setOcrPreview({
          rows: [],
          fileName: file?.name || '',
          recordCount: 0,
          warnings: result.warnings || [],
          provider: result.provider || '',
          model: result.model || ''
        });
        showActionToast('OCR 导入', 'error', { description: '未能识别出有效的持仓记录。' });
        trackActionResult('holdings', 'ocr_recognize', 'empty', {
          durationMs: Date.now() - startedAt,
          warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
          provider: result.provider || '',
          model: result.model || ''
        });
        return;
      }
      setOcrPreview({
        rows: previewRows,
        fileName: file?.name || '',
        recordCount: drafts.length,
        warnings: result.warnings || [],
        provider: result.provider || '',
        model: result.model || ''
      });
      const validCount = previewRows.filter((row) => Object.keys(row.errors).length === 0).length;
      setOcrState(createOcrState({
        status: 'success',
        progress: 100,
        message: `识别出 ${drafts.length} 行，其中有效 ${validCount} 行，请在弹窗内确认后导入。`,
        recordCount: drafts.length
      }));
      showActionToast('OCR 识别', 'success', {
        description: `识别出 ${drafts.length} 行，有效 ${validCount} 行，请在弹窗内确认后导入。`
      });
      trackActionResult('holdings', 'ocr_recognize', 'success', {
        durationMs: Date.now() - startedAt,
        rowCount: drafts.length,
        validCount,
        warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
        provider: result.provider || '',
        model: result.model || ''
      });
    } catch (error) {
      setOcrState(createOcrState({
        status: 'error',
        error: error?.message || '识别失败，请稍后重试。'
      }));
      showActionToast('OCR 导入', 'error', { description: error?.message || '识别失败。' });
      trackActionResult('holdings', 'ocr_recognize', 'error', {
        durationMs: Date.now() - startedAt,
        errorMessage: error?.message || ''
      });
    } finally {
      // 允许同一个文件被重复选择，在弹窗内重新上传。
      if (event?.target) event.target.value = '';
    }
  }
  // ---- Excel paste import ----
  function openPasteModal(source = 'toolbar') {
    setPasteModalOpen(true);
    setPasteText('');
    setPasteResult(null);
    trackFeatureEvent('holdings', 'paste_modal_open', { source });
  }
  function closePasteModal() {
    setPasteModalOpen(false);
  }
  // ---- OCR import modal controls ----
  function openOcrModal(source = 'toolbar') {
    setOcrModalOpen(true);
    setOcrPreview(null);
    setOcrState(createOcrState());
    setOcrWarningsExpanded(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    trackFeatureEvent('holdings', 'ocr_modal_open', { source });
  }
  function closeOcrModal() {
    setOcrModalOpen(false);
    setOcrPreview(null);
    setOcrState(createOcrState());
    setOcrWarningsExpanded(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
  function handleImportOcr() {
    if (!ocrPreview || !ocrPreview.rows.length) return;
    const validRows = ocrPreview.rows.filter((row) => Object.keys(row.errors).length === 0);
    if (!validRows.length) {
      showActionToast('导入失败', 'error', { description: '没有有效行可导入，请重传或手动录入。' });
      trackActionResult('holdings', 'ocr_import', 'validation_error', {
        rowCount: ocrPreview.rows.length,
        validCount: 0
      });
      return;
    }
    // 重新生成 id，避免与现有流水 id 冲突（与 Excel 粘贴导入一致的打包逻辑）。
    const validDrafts = validRows.map((row) => normalizeTransaction({ ...row.draft, id: undefined, switchPairId: '' }, { idPrefix: 'ocr' }));
    setLedger((prev) => ({
      ...prev,
      transactions: [...(prev.transactions || []), ...validDrafts]
    }));
    const skipped = ocrPreview.rows.length - validDrafts.length;
    showActionToast('OCR 导入', 'success', {
      description: skipped > 0
        ? `已导入 ${validDrafts.length} 条 BUY 草稿，跳过 ${skipped} 行无效。请补录交易日期。`
        : `已导入 ${validDrafts.length} 条 BUY 草稿，请补录交易日期。`
    });
    setOcrModalOpen(false);
    setOcrPreview(null);
    setOcrState(createOcrState());
    setOcrWarningsExpanded(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    trackActionResult('holdings', 'ocr_import', 'success', {
      rowCount: ocrPreview.rows.length,
      importedCount: validDrafts.length,
      skippedCount: skipped
    });
    triggerConversionPrompt('holdings_import_success', {
      source: 'ocr',
      importedCount: validDrafts.length,
      skippedCount: skipped
    });
  }
  // 在 OCR 预览表格里逐行修改某个字段。修改后同步重算 errors，让「状态/问题」列即时刷新。
  function handleOcrRowFieldChange(rowIndex, field, value) {
    setOcrPreview((prev) => {
      if (!prev || !Array.isArray(prev.rows)) return prev;
      const nextRows = prev.rows.map((row) => {
        if (row.index !== rowIndex) return row;
        let nextValue = value;
        if (field === 'code') {
          nextValue = sanitizeCodeInput(value);
        } else if (field === 'price' || field === 'shares' || field === 'amount' || field === 'costPrice') {
          nextValue = sanitizeDecimalInput(value, {
            allowNegative: field === 'price'
          });
        } else if (field === 'type') {
          nextValue = String(value || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        }
        const nextDraft = { ...row.draft, [field]: nextValue };
        return { ...row, draft: nextDraft, errors: getTransactionErrors(nextDraft) };
      });
      return { ...prev, rows: nextRows };
    });
  }
  // 粘贴预览也采用卡片表单后，需要可编辑模式，逻辑与 OCR 完全对齐。
  function handlePasteRowFieldChange(rowIndex, field, value) {
    setPasteResult((prev) => {
      if (!prev || !Array.isArray(prev.rows)) return prev;
      const nextRows = prev.rows.map((row) => {
        if (row.index !== rowIndex) return row;
        let nextValue = value;
        if (field === 'code') {
          nextValue = sanitizeCodeInput(value);
        } else if (field === 'price' || field === 'shares' || field === 'amount' || field === 'costPrice') {
          nextValue = sanitizeDecimalInput(value, {
            allowNegative: field === 'price'
          });
        } else if (field === 'type') {
          nextValue = String(value || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        }
        const nextDraft = { ...row.draft, [field]: nextValue };
        return { ...row, draft: nextDraft, errors: getTransactionErrors(nextDraft) };
      });
      return { ...prev, rows: nextRows };
    });
  }
  // ---- Switch counterpart picker ----
  function openSwitchPicker() {
    setSwitchPickerSearch('');
    // 初始化选择状态：只按 switchPairId 预选，不再按金额拆分分配。
    setSwitchPickerSelectedIds(() => {
      const s = new Set();
      try {
        if (draft?.switchPairId) {
          s.add(draft.switchPairId);
        }
      } catch (e) {
        // ignore
      }
      return s;
    });
    // 移动端某些 WebView/手势层会出现「点击后 state 已更新，但 UI 不立即重绘」的情况，
    // 往往要等一次导航/返回（popstate）才把弹窗绘出来。这里强制同步 flush，确保立刻渲染。
    flushSync(() => setSwitchPickerOpen(true));
    trackFeatureEvent('holdings', 'switch_picker_open', {
      candidateCount: transactions.length,
      selectedCount: switchPickerSelectedIds.size
    });
  }
  function closeSwitchPicker() {
    setSwitchPickerOpen(false);
  }
  function handleSelectSwitchCounterpart(txId) {
    setSwitchPickerSelectedIds((prev) => {
      if (!txId) return new Set(prev);
      return prev.has(txId) ? new Set() : new Set([txId]);
    });
  }
  function handleConfirmSwitchAllocations({ pairIds = [] }) {
    const nextPairId = String(pairIds[0] || '').trim();
    handleDraftChange('switchAllocations', []);
    handleDraftChange('switchPairId', nextPairId);
    setSwitchPickerOpen(false);
    showActionToast(nextPairId ? '已选择对手方' : '已清除对手方', nextPairId ? 'success' : 'warning', {
      description: '基金切换只记录配对关系，不校验两笔交易金额。'
    });
    trackActionResult('holdings', 'switch_allocation_confirm', nextPairId ? 'success' : 'empty', {
      selectedCount: pairIds.length
    });
  }
  function handleParsePaste() {
    const text = pasteText;
    if (!text.trim()) {
      showActionToast('粘贴解析', 'warning', { description: '粘贴区为空，请从 Excel 复制一段数据再试。' });
      trackActionResult('holdings', 'paste_parse', 'empty');
      return;
    }
    const result = parseExcelPaste(text);
    setPasteResult(result);
    if (!result.rows.length) {
      showActionToast('粘贴解析', 'warning', { description: '没有识别到有效行，请检查格式。' });
      trackActionResult('holdings', 'paste_parse', 'empty', {
        textLengthBucket: text.length > 5000 ? 'gt_5k' : text.length > 1000 ? '1k_5k' : 'lte_1k'
      });
      return;
    }
    const validCount = result.rows.filter((row) => Object.keys(row.errors).length === 0).length;
    showActionToast('粘贴解析', 'success', {
      description: `识别 ${result.rows.length} 行，其中有效 ${validCount} 行${result.headerDetected ? '（已识别表头）' : '（按位置映射）'}。`
    });
    trackActionResult('holdings', 'paste_parse', 'success', {
      rowCount: result.rows.length,
      validCount,
      headerDetected: Boolean(result.headerDetected),
      textLengthBucket: text.length > 5000 ? 'gt_5k' : text.length > 1000 ? '1k_5k' : 'lte_1k'
    });
  }
  function handleImportPasted() {
    if (!pasteResult || !pasteResult.rows.length) return;
    const validRows = pasteResult.rows.filter((row) => Object.keys(row.errors).length === 0);
    if (!validRows.length) {
      showActionToast('导入失败', 'error', { description: '没有有效行可导入，请根据提示修改后重试。' });
      trackActionResult('holdings', 'paste_import', 'validation_error', {
        rowCount: pasteResult.rows.length,
        validCount: 0
      });
      return;
    }
    // 重新生成 id 并重映射 switchPairId，保留批次内切换配对同时避免与现有流水 id 冲突。
    const idMap = new Map();
    const intermediate = validRows.map((row) => {
      const oldId = row.draft && row.draft.id;
      const oldPairId = row.draft && row.draft.switchPairId;
      const draft = normalizeTransaction({ ...row.draft, id: undefined, switchPairId: '' });
      if (oldId) idMap.set(oldId, draft.id);
      return { oldPairId, draft };
    });
    const validDrafts = intermediate.map(({ oldPairId, draft }) => {
      if (oldPairId && idMap.has(oldPairId)) {
        return { ...draft, switchPairId: idMap.get(oldPairId) };
      }
      return draft;
    });
    setLedger((prev) => ({
      ...prev,
      transactions: [...(prev.transactions || []), ...validDrafts]
    }));
    const skipped = pasteResult.rows.length - validDrafts.length;
    showActionToast('Excel 粘贴导入', 'success', {
      description: skipped > 0
        ? `已导入 ${validDrafts.length} 笔，跳过 ${skipped} 笔无效行。`
        : `已导入 ${validDrafts.length} 笔交易。`
    });
    trackActionResult('holdings', 'paste_import', 'success', {
      rowCount: pasteResult.rows.length,
      importedCount: validDrafts.length,
      skippedCount: skipped
    });
    triggerConversionPrompt('holdings_import_success', {
      source: 'paste',
      importedCount: validDrafts.length,
      skippedCount: skipped
    });
    setPasteModalOpen(false);
    setPasteText('');
    setPasteResult(null);
  }
  // ---- Render helpers ----
  function navigateToMarkets(event, code = '') {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
    if (event) event.preventDefault();
    if (typeof window === 'undefined') return;
    const target = links.markets || './index.html?tab=markets';
    const nextUrl = new URL(target, window.location.href);
    if (code) {
      nextUrl.searchParams.set('symbol', normalizeFundCode(code));
      try { window.sessionStorage.setItem('markets:pendingSymbol', normalizeFundCode(code)); } catch (_error) { /* ignore */ }
    }
    if (window.location.href === nextUrl.href) return;
    window.history.pushState({ tab: 'markets', symbol: code || '' }, '', nextUrl);
    window.dispatchEvent(new PopStateEvent('popstate'));
    if (code) {
      window.dispatchEvent(new CustomEvent('markets:select-symbol', { detail: { symbol: normalizeFundCode(code), market: 'cn' } }));
    }
  }

  return (
    <>
    <WorkspaceReturnBar currentTab="holdings" className={`mb-3 px-4 sm:px-6 ${embedded ? '' : 'mx-auto max-w-[1600px]'}`} />
    <HoldingsOverviewShell
      embedded={embedded}
      migrationNoticeVisible={migrationNoticeVisible}
      ledger={ledger}
      portfolio={portfolio}
      inceptionDate={inceptionDate}
      incomeRoute={incomeRoute}
      accountAllocation={accountAllocation}
      onAccountSettingsChange={handleAccountSettingsChange}
      navRefresh={{
        onClick: handleManualRefresh,
        loading: navStatus === 'loading',
        hasFailures: (ledger.lastNavMeta?.failureCount || 0) > 0,
        title: (ledger.lastNavMeta?.failureCount || 0) > 0
          ? `净值同步有 ${ledger.lastNavMeta.failureCount} 项失败`
          : '同步净值',
      }}
      quickActions={{
        onNewTransaction: () => {
          resetDraft(emptyDraft({ type: 'BUY' }));
          setSidePanelTab('create');
          setSidePanelOpen(true);
        },
        onPasteExcel: openPasteModal,
        onOcr: openOcrModal,
        onCopyTable: handleCopyVisibleTable,
        copyTitle: '复制基金汇总为 TSV',
        onClearAllData: handleClearAllData,
      }}
      fileInputRef={fileInputRef}
      onOcrFile={handleOcrFile}
      aggregatesTable={aggregatesTable}
      aggregatesTableData={aggregatesTableData}
      aggregates={aggregates}
      ledgerRows={ledgerRows}
      todaySignals={todaySignals}
      onCreateFirstTransaction={() => {
        resetDraft(emptyDraft({ type: 'BUY' }));
        setSidePanelTab('create');
        setSidePanelOpen(true);
      }}
      onInstallDemoData={handleInstallDemoData}
      onAggregateRowClick={(row) => {
        setSelectedCode(row.original.code);
        setSidePanelTab('summary');
        setSidePanelOpen(true);
      }}
      onOpenAlertDialog={handleOpenAlertDialog}
      pasteModal={{
        open: pasteModalOpen,
        pasteText,
        pasteResult,
        pastePreviewIndex,
        setPastePreviewIndex,
        onClose: closePasteModal,
        onPasteTextChange: (value) => {
          setPasteText(value);
          setPasteResult(null);
        },
        onParse: handleParsePaste,
        onRowFieldChange: handlePasteRowFieldChange,
        onImport: handleImportPasted,
      }}
      ocrModal={{
        open: ocrModalOpen,
        ocrState,
        ocrPreview,
        ocrPreviewIndex,
        setOcrPreviewIndex,
        ocrWarningsExpanded,
        setOcrWarningsExpanded,
        onClose: closeOcrModal,
        onTriggerOcr: handleTriggerOcr,
        onRowFieldChange: handleOcrRowFieldChange,
        onImport: handleImportOcr,
      }}
      switchPicker={{
        open: switchPickerOpen,
        draft,
        transactions,
        selectedIds: switchPickerSelectedIds,
        search: switchPickerSearch,
        onSearchChange: setSwitchPickerSearch,
        onToggle: handleSelectSwitchCounterpart,
        onAutoSelect: setSwitchPickerSelectedIds,
        onConfirm: handleConfirmSwitchAllocations,
        onClose: closeSwitchPicker,
      }}
      sidePanel={{
        open: sidePanelOpen,
        title: sidePanelTab === 'summary' ? '该基金汇总' : draftMode === 'edit' ? '编辑交易' : '新增交易',
        onClose: () => setSidePanelOpen(false),
        tab: sidePanelTab,
        selectedAggregate,
        onNavigateToMarkets: navigateToMarkets,
        onBuyOrSell: openBuyOrSellFromSummary,
        draft,
        draftMode,
        transactions,
        onDraftChange: handleDraftChange,
        onResetDraft: () => resetDraft(),
        onSubmit: submitDraft,
        onDeleteTransaction: handleDeleteTransaction,
        onDeleted: () => setSidePanelOpen(false),
        onOpenSwitchPicker: openSwitchPicker,
        onEditTransaction: handleEditTransaction,
      }}
    />
    <AlertRuleDialog
      open={alertDialogOpen}
      onClose={handleCloseAlertDialog}
      onSave={(config) => handleSaveAlert(config, isFirstAlert)}
      initialRule={selectedHolding}
      mode="holding"
    />
    </>
  );
}
export default HoldingsExperience;
