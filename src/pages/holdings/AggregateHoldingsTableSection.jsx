import { Plus, Wallet } from 'lucide-react';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { DataTableViewOptions } from '@/components/data-table/data-table-view-options';
import { formatCurrency } from '../../app/accumulation.js';
import {
  formatSignedCurrency,
  formatSignedPercent
} from '../../app/holdingsHelpers.js';
import { cx, primaryButtonClass } from '../../components/experience-ui.jsx';

export function AggregateHoldingsTableSection({
  table,
  tableData,
  aggregates,
  onCreateFirstTransaction,
  onInstallDemoData,
  onRowClick
}) {
  if (tableData.length === 0) {
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
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button type="button" className={primaryButtonClass} onClick={onCreateFirstTransaction}>
              <Plus className="h-4 w-4" />录入第一笔交易
            </button>
            {onInstallDemoData ? (
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                onClick={onInstallDemoData}
              >
                生成demo数据
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const filteredAggs = table.getFilteredRowModel().rows.map((r) => r.original);
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
  const footerRow = {
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
  const hideableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide());
  const hiddenColumns = hideableColumns.filter((column) => !column.getIsVisible());
  const defaultHiddenColumns = hideableColumns.filter((column) => column.columnDef?.meta?.defaultHidden);
  const compactActive = defaultHiddenColumns.length > 0 && defaultHiddenColumns.every((column) => !column.getIsVisible());
  const fullActive = hiddenColumns.length === 0;
  const showCompactColumns = () => {
    hideableColumns.forEach((column) => column.toggleVisibility(!column.columnDef?.meta?.defaultHidden));
  };
  const showAllColumns = () => {
    hideableColumns.forEach((column) => column.toggleVisibility(true));
  };
  const columnViewPresets = [
    { key: 'compact', label: '精简视图', active: compactActive, onSelect: showCompactColumns },
    { key: 'full', label: '完整视图', active: fullActive, onSelect: showAllColumns },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">基金汇总</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {hiddenColumns.length > 0
                ? `精简显示 ${table.getVisibleLeafColumns().length} 列，已收起 ${hiddenColumns.length} 个次要列。`
                : '完整显示全部列。'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DataTableViewOptions table={table} presetActions={columnViewPresets} />
          </div>
        </div>
        <DataTableToolbar table={table} className="mt-3" />
      </div>
      <DataTable
        table={table}
        footerRow={footerRow}
        resizable
        onRowClick={onRowClick}
      />
    </div>
  );
}
