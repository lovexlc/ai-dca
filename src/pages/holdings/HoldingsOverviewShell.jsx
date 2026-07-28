import { AlertTriangle, ScanLine, ReceiptText, Plus, Trash2 } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { IncomeSection } from '../../app/income/IncomeSection.jsx';
import { ROUTES } from '../../app/incomeRoute.js';
import { cx } from '../../components/experience-ui.jsx';
import { FloatingActionButton } from '../../components/FloatingActionButton.jsx';
import { AggregateHoldingsTableSection } from './AggregateHoldingsTableSection.jsx';
import { HoldingsSidePanel } from './HoldingsSidePanel.jsx';
import { TodaySignalPanel } from './TodaySignalPanel.jsx';

const HoldingSummaryPanel = lazy(() => import('./HoldingSummaryPanel.jsx').then((module) => ({ default: module.HoldingSummaryPanel })));
const PasteImportModal = lazy(() => import('./TransactionImportModals.jsx').then((module) => ({ default: module.PasteImportModal })));
const OcrImportModal = lazy(() => import('./TransactionImportModals.jsx').then((module) => ({ default: module.OcrImportModal })));
const SwitchCounterpartPickerModal = lazy(() => import('./SwitchCounterpartPickerModal.jsx').then((module) => ({ default: module.SwitchCounterpartPickerModal })));
const TransactionDraftPanel = lazy(() => import('./TransactionDraftPanel.jsx').then((module) => ({ default: module.TransactionDraftPanel })));

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
  todaySignals,
  onCreateFirstTransaction,
  onInstallDemoData,
  onAggregateRowClick,
  onOpenAlertDialog,
  pasteModal,
  ocrModal,
  switchPicker,
  sidePanel,
}) {
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
            <div className="mb-4">
              <TodaySignalPanel
                loading={todaySignals?.loading}
                switchSummary={todaySignals?.switchSummary}
                exitSummary={todaySignals?.exitSummary}
                dismissedSignalCount={todaySignals?.dismissedSignalCount}
                onOpenFundSwitch={todaySignals?.onOpenFundSwitch}
                onOpenExitSignal={todaySignals?.onOpenExitSignal}
                onDismissSignals={todaySignals?.onDismissSignals}
                onRestoreSignals={todaySignals?.onRestoreSignals}
              />
            </div>
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
