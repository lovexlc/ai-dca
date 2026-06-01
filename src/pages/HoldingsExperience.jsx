import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  AlertTriangle,
  ClipboardPaste,
  Copy,
  FileUp,
  Plus,
  Wallet
} from 'lucide-react';
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
import { assignAccount, getAccountAllocation, getAssignedAccount, readAccountAssignments } from '../app/accountManager.js';
import { IncomeSection } from '../app/income/IncomeSection.jsx';
import { useIncomeRoute, ROUTES } from '../app/incomeRoute.js';
import { AggregateHoldingsTableSection } from './holdings/AggregateHoldingsTableSection.jsx';
import { HoldingSummaryPanel } from './holdings/HoldingSummaryPanel.jsx';
import { HoldingsSidePanel } from './holdings/HoldingsSidePanel.jsx';
import { OcrImportModal, PasteImportModal } from './holdings/TransactionImportModals.jsx';
import { createAggregateHoldingsColumns } from './holdings/aggregateHoldingsColumns.jsx';
import { SwitchCounterpartPickerModal } from './holdings/SwitchCounterpartPickerModal.jsx';
import { TransactionDraftPanel } from './holdings/TransactionDraftPanel.jsx';
import {
  aggregateByCode,
  buildLedgerRows,
  buildSoldLots,
  detectFundKind,
  getExpectedLatestNavDate,
  getLedgerCodeList,
  getSwitchChainCodeList,
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
import { getNearestTradingDayShanghai, getNextTradingDayShanghai } from '../app/holidaysCN.js';
import {
  buildNavMetaFromResult,
  mergeSnapshotsFromNavResult,
  persistLedgerState,
  readLedgerState,
  recognizeLedgerFile
} from '../app/holdingsLedger.js';
import { showActionToast } from '../app/toast.js';
import { getNavSnapshots } from '../app/navService.js';
import {
  cx,
  primaryButtonClass
} from '../components/experience-ui.jsx';
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
import { groupCostBasisBySymbol, attachUnrealized } from '../app/costTracker.js';
import { hasPotentialUserData, installDemoData } from '../app/demoData.js';


export function HoldingsExperience({ links = {}, inPagesDir = false, embedded = false } = {}) {
  const [ledger, setLedger] = useState(() => readLedgerState());
  const [kindFilter, setKindFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [sidePanelTab, setSidePanelTab] = useState('summary');
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraft());
  const [draftMode, setDraftMode] = useState('create');
  const [navStatus, setNavStatus] = useState('idle');
  const [ocrState, setOcrState] = useState(() => createOcrState());
  const [primaryTabKey, setPrimaryTabKey] = useState('holdings');
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  useEffect(() => {
    function onMobileNew() {
      // 4.2: 已卖出 tab 已移除 (迁移到 #/liquidation)，默认留 BUY
      resetDraft(emptyDraft({ type: 'BUY' }));
      setSidePanelTab('create');
      setSidePanelOpen(true);
    }
    function onMobilePaste() { openPasteModal(); }
    function onMobileOcr() { openOcrModal(); }
    function onSelectFund(event) {
      const code = event && event.detail && event.detail.code;
      if (!code) return;
      setSelectedCode(code);
      setSidePanelTab('summary');
      setSidePanelOpen(true);
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
  const [pasteResult, setPasteResult] = useState(null);
  // ---- OCR import modal: 截图 OCR 走与「粘贴 Excel」一致的「先弹窗 → 解析预览 → 导入有效行」流程。 ----
  const [ocrModalOpen, setOcrModalOpen] = useState(false);
  // ocrPreview 与 pasteResult 形状对齐：{ rows: Array<{ index, draft, errors }>, fileName, recordCount, warnings, provider, model }
  const [ocrPreview, setOcrPreview] = useState(null);
  // 识别提醒（warnings）默认折叠，点击展开后显示全部，避免占用太多纵向空间。
  const [ocrWarningsExpanded, setOcrWarningsExpanded] = useState(false);
  // 预览弹窗里把多行识别结果做成卡片轮播，每次只显示一条，避免手机端表格被横向截断。
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
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [switchPickerOpen, setSwitchPickerOpen] = useState(false);
  const [switchPickerSearch, setSwitchPickerSearch] = useState('');
  const [switchPickerSelectedIds, setSwitchPickerSelectedIds] = useState(() => new Set());
  const fileInputRef = useRef(null);
  const autoNavTriggeredRef = useRef(false);
  const navAttemptedCodesRef = useRef(new Set());
  const importMenuRef = useRef(null);


  // ---- Persist changes to localStorage whenever ledger state changes ----
  useEffect(() => {
    persistLedgerState(ledger);
  }, [ledger]);

  // ---- PR 3.5 part 1: 读取交易台账 (aiDcaTradeLedger)，给基金汇总行注入成本/盈亏字段（仅数据层，UI 留到 part 2）。 ----
  const [tradeLedgerEntries, setTradeLedgerEntries] = useState(() => readTradeLedger());
  const [accountAssignments, setAccountAssignments] = useState(() => readAccountAssignments());
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onStorage(event) {
      if (!event || event.key === 'aiDcaTradeLedger' || event.key === null) {
        setTradeLedgerEntries(readTradeLedger());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ---- Derived data ----
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
  const portfolio = useMemo(
    () => summarizePortfolio(aggregates, soldSummary),
    [aggregates, soldSummary]
  );
  const searchNeedle = searchText.trim().toLowerCase();

  // ---- TanStack Table (shadcn / tablecn) for the 「基金汇总」 view ----
  // PR 3.5 part 1：交易台账以 symbol 为维度聚合成本/盈亏，以 ledger* 字段挂到持仓行上；UI 呈现留给 part 2。
  const costBasisBySymbol = useMemo(
    () => groupCostBasisBySymbol(tradeLedgerEntries),
    [tradeLedgerEntries],
  );
  const aggregatesTableData = useMemo(
    () => {
      const enriched = aggregates.filter((agg) => agg.hasPosition).map((agg) => {
        const sym = String(agg.code || '').trim().toUpperCase();
        const entry = sym ? costBasisBySymbol[sym] : null;
        const summary = entry ? entry.summary : null;
        const accountType = getAssignedAccount(sym || agg.code, accountAssignments);
        const base = summary ? {
          ...agg,
          accountType,
          ledgerTextbookCost: summary.textbookCost,
          ledgerEffectiveCost: summary.effectiveCost,
          ledgerRealizedPnl: summary.realizedPnl,
          ledgerIsNegativeCost: summary.isNegativeCost,
        } : { ...agg, accountType };
        const price = Number(agg.currentPrice ?? agg.latestNav) || 0;
        if (summary && price > 0) {
          const withUnreal = attachUnrealized(summary, price);
          base.ledgerUnrealizedPnl = withUnreal.unrealizedPnl;
          base.ledgerTotalPnl = withUnreal.totalPnl;
        }
        return base;
      });
      // PR 4.5 收尾：仓位占比在表中可视化。总市值走有当前价格的行，以避免未定价资产拉低总合计。
      const totalMv = enriched.reduce(
        (sum, row) => sum + (row.hasCurrentPrice ? (Number(row.marketValue) || 0) : 0),
        0,
      );
      if (totalMv <= 0) return enriched;
      return enriched.map((row) => ({
        ...row,
        weightPct: row.hasCurrentPrice ? ((Number(row.marketValue) || 0) / totalMv) * 100 : null,
      }));
    },
    [accountAssignments, aggregates, costBasisBySymbol],
  );
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
  const accountAllocation = useMemo(
    () => getAccountAllocation(aggregatesTableData, accountAssignments),
    [accountAssignments, aggregatesTableData],
  );
  function handleAccountChange(symbol, accountType) {
    setAccountAssignments((current) => assignAccount(symbol, accountType, current));
  }

  function handleInstallDemoData() {
    if (typeof window !== 'undefined' && hasPotentialUserData() && !window.confirm('检测到已有本地数据。生成演示数据会覆盖当前持仓、计划和定投数据。建议先到「数据同步」导出备份。确认继续？')) return;
    installDemoData();
    setLedger(readLedgerState());
    setAccountAssignments(readAccountAssignments());
    setTradeLedgerEntries(readTradeLedger());
    showActionToast('生成 Demo 数据', 'success', {
      description: '已生成纳指 ETF 模拟持仓，买入价锚定 2026-03-01。'
    });
  }
  const aggregateColumns = useMemo(() => createAggregateHoldingsColumns({
    accountAssignments,
    kindFilterOptions,
    numericSortFn,
    onAccountChange: handleAccountChange,
    onNavigateToMarkets: navigateToMarkets,
  }), [accountAssignments, kindFilterOptions, links.markets]);

  const aggregatesTable = useReactTable({
    data: aggregatesTableData,
    columns: aggregateColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      sorting: [{ id: 'marketValue', desc: true }],
      pagination: { pageSize: 50 },
    },
  });

  const selectedAggregate = selectedCode ? aggregateByCodeMap.get(selectedCode) : null;
  const needsDateBackfill = useMemo(
    () => transactions.some((tx) => !tx.date),
    [transactions]
  );
  const migrationNoticeVisible = Boolean(ledger.migratedFromLegacy) && needsDateBackfill;

  // ---- NAV auto-refresh on mount ----
  useEffect(() => {
    // 进入页面时无条件触发一次净值刷新（包含所有持仓代码）。
    // autoNavTriggeredRef 保证整个 mount 周期内只跑一次；手动刷新走 handleManualRefresh，独立于此。
    if (autoNavTriggeredRef.current) return;
    // 拉取所有交易代码（含已卖出/清仓代码），确保卖出净值和清仓收益也能拿到最新确认 NAV。
    const ledgerCodes = getLedgerCodeList(transactions);
    const chainCodes = getSwitchChainCodeList(transactions);
    const codes = [...new Set([...ledgerCodes, ...chainCodes])].sort();
    if (!codes.length) return;
    autoNavTriggeredRef.current = true;
    for (const code of codes) navAttemptedCodesRef.current.add(code);
    void refreshNavForCodes(codes, { silent: true });
  }, [transactions]);

  useEffect(() => {
    if (!importMenuOpen) return undefined;
    function handle(event) {
      if (!importMenuRef.current) return;
      if (importMenuRef.current.contains(event.target)) return;
      setImportMenuOpen(false);
    }
    function handleKey(event) {
      if (event.key === 'Escape') setImportMenuOpen(false);
    }
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [importMenuOpen]);

  async function refreshNavForCodes(codes, { silent = false } = {}) {
    const safeCodes = (Array.isArray(codes) ? codes : []).filter(Boolean);
    if (!safeCodes.length) {
      if (!silent) showActionToast('净值刷新', 'warning', { description: '当前没有可刷新的基金代码。' });
      return;
    }
    setNavStatus('loading');
    try {
      const navResult = await getNavSnapshots(safeCodes);
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
    } catch (error) {
      setNavStatus('error');
      // 网络异常允许下次重试。
      for (const code of safeCodes) navAttemptedCodesRef.current.delete(code);
      if (!silent) {
        showActionToast('净值刷新', 'error', { description: error?.message || '净值服务暂时不可用。' });
      }
    }
  }

  function handleManualRefresh() {
    // 手动刷新：所有交易代码 + 切换链路里出现过的代码，保证已卖出/清仓记录也能同步确认 NAV。
    const ledgerCodes = getLedgerCodeList(transactions);
    const chainCodes = getSwitchChainCodeList(transactions);
    const codes = [...new Set([...ledgerCodes, ...chainCodes])].sort();
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
    void refreshNavForCodes(codes, { silent: false });
  }

  // ---- Draft (quick add) handlers ----
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
        const existingPrice = Number(tx?.price) || 0;
        if (existingPrice > 0) return tx;
        const kind = String(tx?.kind || '').toLowerCase();
        if (kind === 'exchange') return tx;
        const code = normalizeFundCode(tx?.code || '');
        if (!code) return tx;
        const snap = snapMap[code];
        if (!snap) return tx;
        const txDate = String(tx?.date || '');
        if (!txDate) return tx;
        let resolved = 0;
        if (String(snap.latestNavDate || '') === txDate && Number(snap.latestNav) > 0) {
          resolved = Number(snap.latestNav);
        } else if (String(snap.previousNavDate || '') === txDate && Number(snap.previousNav) > 0) {
          resolved = Number(snap.previousNav);
        }
        if (!(resolved > 0)) return tx;
        changed = true;
        return { ...tx, price: Number(resolved.toFixed(4)) };
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
  }

  function handleDraftChange(field, value) {
    setDraft((prev) => {
      if (!prev) return prev;
      if (field === 'code') {
        const nextCode = sanitizeCodeInput(value);
        const existingName = prev.name || (aggregateByCodeMap.get(normalizeFundCode(nextCode))?.name || '');
        const nextKind = prev.kind && prev.kind !== 'otc' ? prev.kind : detectFundKind(nextCode);
        return { ...prev, code: nextCode, name: existingName, kind: nextKind };
      }
      if (field === 'price' || field === 'shares' || field === 'costPrice') {
        return { ...prev, [field]: sanitizeDecimalInput(value) };
      }
      if (field === 'before3pm') {
        // 场外/QDII：勾选「三点前」表示今天交易日收盘价确认；未勾 = 次个交易日确认。
        // 场内不适用，只记状态不动 date。NAV 始终不自动带入。
        const nextBefore3pm = Boolean(value);
        if (prev.kind === 'exchange') {
          return { ...prev, before3pm: nextBefore3pm };
        }
        const ctx = computeOtcAutoFillContext({ kind: prev.kind, before3pm: nextBefore3pm });
        return {
          ...prev,
          before3pm: nextBefore3pm,
          date: ctx.confirmDate || prev.date
        };
      }
      return { ...prev, [field]: value };
    });
  }

  // 场外/QDII 基金「三点前/后」确认逻辑：
  //   三点前 -> 确认日 = 今天所在的交易日（T 日）。
  //   三点后 -> 确认日 = 下一个交易日（T+1）。
  // 价格（净值）始终不自动带入——下单时本日 NAV 还未公布，快照里看到的只是上一个交易日的净值。
  function computeOtcAutoFillContext({ kind, before3pm }) {
    if (kind === 'exchange') {
      return { confirmDate: '', price: '', hint: '' };
    }
    const today = getTodayShanghaiDate();
    const todayTrading = getNearestTradingDayShanghai(today);
    const confirmDate = before3pm ? todayTrading : getNextTradingDayShanghai(todayTrading);
    return { confirmDate, price: '', hint: '' };
  }

  function submitDraft() {
    const prepared = {
      ...draft,
      code: normalizeFundCode(draft.code),
      kind: normalizeFundKind(draft.kind, draft.code),
      price: Number(draft.price),
      shares: Number(draft.shares)
    };
    const errors = getTransactionErrors(prepared);
    if (Object.keys(errors).length) {
      showActionToast('保存失败', 'error', { description: summarizeTransactionErrors(errors) });
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
        return;
      }
    }
    setLedger((prev) => {
      const list = Array.isArray(prev.transactions) ? prev.transactions : [];
      const previousTx = draftMode === 'edit' && draft.id ? list.find((tx) => tx.id === draft.id) : null;
      const previousPairId = previousTx?.switchPairId || '';
      // 如果存在 switchAllocations，则按分配拆分/生成多笔交易；否则走单笔逻辑
      const allocations = Array.isArray(draft.switchAllocations) && draft.switchAllocations.length ? draft.switchAllocations : null;
      const remap = (tx, firstNewId, firstNewSwitchId) => {
        // 清理老数据里由旧的一对一逻辑写入的反向指针。
        if (previousPairId && previousPairId !== firstNewSwitchId && tx.id === previousPairId && tx.switchPairId === (firstNewId || normalized.id)) {
          return { ...tx, switchPairId: '' };
        }
        return tx;
      };

      if (allocations) {
        // 生成按 allocation 拆分的交易条目
        const basePrice = Number(prepared.price) || 0;
        const totalSharesTarget = Number(prepared.shares) || 0;
        const allocTxs = allocations.map((a) => {
          const counterpart = list.find((t) => t.id === a.txId) || null;
          const counterpartPrice = Number(counterpart?.price) || 0;
          let shares = 0;
          if (basePrice > 0) shares = (Number(a.amount || 0) / basePrice);
          else if (counterpartPrice > 0) shares = (Number(a.amount || 0) / counterpartPrice);
          shares = Number(shares.toFixed(4));
          return { ...prepared, id: undefined, price: basePrice || counterpartPrice || 0, shares, switchPairId: a.txId };
        });
        // 修正四舍五入导致的份额差异：把差值加到最后一笔
        const sumShares = allocTxs.reduce((s, t) => s + (Number(t.shares) || 0), 0);
        if (Math.abs(sumShares - totalSharesTarget) > 1e-6 && allocTxs.length) {
          const last = allocTxs[allocTxs.length - 1];
          last.shares = Number((Number(last.shares || 0) + (totalSharesTarget - sumShares)).toFixed(4));
        }

        const normalizedList = allocTxs.map((t, idx) => normalizeTransaction({ ...t, id: undefined }));
        if (draftMode === 'edit' && draft.id) {
          // 保留原 id 给第一笔，其他作为新记录追加
          const first = normalizedList[0];
          const others = normalizedList.slice(1);
          const firstWithId = { ...first, id: normalized.id };
          return {
            ...prev,
            transactions: [...list.map((tx) => remap(tx, firstWithId.id, firstWithId.switchPairId)), ...others.map((o) => o)]
          };
        }
        return { ...prev, transactions: [...list.map((tx) => remap(tx, normalizedList[0]?.id, normalizedList[0]?.switchPairId)), ...normalizedList] };
      }

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
      description: `${normalized.code} ${normalized.type} ${formatShares(normalized.shares)} 份 @ ${formatNav(normalized.price)}`
    });
    resetDraft();
    setSelectedCode(normalized.code);
    setSidePanelTab('summary');
    setSidePanelOpen(false);
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
    const filtered = aggregates.filter((agg) => {
      if (!agg.hasPosition) return false;
      if (kindFilter !== 'all' && agg.kind !== kindFilter) return false;
      if (!searchNeedle) return true;
      return agg.code.toLowerCase().includes(searchNeedle)
        || (agg.name || '').toLowerCase().includes(searchNeedle);
    });
    const header = ['基金代码', '基金名称', '标签', '总份额', '平均成本', '当前价格', '总市值', '总收益(元)', '总收益率', '当日收益(元)', '当日收益率'];
    const rows = filtered.map((agg) => {
      const kindLabel = agg.kind === 'exchange' ? '场内' : '场外';
      return [
        agg.code,
        agg.name || '',
        kindLabel,
        formatShares(agg.totalShares),
        formatNav(agg.avgCost),
        agg.hasCurrentPrice ? formatNav(agg.currentPrice ?? agg.latestNav) : '',
        agg.hasCurrentPrice ? agg.marketValue.toFixed(2) : '',
        agg.hasCurrentPrice ? agg.unrealizedProfit.toFixed(2) : '',
        agg.hasCurrentPrice ? `${agg.unrealizedReturnRate.toFixed(2)}%` : '',
        agg.hasTodayNav ? agg.todayProfit.toFixed(2) : '',
        agg.hasTodayNav ? `${agg.todayReturnRate.toFixed(2)}%` : ''
      ].join('\t');
    });
    return { count: filtered.length, tsv: [header.join('\t'), ...rows].join('\n') };
  }

  async function handleCopyVisibleTable() {
    const payload = buildAggregateTsv();
    const label = '基金汇总';
    if (payload.count === 0) {
      showActionToast('复制表格', 'warning', { description: '当前没有可复制的行。' });
      return;
    }
    const ok = await writeClipboard(payload.tsv);
    if (ok) {
      showActionToast('已复制', 'success', { description: `${label} ${payload.count} 行已复制为 TSV。` });
    } else {
      showActionToast('复制失败', 'error', { description: '浏览器拒绝写入剪贴板，请手动复制。' });
    }
  }

  // ---- OCR import ----
  function handleTriggerOcr() {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  }

  async function handleOcrFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
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
    } catch (error) {
      setOcrState(createOcrState({
        status: 'error',
        error: error?.message || '识别失败，请稍后重试。'
      }));
      showActionToast('OCR 导入', 'error', { description: error?.message || '识别失败。' });
    } finally {
      // 允许同一个文件被重复选择，在弹窗内重新上传。
      if (event?.target) event.target.value = '';
    }
  }

  // ---- Excel paste import ----
  function openPasteModal() {
    setPasteModalOpen(true);
    setPasteText('');
    setPasteResult(null);
  }

  function closePasteModal() {
    setPasteModalOpen(false);
  }

  // ---- OCR import modal controls ----
  function openOcrModal() {
    setOcrModalOpen(true);
    setOcrPreview(null);
    setOcrState(createOcrState());
    setOcrWarningsExpanded(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
        } else if (field === 'price' || field === 'shares' || field === 'costPrice') {
          nextValue = sanitizeDecimalInput(value);
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
        } else if (field === 'price' || field === 'shares' || field === 'costPrice') {
          nextValue = sanitizeDecimalInput(value);
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
    // 初始化多选状态：如果 draft 有 switchAllocations 或 switchPairId，预选对应 id
    setSwitchPickerSelectedIds(() => {
      const s = new Set();
      try {
        if (Array.isArray(draft?.switchAllocations)) {
          for (const a of draft.switchAllocations) if (a && a.txId) s.add(a.txId);
        } else if (draft?.switchPairId) {
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
  }

  function closeSwitchPicker() {
    setSwitchPickerOpen(false);
  }

  function handleSelectSwitchCounterpart(txId) {
    // 保持与旧接口兼容：单击行为改为切换选中（多选）。
    setSwitchPickerSelectedIds((prev) => {
      const next = new Set(prev);
      if (!txId) return next;
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  }

  function handleConfirmSwitchAllocations({ allocations, remaining }) {
    // 写回 draft，用于 submit 时按照 allocations 拆分/保存
    handleDraftChange('switchAllocations', allocations);
    // 保持向后兼容：设置 switchPairId 为首个分配的对手方
    if (allocations.length) handleDraftChange('switchPairId', allocations[0].txId);
    else handleDraftChange('switchPairId', '');
    setSwitchPickerOpen(false);
    showActionToast('已准备好分配', remaining > 0 ? 'warning' : 'success', { description: remaining > 0 ? `还有 ${formatCurrency(remaining, '¥', 2)} 未分配` : '已完成全额分配' });
  }

  function handleParsePaste() {
    const text = pasteText;
    if (!text.trim()) {
      showActionToast('粘贴解析', 'warning', { description: '粘贴区为空，请从 Excel 复制一段数据再试。' });
      return;
    }
    const result = parseExcelPaste(text);
    setPasteResult(result);
    if (!result.rows.length) {
      showActionToast('粘贴解析', 'warning', { description: '没有识别到有效行，请检查格式。' });
      return;
    }
    const validCount = result.rows.filter((row) => Object.keys(row.errors).length === 0).length;
    showActionToast('粘贴解析', 'success', {
      description: `识别 ${result.rows.length} 行，其中有效 ${validCount} 行${result.headerDetected ? '（已识别表头）' : '（按位置映射）'}。`
    });
  }

  function handleImportPasted() {
    if (!pasteResult || !pasteResult.rows.length) return;
    const validRows = pasteResult.rows.filter((row) => Object.keys(row.errors).length === 0);
    if (!validRows.length) {
      showActionToast('导入失败', 'error', { description: '没有有效行可导入，请根据提示修改后重试。' });
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

  function renderAggregatesTable() {
    return (
      <AggregateHoldingsTableSection
        table={aggregatesTable}
        tableData={aggregatesTableData}
        aggregates={aggregates}
        onCreateFirstTransaction={() => {
          resetDraft(emptyDraft({ type: 'BUY' }));
          setSidePanelTab('create');
          setSidePanelOpen(true);
        }}
        onInstallDemoData={handleInstallDemoData}
        onRowClick={(row) => {
          setSelectedCode(row.original.code);
          setSidePanelTab('summary');
          setSidePanelOpen(true);
        }}
      />
    );
  }


  function renderDraftPanel() {
    return (
      <TransactionDraftPanel
        draft={draft}
        draftMode={draftMode}
        transactions={transactions}
        onDraftChange={handleDraftChange}
        onResetDraft={() => resetDraft()}
        onSubmit={submitDraft}
        onDeleteTransaction={handleDeleteTransaction}
        onDeleted={() => setSidePanelOpen(false)}
        onOpenSwitchPicker={openSwitchPicker}
      />
    );
  }

  const content = (
    <div className={cx('flex flex-col gap-4 px-4 sm:px-6', embedded ? '' : 'mx-auto max-w-[1600px]')}>
      {migrationNoticeVisible ? (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <div>
            检测到从旧持仓汇总迁入的交易，请点击行内编辑按钮补录交易日期。迁入时间：{ledger.legacyMigrationAt?.slice(0, 10) || '—'}
          </div>
        </div>
      ) : null}
      <IncomeSection
        ledger={ledger}
        portfolio={portfolio}
        inceptionDate={inceptionDate}
        onEditTransaction={handleEditTransaction}
        accountAllocation={accountAllocation}
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
        }}
      />
      {incomeRoute === ROUTES.OVERVIEW ? (<>
      <div className="grid grid-cols-1 gap-4">
        <section className="min-w-0 rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          {/* v7.1: 「复制表格 / + 新增交易」已合并到 IncomeSummary hero 行右侧，原 hidden sm:flex header strip 一并移除（及其 px-4 py-3 border-b）。 */}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleOcrFile} />
          <div className="min-h-[480px] px-1">
            {renderAggregatesTable()}
          </div>
          <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            {`持仓中 ${portfolio.assetCount} 只基金；累计 ${ledgerRows.length} 笔流水。`}
          </div>
        </section>
      </div>
      <PasteImportModal
        open={pasteModalOpen}
        pasteText={pasteText}
        pasteResult={pasteResult}
        pastePreviewIndex={pastePreviewIndex}
        setPastePreviewIndex={setPastePreviewIndex}
        onClose={closePasteModal}
        onPasteTextChange={(value) => { setPasteText(value); setPasteResult(null); }}
        onParse={handleParsePaste}
        onRowFieldChange={handlePasteRowFieldChange}
        onImport={handleImportPasted}
      />
      <OcrImportModal
        open={ocrModalOpen}
        ocrState={ocrState}
        ocrPreview={ocrPreview}
        ocrPreviewIndex={ocrPreviewIndex}
        setOcrPreviewIndex={setOcrPreviewIndex}
        ocrWarningsExpanded={ocrWarningsExpanded}
        setOcrWarningsExpanded={setOcrWarningsExpanded}
        onClose={closeOcrModal}
        onTriggerOcr={handleTriggerOcr}
        onRowFieldChange={handleOcrRowFieldChange}
        onImport={handleImportOcr}
      />
      </>) : null}
      <SwitchCounterpartPickerModal
        open={switchPickerOpen}
        draft={draft}
        transactions={transactions}
        selectedIds={switchPickerSelectedIds}
        search={switchPickerSearch}
        onSearchChange={setSwitchPickerSearch}
        onToggle={handleSelectSwitchCounterpart}
        onAutoSelect={setSwitchPickerSelectedIds}
        onConfirm={handleConfirmSwitchAllocations}
        onClose={closeSwitchPicker}
      />
      {/* v6.1 fix: sidePanel 是 fixed overlay 全局 modal，必须在 OVERVIEW Fragment 外渲染，
          否则在 TRANSACTIONS 子页点击行编辑时不出现，要跳主页才能看到。*/}
      <HoldingsSidePanel
        open={sidePanelOpen}
        title={sidePanelTab === 'summary' ? '该基金汇总' : draftMode === 'edit' ? '编辑交易' : '新增交易'}
        onClose={() => setSidePanelOpen(false)}
      >
        <div>
          {sidePanelTab === 'summary' ? (
            <HoldingSummaryPanel
              aggregate={selectedAggregate}
              onNavigateToMarkets={navigateToMarkets}
              onBuyOrSell={openBuyOrSellFromSummary}
            />
          ) : renderDraftPanel()}
        </div>
      </HoldingsSidePanel>
    </div>
  );

  return content;
}

export default HoldingsExperience;
