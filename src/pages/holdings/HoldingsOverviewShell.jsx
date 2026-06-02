import { AlertTriangle } from 'lucide-react';
import { IncomeSection } from '../../app/income/IncomeSection.jsx';
import { ROUTES } from '../../app/incomeRoute.js';
import { cx } from '../../components/experience-ui.jsx';
import { AggregateHoldingsTableSection } from './AggregateHoldingsTableSection.jsx';
import { HoldingSummaryPanel } from './HoldingSummaryPanel.jsx';
import { HoldingsSidePanel } from './HoldingsSidePanel.jsx';
import { OcrImportModal, PasteImportModal } from './TransactionImportModals.jsx';
import { SwitchCounterpartPickerModal } from './SwitchCounterpartPickerModal.jsx';
import { TransactionDraftPanel } from './TransactionDraftPanel.jsx';

export function HoldingsOverviewShell({
  embedded = false,
  migrationNoticeVisible = false,
  ledger,
  portfolio,
  inceptionDate,
  incomeRoute,
  accountAllocation,
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
  pasteModal,
  ocrModal,
  switchPicker,
  sidePanel,
}) {
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
        onEditTransaction={sidePanel.onEditTransaction}
        accountAllocation={accountAllocation}
        navRefresh={navRefresh}
        quickActions={quickActions}
      />
      {incomeRoute === ROUTES.OVERVIEW ? (<>
        <div className="grid grid-cols-1 gap-4">
          <section className="min-w-0 rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onOcrFile} />
            <div className="min-h-[480px] px-1">
              <AggregateHoldingsTableSection
                table={aggregatesTable}
                tableData={aggregatesTableData}
                aggregates={aggregates}
                onCreateFirstTransaction={onCreateFirstTransaction}
                onInstallDemoData={onInstallDemoData}
                onRowClick={onAggregateRowClick}
              />
            </div>
            <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
              {`持仓中 ${portfolio.assetCount} 只基金；累计 ${ledgerRows.length} 笔流水。`}
            </div>
          </section>
        </div>
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
      </>) : null}
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
      <HoldingsSidePanel
        open={sidePanel.open}
        title={sidePanel.title}
        onClose={sidePanel.onClose}
      >
        <div>
          {sidePanel.tab === 'summary' ? (
            <HoldingSummaryPanel
              aggregate={sidePanel.selectedAggregate}
              onNavigateToMarkets={sidePanel.onNavigateToMarkets}
              onBuyOrSell={sidePanel.onBuyOrSell}
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
      </HoldingsSidePanel>
    </div>
  );
}

export default HoldingsOverviewShell;
