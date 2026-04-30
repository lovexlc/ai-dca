import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CloudUpload,
  FileImage,
  LoaderCircle,
  Plus,
  Trash2
} from 'lucide-react';
import { formatCurrency } from '../app/accumulation.js';
import {
  buildFundSwitchStateFromDocument,
  buildFundSwitchStateFromHistoryEntry,
  buildFundSwitchSummary,
  createDefaultFundSwitchState,
  createEmptyFundSwitchRow,
  deleteFundSwitchDocument,
  deleteFundSwitchHistoryEntry,
  deriveFundSwitchComparison,
  persistFundSwitchState,
  readFundSwitchDocument,
  readFundSwitchDocuments,
  readFundSwitchHistory,
  readFundSwitchState,
  saveFundSwitchDocument,
  saveFundSwitchHistoryEntry
} from '../app/fundSwitch.js';
import { findLatestNasdaqPrice, loadLatestNasdaqPrices } from '../app/nasdaqPrices.js';
import {
  Card,
  Field,
  NumberInput,
  Pill,
  SectionHeading,
  TextInput,
  cx,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  subtleButtonClass,
  tableInputClass
} from '../components/experience-ui.jsx';
import {
  LANDING_MOBILE_SCROLL_ROWS,
  LANDING_SCROLL_PANELS,
  WORKSPACE_PANELS,
  buildRowValidationDiagnostics,
  buildRowValidationIssues,
  buildTrackedCodes,
  createOcrState,
  formatSignedCurrency,
  getAdvantageTone,
  getFundCodeError,
  readFundSwitchRouteState,
  roundToCurrency,
  summarizeValidationIssues,
  updateFundSwitchRoute,
  validateOcrUploadFile
} from '../app/fundSwitchHelpers.js';
import {
  AnalysisWorkspaceSidebar,
  CompactMetricCard,
  DocumentRecordCard,
  FundSwitchDocumentSection,
  FundSwitchHistorySection,
  HistoryRecordCard,
  LandingQuestionChip,
  LandingQuestionWall,
  PendingResultCard,
  PositionEditorSection,
  PositionValueCard,
  StrategyToggle,
  SummaryValueCard,
  TransactionEditorCard,
  WorkflowStepList,
  WorkspaceNavButton,
  buildWorkflowSteps,
  getDocumentWorkflowMeta
} from './fundSwitch/sections.jsx';

