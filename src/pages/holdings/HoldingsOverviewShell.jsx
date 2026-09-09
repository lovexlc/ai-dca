import { AlertTriangle, Bell, ChevronDown, ChevronUp, Loader2, RefreshCw, ScanLine, ReceiptText, Plus, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { IncomeSection } from '../../app/income/IncomeSection.jsx';
import { ROUTES } from '../../app/incomeRoute.js';
import { buildHoldingsNotifyDigest } from '../../app/holdingsLedgerCore.js';
import { loadHoldingsNotifyRule, saveHoldingsNotifyRule } from '../../app/notifySync.js';
import { showActionToast } from '../../app/toast.js';
import { cx, secondaryButtonClass } from '../../components/experience-ui.jsx';
import { FloatingActionButton } from '../../components/FloatingActionButton.jsx';
import { AggregateHoldingsTableSection } from './AggregateHoldingsTableSection.jsx';
import { HoldingsSidePanel } from './HoldingsSidePanel.jsx';

const HoldingSummaryPanel = lazy(() => import('./HoldingSummaryPanel.jsx').then((module) => ({ default: module.HoldingSummaryPanel })));
const PasteImportModal = lazy(() => import('./TransactionImportModals.jsx').then((module) => ({ default: module.PasteImportModal })));
const OcrImportModal = lazy(() => import('./TransactionImportModals.jsx').then((module) => ({ default: module.OcrImportModal })));
const SwitchCounterpartPickerModal = lazy(() => import('./SwitchCounterpartPickerModal.jsx').then((module) => ({ default: module.SwitchCounterpartPickerModal })));
const TransactionDraftPanel = lazy(() => import('./TransactionDraftPanel.jsx').then((module) => ({ default: module.TransactionDraftPanel })));

function normalizeHoldingsNotifyRule(payload = {}) {
  return {
    enabled: Boolean(payload?.enabled),
    digest: payload?.digest || null,
    updatedAt: String(payload?.updatedAt || '')
  };
}

export function HoldingsOverviewShell({
  embedded = false,
  migrationNoticeVisible = false,
  ledger,
  portfolio,
  inceptionDate,
  incomeRoute,
  accountAllocation,
  onAccountSettingsChange,
  navRefresh,
  quickActions,
  fileInputRef,
  onOcrFile,
  aggregatesTable,
  aggregatesTableData,
  aggregates,
  ledgerRows,
  onCreateFirstTransaction,
  onInstallDemoData,
  onAggregateRowClick,
  onOpenAlertDialog,
  pasteModal,
  ocrModal,
  switchPicker,
  sidePanel,
}) {
  const [dailyReturnNotifyRule, setDailyReturnNotifyRule] = useState(() => normalizeHoldingsNotifyRule());
  const [isDailyReturnNotifyCollapsed, setIsDailyReturnNotifyCollapsed] = useState(true);
  const [isSavingDailyReturnNotify, setIsSavingDailyReturnNotify] = useState(false);
  const [isSyncingDailyReturnNotify, setIsSyncingDailyReturnNotify] = useState(false);
  const dailyReturnNotifyDigest = useMemo(
    () => buildHoldingsNotifyDigest({ aggregates, summary: portfolio }),
    [aggregates, portfolio]
  );

  useEffect(() => {
    if (incomeRoute !== ROUTES.OVERVIEW) return undefined;
    let cancelled = false;
    loadHoldingsNotifyRule()
      .then((payload) => {
        if (!cancelled) setDailyReturnNotifyRule(normalizeHoldingsNotifyRule(payload));
      })
      .catch(() => {
        // 未登录或通知服务暂不可用时保持未启用，不阻塞持仓总览。
      });
    return () => {
      cancelled = true;
    };
  }, [incomeRoute]);

  async function handleToggleDailyReturnNotify() {
    const nextEnabled = !dailyReturnNotifyRule.enabled;
    setIsSavingDailyReturnNotify(true);
    try {
      const payload = await saveHoldingsNotifyRule({
        enabled: nextEnabled,
        digest: dailyReturnNotifyDigest
      });
      setDailyReturnNotifyRule({
        ...normalizeHoldingsNotifyRule(payload),
        enabled: typeof payload?.enabled === 'boolean' ? payload.enabled : nextEnabled,
        digest: payload?.digest || dailyReturnNotifyDigest || null,
        updatedAt: String(payload?.updatedAt || new Date().toISOString())
      });
      showActionToast(nextEnabled ? '已开启每日收益通知' : '已关闭每日收益通知', 'success');
    } catch (error) {
      showActionToast('保存每日收益通知失败', 'error', {
        description: error?.message || '请先登录账户后重试。'
      });
    } finally {
      setIsSavingDailyReturnNotify(false);
    }
  }

  async function handleSyncDailyReturnNotify() {
    setIsSyncingDailyReturnNotify(true);
    try {
      const payload = await saveHoldingsNotifyRule({
        enabled: dailyReturnNotifyRule.enabled,
        digest: dailyReturnNotifyDigest
      });
      setDailyReturnNotifyRule({
        ...normalizeHoldingsNotifyRule(payload),
        enabled: typeof payload?.enabled === 'boolean' ? payload.enabled : dailyReturnNotifyRule.enabled,
        digest: payload?.digest || dailyReturnNotifyDigest || null,
        updatedAt: String(payload?.updatedAt || new Date().toISOString())
      });
      showActionToast('已同步每日收益通知持仓', 'success');
    } catch (error) {
      showActionToast('同步每日收益通知失败', 'error', {
        description: error?.message || '请先登录账户后重试。'
      });
    } finally {
      setIsSyncingDailyReturnNotify(false);
    }
  }

  // v7.7: FAB 操作列表（仅移动端显示，按重要性排序）
  const fabActions = [];
  if (quickActions?.onNewTransaction) {
    fabActions.push({
      label: '新增单笔',
      icon: Plus,
      onClick: quickActions.onNewTransaction,
    });
  }
  if (quickActions?.onPasteExcel) {
    fabActions.push({
      label: 'Excel 粘贴',
      icon: ReceiptText,
      onClick: quickActions.onPasteExcel,
    });
  }
  if (quickActions?.onOcr) {
    fabActions.push({
      label: '截图 OCR',
      icon: ScanLine,
      onClick: quickActions.onOcr,
    });
  }
  if (quickActions?.onClearAllData) {
    fabActions.push({
      label: '清除数据',
      icon: Trash2,
      onClick: quickActions.onClearAllData,
      variant: 'danger',
    });
  }

  return (
    <div className={cx('flex flex-col gap-4 px-4 sm:px-6', embedded ? '' : 'mx-auto max-w-[1600px]')}>
      {migrationNoticeVisible ? (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <div>
            检测到从旧持仓汇总迁入的交易，请点击行内编辑按钮补录交易日期。迁入时间：{ledger.legacyMigrationAt?.slice(0, 10) || '—'}
          </div>
        </div>
      ) : null}
      {incomeRoute === ROUTES.OVERVIEW ? (
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start gap-3 text-left"
              onClick={() => setIsDailyReturnNotifyCollapsed((current) => !current)}
              aria-expanded={!isDailyReturnNotifyCollapsed}
              aria-label={isDailyReturnNotifyCollapsed ? '展开每日收益通知设置' : '收起每日收益通知设置'}
            >
              <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-100">
                <Bell className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">每日收益通知</span>
                  <span className={cx(
                    'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    dailyReturnNotifyRule.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  )}>
                    {dailyReturnNotifyRule.enabled ? '已开启' : '未开启'}
                  </span>
                </span>
                {!isDailyReturnNotifyCollapsed ? (
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    收盘后推送持仓组合的当日收益；只同步基金代码和组合权重，不上传份额、成本或金额。
                  </span>
                ) : null}
              </span>
              {isDailyReturnNotifyCollapsed
                ? <ChevronDown className="mt-2 h-4 w-4 flex-none text-slate-400" />
                : <ChevronUp className="mt-2 h-4 w-4 flex-none text-slate-400" />}
            </button>
            {!isDailyReturnNotifyCollapsed ? (
              <div className="flex flex-wrap items-center gap-2 pl-12 sm:flex-none sm:pl-0">
                <button
                  type="button"
                  className={cx(
                    'inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold shadow-sm transition-colors',
                    dailyReturnNotifyRule.enabled
                      ? 'border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50'
                      : 'bg-emerald-600 text-white hover:bg-emerald-500',
                    isSavingDailyReturnNotify && 'cursor-not-allowed opacity-60'
                  )}
                  onClick={handleToggleDailyReturnNotify}
                  disabled={isSavingDailyReturnNotify || isSyncingDailyReturnNotify}
                >
                  {isSavingDailyReturnNotify ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                  {isSavingDailyReturnNotify
                    ? '正在保存'
                    : dailyReturnNotifyRule.enabled ? '关闭通知' : '开启每日收益通知'}
                </button>
                {dailyReturnNotifyRule.enabled ? (
                  <button
                    type="button"
                    className={cx(secondaryButtonClass, 'h-9 rounded-xl px-3 text-xs', isSyncingDailyReturnNotify && 'cursor-not-allowed opacity-60')}
                    onClick={handleSyncDailyReturnNotify}
                    disabled={isSavingDailyReturnNotify || isSyncingDailyReturnNotify}
                  >
                    {isSyncingDailyReturnNotify ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {isSyncingDailyReturnNotify ? '正在同步' : '同步持仓'}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      <IncomeSection
        ledger={ledger}
        portfolio={portfolio}
        inceptionDate={inceptionDate}
        aggregates={aggregates}
        onEditTransaction={sidePanel.onEditTransaction}
        accountAllocation={accountAllocation}
        onAccountSettingsChange={onAccountSettingsChange}
        navRefresh={navRefresh}
        quickActions={quickActions}
      />
      {incomeRoute === ROUTES.OVERVIEW ? (<>
        <div className="grid grid-cols-1 gap-4">
          <section className="min-w-0">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onOcrFile} />
            <div className="min-h-[480px]">
              <AggregateHoldingsTableSection
                table={aggregatesTable}
                tableData={aggregatesTableData}
                aggregates={aggregates}
                onCreateFirstTransaction={onCreateFirstTransaction}
                onInstallDemoData={onInstallDemoData}
                onRowClick={onAggregateRowClick}
                onOpenAlertDialog={onOpenAlertDialog}
              />
            </div>
            <div className="px-1 pt-2 text-[11px] text-slate-400">
              {`持仓中 ${portfolio.assetCount} 只基金；累计 ${ledgerRows.length} 笔流水。`}
            </div>
          </section>
        </div>
        {pasteModal.open ? (
          <Suspense fallback={null}>
            <PasteImportModal
              open={pasteModal.open}
              pasteText={pasteModal.pasteText}
              pasteResult={pasteModal.pasteResult}
              pastePreviewIndex={pasteModal.pastePreviewIndex}
              setPastePreviewIndex={pasteModal.setPastePreviewIndex}
              onClose={pasteModal.onClose}
              onPasteTextChange={pasteModal.onPasteTextChange}
              onParse={pasteModal.onParse}
              onRowFieldChange={pasteModal.onRowFieldChange}
              onImport={pasteModal.onImport}
            />
          </Suspense>
        ) : null}
        {ocrModal.open ? (
          <Suspense fallback={null}>
            <OcrImportModal
              open={ocrModal.open}
              ocrState={ocrModal.ocrState}
              ocrPreview={ocrModal.ocrPreview}
              ocrPreviewIndex={ocrModal.ocrPreviewIndex}
              setOcrPreviewIndex={ocrModal.setOcrPreviewIndex}
              ocrWarningsExpanded={ocrModal.ocrWarningsExpanded}
              setOcrWarningsExpanded={ocrModal.setOcrWarningsExpanded}
              onClose={ocrModal.onClose}
              onTriggerOcr={ocrModal.onTriggerOcr}
              onRowFieldChange={ocrModal.onRowFieldChange}
              onImport={ocrModal.onImport}
            />
          </Suspense>
        ) : null}
      </>) : null}
      {switchPicker.open ? (
        <Suspense fallback={null}>
          <SwitchCounterpartPickerModal
            open={switchPicker.open}
            draft={switchPicker.draft}
            transactions={switchPicker.transactions}
            selectedIds={switchPicker.selectedIds}
            search={switchPicker.search}
            onSearchChange={switchPicker.onSearchChange}
            onToggle={switchPicker.onToggle}
            onAutoSelect={switchPicker.onAutoSelect}
            onConfirm={switchPicker.onConfirm}
            onClose={switchPicker.onClose}
          />
        </Suspense>
      ) : null}
      <HoldingsSidePanel
        open={sidePanel.open}
        title={sidePanel.title}
        onClose={sidePanel.onClose}
      >
        {sidePanel.open ? (
          <Suspense fallback={null}>
            <div>
              {sidePanel.tab === 'summary' ? (
                <HoldingSummaryPanel
                  aggregate={sidePanel.selectedAggregate}
                  onNavigateToMarkets={sidePanel.onNavigateToMarkets}
                  onBuyOrSell={sidePanel.onBuyOrSell}
                  onOpenAlertDialog={onOpenAlertDialog}
                />
              ) : (
                <TransactionDraftPanel
                  draft={sidePanel.draft}
                  draftMode={sidePanel.draftMode}
                  transactions={sidePanel.transactions}
                  onDraftChange={sidePanel.onDraftChange}
                  onResetDraft={sidePanel.onResetDraft}
                  onSubmit={sidePanel.onSubmit}
                  onDeleteTransaction={sidePanel.onDeleteTransaction}
                  onDeleted={sidePanel.onDeleted}
                  onOpenSwitchPicker={sidePanel.onOpenSwitchPicker}
                />
              )}
            </div>
          </Suspense>
        ) : null}
      </HoldingsSidePanel>

      {/* v7.7: 移动端右下角悬浮操作按钮，仅持仓总览展示 */}
      {incomeRoute === ROUTES.OVERVIEW ? <FloatingActionButton actions={fabActions} /> : null}
    </div>
  );
}

export default HoldingsOverviewShell;
