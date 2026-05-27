import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  CloudUpload,
  Copy,
  FileImage,
  FileUp,
  ExternalLink,
  LoaderCircle,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Wallet,
  X
} from 'lucide-react';
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableFacetedFilter } from '@/components/data-table/data-table-faceted-filter';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { formatCurrency, formatPercent } from '../app/accumulation.js';
import { ACCOUNT_TYPES, assignAccount, getAccountAllocation, getAssignedAccount, readAccountAssignments } from '../app/accountManager.js';
import { IncomeSection } from '../app/income/IncomeSection.jsx';
import { useIncomeRoute, ROUTES } from '../app/incomeRoute.js';
import {
  aggregateByCode,
  buildLedgerRows,
  buildSoldLots,
  computeSwitchChainMetrics,
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
  Pill,
  cx,
  primaryButtonClass,
  secondaryButtonClass,
  tableInputClass
} from '../components/experience-ui.jsx';
import {
  EDITABLE_INPUT,
  GHOST_BTN,
  KIND_FILTER_KEYS,
  KIND_FILTER_LABELS,
  KIND_LABELS,
  KIND_PILL_TONES,
  LEDGER_COLUMN_COUNT,
  PRIMARY_BTN,
  SUBTLE_BTN,
  createOcrState,
  emptyDraft,
  formatNav,
  formatShares,
  formatSignedCurrency,
  formatSignedPercent,
  nowIso,
  sanitizeCodeInput,
  sanitizeDecimalInput,
  transactionToDraft
} from '../app/holdingsHelpers.js';
import { readTradeLedger } from '../app/tradeLedger.js';
import { groupCostBasisBySymbol, attachUnrealized } from '../app/costTracker.js';