export function FundSwitchExperience({ links, inPagesDir, embedded = false }) {
  const [state, setState] = useState(() => readFundSwitchState());
  const [documentEntries, setDocumentEntries] = useState(() => readFundSwitchDocuments());
  const [historyEntries, setHistoryEntries] = useState(() => readFundSwitchHistory());
  const [ocrState, setOcrState] = useState(() => createOcrState());
  const [activeWorkspacePanel, setActiveWorkspacePanel] = useState(() => (state.resultConfirmed ? 'summary' : 'details'));
  const [routeState, setRouteState] = useState(() => readFundSwitchRouteState());
  const [expandedStepKey, setExpandedStepKey] = useState('');
  const [highlightedRowIndex, setHighlightedRowIndex] = useState(-1);
  const [confirmError, setConfirmError] = useState('');
  const [priceState, setPriceState] = useState(() => ({ status: 'idle', entries: [], error: '' }));
  const fileInputRef = useRef(null);
  const priceRequestIdRef = useRef(0);

  const trackedCodes = useMemo(() => buildTrackedCodes(state.comparison), [state.comparison]);
  const priceSnapshotByCode = useMemo(
    () => Object.fromEntries(
      trackedCodes
        .map((code) => [code, findLatestNasdaqPrice(priceState.entries, code)])
        .filter(([, snapshot]) => Boolean(snapshot))
    ),
    [trackedCodes, priceState.entries]
  );

  const summary = useMemo(
    () => buildFundSwitchSummary(state, {
      getCurrentPrice: (code) => Number(priceSnapshotByCode[code]?.current_price) || 0
    }),
    [state, priceSnapshotByCode]
  );
  const recognizedCount = summary.validRecordCount;
  const hasImportedData = Boolean(state.fileName) || recognizedCount > 0;
  const effectiveOcrStatus = hasImportedData && ocrState.status === 'idle' ? 'success' : ocrState.status;
  const effectiveOcrMessage = hasImportedData && ocrState.status === 'idle'
    ? `已同步 ${recognizedCount} 条记录，可继续确认收益或修改明细。`
    : ocrState.message;
  const validationDiagnostics = useMemo(() => buildRowValidationDiagnostics(summary.rows), [summary.rows]);
  const validationIssues = useMemo(() => buildRowValidationIssues(validationDiagnostics), [validationDiagnostics]);
  const validationIssueSummary = useMemo(() => summarizeValidationIssues(validationDiagnostics), [validationDiagnostics]);
  const advantageMeta = getAdvantageTone(summary.switchAdvantage);
  const showViewPage = routeState.mode === 'view' && hasImportedData;
  const workflowSteps = useMemo(() => buildWorkflowSteps({
    fileName: state.fileName,
    hasImportedData,
    recognizedCount,
    ocrState,
    resultConfirmed: state.resultConfirmed,
    effectiveOcrMessage,
    validationDiagnostics,
    summary
  }), [effectiveOcrMessage, hasImportedData, ocrState, recognizedCount, state.fileName, state.resultConfirmed, summary, validationDiagnostics]);

  useEffect(() => {
    function syncRouteState() {
      setRouteState(readFundSwitchRouteState());
    }

    window.addEventListener('hashchange', syncRouteState);
    window.addEventListener('popstate', syncRouteState);
    return () => {
      window.removeEventListener('hashchange', syncRouteState);
      window.removeEventListener('popstate', syncRouteState);
    };
  }, []);

  useEffect(() => {
    if (routeState.mode === 'view' && routeState.docId && routeState.docId !== state.docId) {
      const documentEntry = readFundSwitchDocument(routeState.docId);
      if (!documentEntry) {
        openUploadPage({ replace: true });
        return;
      }

      const nextState = buildFundSwitchStateFromDocument(documentEntry);
      setState(nextState);
      setOcrState(createOcrState({
        status: documentEntry.ocrStatus || 'success',
        progress: documentEntry.workflowStatus === 'ready' ? 100 : 84,
        durationMs: documentEntry.ocrDurationMs,
        lineCount: nextState.recognizedRecords,
        message: documentEntry.ocrMessage || '已从文档链接载入 OCR 结果。'
      }));
      setConfirmError('');
      selectWorkspacePanel(nextState.resultConfirmed ? 'summary' : 'details');
      setExpandedStepKey('');
      return;
    }

    if (routeState.mode === 'view' && !hasImportedData) {
      openUploadPage({ replace: true });
    }
  }, [hasImportedData, routeState.docId, routeState.mode, state.docId]);

  useEffect(() => {
    persistFundSwitchState({ ...state, comparison: summary.comparison }, summary);
  }, [state, summary]);

  useEffect(() => {
    if (highlightedRowIndex < 0) {
      return;
    }

    const target = document.querySelector(`[data-row-index="${highlightedRowIndex}"]`);
    if (!target) {
      return;
    }

    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const firstField = target.querySelector('input, select');
      if (firstField instanceof HTMLElement) {
        firstField.focus();
        if (typeof firstField.select === 'function') {
          firstField.select();
        }
      }
    });
  }, [activeWorkspacePanel, highlightedRowIndex]);

  function refreshDocumentEntries() {
    const nextEntries = readFundSwitchDocuments();
    setDocumentEntries((current) => {
      const isSame = current.length === nextEntries.length
        && current.every((entry, index) => (
          entry.id === nextEntries[index]?.id
          && entry.updatedAt === nextEntries[index]?.updatedAt
          && entry.workflowStatus === nextEntries[index]?.workflowStatus
          && entry.historyEntryId === nextEntries[index]?.historyEntryId
        ));
      return isSame ? current : nextEntries;
    });
  }

  function refreshHistoryEntries() {
    setHistoryEntries(readFundSwitchHistory());
  }

  async function refreshLatestPrices() {
    const requestId = priceRequestIdRef.current + 1;
    priceRequestIdRef.current = requestId;

    setPriceState((current) => ({
      status: 'loading',
      entries: current.entries,
      error: ''
    }));

    try {
      const entries = await loadLatestNasdaqPrices({ inPagesDir });
      if (priceRequestIdRef.current !== requestId) {
        return entries;
      }

      setPriceState({
        status: 'success',
        entries,
        error: ''
      });
      return entries;
    } catch (error) {
      if (priceRequestIdRef.current !== requestId) {
        return null;
      }

      setPriceState({
        status: 'error',
        entries: [],
        error: error instanceof Error ? error.message : '加载失败。'
      });
      return [];
    }
  }

  function buildSummaryWithLatestPrices(nextState, priceEntries = priceState.entries) {
    return buildFundSwitchSummary(nextState, {
      getCurrentPrice: (code) => Number(findLatestNasdaqPrice(priceEntries, code)?.current_price) || 0
    });
  }

  function saveAnalysisToHistory(nextState, priceEntries = priceState.entries) {
    const nextSummary = buildSummaryWithLatestPrices(nextState, priceEntries);
    const savedEntry = saveFundSwitchHistoryEntry(nextState, nextSummary);
    refreshHistoryEntries();
    return savedEntry;
  }

  function saveDocumentSnapshot(nextState, nextOcrState = ocrState, workflowStatus) {
    const savedDocument = saveFundSwitchDocument(
      {
        ...nextState,
        comparison: deriveFundSwitchComparison(nextState.rows, nextState.comparison)
      },
      {
        ocrState: nextOcrState,
        workflowStatus
      }
    );
    refreshDocumentEntries();
    return savedDocument;
  }

  function openViewPage(docId, { replace = false } = {}) {
    const normalizedDocId = String(docId || '').trim();
    if (!normalizedDocId) {
      return;
    }

    if (routeState.mode === 'view' && routeState.docId === normalizedDocId) {
      return;
    }

    setRouteState(updateFundSwitchRoute({ mode: 'view', docId: normalizedDocId }, { replace }));
  }

  function openUploadPage({ replace = false } = {}) {
    if (routeState.mode === 'upload') {
      return;
    }
    setRouteState(updateFundSwitchRoute({ mode: 'upload', docId: '' }, { replace }));
  }

  function toggleWorkflowStep(stepKey) {
    setExpandedStepKey((current) => (current === stepKey ? '' : stepKey));
  }

  function focusValidationIssue(rowIndex) {
    if (rowIndex < 0) {
      return;
    }

    setHighlightedRowIndex(rowIndex);
    setActiveWorkspacePanel('details');
  }

  useEffect(() => {
    if (!state.docId || !hasImportedData) {
      return;
    }

    saveDocumentSnapshot(
      { ...state, comparison: summary.comparison },
      createOcrState({
        ...ocrState,
        status: effectiveOcrStatus,
        message: effectiveOcrMessage,
        lineCount: recognizedCount
      }),
      state.resultConfirmed ? 'ready' : 'processing'
    );
  }, [effectiveOcrMessage, effectiveOcrStatus, hasImportedData, ocrState, recognizedCount, state, summary.comparison]);

  useEffect(() => {
    void refreshLatestPrices();
    return () => {
      priceRequestIdRef.current += 1;
    };
  }, [inPagesDir]);

  function updateComparisonScalar(key, value) {
    setConfirmError('');
    setState((current) => ({
      ...current,
      comparison: {
        ...current.comparison,
        [key]: ['switchCost', 'extraCash', 'feeTradeCount'].includes(key) ? Number(value) || 0 : value
      }
    }));
  }

  function updateSinglePosition(kind, field, value) {
    setConfirmError('');
    setState((current) => {
      const isSource = kind === 'source';
      const codeKey = isSource ? 'sourceCode' : 'targetCode';
      const sharesKey = isSource ? 'sourceSellShares' : 'targetBuyShares';
      const positionsKey = isSource ? 'sourcePositions' : 'targetPositions';
      const nextCode = field === 'code' ? String(value || '').trim() : String(current.comparison?.[codeKey] || '').trim();
      const nextShares = field === 'shares' ? Number(value) || 0 : Number(current.comparison?.[sharesKey]) || 0;

      return {
        ...current,
        comparison: {
          ...current.comparison,
          [codeKey]: nextCode,
          [sharesKey]: nextShares,
          [positionsKey]: nextCode && nextShares > 0 ? [{ code: nextCode, shares: nextShares }] : []
        }
      };
    });
  }

  function updatePriceOverride(kind, code, value) {
    setConfirmError('');
    setState((current) => {
      const normalizedCode = String(code || '').trim();
      const nextValue = Number(value) || 0;
      const nextPriceOverrides = { ...(current.comparison?.priceOverrides || {}) };

      if (normalizedCode) {
        if (nextValue > 0) {
          nextPriceOverrides[normalizedCode] = nextValue;
        } else {
          delete nextPriceOverrides[normalizedCode];
        }
      }

      const nextComparison = {
        ...current.comparison,
        priceOverrides: nextPriceOverrides
      };

      if (kind === 'source' && current.comparison?.sourceCode === normalizedCode) {
        nextComparison.sourceCurrentPrice = nextValue;
      }

      if (kind === 'target' && current.comparison?.targetCode === normalizedCode) {
        nextComparison.targetCurrentPrice = nextValue;
      }

      return {
        ...current,
        comparison: nextComparison
      };
    });
  }

  function updateStrategy(strategy) {
    setConfirmError('');
    setState((current) => ({
      ...current,
      comparison: deriveFundSwitchComparison(current.rows, { ...current.comparison, strategy }, strategy)
    }));
  }

  function updateFeePerTrade(value) {
    setConfirmError('');
    setState((current) => ({ ...current, feePerTrade: Number(value) || 0 }));
  }

  function updateRow(index, key, value) {
    setConfirmError('');
    setState((current) => {
      const nextRows = [...current.rows];
      const currentRow = nextRows[index] || createEmptyFundSwitchRow();
      const nextRow = {
        ...currentRow,
        [key]: ['buyPrice', 'sellPrice', 'shares'].includes(key) ? Number(value) || 0 : value
      };

      if (key === 'type') {
        const nextType = value === '卖出' ? '卖出' : '买入';
        const previousActivePrice = currentRow.type === '卖出' ? Number(currentRow.sellPrice) || 0 : Number(currentRow.buyPrice) || 0;
        nextRow.type = nextType;
        if (nextType === '买入' && !nextRow.buyPrice && previousActivePrice) {
          nextRow.buyPrice = previousActivePrice;
        }
        if (nextType === '卖出' && !nextRow.sellPrice && previousActivePrice) {
          nextRow.sellPrice = previousActivePrice;
        }
      }

      const activePrice = nextRow.type === '卖出' ? Number(nextRow.sellPrice) || 0 : Number(nextRow.buyPrice) || 0;
      const activeShares = Number(nextRow.shares) || 0;
      nextRow.price = activePrice;
      nextRow.amount = activePrice > 0 && activeShares > 0 ? roundToCurrency(activePrice * activeShares) : 0;
      nextRows[index] = nextRow;
      return { ...current, rows: nextRows, recognizedRecords: nextRows.length, resultConfirmed: false };
    });
  }

  function removeRow(index) {
    setConfirmError('');
    setState((current) => {
      const nextRows = current.rows.filter((_, rowIndex) => rowIndex !== index);
      const safeRows = nextRows.length ? nextRows : [createEmptyFundSwitchRow()];
      return { ...current, rows: safeRows, recognizedRecords: safeRows.length, resultConfirmed: false };
    });
  }

  function addRow() {
    setConfirmError('');
    setState((current) => {
      const nextRows = [...current.rows, createEmptyFundSwitchRow()];
      return {
        ...current,
        rows: nextRows,
        recognizedRecords: nextRows.length,
        resultConfirmed: false
      };
    });
  }

  async function processOcrFile(file) {
    try {
      validateOcrUploadFile(file);
      setHighlightedRowIndex(-1);
      setOcrState(createOcrState({ status: 'loading', progress: 12, message: '准备上传截图' }));
      selectWorkspacePanel('details');
      const { recognizeFundSwitchFile } = await import('../app/fundSwitchOcr.js');
      const result = await recognizeFundSwitchFile(file, state.comparison, (progress) => {
        setOcrState((current) => createOcrState({ ...current, ...progress }));
      });

      const parsedRows = result.rows.length ? result.rows : [createEmptyFundSwitchRow()];
      const nextState = {
        ...state,
        docId: '',
        historyEntryId: '',
        fileName: file.name,
        recognizedRecords: result.recordCount || parsedRows.length,
        resultConfirmed: false,
        rows: parsedRows,
        comparison: {
          ...state.comparison,
          ...result.comparison
        }
      };
      setConfirmError('');
      selectWorkspacePanel('details');
      setExpandedStepKey('');

      let nextOcrState;
      if (result.rows.length) {
        const hasWarnings = Array.isArray(result.warnings) && result.warnings.length > 0;
        nextOcrState = createOcrState({
          status: hasWarnings ? 'warning' : 'success',
          progress: 100,
          durationMs: result.durationMs,
          lineCount: result.recordCount || result.rows.length,
          message: hasWarnings ? `已提取 ${result.rows.length} 条记录，请复核。` : `提取完成，已解析 ${result.rows.length} 条记录。`
        });
      } else {
        nextOcrState = createOcrState({
          status: 'warning',
          progress: 100,
          durationMs: result.durationMs,
          lineCount: 0,
          message: '未能解析出记录。'
        });
      }

      const savedDocument = saveDocumentSnapshot(nextState, nextOcrState, 'ready');
      const persistedState = savedDocument
        ? { ...nextState, docId: savedDocument.id }
        : nextState;

      setState(persistedState);
      setOcrState(nextOcrState);
      openViewPage(persistedState.docId);
    } catch (error) {
      setOcrState(createOcrState({
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : '提取失败',
        message: '服务异常'
      }));
    }
  }

  function handleFileInputChange(event) {
    const file = event.target.files?.[0];
    if (file) {
      void processOcrFile(file);
    }
    event.target.value = '';
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function resetToUploadEntry() {
    setState(createDefaultFundSwitchState());
    setOcrState(createOcrState());
    setHighlightedRowIndex(-1);
    setConfirmError('');
    selectWorkspacePanel('details');
    setExpandedStepKey('');
    openUploadPage();
  }

  function openDetailEditor() {
    setHighlightedRowIndex(-1);
    selectWorkspacePanel('details');
  }

  function selectWorkspacePanel(panelKey) {
    setActiveWorkspacePanel(panelKey);
    if (panelKey !== 'details') {
      setHighlightedRowIndex(-1);
    }
    if (panelKey === 'summary' || panelKey === 'settings') {
      void refreshLatestPrices();
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void processOcrFile(file);
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  async function handleConfirmDataAndYield() {
    const actionLabel = state.resultConfirmed ? '确认数据与收益' : '校验并生成结果';

    if (validationIssues.length) {
      const message = summarizeValidationIssues(validationDiagnostics);
      setConfirmError(message);
      showActionToast(actionLabel, 'error', {
        description: message
      });
      return;
    }

    setConfirmError('');
    const latestPriceEntries = await refreshLatestPrices();
    const nextComparison = deriveFundSwitchComparison(state.rows, state.comparison);
    const draftState = {
      ...state,
      comparison: nextComparison,
      recognizedRecords: state.rows.length,
      resultConfirmed: true
    };
    const savedDocument = saveDocumentSnapshot(draftState, createOcrState({
      ...ocrState,
      status: effectiveOcrStatus,
      message: effectiveOcrMessage,
      lineCount: recognizedCount
    }), 'ready');
    const nextState = savedDocument ? { ...draftState, docId: savedDocument.id } : draftState;
    const savedEntry = saveAnalysisToHistory(
      nextState,
      Array.isArray(latestPriceEntries) ? latestPriceEntries : priceState.entries
    );
    const finalState = {
      ...nextState,
      historyEntryId: savedEntry?.id || nextState.historyEntryId
    };

    if (savedEntry) {
      saveDocumentSnapshot(finalState, createOcrState({
        ...ocrState,
        status: effectiveOcrStatus,
        message: effectiveOcrMessage,
        lineCount: recognizedCount
      }), 'ready');
    }

    setState(finalState);
    setHighlightedRowIndex(-1);
    selectWorkspacePanel('summary');
    setExpandedStepKey('');
    openViewPage(finalState.docId);
    showActionToast(actionLabel, 'success');
  }

  function openDocument(documentId) {
    const documentEntry = readFundSwitchDocument(documentId);
    if (!documentEntry) {
      return;
    }

    const nextState = buildFundSwitchStateFromDocument(documentEntry);
    setState(nextState);
    setOcrState(createOcrState({
      status: documentEntry.ocrStatus || (nextState.resultConfirmed ? 'success' : 'warning'),
      progress: documentEntry.workflowStatus === 'ready' ? 100 : 84,
      durationMs: documentEntry.ocrDurationMs,
      lineCount: nextState.recognizedRecords,
      message: documentEntry.ocrMessage || '已从最近文档载入当前分析。'
    }));
    setHighlightedRowIndex(-1);
    setConfirmError('');
    selectWorkspacePanel(nextState.resultConfirmed ? 'summary' : 'details');
    setExpandedStepKey('');
    openViewPage(documentEntry.id);
  }

  function openHistoryAnalysis(entry) {
    const baseState = buildFundSwitchStateFromHistoryEntry(entry);
    const nextOcrState = createOcrState({
      status: 'success',
      progress: 100,
      message: '已从历史载入，将按当前最新价格重新分析。',
      lineCount: baseState.recognizedRecords
    });
    const savedDocument = saveDocumentSnapshot({
      ...baseState,
      docId: baseState.docId || ''
    }, nextOcrState, 'ready');
    const nextState = savedDocument ? { ...baseState, docId: savedDocument.id } : baseState;

    setState(nextState);
    setOcrState(nextOcrState);
    setHighlightedRowIndex(-1);
    setConfirmError('');
    selectWorkspacePanel('summary');
    setExpandedStepKey('');
    openViewPage(nextState.docId);
    showActionToast('打开历史分析', 'success', {
      description: '已载入历史记录，当前页面会直接用最新价格重算。'
    });
  }

  function removeHistoryAnalysis(entryId) {
    deleteFundSwitchHistoryEntry(entryId);
    refreshHistoryEntries();
    if (state.historyEntryId === entryId) {
      setState((current) => ({ ...current, historyEntryId: '' }));
    }
    showActionToast('删除历史分析', 'success');
  }

  function removeDocumentEntry(entryId) {
    deleteFundSwitchDocument(entryId);
    refreshDocumentEntries();
    if (state.docId === entryId) {
      setState((current) => ({ ...current, docId: '' }));
    }
    showActionToast('删除最近上传', 'success');
  }

  const detailsPanel = (
    <div className="space-y-5">
      {confirmError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {confirmError}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[24px] bg-transparent">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">已回填交易表</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500">{recognizedCount} 条识别记录</div>
            <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-50" type="button" onClick={addRow}>
              <Plus className="h-4 w-4" />
              新增条目
            </button>
          </div>
        </div>

        <div className="space-y-3 p-4 md:hidden">
          {summary.rows.map((row, index) => (
            <TransactionEditorCard
              key={row.id}
              row={row}
              index={index}
              codeError={getFundCodeError(row.code)}
              highlighted={highlightedRowIndex === index}
              onUpdateRow={updateRow}
              onRemoveRow={removeRow}
            />
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px] table-fixed whitespace-nowrap text-left text-sm">
            <colgroup>
              <col className="w-[170px]" />
              <col className="w-[124px]" />
              <col className="w-[152px]" />
              <col className="w-[124px]" />
              <col className="w-[132px]" />
              <col className="w-[150px]" />
              <col className="w-[64px]" />
            </colgroup>
            <thead className="border-b border-slate-100 bg-white text-xs uppercase tracking-[0.14em] text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">日期</th>
                <th className="px-4 py-3 font-semibold">基金代码</th>
                <th className="px-4 py-3 font-semibold">交易类型</th>
                <th className="px-4 py-3 font-semibold">价格</th>
                <th className="px-4 py-3 font-semibold">份额</th>
                <th className="px-4 py-3 font-semibold">成交额</th>
                <th className="w-16 px-4 py-3 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {summary.rows.map((row, index) => {
                const codeError = getFundCodeError(row.code);
                const focusEditableField = (event) => {
                  const field = event.currentTarget.querySelector('input, select');
                  if (field instanceof HTMLElement) {
                    field.focus();
                    if (typeof field.select === 'function') {
                      field.select();
                    }
                  }
                };

                return (
                  <tr
                    key={row.id}
                    data-row-index={index}
                    className={cx(
                      'group transition-colors hover:bg-slate-50/70 focus-within:bg-slate-50/70',
                      highlightedRowIndex === index ? 'bg-indigo-50/80' : ''
                    )}
                  >
                    <td className="px-3 py-2.5" onClick={focusEditableField}>
                      <input
                        className={cx(tableInputClass, 'h-11 rounded-md px-2.5 font-medium hover:bg-white focus:bg-white')}
                        placeholder="例如 2026-03-29"
                        value={row.date}
                        onChange={(event) => updateRow(index, 'date', event.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2.5" onClick={focusEditableField}>
                      <div className="relative">
                        <input
                          className={cx(
                            tableInputClass,
                            'h-11 rounded-md px-2.5 font-semibold hover:bg-white focus:bg-white',
                            codeError ? 'border-red-300 text-red-900 focus:border-red-500' : ''
                          )}
                          placeholder="纯数字代码"
                          value={row.code}
                          onChange={(event) => updateRow(index, 'code', event.target.value)}
                        />
                        {codeError ? <div className="absolute left-2 top-[calc(100%+4px)] z-10 rounded bg-red-600 px-2 py-1 text-[10px] text-white shadow-sm">{codeError}</div> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5" onClick={focusEditableField}>
                      <select
                        className={cx(
                          'h-11 w-full rounded-md border border-transparent bg-transparent px-2.5 pr-8 text-sm font-semibold outline-none transition-all hover:border-slate-200 hover:bg-white focus:border-indigo-400 focus:bg-white',
                          row.type === '卖出' ? 'text-emerald-700' : 'text-red-700'
                        )}
                        value={row.type}
                        onChange={(event) => updateRow(index, 'type', event.target.value)}
                      >
                        <option value="卖出">卖出</option>
                        <option value="买入">买入</option>
                      </select>
                    </td>
                    <td className="px-3 py-2.5" onClick={focusEditableField}>
                      <input
                        className={cx(tableInputClass, 'h-11 rounded-md px-2.5 hover:bg-white focus:bg-white')}
                        step="0.0001"
                        type="number"
                        placeholder="0.0000"
                        value={row.price}
                        onChange={(event) => updateRow(index, row.type === '卖出' ? 'sellPrice' : 'buyPrice', event.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2.5" onClick={focusEditableField}>
                      <input
                        className={cx(tableInputClass, 'h-11 rounded-md px-2.5 hover:bg-white focus:bg-white')}
                        step="0.01"
                        type="number"
                        placeholder="0.00"
                        value={row.shares}
                        onChange={(event) => updateRow(index, 'shares', event.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex h-11 items-center rounded-md px-2.5 font-semibold text-slate-700">
                        {formatCurrency(row.amount, '¥ ')}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        className="rounded-lg p-2 text-slate-400 opacity-0 transition-colors group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-red-50 hover:text-red-500"
                        type="button"
                        onClick={() => removeRow(index)}
                        title="删除记录"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={handleConfirmDataAndYield}>
          {state.resultConfirmed ? '确认数据与收益' : '校验并生成结果'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const summaryPanel = state.resultConfirmed ? (
    <div className="space-y-4">
      <SummaryValueCard
        value={formatSignedCurrency(summary.switchAdvantage, '')}
        advantageMeta={advantageMeta}
        strategy={summary.strategy}
        onStrategyChange={updateStrategy}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <PositionValueCard
          title="如果不换，现在值多少"
          value={formatCurrency(summary.stayValue, '¥ ')}
          positions={summary.sourcePositions}
          priceSnapshotByCode={priceSnapshotByCode}
          emptyText="尚未回放出来源持仓，请先确认交易数据。"
        />
        <PositionValueCard
          title="换到现在这只后，值多少"
          value={formatCurrency(summary.switchedValue, '¥ ')}
          positions={summary.targetPositions}
          priceSnapshotByCode={priceSnapshotByCode}
          emptyText="尚未回放出目标持仓，请先确认交易数据。"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <CompactMetricCard
          title="现持仓浮盈"
          value={formatSignedCurrency(summary.switchedPositionProfit, '¥ ')}
          note="现值 - 成本 - 手续费"
          tone={summary.switchedPositionProfit >= 0 ? 'positive' : 'negative'}
        />
        <CompactMetricCard title="预估处理金额" value={formatCurrency(summary.processedAmount, '¥ ')} note="已识别记录累计成交额" />
        <CompactMetricCard title="额外补入现金" value={formatCurrency(summary.comparison.extraCash, '¥ ')} note="已计入最终真实额外收益" />
      </div>

      {state.resultConfirmed && summary.missingPriceCodes.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          以下基金暂未匹配到现价，请到“计算参数”里手动补入：{summary.missingPriceCodes.join('、')}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={handleConfirmDataAndYield}>
          确认数据与收益
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  ) : (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="收益摘要"
        title="等待确认识别明细"
      />
      <PendingResultCard issueSummary={confirmError || validationIssueSummary} />
      <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => selectWorkspacePanel('details')}>
        去看识别明细
      </button>
    </div>
  );

  const settingsPanel = state.resultConfirmed ? (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="计算参数"
        title="收益口径与价格校准"
      />

      <div className="flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">收益口径</div>
          <div className="mt-1 text-sm leading-6 text-slate-600">推荐口径会沿交易链往前追，把中间换仓和补入现金一起算进去；另一档只看最后一次换仓。</div>
        </div>
        <StrategyToggle strategy={summary.strategy} onChange={updateStrategy} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <PositionEditorSection
          kind="source"
          positions={summary.sourcePositions}
          comparison={summary.comparison}
          priceSnapshotByCode={priceSnapshotByCode}
          onSingleFieldChange={updateSinglePosition}
          onPriceChange={updatePriceOverride}
        />

        <PositionEditorSection
          kind="target"
          positions={summary.targetPositions}
          comparison={summary.comparison}
          priceSnapshotByCode={priceSnapshotByCode}
          onSingleFieldChange={updateSinglePosition}
          onPriceChange={updatePriceOverride}
        />
      </div>

      {priceState.status === 'error' ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {priceState.error}
        </div>
      ) : null}

      <div className="border-t border-slate-100 pt-6">
        <SectionHeading eyebrow="成本调整" title="切换成本调整项" />
        <div className="mt-5 grid gap-4 xl:grid-cols-3 xl:gap-6">
          <label className="block rounded-xl border border-slate-100 bg-slate-50 p-4">
            <span className="block text-sm font-bold text-slate-700">额外补入现金 (元)</span>
            <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">推荐口径会把中间换仓时补进去的钱一起算上；“只看最后一次”只统计最后一跳补的钱。</span>
            <input className="mt-3 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="0.01" value={summary.comparison.extraCash} onChange={(event) => updateComparisonScalar('extraCash', event.target.value)} />
          </label>

          <label className="block rounded-xl border border-slate-100 bg-slate-50 p-4">
            <span className="block text-sm font-bold text-slate-700">目标仓位原始成本 (元)</span>
            <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">这里是当前剩余目标仓位的成本合计，默认由 lot 回放自动生成，必要时可以人工校准。</span>
            <input className="mt-3 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="0.01" value={summary.comparison.switchCost} onChange={(event) => updateComparisonScalar('switchCost', event.target.value)} />
          </label>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <span className="block text-sm font-bold text-slate-700">预估交易手续费 (元)</span>
            <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">默认同步为当前明细记录行数，可继续手动校准。</span>
            <div className="mt-3 flex items-center gap-2">
              <input className="h-11 w-20 rounded-lg border border-slate-200 bg-white px-2 text-center font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="0.01" placeholder="单笔" value={summary.feePerTrade} onChange={(event) => updateFeePerTrade(event.target.value)} />
              <span className="text-xs font-bold text-slate-400">×</span>
              <div className="relative flex-1">
                <input className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="1" value={summary.comparison.feeTradeCount} onChange={(event) => updateComparisonScalar('feeTradeCount', event.target.value)} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">笔</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={handleConfirmDataAndYield}>
          确认数据与收益
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  ) : (
    <div className="space-y-5">
      <SectionHeading eyebrow="计算参数" title="收益口径与价格校准" />
      <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm leading-6 text-slate-500">
        先去“识别明细”里确认交易数据，然后这里才会开放收益口径、现价补录和成本校准。
      </div>
      <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => selectWorkspacePanel('details')}>
        去确认识别明细
      </button>
    </div>
  );

  const landingUploadCard = (
    <div className="mx-auto w-full max-w-[456px] rounded-[32px] bg-white/58 p-7 shadow-[0_12px_32px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:p-8">
      <button
        className={cx(
          'flex aspect-square w-full flex-col items-center justify-center rounded-[24px] p-6 text-center transition-all',
          ocrState.status === 'loading'
            ? 'bg-indigo-50/70'
            : 'bg-white/44 hover:bg-white/58'
        )}
        onClick={openFilePicker}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        type="button"
      >
        {ocrState.status === 'loading' ? (
          <LoaderCircle className="mb-4 h-9 w-9 animate-spin text-indigo-500" />
        ) : (
          <CloudUpload className="mb-4 h-9 w-9 text-slate-400" />
        )}
        <div className="text-base font-semibold text-slate-700">
          {ocrState.status === 'loading' ? '正在识别截图' : '点击或拖拽上传'}
        </div>
        <div className="mt-2 text-xs font-medium text-slate-400">PNG / JPG / JPEG</div>
        {ocrState.status === 'idle' ? null : (
          <div className="mt-5 w-full max-w-xs">
            <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-500">
              <span>识别进度</span>
              <span className="text-indigo-600">{ocrState.progress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${ocrState.progress}%` }} />
            </div>
          </div>
        )}
      </button>

      {(ocrState.status !== 'idle' || state.fileName) && (
        <div className="mt-5 flex items-start gap-3 rounded-[24px] bg-white/52 px-4 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
          <FileImage className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-semibold text-slate-700">{state.fileName || '未命名文件'}</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">{effectiveOcrMessage}</div>
            {ocrState.error ? <div className="mt-2 text-xs text-red-500">{ocrState.error}</div> : null}
            {priceState.status === 'error' ? <div className="mt-2 text-xs text-amber-600">{priceState.error}</div> : null}
          </div>
        </div>
      )}
    </div>
  );

  const content = !showViewPage ? (
    <div className="mx-auto max-w-6xl space-y-10 px-4 pt-6 sm:px-6 sm:pt-8">
      <div className="overflow-hidden rounded-[40px] border border-transparent bg-transparent shadow-none">
        <div className="relative px-0 pb-6 pt-0 sm:px-0 sm:pb-8 sm:pt-0">
          <div className="relative mx-auto max-w-6xl">
            <div className="md:hidden">
              <LandingQuestionWall className="mx-auto mb-8 max-w-2xl" rows={LANDING_MOBILE_SCROLL_ROWS} />
            </div>

            <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_minmax(280px,456px)_minmax(0,1fr)] md:items-center md:gap-4 lg:gap-6 xl:gap-8">
              <LandingQuestionWall className="w-full max-w-[200px] justify-self-start lg:max-w-[240px] xl:max-w-[280px]" rows={LANDING_SCROLL_PANELS[0]} />
              {landingUploadCard}
              <LandingQuestionWall className="w-full max-w-[200px] justify-self-end lg:max-w-[240px] xl:max-w-[280px]" rows={LANDING_SCROLL_PANELS[1]} />
            </div>

            <div className="md:hidden">
              {landingUploadCard}
            </div>
          </div>
        </div>
      </div>

      <div>
        <FundSwitchDocumentSection
          entries={documentEntries}
          activeDocId={state.docId}
          onOpen={openDocument}
          onDelete={removeDocumentEntry}
        />
      </div>

      <div>
        <FundSwitchHistorySection
          entries={historyEntries}
          activeEntryId={state.historyEntryId}
          onOpen={openHistoryAnalysis}
          onDelete={removeHistoryAnalysis}
        />
      </div>
    </div>
  ) : (
    <div className="mx-auto max-w-screen-2xl px-4 pb-6 pt-3 sm:px-6 sm:pb-8 sm:pt-4">
      <div className="mb-4 flex items-center">
        <button className="text-sm font-semibold text-slate-500 transition-colors hover:text-slate-800" type="button" onClick={resetToUploadEntry}>
          返回上传入口
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-5 xl:col-span-4">
          <AnalysisWorkspaceSidebar
            activeDocId={state.docId}
            documentEntries={documentEntries}
            expandedStepKey={expandedStepKey}
            workflowSteps={workflowSteps}
            onEdit={openDetailEditor}
            onJumpToIssue={focusValidationIssue}
            onOpenDocument={openDocument}
            onShowSummary={() => selectWorkspacePanel('summary')}
            onToggleStep={toggleWorkflowStep}
          />
        </div>

        <div className="col-span-12 lg:col-span-7 xl:col-span-8">
          <main className="rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
            <div className="border-b border-slate-200 px-4 py-4 sm:px-6">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {WORKSPACE_PANELS.map((panel) => (
                  <WorkspaceNavButton
                    key={panel.key}
                    panel={panel}
                    active={activeWorkspacePanel === panel.key}
                    onSelect={selectWorkspacePanel}
                    badge={panel.key === 'details' ? String(recognizedCount) : ''}
                  />
                ))}
              </div>
            </div>

            <section className="p-5 sm:p-7">
              {activeWorkspacePanel === 'details' ? detailsPanel : null}
              {activeWorkspacePanel === 'summary' ? summaryPanel : null}
              {activeWorkspacePanel === 'settings' ? settingsPanel : null}
            </section>
          </main>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <input ref={fileInputRef} accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden onChange={handleFileInputChange} type="file" />
      {content}
    </>
  );
}
