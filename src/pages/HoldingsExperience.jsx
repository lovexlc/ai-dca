import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  CloudUpload,
  Copy,
  FileImage,
  FileUp,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Wallet,
  X
} from 'lucide-react';
import { formatCurrency, formatPercent } from '../app/accumulation.js';
import {
  aggregateByCode,
  buildLedgerRows,
  buildSoldLots,
  detectFundKind,
  getLedgerCodeList,
  getTransactionErrors,
  normalizeFundCode,
  normalizeFundKind,
  normalizeTransaction,
  parseExcelPaste,
  summarizePortfolio,
  summarizeSoldLots,
  summarizeTransactionErrors
} from '../app/holdingsLedgerCore.js';
import {
  buildNavMetaFromResult,
  mergeSnapshotsFromNavResult,
  persistLedgerState,
  readLedgerState,
  recognizeLedgerFile,
  requestLedgerNav
} from '../app/holdingsLedger.js';
import { showActionToast } from '../app/toast.js';
import {
  Pill,
  cx,
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
  formatRelativeTime,
  formatShares,
  formatSignedCurrency,
  formatSignedPercent,
  nowIso,
  sanitizeCodeInput,
  sanitizeDecimalInput,
  transactionToDraft
} from '../app/holdingsHelpers.js';


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
  const [pasteResult, setPasteResult] = useState(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [switchPickerOpen, setSwitchPickerOpen] = useState(false);
  const [switchPickerSearch, setSwitchPickerSearch] = useState('');

  const fileInputRef = useRef(null);
  const autoNavTriggeredRef = useRef(false);
  const importMenuRef = useRef(null);


  // ---- Persist changes to localStorage whenever ledger state changes ----
  useEffect(() => {
    persistLedgerState(ledger);
  }, [ledger]);

  // ---- Derived data ----
  const transactions = ledger.transactions;
  const snapshotsByCode = ledger.snapshotsByCode;
  const ledgerRows = useMemo(
    () => buildLedgerRows(transactions, snapshotsByCode),
    [transactions, snapshotsByCode]
  );
  const aggregates = useMemo(
    () => aggregateByCode(transactions, snapshotsByCode),
    [transactions, snapshotsByCode]
  );
  const portfolio = useMemo(() => summarizePortfolio(aggregates), [aggregates]);
  const aggregateByCodeMap = useMemo(() => {
    const map = new Map();
    for (const agg of aggregates) map.set(agg.code, agg);
    return map;
  }, [aggregates]);
  const soldLots = useMemo(() => buildSoldLots(transactions), [transactions]);
  const soldSummary = useMemo(() => summarizeSoldLots(soldLots), [soldLots]);

  // 基金切换收益差：用与《基金切换》tab 同样的公式计算。
  // stayValue   = 原基金卖出份额 × 原基金现净值        (如果不卖，持有到现在的市值)
  // switchedValue = 新基金买入份额 × 新基金现净值    (切换后持有到现在的市值)
  // extraCash   = max(buyAmount - sellProceeds, 0)        (切换时额外追加的现金)
  // switchAdvantage = switchedValue - stayValue - extraCash  (切换相对于不动的额外收益)
  // 切换收益率 = switchAdvantage / stayValue
  const switchInsightByLotId = useMemo(() => {
    const txById = new Map();
    for (const tx of transactions) txById.set(tx.id, tx);
    const map = new Map();
    for (const lot of soldLots) {
      if (!lot.isSwitch) continue;
      const pairTx = txById.get(lot.switchPairId);
      if (!pairTx) continue;
      const srcSnap = snapshotsByCode?.[lot.code] || null;
      const tgtSnap = snapshotsByCode?.[pairTx.code] || null;
      const srcPrice = Number(srcSnap?.latestNav) || 0;
      const tgtPrice = Number(tgtSnap?.latestNav) || 0;
      const srcDate = String(srcSnap?.latestNavDate || '');
      const tgtDate = String(tgtSnap?.latestNavDate || '');
      const hasPrices = srcPrice > 0 && tgtPrice > 0;
      const stayValue = Math.round(srcPrice * lot.sellShares * 100) / 100;
      const switchedValue = Math.round(tgtPrice * pairTx.shares * 100) / 100;
      const extraCash = Number(lot.switchExtraCash) || 0;
      const switchAdvantage = Math.round((switchedValue - stayValue - extraCash) * 100) / 100;
      const advantageRate = stayValue > 0
        ? Math.round(((switchAdvantage / stayValue) * 100) * 100) / 100
        : 0;
      const missingPriceCodes = [
        ...(srcPrice > 0 ? [] : [lot.code]),
        ...(tgtPrice > 0 ? [] : [pairTx.code])
      ];
      map.set(lot.id, {
        hasPrices,
        srcPrice,
        tgtPrice,
        srcDate,
        tgtDate,
        stayValue,
        switchedValue,
        extraCash,
        switchAdvantage,
        advantageRate,
        missingPriceCodes,
        pairCode: pairTx.code,
        pairName: pairTx.name || '',
        pairShares: pairTx.shares,
        pairPrice: pairTx.price
      });
    }
    return map;
  }, [soldLots, transactions, snapshotsByCode]);

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
    const counts = { all: ledgerRows.length, otc: 0, exchange: 0 };
    for (const row of ledgerRows) {
      if (row.tx.kind === 'otc') counts.otc += 1;
      else if (row.tx.kind === 'exchange') counts.exchange += 1;
    }
    return counts;
  }, [ledgerRows]);

  const selectedAggregate = selectedCode ? aggregateByCodeMap.get(selectedCode) : null;
  const needsDateBackfill = useMemo(
    () => transactions.some((tx) => !tx.date),
    [transactions]
  );
  const migrationNoticeVisible = Boolean(ledger.migratedFromLegacy) && needsDateBackfill;

  // ---- NAV auto-refresh on mount ----
  useEffect(() => {
    if (autoNavTriggeredRef.current) return;
    const codes = getLedgerCodeList(transactions);
    if (!codes.length) return;
    autoNavTriggeredRef.current = true;
    void refreshNavForCodes(codes, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const navResult = await requestLedgerNav(safeCodes);
      const { snapshotsByCode: mergedSnapshots, errors } = mergeSnapshotsFromNavResult(ledger.snapshotsByCode, navResult);
      const nextMeta = buildNavMetaFromResult(navResult, errors);
      setLedger((prev) => ({
        ...prev,
        snapshotsByCode: mergedSnapshots,
        lastNavMeta: nextMeta
      }));
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
      if (!silent) {
        showActionToast('净值刷新', 'error', { description: error?.message || '净值服务暂时不可用。' });
      }
    }
  }

  function handleManualRefresh() {
    const codes = getLedgerCodeList(transactions);
    void refreshNavForCodes(codes, { silent: false });
  }

  // ---- Draft (quick add) handlers ----
  function resetDraft(nextDraft = emptyDraft()) {
    setDraft(nextDraft);
    setDraftMode('create');
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
      return { ...prev, [field]: value };
    });
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
    // 带 costPrice 的 SELL 是“已卖出快速登记”，不占用持仓，跳过份额校验。
    if (normalized.type === 'SELL' && !(normalized.costPrice > 0)) {
      const targetAgg = aggregateByCodeMap.get(normalized.code);
      let available = targetAgg ? targetAgg.totalShares : 0;
      if (draftMode === 'edit' && draft.id) {
        const existing = transactions.find((tx) => tx.id === draft.id);
        if (existing && existing.code === normalized.code) {
          if (existing.type === 'SELL') available += existing.shares;
          else if (existing.type === 'BUY') available -= existing.shares;
        }
      }
      if (normalized.shares > available + 1e-6) {
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
    if (!txId) return;
    const tx = transactions.find((item) => item.id === txId);
    if (!tx) return;
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && !window.confirm(`确认删除 ${tx.code} ${tx.type} ${formatShares(tx.shares)} 份？`)) {
      return;
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
    if (normalized.type === 'SELL' && !(normalized.costPrice > 0)) {
      const targetAgg = aggregateByCodeMap.get(normalized.code);
      let available = targetAgg ? targetAgg.totalShares : 0;
      const existing = transactions.find((tx) => tx.id === editingBuffer.id);
      if (existing && existing.code === normalized.code) {
        if (existing.type === 'SELL') available += existing.shares;
        else if (existing.type === 'BUY') available -= existing.shares;
      }
      if (normalized.shares > available + 1e-6) {
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
        agg.hasLatestNav ? agg.totalProfit.toFixed(2) : '',
        agg.hasLatestNav ? `${agg.totalReturnRate.toFixed(2)}%` : '',
        (agg.hasLatestNav && agg.hasPreviousNav) ? agg.todayProfit.toFixed(2) : '',
        (agg.hasLatestNav && agg.hasPreviousNav) ? `${agg.todayReturnRate.toFixed(2)}%` : ''
      ].join('\t');
    });
    return { count: filtered.length, tsv: [header.join('\t'), ...rows].join('\n') };
  }

  function buildSoldTsv() {
    const filtered = soldLots.filter((lot) => {
      if (kindFilter !== 'all' && lot.kind !== kindFilter) return false;
      if (!searchNeedle) return true;
      return lot.code.toLowerCase().includes(searchNeedle)
        || (lot.name || '').toLowerCase().includes(searchNeedle);
    });
    const header = ['基金代码', '基金名称', '标签', '卖出日期', '卖出份额', '卖出价', '平均成本', '成本金额', '卖出金额', '已实现收益(元)', '已实现收益率', '切换标记'];
    const rows = filtered.map((lot) => {
      const kindLabel = lot.kind === 'exchange' ? '场内' : '场外';
      const switchLabel = lot.isSwitch ? `切换至 ${lot.switchTargetCode}` : '';
      return [
        lot.code,
        lot.name || '',
        kindLabel,
        lot.sellDate || '',
        formatShares(lot.sellShares),
        formatNav(lot.sellPrice),
        lot.hasAvgCost ? formatNav(lot.avgCost) : '',
        lot.hasAvgCost ? lot.costBasis.toFixed(2) : '',
        lot.proceeds.toFixed(2),
        lot.hasAvgCost ? lot.realizedProfit.toFixed(2) : '',
        lot.hasAvgCost ? `${lot.realizedReturnRate.toFixed(2)}%` : '',
        switchLabel
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
    } else if (mainViewTab === 'sold') {
      payload = buildSoldTsv();
      label = '已卖出';
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
      if (!drafts.length) {
        setOcrState(createOcrState({
          status: 'error',
          error: '未能识别出有效的持仓记录，请重试或手动录入。'
        }));
        showActionToast('OCR 导入', 'error', { description: '未能识别出有效的持仓记录。' });
        return;
      }
      setLedger((prev) => ({
        ...prev,
        transactions: [...(prev.transactions || []), ...drafts]
      }));
      setOcrState(createOcrState({
        status: 'success',
        progress: 100,
        message: `已导入 ${drafts.length} 条 BUY 草稿，请补录交易日期。`,
        recordCount: drafts.length
      }));
      showActionToast('OCR 导入', 'success', { description: `已导入 ${drafts.length} 条 BUY 草稿，请补录交易日期。` });
    } catch (error) {
      setOcrState(createOcrState({
        status: 'error',
        error: error?.message || '识别失败，请稍后重试。'
      }));
      showActionToast('OCR 导入', 'error', { description: error?.message || '识别失败。' });
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

  // ---- Switch counterpart picker ----
  function openSwitchPicker() {
    setSwitchPickerSearch('');
    setSwitchPickerOpen(true);
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
  function renderPortfolioOverview() {
    const profitTone = portfolio.totalProfit > 0 ? 'emerald' : portfolio.totalProfit < 0 ? 'red' : 'slate';
    const todayTone = portfolio.todayProfit > 0 ? 'emerald' : portfolio.todayProfit < 0 ? 'red' : 'slate';
    const navIncomplete = portfolio.assetCount > 0 && portfolio.pricedCount < portfolio.assetCount;
    const lastUpdateDisplay = (() => {
      if (portfolio.latestSnapshotAt) {
        const ts = Date.parse(portfolio.latestSnapshotAt);
        if (Number.isFinite(ts)) {
          const d = new Date(ts);
          const pad = (n) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
      }
      return portfolio.latestNavDate || '尚未同步';
    })();
    const toneClass = {
      slate: 'text-slate-900',
      emerald: 'text-emerald-600',
      red: 'text-red-500',
      amber: 'text-amber-600'
    };
    const cards = [
      { label: '总市值', value: formatCurrency(portfolio.marketValue, '¥', 2), tone: 'slate' },
      { label: '总成本', value: formatCurrency(portfolio.totalCost, '¥', 2), tone: 'slate' },
      { label: '总收益', value: formatSignedCurrency(portfolio.totalProfit), tone: profitTone },
      { label: '总收益率', value: formatSignedPercent(portfolio.totalReturnRate), tone: profitTone },
      { label: '当日收益', value: formatSignedCurrency(portfolio.todayProfit), tone: todayTone },
      { label: '当日收益率', value: formatSignedPercent(portfolio.todayReturnRate), tone: todayTone },
      { label: '持仓数量', value: String(portfolio.assetCount), tone: 'slate' },
      { label: '最后更新', value: lastUpdateDisplay, tone: navIncomplete ? 'amber' : 'slate', small: true }
    ];
    return (
      <section className="rounded-2xl border border-slate-200/70 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">投资组合概览</div>
          <div className="text-[11px] text-slate-400">
            NAV 覆盖 {portfolio.pricedCount}/{portfolio.assetCount}
            {portfolio.failedCodes && portfolio.failedCodes.length > 0 ? ` · 失败 ${portfolio.failedCodes.length}` : ''}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {cards.map((card) => (
            <div key={card.label}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{card.label}</div>
              <div className={cx(
                'mt-1 font-extrabold tracking-tight tabular-nums',
                card.small ? 'text-base' : 'text-xl',
                toneClass[card.tone] || toneClass.slate
              )}>
                {card.value}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
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

  function renderNavBadge() {
    const meta = ledger.lastNavMeta || {};
    const refreshBtn = (
      <button
        type="button"
        onClick={handleManualRefresh}
        disabled={navStatus === 'loading'}
        title="刷新净值"
        aria-label="刷新净值"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw className={cx('h-3.5 w-3.5', navStatus === 'loading' && 'animate-spin')} />
      </button>
    );
    if (navStatus === 'loading') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          {refreshBtn}
          正在刷新净值
        </span>
      );
    }
    if (!meta.updatedAt) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          {refreshBtn}
          <AlertTriangle className="h-3.5 w-3.5" />
          尚未同步净值
        </span>
      );
    }
    if (meta.failureCount > 0) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-amber-600">
          {refreshBtn}
          <AlertTriangle className="h-3.5 w-3.5" />
          {`${formatRelativeTime(meta.updatedAt)} · ${meta.successCount} 成功 / ${meta.failureCount} 失败`}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        {refreshBtn}
        <CheckCircle2 className="h-3.5 w-3.5" />
        {`${formatRelativeTime(meta.updatedAt)} · ${meta.successCount} 条净值已同步`}
      </span>
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
    const profitCellClass = metrics.totalProfit > 0
      ? 'text-emerald-600'
      : metrics.totalProfit < 0 ? 'text-red-500' : 'text-slate-700';
    const todayCellClass = metrics.todayProfit > 0
      ? 'text-emerald-600'
      : metrics.todayProfit < 0 ? 'text-red-500' : 'text-slate-700';

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
                <Save className="h-3.5 w-3.5" /> 保存
              </button>
              <button type="button" className={SUBTLE_BTN} onClick={handleCancelEdit}>
                <X className="h-3.5 w-3.5" /> 取消
              </button>
            </div>
          </td>
          <td className="px-2 py-2" />
        </tr>
      );
    }

    const sellProceeds = metrics.isSell ? metrics.proceeds : null;
    const marketOrProceeds = metrics.isSell
      ? formatCurrency(sellProceeds || 0, '¥', 2)
      : metrics.hasLatestNav ? formatCurrency(metrics.marketValue, '¥', 2) : '—';
    const profitDisplay = metrics.isSell
      ? '—'
      : metrics.hasLatestNav ? formatSignedCurrency(metrics.totalProfit) : '—';
    const profitRateDisplay = metrics.isSell
      ? '—'
      : metrics.hasLatestNav ? formatSignedPercent(metrics.totalReturnRate) : '—';
    const todayDisplay = metrics.isSell
      ? '—'
      : (metrics.hasLatestNav && metrics.hasPreviousNav) ? formatSignedCurrency(metrics.todayProfit) : '—';
    const todayRateDisplay = metrics.isSell
      ? '—'
      : (metrics.hasLatestNav && metrics.hasPreviousNav) ? formatSignedPercent(metrics.todayReturnRate) : '—';
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
        <td className="whitespace-nowrap px-2 py-2">
          <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
            <button type="button" title="编辑" className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800" onClick={() => handleStartEdit(row)}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button type="button" title="复制到录入表" className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800" onClick={() => handleCopyRowToDraft(row)}>
              <FileImage className="h-3.5 w-3.5" />
            </button>
            <button type="button" title="删除" className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50" onClick={() => handleDeleteTransaction(tx.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  function renderAggregatesTable() {
    const filteredAggs = aggregates.filter((agg) => {
      if (!agg.hasPosition) return false;
      if (kindFilter !== 'all' && agg.kind !== kindFilter) return false;
      if (!searchNeedle) return true;
      return agg.code.toLowerCase().includes(searchNeedle)
        || (agg.name || '').toLowerCase().includes(searchNeedle);
    });

    if (!filteredAggs.length) {
      const activeCount = aggregates.filter((agg) => agg.hasPosition).length;
      const emptyMessage = aggregates.length === 0
        ? '还没有任何基金持仓，点「+ 新增」或「OCR 导入」录入。'
        : activeCount === 0
          ? '所有基金均已卖出，请切换到「已卖出」页签查看历史交易。'
          : '当前筛选条件下没有基金。';
      return (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
          <Wallet className="h-8 w-8 text-slate-300" />
          <div className="text-sm text-slate-500">{emptyMessage}</div>
        </div>
      );
    }

    const totalTone = portfolio.totalProfit > 0 ? 'text-emerald-600' : portfolio.totalProfit < 0 ? 'text-red-500' : 'text-slate-700';
    const totalTodayTone = portfolio.todayProfit > 0 ? 'text-emerald-600' : portfolio.todayProfit < 0 ? 'text-red-500' : 'text-slate-700';

    return (
      <div className="overflow-x-auto">
        <table className="min-w-[1200px] w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <tr>
              <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 shadow-[1px_0_0_rgba(15,23,42,0.08)]">基金代码</th>
              <th className="px-3 py-2">基金名称</th>
              <th className="px-3 py-2">标签</th>
              <th className="px-3 py-2 text-right">总份额</th>
              <th className="px-3 py-2 text-right">平均成本</th>
              <th className="px-3 py-2 text-right">当前净值</th>
              <th className="px-3 py-2 text-right">总市值</th>
              <th className="px-3 py-2 text-right">总收益(元)</th>
              <th className="px-3 py-2 text-right">总收益率</th>
              <th className="px-3 py-2 text-right">当日收益(元)</th>
              <th className="px-3 py-2 text-right">当日收益率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredAggs.map((agg) => {
              const kindTone = KIND_PILL_TONES[agg.kind] || 'slate';
              const kindLabel = KIND_LABELS[agg.kind] || '未知';
              const profitClass = agg.totalProfit > 0 ? 'text-emerald-600' : agg.totalProfit < 0 ? 'text-red-500' : 'text-slate-700';
              const todayClass = agg.todayProfit > 0 ? 'text-emerald-600' : agg.todayProfit < 0 ? 'text-red-500' : 'text-slate-700';
              const isSelected = selectedCode === agg.code;
              return (
                <tr
                  key={agg.code}
                  className={cx(
                    'cursor-pointer text-slate-700 transition-colors hover:bg-slate-50',
                    isSelected && 'bg-indigo-50/50'
                  )}
                  onClick={() => {
                    setSelectedCode(agg.code);
                    setSidePanelTab('summary');
                    setSidePanelOpen(true);
                  }}
                >
                  <td className={cx(
                    'sticky left-0 z-10 whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-slate-800 shadow-[1px_0_0_rgba(15,23,42,0.06)]',
                    isSelected ? 'bg-indigo-50/90' : 'bg-white'
                  )}>{agg.code}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{agg.name || <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2"><Pill tone={kindTone}>{kindLabel}</Pill></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">{formatShares(agg.totalShares)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">{formatNav(agg.avgCost)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
                    {agg.hasLatestNav ? formatNav(agg.latestNav) : (agg.snapshotError ? <span className="text-red-500">失败</span> : '—')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-700">
                    {agg.hasLatestNav ? formatCurrency(agg.marketValue, '¥', 2) : '—'}
                  </td>
                  <td className={cx('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', profitClass)}>
                    {agg.hasLatestNav ? formatSignedCurrency(agg.totalProfit) : '—'}
                  </td>
                  <td className={cx('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', profitClass)}>
                    {agg.hasLatestNav ? formatSignedPercent(agg.totalReturnRate) : '—'}
                  </td>
                  <td className={cx('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', todayClass)}>
                    {agg.hasLatestNav && agg.hasPreviousNav ? formatSignedCurrency(agg.todayProfit) : '—'}
                  </td>
                  <td className={cx('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', todayClass)}>
                    {agg.hasLatestNav && agg.hasPreviousNav ? formatSignedPercent(agg.todayReturnRate) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50/70 text-xs font-semibold text-slate-700">
            <tr>
              <td className="px-3 py-2" colSpan={6}>合计（{portfolio.assetCount} 只持仓）</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCurrency(portfolio.marketValue, '¥', 2)}</td>
              <td className={cx('whitespace-nowrap px-3 py-2 text-right tabular-nums', totalTone)}>{formatSignedCurrency(portfolio.totalProfit)}</td>
              <td className={cx('whitespace-nowrap px-3 py-2 text-right tabular-nums', totalTone)}>{formatSignedPercent(portfolio.totalReturnRate)}</td>
              <td className={cx('whitespace-nowrap px-3 py-2 text-right tabular-nums', totalTodayTone)}>{formatSignedCurrency(portfolio.todayProfit)}</td>
              <td className={cx('whitespace-nowrap px-3 py-2 text-right tabular-nums', totalTodayTone)}>{formatSignedPercent(portfolio.todayReturnRate)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  function renderSoldTable() {
    const filteredLots = soldLots.filter((lot) => {
      if (kindFilter !== 'all' && lot.kind !== kindFilter) return false;
      if (!searchNeedle) return true;
      return lot.code.toLowerCase().includes(searchNeedle)
        || (lot.name || '').toLowerCase().includes(searchNeedle);
    });
    const filteredSummary = summarizeSoldLots(filteredLots);
    // 当前筛选可见切换配对的合计（仅统计两边都有净值的配对）。
    const filteredSwitchTotals = filteredLots.reduce((acc, lot) => {
      const insight = switchInsightByLotId.get(lot.id);
      if (!insight || !insight.hasPrices) return acc;
      acc.count += 1;
      acc.advantage = Math.round((acc.advantage + insight.switchAdvantage) * 100) / 100;
      acc.stayValue = Math.round((acc.stayValue + insight.stayValue) * 100) / 100;
      return acc;
    }, { count: 0, advantage: 0, stayValue: 0 });
    const filteredSwitchAdvantageRate = filteredSwitchTotals.stayValue > 0
      ? Math.round(((filteredSwitchTotals.advantage / filteredSwitchTotals.stayValue) * 100) * 100) / 100
      : 0;
    const switchTotalTone = filteredSwitchTotals.advantage > 0
      ? 'text-emerald-600'
      : filteredSwitchTotals.advantage < 0 ? 'text-red-500' : 'text-slate-700';

    if (!filteredLots.length) {
      const emptyMessage = soldLots.length === 0
        ? '还没有任何卖出记录。SELL 交易会自动出现在这里。'
        : '当前筛选条件下没有卖出记录。';
      return (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
          <Wallet className="h-8 w-8 text-slate-300" />
          <div className="text-sm text-slate-500">{emptyMessage}</div>
        </div>
      );
    }

    const totalTone = filteredSummary.totalRealizedProfit > 0
      ? 'text-emerald-600'
      : filteredSummary.totalRealizedProfit < 0 ? 'text-red-500' : 'text-slate-700';

    return (
      <div className="overflow-x-auto">
        <table className="min-w-[1400px] w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <tr>
              <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 shadow-[1px_0_0_rgba(15,23,42,0.08)]">基金代码</th>
              <th className="px-3 py-2">基金名称</th>
              <th className="px-3 py-2">标签</th>
              <th className="px-3 py-2">卖出日期</th>
              <th className="px-3 py-2 text-right">卖出份额</th>
              <th className="px-3 py-2 text-right">卖出价</th>
              <th className="px-3 py-2 text-right">平均成本</th>
              <th className="px-3 py-2 text-right">成本金额</th>
              <th className="px-3 py-2 text-right">卖出金额</th>
              <th className="px-3 py-2 text-right">已实现收益(元)</th>
              <th className="px-3 py-2 text-right">已实现收益率</th>
              <th className="px-3 py-2 text-right" title="如果不切换，原基金持有到现在；对比切换后新基金持有到现在的额外收益。与《基金切换》tab 一致。">切换收益(元)</th>
              <th className="px-3 py-2 text-right" title="切换收益 / 原基金持有到今的市值">切换收益率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredLots.map((lot) => {
              const kindTone = KIND_PILL_TONES[lot.kind] || 'slate';
              const kindLabel = KIND_LABELS[lot.kind] || '未知';
              const profitClass = lot.realizedProfit > 0
                ? 'text-emerald-600'
                : lot.realizedProfit < 0 ? 'text-red-500' : 'text-slate-700';
              const switchInsight = lot.isSwitch ? switchInsightByLotId.get(lot.id) : null;
              const switchAdvantageClass = (switchInsight && switchInsight.hasPrices)
                ? (switchInsight.switchAdvantage > 0
                    ? 'text-emerald-600'
                    : switchInsight.switchAdvantage < 0 ? 'text-red-500' : 'text-slate-700')
                : 'text-slate-400';
              const switchInsightTitle = switchInsight && switchInsight.hasPrices
                ? `原持仓 ${formatShares(lot.sellShares)}份 × ${formatNav(switchInsight.srcPrice)} = ${formatCurrency(switchInsight.stayValue, '¥', 2)}\n切换后 ${formatShares(switchInsight.pairShares)}份 × ${formatNav(switchInsight.tgtPrice)} = ${formatCurrency(switchInsight.switchedValue, '¥', 2)}` + (switchInsight.extraCash > 0 ? `\n额外追加现金 ${formatCurrency(switchInsight.extraCash, '¥', 2)}` : '')
                : '';
              const isSelected = selectedCode === lot.code;
              return (
                <tr
                  key={lot.id}
                  className={cx(
                    'cursor-pointer text-slate-700 transition-colors hover:bg-slate-50',
                    isSelected && 'bg-indigo-50/50'
                  )}
                  onClick={() => {
                    setSelectedCode(lot.code);
                    setSidePanelTab('summary');
                  }}
                >
                  <td className={cx(
                    'sticky left-0 z-10 whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-slate-800 shadow-[1px_0_0_rgba(15,23,42,0.06)]',
                    isSelected ? 'bg-indigo-50/90' : 'bg-white'
                  )}>{lot.code}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <span>{lot.name || <span className="text-slate-400">—</span>}</span>
                    {lot.isSwitch ? (
                      <span
                        className="ml-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 ring-1 ring-indigo-100"
                        title={`切换至 ${lot.switchTargetCode}${lot.switchTargetName ? ` ${lot.switchTargetName}` : ''}`}
                      >
                        ⇋ 切换至 {lot.switchTargetCode}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2"><Pill tone={kindTone}>{kindLabel}</Pill></td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{lot.sellDate || <span className="text-amber-600">待补录</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">{formatShares(lot.sellShares)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">{formatNav(lot.sellPrice)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">{lot.hasAvgCost ? formatNav(lot.avgCost) : <span className="text-slate-400">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-700">{lot.hasAvgCost ? formatCurrency(lot.costBasis, '¥', 2) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-700">{formatCurrency(lot.proceeds, '¥', 2)}</td>
                  <td className={cx('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', profitClass)}>
                    {lot.hasAvgCost ? formatSignedCurrency(lot.realizedProfit) : '—'}
                  </td>
                  <td className={cx('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', profitClass)}>
                    {lot.hasAvgCost ? formatSignedPercent(lot.realizedReturnRate) : '—'}
                  </td>
                  <td
                    className={cx('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', switchAdvantageClass)}
                    title={switchInsightTitle}
                  >
                    {!lot.isSwitch
                      ? <span className="text-slate-300">—</span>
                      : !switchInsight
                        ? <span className="text-slate-300">—</span>
                        : !switchInsight.hasPrices
                          ? <span className="text-amber-600" title={`缺少净值：${switchInsight.missingPriceCodes.join('、')}`}>缺净值</span>
                          : formatSignedCurrency(switchInsight.switchAdvantage)}
                  </td>
                  <td
                    className={cx('whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums', switchAdvantageClass)}
                  >
                    {lot.isSwitch && switchInsight && switchInsight.hasPrices
                      ? formatSignedPercent(switchInsight.advantageRate)
                      : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50/70 text-xs font-semibold text-slate-700">
            <tr>
              <td className="px-3 py-2" colSpan={4}>合计（{filteredSummary.codeCount} 只 / {filteredSummary.lotCount} 笔）</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatShares(filteredSummary.totalSellShares)}</td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2"></td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCurrency(filteredSummary.totalCostBasis, '¥', 2)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCurrency(filteredSummary.totalProceeds, '¥', 2)}</td>
              <td className={cx('whitespace-nowrap px-3 py-2 text-right tabular-nums', totalTone)}>{formatSignedCurrency(filteredSummary.totalRealizedProfit)}</td>
              <td className={cx('whitespace-nowrap px-3 py-2 text-right tabular-nums', totalTone)}>{formatSignedPercent(filteredSummary.totalRealizedReturnRate)}</td>
              <td
                className={cx('whitespace-nowrap px-3 py-2 text-right tabular-nums', filteredSwitchTotals.count > 0 ? switchTotalTone : 'text-slate-400')}
                title={filteredSwitchTotals.count > 0 ? `已配对且两边都有净值的切换：${filteredSwitchTotals.count} 笔` : ''}
              >
                {filteredSwitchTotals.count > 0 ? formatSignedCurrency(filteredSwitchTotals.advantage) : <span className="text-slate-300">—</span>}
              </td>
              <td className={cx('whitespace-nowrap px-3 py-2 text-right tabular-nums', filteredSwitchTotals.count > 0 ? switchTotalTone : 'text-slate-400')}>
                {filteredSwitchTotals.count > 0 ? formatSignedPercent(filteredSwitchAdvantageRate) : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  function renderLedgerTable() {
    if (!filteredRows.length) {
      return (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
          <Wallet className="h-8 w-8 text-slate-300" />
          <div className="text-sm text-slate-500">
            {ledgerRows.length === 0 ? '还没有任何交易流水，点「+ 新增」或「OCR 导入」录入。' : '当前筛选条件下没有交易流水。'}
          </div>
        </div>
      );
    }
    return (
      <div className="overflow-x-auto">
        <table className="min-w-[1400px] w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <tr>
              <th className="sticky left-0 z-20 bg-slate-50 px-2 py-2 shadow-[1px_0_0_rgba(15,23,42,0.08)]">代码</th>
              <th className="px-2 py-2">名称</th>
              <th className="px-2 py-2">标签</th>
              <th className="px-2 py-2">类型</th>
              <th className="px-2 py-2">日期</th>
              <th className="px-2 py-2 text-right">价</th>
              <th className="px-2 py-2 text-right">份额</th>
              <th className="px-2 py-2 text-right">当前净值</th>
              <th className="px-2 py-2 text-right">净值日</th>
              <th className="px-2 py-2 text-right">当前份额</th>
              <th className="px-2 py-2 text-right">成本</th>
              <th className="px-2 py-2 text-right">市值/实收</th>
              <th className="px-2 py-2 text-right">总收益</th>
              <th className="px-2 py-2 text-right">总收益率</th>
              <th className="px-2 py-2 text-right">当日收益</th>
              <th className="px-2 py-2 text-right">当日收益率</th>
              <th className="px-2 py-2 text-right">前一日净值</th>
              <th className="px-2 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.map(renderRow)}
          </tbody>
        </table>
      </div>
    );
  }

  function renderSummaryPanel() {
    if (!selectedAggregate) {
      return (
        <div className="text-sm text-slate-500">
          点击左侧任意一行查看该基金的汇总（净份额 / 加权均价 / 总收益 / 今日收益）。
        </div>
      );
    }
    const agg = selectedAggregate;
    const profitTone = agg.totalProfit > 0 ? 'text-emerald-600' : agg.totalProfit < 0 ? 'text-red-500' : 'text-slate-700';
    const todayTone = agg.todayProfit > 0 ? 'text-emerald-600' : agg.todayProfit < 0 ? 'text-red-500' : 'text-slate-700';
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
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">净份额</dt>
            <dd className="mt-1 tabular-nums text-slate-900">{formatShares(agg.totalShares)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">加权均价</dt>
            <dd className="mt-1 tabular-nums text-slate-900">{formatNav(agg.avgCost)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总成本</dt>
            <dd className="mt-1 tabular-nums text-slate-900">{formatCurrency(agg.totalCost, '¥', 2)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总市值</dt>
            <dd className="mt-1 tabular-nums text-slate-900">{agg.hasLatestNav ? formatCurrency(agg.marketValue, '¥', 2) : '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">累计盈亏</dt>
            <dd className={cx('mt-1 tabular-nums', profitTone)}>
              {agg.hasLatestNav ? `${formatSignedCurrency(agg.totalProfit)} (${formatSignedPercent(agg.totalReturnRate)})` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">今日盈亏</dt>
            <dd className={cx('mt-1 tabular-nums', todayTone)}>
              {agg.hasLatestNav && agg.hasPreviousNav ? `${formatSignedCurrency(agg.todayProfit)} (${formatSignedPercent(agg.todayReturnRate)})` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">BUY 总份额</dt>
            <dd className="mt-1 tabular-nums text-slate-900">{formatShares(agg.buyShares)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">SELL 总份额</dt>
            <dd className="mt-1 tabular-nums text-slate-900">{formatShares(agg.sellShares)}</dd>
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
    const switchCandidates = transactions
      .filter((tx) => (
        tx.id !== draft.id
        && tx.type === oppositeType
        && tx.code
        && tx.code !== draftCodeNormalized
        && (!tx.switchPairId || tx.switchPairId === draft.id)
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
            价格（净值）
            <input
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.price}
              onChange={(event) => handleDraftChange('price', event.target.value)}
              placeholder="0.0000"
              inputMode="decimal"
            />
          </label>
          <label className="col-span-1 text-xs text-slate-500">
            份额
            <input
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.shares}
              onChange={(event) => handleDraftChange('shares', event.target.value)}
              placeholder="0.0000"
              inputMode="decimal"
            />
          </label>
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
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={openSwitchPicker}
                      disabled={switchCandidates.length === 0}
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
          {draftMode === 'edit' ? '保存交易' : '新增交易'}
        </button>
      </div>
    );
  }

  const content = (
    <div className={cx('flex flex-col gap-4 px-4 py-5 sm:px-6', embedded ? '' : 'mx-auto max-w-[1600px]')}>
      {migrationNoticeVisible ? (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <div>
            检测到从旧持仓汇总迁入的交易，请点击行内编辑按钮补录交易日期。迁入时间：{ledger.legacyMigrationAt?.slice(0, 10) || '—'}
          </div>
        </div>
      ) : null}
      {renderPortfolioOverview()}
      <div className="grid grid-cols-1 gap-4">
        <section className="min-w-0 rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center rounded-xl bg-slate-100 p-1 text-xs font-semibold text-slate-600">
                <button
                  type="button"
                  className={cx('rounded-lg px-3 py-1.5 transition-colors', mainViewTab === 'aggregate' ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'hover:text-slate-800')}
                  onClick={() => setMainViewTab('aggregate')}
                >
                  基金汇总
                </button>
                <button
                  type="button"
                  className={cx('rounded-lg px-3 py-1.5 transition-colors', mainViewTab === 'sold' ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'hover:text-slate-800')}
                  onClick={() => setMainViewTab('sold')}
                >
                  已卖出{soldLots.length ? <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{soldLots.length}</span> : null}
                </button>
                <button
                  type="button"
                  className={cx('rounded-lg px-3 py-1.5 transition-colors', mainViewTab === 'ledger' ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'hover:text-slate-800')}
                  onClick={() => setMainViewTab('ledger')}
                >
                  成交流水
                </button>
              </div>
              {renderKindFilter()}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className={cx(tableInputClass, 'h-9 w-56 rounded-lg border-slate-200 bg-slate-50 pl-9 pr-3 text-sm hover:bg-white')}
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="搜索代码或名称"
                />
              </div>
              {renderNavBadge()}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-white px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:ring-slate-300"
                onClick={handleCopyVisibleTable}
                title={mainViewTab === 'aggregate' ? '复制基金汇总为 TSV' : mainViewTab === 'sold' ? '复制已卖出为 TSV' : '复制成交流水为 TSV'}
              >
                <Copy className="h-3.5 w-3.5" />
                复制表格
              </button>
              <div className="relative" ref={importMenuRef}>
                <button
                  type="button"
                  className={cx(
                    'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-white px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60',
                    importMenuOpen && 'bg-slate-50 ring-slate-300'
                  )}
                  onClick={() => setImportMenuOpen((open) => !open)}
                  disabled={ocrState.status === 'loading'}
                  aria-haspopup="menu"
                  aria-expanded={importMenuOpen}
                >
                  {ocrState.status === 'loading' ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileUp className="h-3.5 w-3.5" />
                  )}
                  {ocrState.status === 'loading' ? '识别中...' : '批量导入'}
                  <ChevronDown className={cx('h-3 w-3 text-slate-400 transition-transform', importMenuOpen && 'rotate-180')} />
                </button>
                {importMenuOpen ? (
                  <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200" role="menu">
                    <button
                      type="button"
                      className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-xs text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => { setImportMenuOpen(false); openPasteModal(); }}
                      role="menuitem"
                    >
                      <ClipboardPaste className="mt-0.5 h-4 w-4 flex-none text-slate-500" />
                      <span className="flex-1">
                        <span className="block font-semibold text-slate-800">粘贴 Excel</span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">从 Excel 粘贴 TSV / CSV 交易流水</span>
                      </span>
                    </button>
                    <div className="h-px bg-slate-100" />
                    <button
                      type="button"
                      className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-xs text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => { setImportMenuOpen(false); handleTriggerOcr(); }}
                      disabled={ocrState.status === 'loading'}
                      role="menuitem"
                    >
                      <CloudUpload className="mt-0.5 h-4 w-4 flex-none text-slate-500" />
                      <span className="flex-1">
                        <span className="block font-semibold text-slate-800">截图 OCR</span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">上传持仓截图识别交易</span>
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleOcrFile} />
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-indigo-600 px-3.5 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  resetDraft(emptyDraft({ type: mainViewTab === 'sold' ? 'SELL' : 'BUY' }));
                  setSidePanelTab('create');
                  setSidePanelOpen(true);
                }}
                title="新增单条交易"
              >
                <Plus className="h-3.5 w-3.5" />
                新增交易
              </button>
            </div>
          </div>
          <div className="px-1 py-1">
            {mainViewTab === 'aggregate'
              ? renderAggregatesTable()
              : mainViewTab === 'sold'
                ? renderSoldTable()
                : renderLedgerTable()}
          </div>
          <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            {mainViewTab === 'aggregate'
              ? `持仓中 ${portfolio.assetCount} 只基金；累计 ${ledgerRows.length} 笔流水。`
              : mainViewTab === 'sold'
                ? `共 ${soldSummary.codeCount} 只基金 / ${soldSummary.lotCount} 笔卖出；已实现收益 ${formatSignedCurrency(soldSummary.totalRealizedProfit)} （${formatSignedPercent(soldSummary.totalRealizedReturnRate)}）。`
                : `共 ${ledgerRows.length} 笔流水；当前筛选 ${filteredRows.length} 笔。`}
          </div>
        </section>
      </div>
      {sidePanelOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4 py-6"
          onClick={() => setSidePanelOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div className="text-sm font-bold text-slate-900">
                {sidePanelTab === 'summary'
                  ? '该基金汇总'
                  : draftMode === 'edit' ? '编辑交易' : '新增交易'}
              </div>
              <button
                type="button"
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
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-left font-semibold text-slate-500">
                      <tr>
                        <th className="px-2 py-1.5">状态</th>
                        <th className="px-2 py-1.5">代码</th>
                        <th className="px-2 py-1.5">名称</th>
                        <th className="px-2 py-1.5">标签</th>
                        <th className="px-2 py-1.5">类型</th>
                        <th className="px-2 py-1.5">日期</th>
                        <th className="px-2 py-1.5 text-right">价</th>
                        <th className="px-2 py-1.5 text-right">份额</th>
                        <th className="px-2 py-1.5">问题</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pasteResult.rows.map((row) => {
                        const ok = Object.keys(row.errors).length === 0;
                        return (
                          <tr key={row.index} className={ok ? 'text-slate-700' : 'bg-red-50/60 text-red-600'}>
                            <td className="px-2 py-1.5">
                              {ok ? (
                                <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />有效</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-red-500"><AlertTriangle className="h-3.5 w-3.5" />跳过</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 font-mono">{row.draft.code || <span className="text-slate-400">—</span>}</td>
                            <td className="px-2 py-1.5">{row.draft.name || <span className="text-slate-400">—</span>}</td>
                            <td className="px-2 py-1.5">{KIND_LABELS[row.draft.kind] || row.draft.kind || <span className="text-slate-400">—</span>}</td>
                            <td className="px-2 py-1.5">{row.draft.type}</td>
                            <td className="px-2 py-1.5">{row.draft.date || <span className="text-amber-600">待补录</span>}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{row.draft.price || '—'}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{row.draft.shares || '—'}</td>
                            <td className="px-2 py-1.5">{ok ? '—' : summarizeTransactionErrors(row.errors)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <div className="text-xs text-slate-500">
                {pasteResult
                  ? `将导入 ${pasteResult.rows.filter((row) => Object.keys(row.errors).length === 0).length} 笔有效交易`
                  : '提示：Excel 复制时会带上表头行，直接粘贴即可自动识别。'}
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
      {switchPickerOpen ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 px-4 py-6" onClick={closeSwitchPicker}>
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
              <div>点击任意一行即选定该笔交易作为切换对手方。</div>
              <button type="button" className={GHOST_BTN} onClick={closeSwitchPicker}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  return content;
}

export default HoldingsExperience;