export function HoldingsExperience({ links = {}, inPagesDir = false, embedded = false } = {}) {
  const [ledger, setLedger] = useState(() => readLedgerState());
  const [kindFilter, setKindFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [sidePanelTab, setSidePanelTab] = useState('summary');
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [mainViewTab, setMainViewTab] = useState('aggregate');
  const [draft, setDraft] = useState(() => emptyDraft());
  const [draftMode, setDraftMode] = useState('create');
  const [editingTxId, setEditingTxId] = useState('');
  const [editingBuffer, setEditingBuffer] = useState(null);
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
  }, [mainViewTab]);
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
  // 切换链路 leg 选购/选卖弹窗
  // 形状：{ chainId, legIndex, role: 'buy' | 'sell' }
  const [chainPicker, setChainPicker] = useState(null);
  const [chainPickerSearch, setChainPickerSearch] = useState('');
  // 已展开的链路 id 集合。保存过的链路默认折叠，新建时自动展开。
  const [expandedChains, setExpandedChains] = useState(() => new Set());
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
  // 第五刀 v6: 交易记录独立子页化后，主页 (#/) 只渲染基金汇总表格；mainViewTab 恒为 'aggregate'。
  // ledger 编表仍保留以服务 IncomeTransactionsPage 点击行调 sidePanel 编辑。
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
  const switchChains = Array.isArray(ledger.switchChains) ? ledger.switchChains : [];
  const switchChainMetrics = useMemo(
    () => switchChains.map((chain) => ({
      chain,
      metrics: computeSwitchChainMetrics(chain, transactions, snapshotsByCode)
    })),
    [switchChains, transactions, snapshotsByCode]
  );

  const searchNeedle = searchText.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    return ledgerRows.filter((row) => {
      if (kindFilter !== 'all' && row.tx.kind !== kindFilter) return false;
      if (!searchNeedle) return true;
      return (
        row.tx.code.toLowerCase().includes(searchNeedle)
        || (row.tx.name || '').toLowerCase().includes(searchNeedle)
      );
    });
  }, [ledgerRows, kindFilter, searchNeedle]);

  const kindCounts = useMemo(() => {
    // 计数随当前 tab 切换：
    // - 基金汇总：在持的基金数（hasPosition）
    // - 交易明细：交易总条数
    let source;
    if (mainViewTab === 'aggregate') {
      source = aggregates.filter((agg) => agg.hasPosition);
    } else {
      source = ledgerRows.map((row) => row.tx);
    }
    const counts = { all: source.length, otc: 0, exchange: 0, qdii: 0 };
    for (const item of source) {
      if (item.kind === 'otc') counts.otc += 1;
      else if (item.kind === 'exchange') counts.exchange += 1;
      else if (item.kind === 'qdii') counts.qdii += 1;
    }
    return counts;
  }, [mainViewTab, aggregates, ledgerRows]);

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
        const price = Number(agg.latestNav) || 0;
        if (summary && price > 0) {
          const withUnreal = attachUnrealized(summary, price);
          base.ledgerUnrealizedPnl = withUnreal.unrealizedPnl;
          base.ledgerTotalPnl = withUnreal.totalPnl;
        }
        return base;
      });
      // PR 4.5 收尾：仓位占比在表中可视化。总市值走 hasLatestNav 的行，以避免未定价的场外基金拉低总合计。
      const totalMv = enriched.reduce(
        (sum, row) => sum + (row.hasLatestNav ? (Number(row.marketValue) || 0) : 0),
        0,
      );
      if (totalMv <= 0) return enriched;
      return enriched.map((row) => ({
        ...row,
        weightPct: row.hasLatestNav ? ((Number(row.marketValue) || 0) / totalMv) * 100 : null,
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
  const aggregateColumns = useMemo(() => [
    {
      id: 'code',
      accessorFn: (row) => row.code,
      meta: { label: '代码' },
      enableHiding: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="代码" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-semibold tabular-nums">{row.original.code}</span>
          {row.original.ledgerIsNegativeCost ? <Pill tone="emerald">负成本</Pill> : null}
        </div>
      ),
    },
    {
      id: 'name',
      accessorFn: (row) => row.name || '',
      meta: { label: '名称', variant: 'text', placeholder: '搜索名称' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="名称" />,
      cell: ({ row }) => row.original.name || <span className="text-muted-foreground">—</span>,
      filterFn: 'includesString',
    },
    {
      id: 'kind',
      accessorFn: (row) => row.kind,
      meta: { label: '标签', variant: 'multiSelect', options: kindFilterOptions },
      header: ({ column }) => <DataTableColumnHeader column={column} label="标签" />,
      cell: ({ row }) => (
        <Pill tone={KIND_PILL_TONES[row.original.kind] || 'slate'}>
          {KIND_LABELS[row.original.kind] || '未知'}
        </Pill>
      ),
      filterFn: (row, columnId, filterValue) => {
        if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
        return filterValue.includes(row.getValue(columnId));
      },
    },
    {
      id: 'accountType',
      accessorFn: (row) => row.accountType,
      meta: { label: '账户' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="账户" />,
      cell: ({ row }) => (
        <select
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
          value={row.original.accountType || getAssignedAccount(row.original.code, accountAssignments)}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => handleAccountChange(row.original.code, event.target.value)}
        >
          {Object.entries(ACCOUNT_TYPES).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
        </select>
      ),
    },
    {
      id: 'totalShares',
      accessorFn: (row) => row.totalShares,
      meta: { label: '总份额' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="总份额" />,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatShares(row.original.totalShares)}
          {row.original.pendingSellShares > 0 ? (
            <span className="ml-1 rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-600" title={row.original.kind === 'qdii' ? 'QDII 赎回：T 日净值由 T+1 晚公布，T+2 确认后自动扣减' : '场外赎回：T 日晚公布 NAV，T+1 确认后自动扣减'}>
              卖出{formatShares(row.original.pendingSellShares)} 份待确认
            </span>
          ) : null}
        </span>
      ),
      sortingFn: numericSortFn,
    },
    {
      id: 'avgCost',
      accessorFn: (row) => row.avgCost,
      meta: { label: '平均成本' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="平均成本" />,
      cell: ({ row }) => <span className="tabular-nums">{formatNav(row.original.avgCost)}</span>,
      sortingFn: numericSortFn,
    },
    {
      id: 'latestNav',
      accessorFn: (row) => row.latestNav,
      meta: { label: '当前净值' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="当前净值" />,
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.hasLatestNav ? formatNav(row.original.latestNav) : <span className="text-muted-foreground">—</span>}</span>
      ),
      sortingFn: numericSortFn,
    },
    {
      id: 'marketValue',
      accessorFn: (row) => row.marketValue,
      meta: { label: '总市值' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="总市值" />,
      cell: ({ row }) => <span className="tabular-nums">{formatCurrency(row.original.marketValue, '¥', 2)}</span>,
      sortingFn: numericSortFn,
    },
    {
      id: 'unrealizedProfit',
      accessorFn: (row) => row.unrealizedProfit,
      meta: { label: '总收益' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="总收益" />,
      cell: ({ row }) => {
        if (!row.original.hasLatestNav) return <span className="text-muted-foreground">—</span>;
        const v = row.original.unrealizedProfit;
        const cls = v > 0 ? 'text-rose-600' : v < 0 ? 'text-emerald-600' : '';
        return <span className={cx('tabular-nums', cls)}>{formatSignedCurrency(v, 2)}</span>;
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'unrealizedReturnRate',
      accessorFn: (row) => row.unrealizedReturnRate,
      meta: { label: '总收益率' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="总收益率" />,
      cell: ({ row }) => {
        if (!row.original.hasLatestNav) return <span className="text-muted-foreground">—</span>;
        const v = row.original.unrealizedReturnRate;
        const cls = v > 0 ? 'text-rose-600' : v < 0 ? 'text-emerald-600' : '';
        return <span className={cx('tabular-nums', cls)}>{formatSignedPercent(v)}</span>;
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'todayProfit',
      accessorFn: (row) => row.todayProfit,
      meta: { label: '当日收益' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="当日收益" />,
      cell: ({ row }) => {
        if (!row.original.hasLatestNav) return <span className="text-muted-foreground">—</span>;
        const v = row.original.todayProfit;
        const cls = v > 0 ? 'text-rose-600' : v < 0 ? 'text-emerald-600' : '';
        return <span className={cx('tabular-nums', cls)}>{formatSignedCurrency(v, 2)}</span>;
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'todayReturnRate',
      accessorFn: (row) => row.todayReturnRate,
      meta: { label: '当日收益率' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="当日收益率" />,
      cell: ({ row }) => {
        if (!row.original.hasLatestNav) return <span className="text-muted-foreground">—</span>;
        const v = row.original.todayReturnRate;
        const cls = v > 0 ? 'text-rose-600' : v < 0 ? 'text-emerald-600' : '';
        return <span className={cx('tabular-nums', cls)}>{formatSignedPercent(v)}</span>;
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'weightPct',
      accessorFn: (row) => (row.weightPct == null ? null : row.weightPct),
      meta: { label: '仓位占比' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="仓位占比" />,
      cell: ({ row }) => {
        const v = row.original.weightPct;
        if (v == null) return <span className="text-muted-foreground">—</span>;
        const pct = Math.max(0, Math.min(100, v));
        const heavy = v >= 50;
        const warn = v >= 40 && v < 50;
        const barCls = heavy ? 'bg-rose-500' : warn ? 'bg-amber-500' : 'bg-sky-500';
        const textCls = heavy ? 'text-rose-700 font-semibold' : warn ? 'text-amber-700' : '';
        const barStyle = { width: `${pct}%` };
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <div className="h-1.5 flex-1 rounded-full bg-slate-200 overflow-hidden">
              <div className={cx('h-full rounded-full transition-all', barCls)} style={barStyle} />
            </div>
            <span className={cx('tabular-nums text-xs w-12 text-right', textCls)}>{v.toFixed(1)}%</span>
          </div>
        );
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'markets',
      meta: { label: '行情' },
      header: () => <span className="text-xs font-semibold text-slate-500">行情</span>,
      cell: ({ row }) => (
        <button
          type="button"
          className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
          onClick={(event) => { event.stopPropagation(); navigateToMarkets(event, row.original.code); }}
          title="查看行情详情"
        >
          <ExternalLink className="h-3.5 w-3.5" />行情
        </button>
      ),
    },
  ], [accountAssignments, kindFilterOptions, links.markets]);

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

  // ===== Sold lots table (shadcn/tablecn) =====
  // ===== Ledger (transactions) table (shadcn/tablecn) =====
  const ledgerHandlersRef = useRef({});
  ledgerHandlersRef.current = {
    handleEditFieldChange,
    handleCommitEdit,
    handleCancelEdit,
    handleCopyRowToDraft,
    handleDeleteTransaction,
    setSelectedCode,
    setSidePanelTab,
  };
  const ledgerColumns = useMemo(() => [
    {
      id: 'code',
      accessorFn: (row) => row.tx.code,
      meta: { label: '代码' },
      enableHiding: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="代码" />,
      cell: ({ row }) => {
        const { tx } = row.original;
        const isEditing = editingTxId === tx.id;
        if (isEditing && editingBuffer) {
          return (<input className={EDITABLE_INPUT} value={editingBuffer.code} onChange={(e) => ledgerHandlersRef.current.handleEditFieldChange('code', e.target.value)} placeholder="6位代码" inputMode="numeric" />);
        }
        return (<button type="button" className="font-mono text-xs text-slate-800 hover:underline" onClick={() => { ledgerHandlersRef.current.setSelectedCode(tx.code); ledgerHandlersRef.current.setSidePanelTab('summary'); }}>{tx.code}</button>);
      },
    },
    {
      id: 'name',
      accessorFn: (row) => row.tx.name || '',
      meta: { label: '名称', variant: 'text', placeholder: '搜索名称' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="名称" />,
      cell: ({ row }) => {
        const { tx } = row.original;
        const isEditing = editingTxId === tx.id;
        if (isEditing && editingBuffer) {
          return (<input className={EDITABLE_INPUT} value={editingBuffer.name} onChange={(e) => ledgerHandlersRef.current.handleEditFieldChange('name', e.target.value)} placeholder="基金名称" />);
        }
        return tx.name || <span className="text-muted-foreground">—</span>;
      },
      filterFn: 'includesString',
    },
    {
      id: 'kind',
      accessorFn: (row) => row.tx.kind,
      meta: { label: '标签', variant: 'multiSelect', options: kindFilterOptions },
      header: ({ column }) => <DataTableColumnHeader column={column} label="标签" />,
      cell: ({ row }) => {
        const { tx } = row.original;
        const isEditing = editingTxId === tx.id;
        if (isEditing && editingBuffer) {
          return (<select className={EDITABLE_INPUT} value={editingBuffer.kind} onChange={(e) => ledgerHandlersRef.current.handleEditFieldChange('kind', e.target.value)}><option value="otc">场外</option><option value="exchange">场内</option><option value="qdii">QDII</option></select>);
        }
        return <Pill tone={KIND_PILL_TONES[tx.kind] || 'slate'}>{KIND_LABELS[tx.kind] || '未知'}</Pill>;
      },
      filterFn: (row, columnId, filterValue) => {
        if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
        return filterValue.includes(row.getValue(columnId));
      },
    },
    {
      id: 'type',
      accessorFn: (row) => row.tx.type,
      meta: { label: '类型', variant: 'multiSelect', options: [{ value: 'BUY', label: 'BUY' }, { value: 'SELL', label: 'SELL' }] },
      header: ({ column }) => <DataTableColumnHeader column={column} label="类型" />,
      cell: ({ row }) => {
        const { tx } = row.original;
        const isEditing = editingTxId === tx.id;
        if (isEditing && editingBuffer) {
          return (<select className={EDITABLE_INPUT} value={editingBuffer.type} onChange={(e) => ledgerHandlersRef.current.handleEditFieldChange('type', e.target.value)}><option value="BUY">BUY</option><option value="SELL">SELL</option></select>);
        }
        return (<span className={cx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', tx.type === 'BUY' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500')}>{tx.type}</span>);
      },
      filterFn: (row, columnId, filterValue) => {
        if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
        return filterValue.includes(row.getValue(columnId));
      },
    },
    {
      id: 'date',
      accessorFn: (row) => row.tx.date || '',
      meta: { label: '日期' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="日期" />,
      cell: ({ row }) => {
        const { tx } = row.original;
        const isEditing = editingTxId === tx.id;
        if (isEditing && editingBuffer) {
          return (<input type="date" className={EDITABLE_INPUT} value={editingBuffer.date} onChange={(e) => ledgerHandlersRef.current.handleEditFieldChange('date', e.target.value)} />);
        }
        return tx.date || <span className="text-amber-600">待补录</span>;
      },
    },
    {
      id: 'price',
      accessorFn: (row) => row.tx.price,
      meta: { label: '价' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="价" />,
      cell: ({ row }) => {
        const { tx } = row.original;
        const isEditing = editingTxId === tx.id;
        if (isEditing && editingBuffer) {
          return (<input className={EDITABLE_INPUT} value={editingBuffer.price} onChange={(e) => ledgerHandlersRef.current.handleEditFieldChange('price', e.target.value)} placeholder="0.0000" inputMode="decimal" />);
        }
        return <span className="tabular-nums">{formatNav(tx.price)}</span>;
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'shares',
      accessorFn: (row) => row.tx.shares,
      meta: { label: '份额' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="份额" />,
      cell: ({ row }) => {
        const { tx } = row.original;
        const isEditing = editingTxId === tx.id;
        if (isEditing && editingBuffer) {
          return (<input className={EDITABLE_INPUT} value={editingBuffer.shares} onChange={(e) => ledgerHandlersRef.current.handleEditFieldChange('shares', e.target.value)} placeholder="0.0000" inputMode="decimal" />);
        }
        return <span className="tabular-nums">{formatShares(tx.shares)}</span>;
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'latestNav',
      accessorFn: (row) => row.metrics.hasLatestNav ? row.metrics.latestNav : null,
      meta: { label: '当前净值' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="当前净值" />,
      cell: ({ row }) => {
        const { metrics, snapshot } = row.original;
        const snapshotError = snapshot?.error ? String(snapshot.error) : '';
        return metrics.hasLatestNav ? <span className="tabular-nums">{formatNav(metrics.latestNav)}</span> : (snapshotError ? <span className="text-red-500">失败</span> : '—');
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'latestNavDate',
      accessorFn: (row) => row.metrics.latestNavDate || '',
      meta: { label: '净值日' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="净值日" />,
      cell: ({ row }) => <span className="text-[11px] text-muted-foreground">{row.original.metrics.latestNavDate || '—'}</span>,
    },
    {
      id: 'displayShares',
      accessorFn: (row) => row.metrics.isSell ? null : row.metrics.displayShares,
      meta: { label: '当前份额' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="当前份额" />,
      cell: ({ row }) => {
        const { metrics } = row.original;
        return metrics.isSell ? '—' : <span className="tabular-nums">{formatShares(metrics.displayShares)}</span>;
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'costBasis',
      accessorFn: (row) => row.metrics.costBasis,
      meta: { label: '成本' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="成本" />,
      cell: ({ row }) => <span className="tabular-nums">{formatCurrency(row.original.metrics.costBasis, '¥', 2)}</span>,
      sortingFn: numericSortFn,
    },
    {
      id: 'marketValue',
      accessorFn: (row) => row.metrics.isSell ? row.metrics.proceeds : (row.metrics.hasLatestNav ? row.metrics.marketValue : null),
      meta: { label: '市值/实收' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="市值/实收" />,
      cell: ({ row }) => {
        const { metrics } = row.original;
        if (metrics.isSell) return <span className="tabular-nums text-muted-foreground">{formatCurrency(metrics.proceeds || 0, '¥', 2)}</span>;
        return metrics.hasLatestNav ? <span className="tabular-nums">{formatCurrency(metrics.marketValue, '¥', 2)}</span> : '—';
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'unrealizedProfit',
      accessorFn: (row) => (row.metrics.isSell || !row.metrics.hasLatestNav) ? null : row.metrics.unrealizedProfit,
      meta: { label: '总收益' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="总收益" />,
      cell: ({ row }) => {
        const { metrics } = row.original;
        if (metrics.isSell || !metrics.hasLatestNav) return '—';
        const v = metrics.unrealizedProfit;
        const cls = v > 0 ? 'text-rose-600' : v < 0 ? 'text-emerald-600' : '';
        return <span className={cx('tabular-nums', cls)}>{formatSignedCurrency(v)}</span>;
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'unrealizedReturnRate',
      accessorFn: (row) => (row.metrics.isSell || !row.metrics.hasLatestNav) ? null : row.metrics.unrealizedReturnRate,
      meta: { label: '总收益率' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="总收益率" />,
      cell: ({ row }) => {
        const { metrics } = row.original;
        if (metrics.isSell || !metrics.hasLatestNav) return '—';
        const v = metrics.unrealizedReturnRate;
        const cls = v > 0 ? 'text-rose-600' : v < 0 ? 'text-emerald-600' : '';
        return <span className={cx('tabular-nums', cls)}>{formatSignedPercent(v)}</span>;
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'todayProfit',
      accessorFn: (row) => (row.metrics.isSell || !row.metrics.hasTodayNav) ? null : row.metrics.todayProfit,
      meta: { label: '当日收益' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="当日收益" />,
      cell: ({ row }) => {
        const { metrics } = row.original;
        if (metrics.isSell || !metrics.hasTodayNav) return '—';
        const v = metrics.todayProfit;
        const cls = v > 0 ? 'text-rose-600' : v < 0 ? 'text-emerald-600' : '';
        return <span className={cx('tabular-nums', cls)}>{formatSignedCurrency(v)}</span>;
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'todayReturnRate',
      accessorFn: (row) => (row.metrics.isSell || !row.metrics.hasTodayNav) ? null : row.metrics.todayReturnRate,
      meta: { label: '当日收益率' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="当日收益率" />,
      cell: ({ row }) => {
        const { metrics } = row.original;
        if (metrics.isSell || !metrics.hasTodayNav) return '—';
        const v = metrics.todayReturnRate;
        const cls = v > 0 ? 'text-rose-600' : v < 0 ? 'text-emerald-600' : '';
        return <span className={cx('tabular-nums', cls)}>{formatSignedPercent(v)}</span>;
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'previousNav',
      accessorFn: (row) => row.metrics.hasPreviousNav ? row.metrics.previousNav : null,
      meta: { label: '前一日净值' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="前一日净值" />,
      cell: ({ row }) => {
        const { metrics } = row.original;
        return metrics.hasPreviousNav ? <span className="tabular-nums text-muted-foreground">{formatNav(metrics.previousNav)}</span> : '—';
      },
      sortingFn: numericSortFn,
    },
    {
      id: 'actions',
      enableSorting: false,
      enableHiding: false,
      meta: { label: '操作' },
      header: () => <span className="text-xs font-semibold text-muted-foreground">操作</span>,
      cell: ({ row }) => {
        const { tx } = row.original;
        const isEditing = editingTxId === tx.id;
        if (isEditing && editingBuffer) {
          return (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <button type="button" className={SUBTLE_BTN} onClick={() => ledgerHandlersRef.current.handleCommitEdit()}><Save className="h-4 w-4" /> 保存</button>
              <button type="button" className={SUBTLE_BTN} onClick={() => ledgerHandlersRef.current.handleCancelEdit()}><X className="h-4 w-4" /> 取消</button>
            </div>
          );
        }
        return (
          <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button type="button" title="编辑" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 ring-1 ring-slate-200/80 transition-colors hover:bg-slate-100" onClick={() => ledgerHandlersRef.current.handleCopyRowToDraft(row.original)}><Pencil className="h-4 w-4" /></button>
            <button type="button" title="删除" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-red-600 ring-1 ring-red-200/80 transition-colors hover:bg-red-50" onClick={() => ledgerHandlersRef.current.handleDeleteTransaction(tx.id)}><Trash2 className="h-4 w-4" /></button>
          </div>
        );
      },
    },
  ], [editingTxId, editingBuffer, kindFilterOptions]);

  const ledgerTable = useReactTable({
    data: ledgerRows,
    columns: ledgerColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      sorting: [{ id: 'date', desc: true }],
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

  // ---- Switch chain handlers ----
  function buildChainId() {
    const rand = Math.random().toString(36).slice(2, 8);
    return `chain-${Date.now().toString(36)}-${rand}`;
  }

  function handleAddSwitchChain() {
    const newId = buildChainId();
    setExpandedChains((prev) => {
      const next = new Set(prev);
      next.add(newId);
      return next;
    });
    setLedger((prev) => {
      const list = Array.isArray(prev.switchChains) ? prev.switchChains : [];
      const next = { id: newId, name: '', legs: [{ buyTxId: '', sellTxId: '' }] };
      return { ...prev, switchChains: [...list, next] };
    });
  }

  function handleUpdateSwitchChain(chainId, updater) {
    setLedger((prev) => {
      const list = Array.isArray(prev.switchChains) ? prev.switchChains : [];
      const nextList = list.map((c) => {
        if (c.id !== chainId) return c;
        const draft = typeof updater === 'function' ? updater(c) : { ...c, ...updater };
        return { ...c, ...draft };
      });
      return { ...prev, switchChains: nextList };
    });
  }

  function handleDeleteSwitchChain(chainId) {
    setExpandedChains((prev) => {
      if (!prev.has(chainId)) return prev;
      const next = new Set(prev);
      next.delete(chainId);
      return next;
    });
    setLedger((prev) => {
      const list = Array.isArray(prev.switchChains) ? prev.switchChains : [];
      return { ...prev, switchChains: list.filter((c) => c.id !== chainId) };
    });
  }

  function toggleChainExpanded(chainId) {
    setExpandedChains((prev) => {
      const next = new Set(prev);
      if (next.has(chainId)) next.delete(chainId);
      else next.add(chainId);
      return next;
    });
  }

  function handleAddChainLeg(chainId) {
    handleUpdateSwitchChain(chainId, (chain) => ({
      legs: [...(chain.legs || []), { buyTxId: '', sellTxId: '' }]
    }));
  }

  function handleRemoveChainLeg(chainId, legIndex) {
    handleUpdateSwitchChain(chainId, (chain) => ({
      legs: (chain.legs || []).filter((_, i) => i !== legIndex)
    }));
  }

  function handleSetChainLeg(chainId, legIndex, patch) {
    handleUpdateSwitchChain(chainId, (chain) => ({
      legs: (chain.legs || []).map((leg, i) => (i === legIndex ? { ...leg, ...patch } : leg))
    }));
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
      const newPairId = normalized.switchPairId || '';
      const remap = (tx) => {
        // 如果原配对对手不再被选中，清除它们反向的 switchPairId
        if (previousPairId && previousPairId !== newPairId && tx.id === previousPairId && tx.switchPairId === normalized.id) {
          return { ...tx, switchPairId: '' };
        }
        // 新选中的对手：同步反向指向为当前 tx
        if (newPairId && tx.id === newPairId) {
          return { ...tx, switchPairId: normalized.id };
        }
        return tx;
      };
      if (draftMode === 'edit') {
        return {
          ...prev,
          transactions: list.map((tx) => (tx.id === normalized.id ? normalized : remap(tx)))
        };
      }
      return { ...prev, transactions: [...list.map(remap), normalized] };
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
    if (editingTxId === txId) {
      setEditingTxId('');
      setEditingBuffer(null);
    }
    showActionToast('交易已删除', 'success');
    return true;
  }

  function handleStartEdit(row) {
    setEditingTxId(row.tx.id);
    setEditingBuffer(transactionToDraft(row.tx));
  }

  function handleCancelEdit() {
    setEditingTxId('');
    setEditingBuffer(null);
  }

  function handleEditFieldChange(field, value) {
    setEditingBuffer((prev) => {
      if (!prev) return prev;
      if (field === 'code') {
        return { ...prev, code: sanitizeCodeInput(value) };
      }
      if (field === 'price' || field === 'shares' || field === 'costPrice') {
        return { ...prev, [field]: sanitizeDecimalInput(value) };
      }
      return { ...prev, [field]: value };
    });
  }

  function handleCommitEdit() {
    if (!editingBuffer) return;
    const prepared = {
      ...editingBuffer,
      code: normalizeFundCode(editingBuffer.code),
      kind: normalizeFundKind(editingBuffer.kind, editingBuffer.code),
      price: Number(editingBuffer.price),
      shares: Number(editingBuffer.shares)
    };
    const errors = getTransactionErrors(prepared);
    if (Object.keys(errors).length) {
      showActionToast('保存失败', 'error', { description: summarizeTransactionErrors(errors) });
      return;
    }
    const normalized = normalizeTransaction({ ...prepared, id: editingBuffer.id });
    if (normalized.type === 'SELL') {
      const targetAgg = aggregateByCodeMap.get(normalized.code);
      let available = targetAgg ? targetAgg.totalShares : 0;
      const existing = transactions.find((tx) => tx.id === editingBuffer.id);
      if (existing && existing.code === normalized.code) {
        if (existing.type === 'SELL') available += existing.shares;
        else if (existing.type === 'BUY') available -= existing.shares;
      }
      const allowStandaloneCostPrice = normalized.costPrice > 0 && available <= 1e-6;
      if (!allowStandaloneCostPrice && normalized.shares > available + 1e-6) {
        showActionToast('保存失败', 'error', {
          description: `SELL 份额 ${formatShares(normalized.shares)} 超过当前持仓 ${formatShares(Math.max(available, 0))}。`
        });
        return;
      }
    }
    setLedger((prev) => ({
      ...prev,
      transactions: (prev.transactions || []).map((tx) => (tx.id === normalized.id ? normalized : tx))
    }));
    setEditingTxId('');
    setEditingBuffer(null);
    showActionToast('交易已更新', 'success', {
      description: `${normalized.code} ${normalized.type} ${formatShares(normalized.shares)} 份`
    });
  }

  function handleCopyRowToDraft(row) {
    setDraft(transactionToDraft(row.tx));
    setDraftMode('edit');
    setSidePanelTab('create');
    setSidePanelOpen(true);
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
    const header = ['基金代码', '基金名称', '标签', '总份额', '平均成本', '当前净值', '总市值', '总收益(元)', '总收益率', '当日收益(元)', '当日收益率'];
    const rows = filtered.map((agg) => {
      const kindLabel = agg.kind === 'exchange' ? '场内' : '场外';
      return [
        agg.code,
        agg.name || '',
        kindLabel,
        formatShares(agg.totalShares),
        formatNav(agg.avgCost),
        agg.hasLatestNav ? formatNav(agg.latestNav) : '',
        agg.hasLatestNav ? agg.marketValue.toFixed(2) : '',
        agg.hasLatestNav ? agg.unrealizedProfit.toFixed(2) : '',
        agg.hasLatestNav ? `${agg.unrealizedReturnRate.toFixed(2)}%` : '',
        agg.hasTodayNav ? agg.todayProfit.toFixed(2) : '',
        agg.hasTodayNav ? `${agg.todayReturnRate.toFixed(2)}%` : ''
      ].join('\t');
    });
    return { count: filtered.length, tsv: [header.join('\t'), ...rows].join('\n') };
  }

  function buildLedgerTsv() {
    const header = ['代码', '名称', '标签', '类型', '日期', '价', '份额', '备注', '切换标记'];
    const txById = new Map();
    (transactions || []).forEach((t) => { if (t && t.id) txById.set(t.id, t); });
    const rows = filteredRows.map(({ tx }) => {
      const kindLabel = tx.kind === 'exchange' ? '场内' : '场外';
      const pair = tx.switchPairId ? txById.get(tx.switchPairId) : null;
      let switchLabel = '';
      if (pair && pair.code && pair.code !== tx.code) {
        switchLabel = tx.type === 'SELL' ? `切换至 ${pair.code}` : `由 ${pair.code} 切换`;
      }
      return [
        tx.code,
        tx.name || '',
        kindLabel,
        tx.type,
        tx.date || '',
        formatNav(tx.price),
        formatShares(tx.shares),
        tx.note || '',
        switchLabel
      ].join('\t');
    });
    return { count: filteredRows.length, tsv: [header.join('\t'), ...rows].join('\n') };
  }

  async function handleCopyVisibleTable() {
    let payload;
    let label;
    if (mainViewTab === 'aggregate') {
      payload = buildAggregateTsv();
      label = '基金汇总';
    } else {
      payload = buildLedgerTsv();
      label = '成交流水';
    }
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
    // 移动端某些 WebView/手势层会出现「点击后 state 已更新，但 UI 不立即重绘」的情况，
    // 往往要等一次导航/返回（popstate）才把弹窗绘出来。这里强制同步 flush，确保立刻渲染。
    flushSync(() => setSwitchPickerOpen(true));
  }

  function closeSwitchPicker() {
    setSwitchPickerOpen(false);
  }

  function handleSelectSwitchCounterpart(txId) {
    handleDraftChange('switchPairId', txId || '');
    setSwitchPickerOpen(false);
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

  function renderKindFilter() {
    return (
      <div className="inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold text-slate-600">
        {KIND_FILTER_KEYS.map((key) => {
          const active = kindFilter === key;
          return (
            <button
              key={key}
              type="button"
              className={cx(
                'rounded-lg px-3 py-1.5 transition-colors',
                active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'hover:text-slate-800'
              )}
              onClick={() => setKindFilter(key)}
            >
              {KIND_FILTER_LABELS[key]}
              <span className="ml-1.5 text-[10px] text-slate-400">{kindCounts[key] ?? 0}</span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderNavStatusStrip() {
    const meta = ledger.lastNavMeta || {};
    const loading = navStatus === 'loading';
    const hasFailures = (meta.failureCount || 0) > 0;
    const failureLabel = hasFailures ? `净值同步有 ${meta.failureCount} 项失败` : '同步净值';
    return (
      <button
        type="button"
        onClick={handleManualRefresh}
        disabled={loading}
        aria-label={failureLabel}
        title={failureLabel}
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className={cx('h-3.5 w-3.5', loading && 'animate-spin')} />
        {hasFailures ? (
          <span
            aria-hidden
            className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 ring-2 ring-white"
          />
        ) : null}
      </button>
    );
  }

  function renderRow(row) {
    const { tx, metrics, snapshot } = row;
    const isEditing = editingTxId === tx.id;
    const kindTone = KIND_PILL_TONES[tx.kind] || 'slate';
    const kindLabel = KIND_LABELS[tx.kind] || '未知';
    const isSelected = selectedCode === tx.code;
    const snapshotError = snapshot?.error ? String(snapshot.error) : '';
    const rowKey = tx.id;
    const profitCellClass = metrics.unrealizedProfit > 0
      ? 'text-red-600'
      : metrics.unrealizedProfit < 0 ? 'text-emerald-600' : 'text-slate-700';
    const todayCellClass = metrics.todayProfit > 0
      ? 'text-red-600'
      : metrics.todayProfit < 0 ? 'text-emerald-600' : 'text-slate-700';

    if (isEditing && editingBuffer) {
      return (
        <tr key={rowKey} className="bg-indigo-50/40">
          <td className="px-2 py-2">
            <input
              className={EDITABLE_INPUT}
              value={editingBuffer.code}
              onChange={(event) => handleEditFieldChange('code', event.target.value)}
              placeholder="6 位代码"
              inputMode="numeric"
            />
          </td>
          <td className="px-2 py-2">
            <input
              className={EDITABLE_INPUT}
              value={editingBuffer.name}
              onChange={(event) => handleEditFieldChange('name', event.target.value)}
              placeholder="基金名称"
            />
          </td>
          <td className="px-2 py-2">
            <select
              className={EDITABLE_INPUT}
              value={editingBuffer.kind}
              onChange={(event) => handleEditFieldChange('kind', event.target.value)}
            >
              <option value="otc">场外</option>
              <option value="exchange">场内</option>
              <option value="qdii">QDII</option>
            </select>
          </td>
          <td className="px-2 py-2">
            <select
              className={EDITABLE_INPUT}
              value={editingBuffer.type}
              onChange={(event) => handleEditFieldChange('type', event.target.value)}
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </td>
          <td className="px-2 py-2">
            <input
              type="date"
              className={EDITABLE_INPUT}
              value={editingBuffer.date}
              onChange={(event) => handleEditFieldChange('date', event.target.value)}
            />
          </td>
          <td className="px-2 py-2">
            <input
              className={EDITABLE_INPUT}
              value={editingBuffer.price}
              onChange={(event) => handleEditFieldChange('price', event.target.value)}
              placeholder="0.0000"
              inputMode="decimal"
            />
          </td>
          <td className="px-2 py-2">
            <input
              className={EDITABLE_INPUT}
              value={editingBuffer.shares}
              onChange={(event) => handleEditFieldChange('shares', event.target.value)}
              placeholder="0.0000"
              inputMode="decimal"
            />
          </td>
          <td className="px-2 py-2 text-right" colSpan={LEDGER_COLUMN_COUNT - 8}>
            <div className="flex justify-end gap-1">
              <button type="button" className={SUBTLE_BTN} onClick={handleCommitEdit}>
                <Save className="h-4 w-4" /> 保存
              </button>
              <button type="button" className={SUBTLE_BTN} onClick={handleCancelEdit}>
                <X className="h-4 w-4" /> 取消
              </button>
            </div>
          </td>
          <td className="sticky right-0 z-10 bg-indigo-50/40 px-2 py-2 shadow-[-1px_0_0_rgba(15,23,42,0.06)]" />
        </tr>
      );
    }

    const sellProceeds = metrics.isSell ? metrics.proceeds : null;
    const marketOrProceeds = metrics.isSell
      ? formatCurrency(sellProceeds || 0, '¥', 2)
      : metrics.hasLatestNav ? formatCurrency(metrics.marketValue, '¥', 2) : '—';
    const profitDisplay = metrics.isSell
      ? '—'
      : metrics.hasLatestNav ? formatSignedCurrency(metrics.unrealizedProfit) : '—';
    const profitRateDisplay = metrics.isSell
      ? '—'
      : metrics.hasLatestNav ? formatSignedPercent(metrics.unrealizedReturnRate) : '—';
    const todayDisplay = metrics.isSell
      ? '—'
      : metrics.hasTodayNav ? formatSignedCurrency(metrics.todayProfit) : '—';
    const todayRateDisplay = metrics.isSell
      ? '—'
      : metrics.hasTodayNav ? formatSignedPercent(metrics.todayReturnRate) : '—';
    const marketOrProceedsLabelClass = metrics.isSell ? 'text-slate-500' : 'text-slate-700';

    return (
      <tr
        key={rowKey}
        className={cx(
          'cursor-pointer text-slate-700 transition-colors hover:bg-slate-50',
          isSelected && 'bg-indigo-50/50',
          !tx.date && 'border-l-2 border-amber-400'
        )}
        onClick={() => { setSelectedCode(tx.code); setSidePanelTab('summary'); }}
      >
        <td className={cx(
          'sticky left-0 z-10 whitespace-nowrap px-2 py-2 font-mono text-xs text-slate-800 shadow-[1px_0_0_rgba(15,23,42,0.06)]',
          isSelected ? 'bg-indigo-50/90' : 'bg-white'
        )}>{tx.code}</td>
        <td className="whitespace-nowrap px-2 py-2 text-xs">{tx.name || <span className="text-slate-400">—</span>}</td>
        <td className="px-2 py-2"><Pill tone={kindTone}>{kindLabel}</Pill></td>
        <td className="px-2 py-2">
          <span className={cx(
            'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
            tx.type === 'BUY' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
          )}>
            {tx.type}
          </span>
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-xs">
          {tx.date || <span className="text-amber-600">待补录</span>}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums">{formatNav(tx.price)}</td>
        <td className="whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums">{formatShares(tx.shares)}</td>
        <td className="whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums text-slate-700">
          {metrics.hasLatestNav ? formatNav(metrics.latestNav) : (snapshotError ? <span className="text-red-500">失败</span> : '—')}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-right text-[11px] text-slate-500">{metrics.latestNavDate || '—'}</td>
        <td className="whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums">{metrics.isSell ? '—' : formatShares(metrics.displayShares)}</td>
        <td className="whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums">{formatCurrency(metrics.costBasis, '¥', 2)}</td>
        <td className={cx('whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums', marketOrProceedsLabelClass)}>{marketOrProceeds}</td>
        <td className={cx('whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums', profitCellClass)}>{profitDisplay}</td>
        <td className={cx('whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums', profitCellClass)}>{profitRateDisplay}</td>
        <td className={cx('whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums', todayCellClass)}>{todayDisplay}</td>
        <td className={cx('whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums', todayCellClass)}>{todayRateDisplay}</td>
        <td className="whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums text-slate-500">
          {metrics.hasPreviousNav ? formatNav(metrics.previousNav) : '—'}
        </td>
        <td className={cx(
          'sticky right-0 z-10 whitespace-nowrap px-2 py-2 shadow-[-1px_0_0_rgba(15,23,42,0.06)]',
          isSelected ? 'bg-indigo-50/90' : 'bg-white'
        )}>
          <div className="flex justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
            <button type="button" title="编辑" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 ring-1 ring-slate-200/80 transition-colors hover:bg-slate-100 hover:text-slate-900" onClick={() => handleCopyRowToDraft(row)}>
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" title="删除" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-red-600 ring-1 ring-red-200/80 transition-colors hover:bg-red-50 hover:text-red-700" onClick={() => handleDeleteTransaction(tx.id)}>
            <Trash2 className="h-4 w-4" />
          </button>
          </div>
        </td>
      </tr>
    );
  }

  function renderAggregatesTable() {
    if (aggregatesTableData.length === 0) {
      const emptyHint = aggregates.length === 0
        ? '还没有交易记录。先录入第一笔交易建立持仓底账。'
        : '全部持仓已卖出。在「收益明细 · 清仓分析」可查看历史。';
      return (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-200 bg-white px-6 py-16 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
            <Wallet className="h-8 w-8" />
          </div>
          <h3 className="mb-2 text-base font-semibold text-slate-900">{aggregates.length === 0 ? '暂无交易记录' : '暂无当前持仓'}</h3>
          <p className="mb-6 max-w-xs text-sm leading-6 text-slate-500">{aggregates.length === 0 ? '添加你的第一笔交易，开始追踪投资组合收益与风险敞口。' : emptyHint}</p>
          {aggregates.length === 0 ? (
            <button type="button" className={primaryButtonClass} onClick={() => { resetDraft(emptyDraft({ type: 'BUY' })); setSidePanelTab('create'); setSidePanelOpen(true); }}>
              <Plus className="h-4 w-4" />录入第一笔交易
            </button>
          ) : null}
        </div>
      );
    }
    const filteredAggs = aggregatesTable.getFilteredRowModel().rows.map((r) => r.original);
    let sumMarketValue = 0;
    let sumTotalCost = 0;
    let sumTotalProfit = 0;
    let sumTodayProfit = 0;
    let sumPreviousValue = 0;
    let pricedCount = 0;
    let todayCount = 0;
    for (const agg of filteredAggs) {
      if (agg.hasLatestNav) {
        sumMarketValue += Number(agg.marketValue) || 0;
        sumTotalCost += Number(agg.totalCost) || 0;
        sumTotalProfit += Number(agg.unrealizedProfit) || 0;
        pricedCount += 1;
      }
      if (agg.hasTodayNav) {
        sumTodayProfit += Number(agg.todayProfit) || 0;
        sumPreviousValue += Number(agg.previousValue) || 0;
        todayCount += 1;
      }
    }
    const summaryTotalReturnRate = sumTotalCost > 0 ? (sumTotalProfit / sumTotalCost) * 100 : null;
    const summaryTodayReturnRate = sumPreviousValue > 0 ? (sumTodayProfit / sumPreviousValue) * 100 : null;
    const totalReturnTone = summaryTotalReturnRate == null
      ? ''
      : summaryTotalReturnRate > 0 ? 'text-rose-600' : summaryTotalReturnRate < 0 ? 'text-emerald-600' : '';
    const todayReturnTone = summaryTodayReturnRate == null
      ? ''
      : summaryTodayReturnRate > 0 ? 'text-rose-600' : summaryTodayReturnRate < 0 ? 'text-emerald-600' : '';
    const totalProfitTone = sumTotalProfit > 0 ? 'text-rose-600' : sumTotalProfit < 0 ? 'text-emerald-600' : '';
    const todayProfitTone = sumTodayProfit > 0 ? 'text-rose-600' : sumTodayProfit < 0 ? 'text-emerald-600' : '';
    const aggregatesFooterRow = {
      code: <span className="text-xs font-semibold text-slate-700">合计</span>,
      name: <span className="text-xs text-muted-foreground">{filteredAggs.length} 只持仓</span>,
      marketValue: pricedCount > 0
        ? <span className="tabular-nums font-semibold">{formatCurrency(sumMarketValue, '¥', 2)}</span>
        : <span className="text-muted-foreground">—</span>,
      unrealizedProfit: pricedCount > 0
        ? <span className={cx('tabular-nums font-semibold', totalProfitTone)}>{formatSignedCurrency(sumTotalProfit, 2)}</span>
        : <span className="text-muted-foreground">—</span>,
      unrealizedReturnRate: summaryTotalReturnRate != null
        ? <span className={cx('tabular-nums font-semibold', totalReturnTone)}>{formatSignedPercent(summaryTotalReturnRate)}</span>
        : <span className="text-muted-foreground">—</span>,
      todayProfit: todayCount > 0
        ? <span className={cx('tabular-nums font-semibold', todayProfitTone)}>{formatSignedCurrency(sumTodayProfit, 2)}</span>
        : <span className="text-muted-foreground">—</span>,
      todayReturnRate: summaryTodayReturnRate != null
        ? <span className={cx('tabular-nums font-semibold', todayReturnTone)}>{formatSignedPercent(summaryTodayReturnRate)}</span>
        : <span className="text-muted-foreground">—</span>,
    };
    return (
      <div className="flex flex-col gap-2">
        <DataTableToolbar table={aggregatesTable} />
        <DataTable
          table={aggregatesTable}
          footerRow={aggregatesFooterRow}
          resizable
          onRowClick={(row) => {
            setSelectedCode(row.original.code);
            setSidePanelTab('summary');
            setSidePanelOpen(true);
          }}
        />
      </div>
    );
  }


  function renderLedgerTable() {
    if (ledgerRows.length === 0) {
      return (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-200 bg-white px-6 py-14 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
            <Wallet className="h-8 w-8" />
          </div>
          <h3 className="mb-2 text-base font-semibold text-slate-900">暂无交易流水</h3>
          <p className="mb-6 max-w-xs text-sm leading-6 text-slate-500">点「新增交易」或「批量导入」录入，支持 OCR / Excel 粘贴。</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" className={primaryButtonClass} onClick={() => { resetDraft(emptyDraft({ type: 'BUY' })); setSidePanelTab('create'); setSidePanelOpen(true); }}>
              <Plus className="h-4 w-4" />录入交易流水
            </button>
            <button type="button" className={secondaryButtonClass} onClick={openPasteModal}>
              <ClipboardPaste className="h-4 w-4" />批量导入
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        <DataTableToolbar table={ledgerTable} />
        <DataTable table={ledgerTable} resizable />
      </div>
    );
  }

  function renderSwitchChainView() {
    const buyTxs = transactions
      .filter((tx) => tx.type === 'BUY')
      .slice()
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.code.localeCompare(b.code));
    const sellTxs = transactions
      .filter((tx) => tx.type === 'SELL')
      .slice()
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.code.localeCompare(b.code));
    const txById = new Map();
    for (const tx of transactions) txById.set(tx.id, tx);

    function txOptionLabel(tx) {
      const dateLabel = tx.date || '日期待补';
      const namePart = tx.name ? ` ${tx.name}` : '';
      return `${tx.code}${namePart} · ${dateLabel} · ${formatNav(tx.price)} × ${formatShares(tx.shares)}`;
    }

    const headerRow = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-3xl text-xs leading-relaxed text-slate-500">
          自由拼接切换链路（如 a → b → c → a）。每段为持仓期间净值变化 = 卖价/买价（末段可选「持有至今」用最新净值）。<br />
          链路收益率 = 每段乘积 − 1；未切换基准为“一直持有首段基金”到链路终点的变化。默认全额切换，未考虑部分切换。
        </div>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-indigo-600 px-3.5 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition-colors hover:bg-indigo-500"
          onClick={handleAddSwitchChain}
        >
          <Plus className="h-3.5 w-3.5" />
          新建链路
        </button>
      </div>
    );

    if (!switchChains.length) {
      return (
        <div className="space-y-4 px-2 py-3">
          {headerRow}
          <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 text-center text-sm text-slate-500">
            <Wallet className="h-7 w-7 text-slate-300" />
            暂无基金切换记录，发生一笔跳转后会自动生成。
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4 px-2 py-3">
        {headerRow}
        {switchChainMetrics.map(({ chain, metrics }) => {
          const valid = metrics.valid;
          const advantageTone = !valid
            ? 'text-slate-400'
            : metrics.advantage > 0
              ? 'text-red-600'
              : metrics.advantage < 0 ? 'text-emerald-600' : 'text-slate-700';
          const chainTone = !valid
            ? 'text-slate-400'
            : metrics.chainReturn > 0
              ? 'text-red-600'
              : metrics.chainReturn < 0 ? 'text-emerald-600' : 'text-slate-700';
          const baselineTone = !valid
            ? 'text-slate-400'
            : metrics.baselineReturn > 0
              ? 'text-red-600'
              : metrics.baselineReturn < 0 ? 'text-emerald-600' : 'text-slate-700';
          const isExpanded = expandedChains.has(chain.id);
          const legCount = (chain.legs || []).length;
          const pathCodes = (chain.legs || []).map((leg) => {
            const t = leg.buyTxId ? txById.get(leg.buyTxId) : null;
            return t ? t.code : '?';
          });
          const lastLeg = chain.legs && chain.legs.length ? chain.legs[chain.legs.length - 1] : null;
          if (lastLeg) {
            if (lastLeg.sellTxId) {
              const sellT = txById.get(lastLeg.sellTxId);
              pathCodes.push(sellT ? sellT.code : '?');
            } else if (lastLeg.buyTxId) {
              pathCodes.push('持有');
            }
          }
          const pathSummary = pathCodes.length ? pathCodes.join(' → ') : '尚未配置任何段';
          return (
            <div
              key={chain.id}
              className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleChainExpanded(chain.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChainExpanded(chain.id); } }}
                className={cx(
                  'flex flex-wrap items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-slate-50/60',
                  isExpanded ? 'border-b border-slate-100' : ''
                )}
              >
                <ChevronDown className={cx('h-4 w-4 flex-none text-slate-400 transition-transform', !isExpanded && '-rotate-90')} />
                <div className="min-w-[180px] flex-1">
                  <div className="truncate text-sm font-semibold text-slate-800">
                    {chain.name || '未命名链路'}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500">{pathSummary}</div>
                </div>
                <div className="flex items-center gap-5 text-xs">
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">链路收益率</div>
                    <div className={cx('font-semibold tabular-nums', chainTone)}>
                      {metrics.valid ? formatSignedPercent(metrics.chainReturn * 100) : '—'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">切换优势</div>
                    <div className={cx('font-semibold tabular-nums', advantageTone)}>
                      {metrics.valid ? formatSignedPercent(metrics.advantage * 100) : '—'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">段数</div>
                    <div className="font-semibold tabular-nums text-slate-700">{legCount}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50"
                  onClick={(e) => { e.stopPropagation(); handleDeleteSwitchChain(chain.id); }}
                  title="删除链路"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </button>
              </div>
              {isExpanded ? (
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
                <input
                  className={cx(tableInputClass, 'h-8 flex-1 min-w-[200px] rounded-lg border-slate-200 bg-slate-50 px-2 text-sm hover:bg-white')}
                  value={chain.name}
                  placeholder="链路名称（可选），例如：场内纳指 159660 → 159501 → 513100"
                  onChange={(e) => handleUpdateSwitchChain(chain.id, { name: e.target.value })}
                />
              </div>
              ) : null}
              {isExpanded ? (
              <>
              <div className="px-4 py-3 space-y-3">
                {(chain.legs || []).map((leg, legIndex) => {
                  const buyTx = leg.buyTxId ? txById.get(leg.buyTxId) : null;
                  const sellTx = leg.sellTxId ? txById.get(leg.sellTxId) : null;
                  const seg = metrics.segments && metrics.segments[legIndex] ? metrics.segments[legIndex] : null;
                  const segTone = !seg || !seg.valid
                    ? 'text-slate-400'
                    : seg.segReturn > 0 ? 'text-red-600' : seg.segReturn < 0 ? 'text-emerald-600' : 'text-slate-700';
                  const buyButtonLabel = buyTx ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="font-mono font-semibold text-slate-800">{buyTx.code}</span>
                      {buyTx.name ? <span className="truncate text-slate-500">{buyTx.name}</span> : null}
                      <span className="text-slate-400">· {buyTx.date || '待补日'}</span>
                      <span className="tabular-nums text-slate-500">@ {formatNav(buyTx.price)} × {formatShares(buyTx.shares)}</span>
                    </span>
                  ) : <span className="text-slate-400">选择买入交易 (BUY)…</span>;
                  const sellButtonLabel = !buyTx ? (
                    <span className="text-slate-300">请先选择买入交易</span>
                  ) : sellTx ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="font-mono font-semibold text-slate-800">{sellTx.code}</span>
                      {sellTx.name ? <span className="truncate text-slate-500">{sellTx.name}</span> : null}
                      <span className="text-slate-400">· {sellTx.date || '待补日'}</span>
                      <span className="tabular-nums text-slate-500">@ {formatNav(sellTx.price)} × {formatShares(sellTx.shares)}</span>
                    </span>
                  ) : <span className="text-amber-600">持有至今（用最新净值）</span>;
                  return (
                    <div key={legIndex} className="rounded-xl border border-slate-100 bg-slate-50/40 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex h-6 min-w-[44px] items-center justify-center rounded-full bg-slate-200 px-2 text-[11px] font-semibold text-slate-700">段 {legIndex + 1}</span>
                        <button
                          type="button"
                          className="inline-flex h-8 min-w-[260px] flex-1 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left text-xs text-slate-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
                          onClick={() => { setChainPicker({ chainId: chain.id, legIndex, role: 'buy' }); setChainPickerSearch(''); }}
                        >
                          <span className="flex-1 truncate">{buyButtonLabel}</span>
                          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                        </button>
                        <span className="text-xs text-slate-400">→</span>
                        <button
                          type="button"
                          className="inline-flex h-8 min-w-[260px] flex-1 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left text-xs text-slate-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:hover:border-slate-200"
                          disabled={!buyTx}
                          onClick={() => { setChainPicker({ chainId: chain.id, legIndex, role: 'sell' }); setChainPickerSearch(''); }}
                        >
                          <span className="flex-1 truncate">{sellButtonLabel}</span>
                          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center justify-center rounded-lg px-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-500"
                          onClick={() => handleRemoveChainLeg(chain.id, legIndex)}
                          title="删除该段"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {seg ? (
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-1 text-[11px] text-slate-500">
                          <span>代码：<span className="font-mono text-slate-700">{seg.code}</span></span>
                          <span>买：{seg.buyDate || '—'} @ {formatNav(seg.buyPrice)}</span>
                          <span>卖：{seg.sellDate || '—'} @ {formatNav(seg.sellPrice)}{seg.segEndSource === 'latestNav' ? <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-600">最新净值</span> : null}</span>
                          <span className={cx('font-semibold tabular-nums', segTone)}>变化 {seg.valid ? formatSignedPercent(seg.segReturn * 100) : '—'}</span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200"
                  onClick={() => handleAddChainLeg(chain.id)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加一段
                </button>
              </div>
              <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
                {!metrics.valid && metrics.validationError ? (
                  <div className="mb-2 flex items-start gap-1.5 text-xs text-amber-600">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                    <span>{metrics.validationError}</span>
                  </div>
                ) : null}
                {!metrics.valid && !metrics.validationError && metrics.missingPriceCodes.length ? (
                  <div className="mb-2 flex items-start gap-1.5 text-xs text-amber-600">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                    <span>缺少净值：{metrics.missingPriceCodes.join('、')}（请先在「基金汇总」刷新最新净值）。</span>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">链路收益率</div>
                    <div className={cx('mt-1 text-base font-semibold tabular-nums', chainTone)}>
                      {metrics.valid ? formatSignedPercent(metrics.chainReturn * 100) : '—'}
                    </div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">乘积 {metrics.valid ? metrics.chainMultiple.toFixed(4) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">未切换基准{metrics.baselineCode ? <span className="ml-1 font-mono text-slate-500">({metrics.baselineCode})</span> : null}</div>
                    <div className={cx('mt-1 text-base font-semibold tabular-nums', baselineTone)}>
                      {metrics.valid ? formatSignedPercent(metrics.baselineReturn * 100) : '—'}
                    </div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                      {metrics.valid ? `${formatNav(metrics.baselineStartPrice)} → ${formatNav(metrics.baselineEndPrice)}` : '—'}
                      {metrics.baselineEndSource === 'latestNav' ? <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-600">最新净值</span> : null}
                      {metrics.baselineAlignedToChainEnd ? <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-600">完美对齐</span> : null}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">切换优势</div>
                    <div className={cx('mt-1 text-base font-semibold tabular-nums', advantageTone)}>
                      {metrics.valid ? `${formatSignedPercent(metrics.advantage * 100)}` : '—'}
                    </div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">链路 − 未切换</div>
                  </div>
                </div>
                <div className="mt-3 border-t border-dashed border-slate-200 pt-3">
                  <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    <span>份额延续口径（实际盈亏·元）</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-slate-500">首段资金滚动·志脱费</span>
                  </div>
                  {metrics.cashFlowValid ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <div className="text-[11px] text-slate-500">链路实际盈亏</div>
                        <div className={cx('mt-0.5 text-sm font-semibold tabular-nums', metrics.chainProfit > 0 ? 'text-red-600' : metrics.chainProfit < 0 ? 'text-emerald-600' : 'text-slate-700')}>
                          {formatSignedCurrency(metrics.chainProfit)}
                        </div>
                        <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                          末值 {formatCurrency(metrics.chainFinalValue, '¥', 2)} · {formatSignedPercent(metrics.chainProfitRate * 100)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">未切换盈亏</div>
                        <div className={cx('mt-0.5 text-sm font-semibold tabular-nums', metrics.baselineProfit > 0 ? 'text-red-600' : metrics.baselineProfit < 0 ? 'text-emerald-600' : 'text-slate-700')}>
                          {formatSignedCurrency(metrics.baselineProfit)}
                        </div>
                        <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                          末值 {formatCurrency(metrics.baselineFinalValue, '¥', 2)} · 初投入 {formatCurrency(metrics.initialCapital, '¥', 2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">切换优势（元）</div>
                        <div className={cx('mt-0.5 text-sm font-semibold tabular-nums', metrics.advantageProfit > 0 ? 'text-red-600' : metrics.advantageProfit < 0 ? 'text-emerald-600' : 'text-slate-700')}>
                          {formatSignedCurrency(metrics.advantageProfit)}
                        </div>
                        <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">链路盈亏 − 未切换盈亏</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400">{metrics.cashFlowNote || '仅在链路有效且首段买入份额 > 0 时可计算。'}</div>
                  )}
                </div>
              </div>
              </>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  function renderSummaryPanel() {
    if (!selectedAggregate) {
      return (
        <div className="text-sm text-slate-500">

        </div>
      );
    }
    const agg = selectedAggregate;
    const profitTone = agg.unrealizedProfit > 0 ? 'text-red-600' : agg.unrealizedProfit < 0 ? 'text-emerald-600' : 'text-slate-700';
    const todayTone = agg.todayProfit > 0 ? 'text-red-600' : agg.todayProfit < 0 ? 'text-emerald-600' : 'text-slate-700';
    return (
      <div className="space-y-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">当前基金</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-base font-bold text-slate-900">{agg.code}</span>
            <Pill tone={KIND_PILL_TONES[agg.kind] || 'slate'}>{KIND_LABELS[agg.kind] || '未知'}</Pill>
          </div>
          {agg.name ? <div className="mt-1 text-sm text-slate-600">{agg.name}</div> : null}
        </div>
        <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">净份额</dt>
            <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">
              {formatShares(agg.totalShares)}
              {agg.pendingSellShares > 0 ? (
                <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-600" title={agg.kind === 'qdii' ? 'QDII 赎回：T 日净值由 T+1 晚公布，T+2 确认后自动扣减' : '场外赎回：T 日晚公布 NAV，T+1 确认后自动扣减'}>
                  卖出{formatShares(agg.pendingSellShares)} 份待确认
                </span>
              ) : null}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">加权均价</dt>
            <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">{formatNav(agg.avgCost)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总成本</dt>
            <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">{formatCurrency(agg.totalCost, '¥', 2)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总市值</dt>
            <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">{agg.hasLatestNav ? formatCurrency(agg.marketValue, '¥', 2) : '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">累计盈亏</dt>
            <dd className={cx('mt-1 min-w-0 truncate whitespace-nowrap tabular-nums', profitTone)}>
              {agg.hasLatestNav ? `${formatSignedCurrency(agg.unrealizedProfit)} (${formatSignedPercent(agg.unrealizedReturnRate)})` : '—'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">今日盈亏</dt>
            <dd className={cx('mt-1 min-w-0 truncate whitespace-nowrap tabular-nums', todayTone)}>
              {agg.hasTodayNav ? `${formatSignedCurrency(agg.todayProfit)} (${formatSignedPercent(agg.todayReturnRate)})` : '—'}
              {agg.hasTodayNav && agg.todayProfitHolidayDays > 0 ? (
                <sup
                  className="ml-1 inline-block rounded-sm bg-amber-50 px-1 py-px align-super text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200"
                  title={`跨越节假日：${agg.previousNavDate} → ${agg.latestNavDate}（共 ${agg.todayProfitSpanDays} 天，含 ${agg.todayProfitHolidayDays} 个法定假期工作日）。该「今日盈亏」为整段空窗的累计涨跌，非单日波动。`}
                >跨节{agg.todayProfitSpanDays}日</sup>
              ) : null}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">BUY 总份额</dt>
            <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">{formatShares(agg.buyShares)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">SELL 总份额</dt>
            <dd className="mt-1 min-w-0 truncate whitespace-nowrap tabular-nums text-slate-900">{formatShares(agg.sellShares)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">首买日期</dt>
            <dd className="mt-1 text-slate-700">{agg.firstBuyDate || '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">最新交易</dt>
            <dd className="mt-1 text-slate-700">{agg.lastTxDate || '—'}</dd>
          </div>
        </dl>
        {agg.snapshotError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            净值获取失败：{agg.snapshotError}
          </div>
        ) : null}
        <button
          type="button"
          className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
          onClick={(event) => navigateToMarkets(event, agg.code)}
        >
          <ExternalLink className="h-4 w-4" />查看行情详情
        </button>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            className="flex-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500"
            onClick={() => openBuyOrSellFromSummary(agg, 'BUY')}
          >
            <Plus className="h-4 w-4" />买入
          </button>
          <button
            type="button"
            className="flex-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-500"
            onClick={() => openBuyOrSellFromSummary(agg, 'SELL')}
          >
            <Minus className="h-4 w-4" />卖出
          </button>
        </div>
      </div>
    );
  }

  function renderDraftPanel() {
    const errors = getTransactionErrors({
      ...draft,
      code: normalizeFundCode(draft.code),
      price: Number(draft.price || 0),
      shares: Number(draft.shares || 0)
    }, { ignoreBlank: true });
    const oppositeType = draft.type === 'BUY' ? 'SELL' : 'BUY';
    const draftCodeNormalized = normalizeFundCode(draft.code);
    const switchUsedIds = new Set(
      transactions
        .map((tx) => String(tx.switchPairId || '').trim())
        .filter(Boolean),
    );
    const switchCandidates = transactions
      .filter((tx) => (
        tx.id !== draft.id
        && tx.type === oppositeType
        && tx.code
        && tx.code !== draftCodeNormalized
        // 只允许选择“从未参与任何切换配对”的对手方：
        // - 自己没有 switchPairId（没主动指向别人）
        // - 也没被别人 switchPairId 指向（没作为别人的对手方）
        && !tx.switchPairId
        && !switchUsedIds.has(tx.id)
      ))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const isSwitchOn = Boolean(draft.switchPairId);
    const pairedCounterpart = draft.switchPairId ? transactions.find((tx) => tx.id === draft.switchPairId) : null;
    const pairedMissing = Boolean(draft.switchPairId) && !pairedCounterpart;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {draftMode === 'edit' ? '编辑交易' : '新增交易'}
          </div>
          {draftMode === 'edit' ? (
            <button type="button" className={SUBTLE_BTN} onClick={() => resetDraft()}>
              <X className="h-3.5 w-3.5" /> 取消
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-1 text-xs text-slate-500">
            代码
            <input
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.code}
              onChange={(event) => handleDraftChange('code', event.target.value)}
              placeholder="如 021000"
              inputMode="numeric"
            />
          </label>
          <label className="col-span-1 text-xs text-slate-500">
            名称
            <input
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.name}
              onChange={(event) => handleDraftChange('name', event.target.value)}
              placeholder="如 长信电子信息"
            />
          </label>
          <label className="col-span-1 text-xs text-slate-500">
            标签
            <select
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.kind}
              onChange={(event) => handleDraftChange('kind', event.target.value)}
            >
              <option value="otc">场外</option>
              <option value="exchange">场内</option>
              <option value="qdii">QDII</option>
            </select>
          </label>
          <label className="col-span-1 text-xs text-slate-500">
            类型
            <select
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.type}
              onChange={(event) => handleDraftChange('type', event.target.value)}
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </label>
          <label className="col-span-2 text-xs text-slate-500">
            日期
            <input
              type="date"
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.date}
              onChange={(event) => handleDraftChange('date', event.target.value)}
            />
          </label>
          <label className="col-span-1 text-xs text-slate-500">
            {draft.kind === 'exchange' ? '价格（成交价·选填）' : '价格（净值·选填）'}
            <input
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.price}
              onChange={(event) => handleDraftChange('price', event.target.value)}
              placeholder="0.0000"
              inputMode="decimal"
            />
          </label>
          <label className="col-span-1 text-xs text-slate-500">
            份额 *
            <input
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.shares}
              onChange={(event) => handleDraftChange('shares', event.target.value)}
              placeholder="0.0000"
              inputMode="decimal"
            />
          </label>
          {draft.kind !== 'exchange' ? (
            <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    checked={Boolean(draft.before3pm)}
                    onChange={(event) => handleDraftChange('before3pm', event.target.checked)}
                  />
                  三点前交易
                </label>
              </div>
              <div className="mt-1.5 text-[10px] text-slate-500">
                {draft.kind === 'qdii'
                  ? (draft.before3pm
                      ? 'QDII：T 日 15:00 前提交，按 T 日净值计算；T 日净值需等 T+1 晚公布，T+2 确认。'
                      : 'QDII：T 日 15:00 后提交，顺延为 T+1 申赎，按 T+1 净值计算（T+2 晚公布，T+3 确认）。')
                  : (draft.before3pm
                      ? '场外：T 日 15:00 前提交，按 T 日净值（T 日晚公布），T+1 确认。'
                      : '场外：T 日 15:00 后提交，顺延为 T+1 申赎，按 T+1 净值（T+1 晚公布），T+2 确认。')}
              </div>
            </div>
          ) : null}
          {draft.type === 'SELL' ? (
            <label className="col-span-2 text-xs text-slate-500">
              买入成本价（可选，已卖出快速登记）
              <input
                className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
                value={draft.costPrice || ''}
                onChange={(event) => handleDraftChange('costPrice', event.target.value)}
                placeholder="留空则按已有买入流水的加权平均成本"
                inputMode="decimal"
              />
              <span className="mt-1 block text-[10px] text-slate-400">未录入买入流水时填入此处，自动结算 (卖价 − 成本) × 份额，不占用持仓。</span>
            </label>
          ) : null}
          <div className="col-span-2 rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-indigo-700">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                checked={isSwitchOn}
                onChange={(event) => {
                  if (!event.target.checked) {
                    handleDraftChange('switchPairId', '');
                  } else if (switchCandidates.length) {
                    handleDraftChange('switchPairId', switchCandidates[0].id);
                  }
                }}
              />
              <span>这是一笔基金切换</span>
              <span className="ml-auto text-[10px] font-normal text-indigo-500/80">与反向交易配对</span>
            </label>
            {isSwitchOn ? (
              <div className="mt-2 space-y-1.5">
                {switchCandidates.length === 0 && !pairedCounterpart && !pairedMissing ? (
                  <div className="rounded-lg bg-white px-2.5 py-2 text-[11px] text-slate-500">
                    暂无可配对的{oppositeType === 'BUY' ? '买入' : '卖出'}交易。需先创建一笔不同代码、未被配对的对手交易。
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {pairedCounterpart ? (
                      <div className="flex min-w-[200px] flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] text-slate-700 ring-1 ring-indigo-100">
                        <span className="font-mono font-semibold text-slate-800">{pairedCounterpart.code}</span>
                        {pairedCounterpart.name ? <span className="truncate text-slate-500">{pairedCounterpart.name}</span> : null}
                        <Pill tone={KIND_PILL_TONES[pairedCounterpart.kind] || 'slate'}>{KIND_LABELS[pairedCounterpart.kind] || '未知'}</Pill>
                        <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-semibold', pairedCounterpart.type === 'BUY' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{pairedCounterpart.type}</span>
                        <span className="text-slate-500">{pairedCounterpart.date || '待补录'}</span>
                        <span className="ml-auto tabular-nums text-slate-600">{formatShares(pairedCounterpart.shares)}份 × {formatNav(pairedCounterpart.price)}</span>
                      </div>
                    ) : pairedMissing ? (
                      <div className="flex-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">原配对交易已丢失，请重新选择</div>
                    ) : (
                      <div className="flex-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] text-slate-500">尚未选择对手方交易</div>
                    )}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500"
                      onPointerUp={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openSwitchPicker();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openSwitchPicker();
                      }}
                    >
                      <Search className="h-3 w-3" />
                      {pairedCounterpart || pairedMissing ? '更换' : '选择对手方'}
                    </button>
                    {pairedCounterpart || pairedMissing ? (
                      <button
                        type="button"
                        className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
                        onClick={() => handleDraftChange('switchPairId', '')}
                      >
                        清除
                      </button>
                    ) : null}
                  </div>
                )}
                <div className="px-1 text-[10px] text-slate-500">
                  打开后两笔交易会互相关联，“已卖出”列表中会标识切换去向，从而能在持仓总览里看到资金流转。
                </div>
              </div>
            ) : null}
          </div>
          <label className="col-span-2 text-xs text-slate-500">
            备注
            <input
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.note}
              onChange={(event) => handleDraftChange('note', event.target.value)}
              placeholder="可选"
            />
          </label>
        </div>
        {Object.keys(errors).length ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
            {summarizeTransactionErrors(errors)}
          </div>
        ) : null}
        <button type="button" className={PRIMARY_BTN + ' w-full'} onClick={submitDraft}>
          <Save className="h-4 w-4" />
          保存交易
        </button>
        {/* v6.2: edit 模式下在编辑面板底部提供删除按钮，
            点击后调 handleDeleteTransaction（带 confirm），成功则关闭 sidePanel。
            这样在交易记录子页点明细 → 弹出面板 → 可直接删除，不需剩主页的行内删除按钮。*/}
        {draftMode === 'edit' && draft.id ? (
          <button
            type="button"
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-white text-sm font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 hover:ring-red-300"
            onClick={() => {
              const ok = handleDeleteTransaction(draft.id);
              if (ok) {
                setSidePanelOpen(false);
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
            删除该交易
          </button>
        ) : null}
      </div>
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
          copyTitle: mainViewTab === 'aggregate' ? '复制基金汇总为 TSV' : '复制成交流水为 TSV',
        }}
      />
      {incomeRoute === ROUTES.OVERVIEW ? (<>
      <div className="grid grid-cols-1 gap-4">
        <section className="min-w-0 rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          {/* v7.1: 「复制表格 / + 新增交易」已合并到 IncomeSummary hero 行右侧，原 hidden sm:flex header strip 一并移除（及其 px-4 py-3 border-b）。 */}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleOcrFile} />
          <div className="min-h-[480px] px-1">
            {mainViewTab === 'aggregate' ? renderAggregatesTable() : renderLedgerTable()}
          </div>
          <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            {mainViewTab === 'aggregate'
              ? `持仓中 ${portfolio.assetCount} 只基金；累计 ${ledgerRows.length} 笔流水。`
              : `共 ${ledgerRows.length} 笔流水；当前筛选 ${filteredRows.length} 笔。`}
          </div>
        </section>
      </div>
      {pasteModalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4 py-6" onClick={closePasteModal}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <div className="text-sm font-bold text-slate-900">从 Excel 粘贴交易流水</div>
                <div className="mt-0.5 text-xs text-slate-500">支持 TSV / CSV；自动识别表头（代码 / 名称 / 类型 / 日期 / 价 / 份额），没有表头则按列序映射。</div>
              </div>
              <button type="button" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" onClick={closePasteModal}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
              <textarea
                className="h-40 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 outline-none transition-colors focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                placeholder={'从 Excel 选中单元格复制后粘贴在这里。\n例：\n代码\t名称\t场内场外\t类型\t日期\t价\t份额\n021000\t景顺长城纳斯达克\t场外\tBUY\t2026-04-16\t1.5345\t100'}
                value={pasteText}
                onChange={(event) => { setPasteText(event.target.value); setPasteResult(null); }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={GHOST_BTN} onClick={handleParsePaste}>
                  <Search className="h-4 w-4" />
                  解析预览
                </button>
                {pasteResult ? (
                  <div className="text-xs text-slate-500">
                    共 {pasteResult.rows.length} 行，分隔符 {pasteResult.delimiter}，{pasteResult.headerDetected ? '已识别表头' : '按位置映射'}。
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">默认列顺序：代码 · 名称 · 场内场外 · 类型 · 日期 · 价 · 份额 · 备注</div>
                )}
              </div>
              {pasteResult && pasteResult.rows.length ? (
                (() => {
                  const totalRows = pasteResult.rows.length;
                  const safeIndex = Math.min(Math.max(pastePreviewIndex, 0), totalRows - 1);
                  const row = pasteResult.rows[safeIndex];
                  const ok = Object.keys(row.errors).length === 0;
                  const invalidCount = pasteResult.rows.filter((r) => Object.keys(r.errors).length > 0).length;
                  const goPrev = () => setPastePreviewIndex((i) => Math.max(0, i - 1));
                  const goNext = () => setPastePreviewIndex((i) => Math.min(totalRows - 1, i + 1));
                  return (
                    <div className="space-y-3">
                      {totalRows > 1 ? (
                        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-1.5">
                          <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={goPrev} disabled={safeIndex <= 0} aria-label="上一条">
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <div className="flex flex-col items-center text-center">
                            <div className="text-xs font-semibold text-slate-700 tabular-nums">第 {safeIndex + 1} / {totalRows} 条</div>
                            <div className="text-[10px] text-slate-500">{invalidCount > 0 ? `含 ${invalidCount} 行无效将被跳过` : '全部有效'}</div>
                          </div>
                          <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={goNext} disabled={safeIndex >= totalRows - 1} aria-label="下一条">
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2">
                        {ok ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />有效，将导入</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600"><AlertTriangle className="h-3.5 w-3.5" />仅试用，将被跳过</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="col-span-1 text-xs text-slate-500">
                          代码
                          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3 font-mono')} value={row.draft.code || ''} onChange={(e) => handlePasteRowFieldChange(row.index, 'code', e.target.value)} placeholder="6 位" inputMode="numeric" maxLength={6} />
                        </label>
                        <label className="col-span-1 text-xs text-slate-500">
                          名称
                          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.name || ''} onChange={(e) => handlePasteRowFieldChange(row.index, 'name', e.target.value)} placeholder="基金名称" />
                        </label>
                        <label className="col-span-1 text-xs text-slate-500">
                          标签
                          <select className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.kind || 'otc'} onChange={(e) => handlePasteRowFieldChange(row.index, 'kind', e.target.value)}>
                            <option value="otc">场外</option>
                            <option value="exchange">场内</option>
                            <option value="qdii">QDII</option>
                          </select>
                        </label>
                        <label className="col-span-1 text-xs text-slate-500">
                          类型
                          <select className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.type || 'BUY'} onChange={(e) => handlePasteRowFieldChange(row.index, 'type', e.target.value)}>
                            <option value="BUY">BUY</option>
                            <option value="SELL">SELL</option>
                          </select>
                        </label>
                        <label className="col-span-2 text-xs text-slate-500">
                          日期
                          <input type="date" className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3', row.draft.date ? '' : 'border-amber-200 text-amber-700')} value={row.draft.date || ''} onChange={(e) => handlePasteRowFieldChange(row.index, 'date', e.target.value)} />
                        </label>
                        <label className="col-span-1 text-xs text-slate-500">
                          价格（净值）
                          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.price || ''} onChange={(e) => handlePasteRowFieldChange(row.index, 'price', e.target.value)} placeholder="0.0000" inputMode="decimal" />
                        </label>
                        <label className="col-span-1 text-xs text-slate-500">
                          份额
                          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.shares || ''} onChange={(e) => handlePasteRowFieldChange(row.index, 'shares', e.target.value)} placeholder="0.0000" inputMode="decimal" />
                        </label>
                      </div>
                      {!ok ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                          {summarizeTransactionErrors(row.errors)}
                        </div>
                      ) : null}
                    </div>
                  );
                })()
              ) : null}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <div className="text-xs text-slate-500">
                {pasteResult
                  ? `将导入 ${pasteResult.rows.filter((row) => Object.keys(row.errors).length === 0).length} 笔有效交易`
                  : ''}
              </div>
              <div className="flex gap-2">
                <button type="button" className={GHOST_BTN} onClick={closePasteModal}>取消</button>
                <button
                  type="button"
                  className={PRIMARY_BTN}
                  onClick={handleImportPasted}
                  disabled={!pasteResult || !pasteResult.rows.some((row) => Object.keys(row.errors).length === 0)}
                >
                  <Save className="h-4 w-4" />
                  导入有效行
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {ocrModalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4 py-6" onClick={closeOcrModal}>
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900">从截图识别交易流水</div>
                <div className="mt-0.5 text-[11px] text-slate-500">识别后可逐行编辑、补录字段，确认后再写入流水（默认 BUY）。</div>
              </div>
              <button type="button" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" onClick={closeOcrModal}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={SUBTLE_BTN}
                  onClick={handleTriggerOcr}
                  disabled={ocrState.status === 'loading'}
                >
                  {ocrState.status === 'loading' ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileImage className="h-3.5 w-3.5" />
                  )}
                  {ocrPreview ? '重新上传' : '选择截图文件'}
                </button>
                {ocrState.status === 'loading' ? (
                  <div className="text-[11px] text-slate-500">{ocrState.message || '正在识别…'}{ocrState.progress ? ` · ${Math.round(ocrState.progress)}%` : ''}</div>
                ) : ocrPreview ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                    {ocrPreview.fileName ? <span className="max-w-[180px] truncate font-mono text-slate-600" title={ocrPreview.fileName}>{ocrPreview.fileName}</span> : null}
                    <span>{ocrPreview.rows.length} 行</span>
                    {ocrPreview.model ? <span className="max-w-[180px] truncate text-slate-400" title={ocrPreview.model}>· {ocrPreview.model}</span> : null}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">支持 PNG / JPG；默认 BUY 草稿，可在下方逐行编辑、补录。</div>
                )}
              </div>
              {ocrState.status === 'error' && ocrState.error ? (
                <div className="rounded-lg border border-red-100 bg-red-50/70 px-3 py-1.5 text-[11px] text-red-600">{ocrState.error}</div>
              ) : null}
              {ocrPreview && Array.isArray(ocrPreview.warnings) && ocrPreview.warnings.length ? (() => {
                const total = ocrPreview.warnings.length;
                const visible = ocrWarningsExpanded ? ocrPreview.warnings : ocrPreview.warnings.slice(0, 2);
                return (
                  <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-1.5 text-[11px] text-amber-700">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold">识别提醒·{total} 条</div>
                      {total > 2 ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-amber-700 underline-offset-2 hover:underline"
                          onClick={() => setOcrWarningsExpanded((prev) => !prev)}
                        >
                          {ocrWarningsExpanded ? '收起' : `展开全部 ${total} 条`}
                        </button>
                      ) : null}
                    </div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {visible.map((warn, idx) => (
                        <li key={idx}>{String(warn)}</li>
                      ))}
                    </ul>
                  </div>
                );
              })() : null}
              {ocrPreview && ocrPreview.rows.length ? (
                (() => {
                  const totalRows = ocrPreview.rows.length;
                  const safeIndex = Math.min(Math.max(ocrPreviewIndex, 0), totalRows - 1);
                  const row = ocrPreview.rows[safeIndex];
                  const ok = Object.keys(row.errors).length === 0;
                  const invalidCount = ocrPreview.rows.filter((r) => Object.keys(r.errors).length > 0).length;
                  const goPrev = () => setOcrPreviewIndex((i) => Math.max(0, i - 1));
                  const goNext = () => setOcrPreviewIndex((i) => Math.min(totalRows - 1, i + 1));
                  return (
                    <div className="space-y-3">
                      {totalRows > 1 ? (
                        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-1.5">
                          <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={goPrev} disabled={safeIndex <= 0} aria-label="上一条">
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <div className="flex flex-col items-center text-center">
                            <div className="text-xs font-semibold text-slate-700 tabular-nums">第 {safeIndex + 1} / {totalRows} 条</div>
                            <div className="text-[10px] text-slate-500">{invalidCount > 0 ? `含 ${invalidCount} 行无效将被跳过` : '全部有效'}</div>
                          </div>
                          <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={goNext} disabled={safeIndex >= totalRows - 1} aria-label="下一条">
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2">
                        {ok ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />有效，将导入</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600"><AlertTriangle className="h-3.5 w-3.5" />仅试用，将被跳过</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="col-span-1 text-xs text-slate-500">
                          代码
                          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3 font-mono')} value={row.draft.code || ''} onChange={(e) => handleOcrRowFieldChange(row.index, 'code', e.target.value)} placeholder="6 位" inputMode="numeric" maxLength={6} />
                        </label>
                        <label className="col-span-1 text-xs text-slate-500">
                          名称
                          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.name || ''} onChange={(e) => handleOcrRowFieldChange(row.index, 'name', e.target.value)} placeholder="基金名称" />
                        </label>
                        <label className="col-span-1 text-xs text-slate-500">
                          标签
                          <select className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.kind || 'otc'} onChange={(e) => handleOcrRowFieldChange(row.index, 'kind', e.target.value)}>
                            <option value="otc">场外</option>
                            <option value="exchange">场内</option>
                            <option value="qdii">QDII</option>
                          </select>
                        </label>
                        <label className="col-span-1 text-xs text-slate-500">
                          类型
                          <select className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.type || 'BUY'} onChange={(e) => handleOcrRowFieldChange(row.index, 'type', e.target.value)}>
                            <option value="BUY">BUY</option>
                            <option value="SELL">SELL</option>
                          </select>
                        </label>
                        <label className="col-span-2 text-xs text-slate-500">
                          日期
                          <input type="date" className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3', row.draft.date ? '' : 'border-amber-200 text-amber-700')} value={row.draft.date || ''} onChange={(e) => handleOcrRowFieldChange(row.index, 'date', e.target.value)} />
                        </label>
                        <label className="col-span-1 text-xs text-slate-500">
                          价格（净值）
                          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.price || ''} onChange={(e) => handleOcrRowFieldChange(row.index, 'price', e.target.value)} placeholder="0.0000" inputMode="decimal" />
                        </label>
                        <label className="col-span-1 text-xs text-slate-500">
                          份额
                          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.shares || ''} onChange={(e) => handleOcrRowFieldChange(row.index, 'shares', e.target.value)} placeholder="0.0000" inputMode="decimal" />
                        </label>
                      </div>
                      {!ok ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                          {summarizeTransactionErrors(row.errors)}
                        </div>
                      ) : null}
                    </div>
                  );
                })()
              ) : ocrPreview ? (
                <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-6 py-6 text-center text-[11px] text-slate-500">
                  <FileImage className="h-6 w-6 text-slate-300" />
                  <div>该截图未识别出有效行，请换一张更清晰的截图后重试。</div>
                </div>
              ) : (
                <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-6 py-6 text-center text-[11px] text-slate-500">
                  <CloudUpload className="h-6 w-6 text-slate-300" />
                  <div />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5">
              <div className="text-[11px] text-slate-500">
                {ocrPreview
                  ? `将导入 ${ocrPreview.rows.filter((row) => Object.keys(row.errors).length === 0).length} / ${ocrPreview.rows.length} 行`
                  : ''}
              </div>
              <div className="flex gap-2">
                <button type="button" className={GHOST_BTN} onClick={closeOcrModal}>取消</button>
                <button
                  type="button"
                  className={PRIMARY_BTN}
                  onClick={handleImportOcr}
                  disabled={!ocrPreview || !ocrPreview.rows.some((row) => Object.keys(row.errors).length === 0)}
                >
                  <Save className="h-4 w-4" />
                  导入有效行
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {switchPickerOpen ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 px-4 py-6" onClick={closeSwitchPicker}>
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <div className="text-sm font-bold text-slate-900">选择基金切换对手方</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  当前是 <span className="font-mono font-semibold text-slate-700">{draft.code || '—'}</span>{draft.name ? <> · {draft.name}</> : null} · {draft.type}，下方列出可配对的 <span className="font-semibold text-slate-700">{draft.type === 'BUY' ? '卖出' : '买入'}</span> 交易（不同代码、未被其他切换占用）。
                </div>
              </div>
              <button type="button" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" onClick={closeSwitchPicker}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="搜索代码或名称…"
                  value={switchPickerSearch}
                  onChange={(event) => setSwitchPickerSearch(event.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {(() => {
                const oppType = draft.type === 'BUY' ? 'SELL' : 'BUY';
                const draftCode = normalizeFundCode(draft.code);
                const filterText = switchPickerSearch.trim().toLowerCase();
                const candidates = transactions
                  .filter((tx) => (
                    tx.id !== draft.id
                    && tx.type === oppType
                    && tx.code
                    && tx.code !== draftCode
                    && (!tx.switchPairId || tx.switchPairId === draft.id)
                  ))
                  .filter((tx) => {
                    if (!filterText) return true;
                    const code = String(tx.code || '').toLowerCase();
                    const name = String(tx.name || '').toLowerCase();
                    return code.includes(filterText) || name.includes(filterText);
                  })
                  .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
                if (candidates.length === 0) {
                  return (
                    <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 px-6 py-10 text-center text-xs text-slate-500">
                      <Wallet className="h-8 w-8 text-slate-300" />
                      {filterText
                        ? `没有匹配 “${switchPickerSearch}” 的对手方交易。`
                        : `暂无可配对的${oppType === 'BUY' ? '买入' : '卖出'}交易。需先创建一笔不同代码、未被配对的对手交易。`}
                    </div>
                  );
                }
                return (
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <tr>
                        <th className="px-3 py-2">代码</th>
                        <th className="px-3 py-2">名称</th>
                        <th className="px-3 py-2">标签</th>
                        <th className="px-3 py-2">类型</th>
                        <th className="px-3 py-2">日期</th>
                        <th className="px-3 py-2 text-right">价</th>
                        <th className="px-3 py-2 text-right">份额</th>
                        <th className="px-3 py-2 text-right">金额</th>
                        <th className="px-3 py-2 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {candidates.map((tx) => {
                        const isSelected = draft.switchPairId === tx.id;
                        const amount = (Number(tx.shares) || 0) * (Number(tx.price) || 0);
                        return (
                          <tr
                            key={tx.id}
                            className={cx(
                              'cursor-pointer text-slate-700 transition-colors hover:bg-indigo-50/60',
                              isSelected && 'bg-indigo-50/80'
                            )}
                            onClick={() => handleSelectSwitchCounterpart(tx.id)}
                          >
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-slate-800">{tx.code}</td>
                            <td className="px-3 py-2 text-xs">{tx.name || <span className="text-slate-400">—</span>}</td>
                            <td className="px-3 py-2"><Pill tone={KIND_PILL_TONES[tx.kind] || 'slate'}>{KIND_LABELS[tx.kind] || '未知'}</Pill></td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs">
                              <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-semibold', tx.type === 'BUY' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{tx.type}</span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs">{tx.date || <span className="text-amber-600">待补录</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">{formatNav(tx.price)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">{formatShares(tx.shares)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-700">{formatCurrency(amount, '¥', 2)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right">
                              {isSelected ? (
                                <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white"><CheckCircle2 className="h-3 w-3" />已选</span>
                              ) : (
                                <span className="inline-flex items-center rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-indigo-600 ring-1 ring-indigo-100">选择</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              <div />
              <button type="button" className={GHOST_BTN} onClick={closeSwitchPicker}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
      {chainPicker ? (() => {
        const ctx = chainPicker;
        const targetChain = (ledger.switchChains || []).find((c) => c.id === ctx.chainId);
        const targetLeg = targetChain && targetChain.legs ? targetChain.legs[ctx.legIndex] : null;
        const buyTx = targetLeg && targetLeg.buyTxId ? transactions.find((tx) => tx.id === targetLeg.buyTxId) : null;
        const isBuyRole = ctx.role === 'buy';
        const oppType = isBuyRole ? 'BUY' : 'SELL';
        const filterText = chainPickerSearch.trim().toLowerCase();
        const close = () => { setChainPicker(null); setChainPickerSearch(''); };
        const candidates = transactions
          .filter((tx) => {
            if (tx.type !== oppType) return false;
            if (!tx.code) return false;
            if (!isBuyRole && buyTx) {
              if (tx.code !== buyTx.code) return false;
              if (buyTx.date && tx.date && tx.date < buyTx.date) return false;
              if (tx.id === buyTx.id) return false;
            }
            return true;
          })
          .filter((tx) => {
            if (!filterText) return true;
            const code = String(tx.code || '').toLowerCase();
            const name = String(tx.name || '').toLowerCase();
            return code.includes(filterText) || name.includes(filterText);
          })
          .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.code.localeCompare(b.code));
        const currentSelectedId = isBuyRole ? (targetLeg?.buyTxId || '') : (targetLeg?.sellTxId || '');
        const handlePick = (txId) => {
          if (isBuyRole) {
            handleSetChainLeg(ctx.chainId, ctx.legIndex, { buyTxId: txId, sellTxId: '' });
          } else {
            handleSetChainLeg(ctx.chainId, ctx.legIndex, { sellTxId: txId });
          }
          close();
        };
        return (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 px-4 py-6" onClick={close}>
            <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    {isBuyRole ? `选择第 ${ctx.legIndex + 1} 段的买入交易` : `选择第 ${ctx.legIndex + 1} 段的卖出交易`}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {isBuyRole
                      ? '列出所有 BUY 交易。选中后会重置本段卖出项。'
                      : (
                        <>仅列出 <span className="font-mono font-semibold text-slate-700">{buyTx?.code || '—'}</span>{buyTx?.name ? <> · {buyTx.name}</> : null} 的 SELL 交易（日期 ≥ 买入日{buyTx?.date ? ` ${buyTx.date}` : ''}）。也可选择「持有至今」。</>
                      )}
                  </div>
                </div>
                <button type="button" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" onClick={close}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    placeholder="搜索代码或名称…"
                    value={chainPickerSearch}
                    onChange={(event) => setChainPickerSearch(event.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                {(candidates.length === 0 && (isBuyRole || !buyTx)) ? (
                  <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 px-6 py-10 text-center text-xs text-slate-500">
                    <Wallet className="h-8 w-8 text-slate-300" />
                    {filterText
                      ? `没有匹配 “${chainPickerSearch}” 的 ${isBuyRole ? '买入' : '卖出'}交易。`
                      : `暂无可选的 ${isBuyRole ? '买入' : '卖出'}交易。`}
                  </div>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <tr>
                        <th className="px-3 py-2">代码</th>
                        <th className="px-3 py-2">名称</th>
                        <th className="px-3 py-2">标签</th>
                        <th className="px-3 py-2">类型</th>
                        <th className="px-3 py-2">日期</th>
                        <th className="px-3 py-2 text-right">价</th>
                        <th className="px-3 py-2 text-right">份额</th>
                        <th className="px-3 py-2 text-right">金额</th>
                        <th className="px-3 py-2 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {!isBuyRole && buyTx ? (
                        <tr
                          className={cx(
                            'cursor-pointer text-slate-700 transition-colors hover:bg-amber-50/60',
                            currentSelectedId === '' && 'bg-amber-50/80'
                          )}
                          onClick={() => handlePick('')}
                        >
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-amber-700">{buyTx.code}</td>
                          <td className="px-3 py-2 text-xs text-slate-600" colSpan={6}>持有至今（使用最新净值作为本段终点）</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            {currentSelectedId === '' ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white"><CheckCircle2 className="h-3 w-3" />已选</span>
                            ) : (
                              <span className="inline-flex items-center rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-amber-600 ring-1 ring-amber-200">选择</span>
                            )}
                          </td>
                        </tr>
                      ) : null}
                      {candidates.map((tx) => {
                        const isSelected = currentSelectedId === tx.id;
                        const amount = (Number(tx.shares) || 0) * (Number(tx.price) || 0);
                        return (
                          <tr
                            key={tx.id}
                            className={cx(
                              'cursor-pointer text-slate-700 transition-colors hover:bg-indigo-50/60',
                              isSelected && 'bg-indigo-50/80'
                            )}
                            onClick={() => handlePick(tx.id)}
                          >
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-slate-800">{tx.code}</td>
                            <td className="px-3 py-2 text-xs">{tx.name || <span className="text-slate-400">—</span>}</td>
                            <td className="px-3 py-2"><Pill tone={KIND_PILL_TONES[tx.kind] || 'slate'}>{KIND_LABELS[tx.kind] || '未知'}</Pill></td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs">
                              <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-semibold', tx.type === 'BUY' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{tx.type}</span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs">{tx.date || <span className="text-amber-600">待补录</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">{formatNav(tx.price)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">{formatShares(tx.shares)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-700">{formatCurrency(amount, '¥', 2)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right">
                              {isSelected ? (
                                <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white"><CheckCircle2 className="h-3 w-3" />已选</span>
                              ) : (
                                <span className="inline-flex items-center rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-indigo-600 ring-1 ring-indigo-100">选择</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                <div />
                <button type="button" className={GHOST_BTN} onClick={close}>关闭</button>
              </div>
            </div>
          </div>
        );
      })() : null}
      </>) : null}
      {/* v6.1 fix: sidePanel 是 fixed overlay 全局 modal，必须在 OVERVIEW Fragment 外渲染，
          否则在 TRANSACTIONS 子页点击行编辑时不出现，要跳主页才能看到。*/}
      {sidePanelOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="holdings-side-panel-title"
          onClick={() => setSidePanelOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSidePanelOpen(false);
          }}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div id="holdings-side-panel-title" className="text-sm font-bold text-slate-900">
                {sidePanelTab === 'summary'
                  ? '该基金汇总'
                  : draftMode === 'edit' ? '编辑交易' : '新增交易'}
              </div>
              <button
                type="button"
                aria-label="关闭弹层"
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setSidePanelOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
              <div>
                {sidePanelTab === 'summary' ? renderSummaryPanel() : renderDraftPanel()}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  return content;
}

export default HoldingsExperience;
