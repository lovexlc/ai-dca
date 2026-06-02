import { useMemo } from 'react';
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { DataTable } from '../../components/data-table/data-table.jsx';
import { DataTableColumnHeader } from '../../components/data-table/data-table-column-header.jsx';
import { DataTableToolbar } from '../../components/data-table/data-table-toolbar.jsx';
import { DataTableViewOptions } from '../../components/data-table/data-table-view-options.jsx';
import { cx } from '../../components/experience-ui.jsx';
import { Sparkline } from '../../components/markets/Sparkline.jsx';
import {
  changeToneClass,
  feeRateToneClass,
  formatFeeRate,
  formatNumber,
  formatPercent,
  formatPremiumPercent,
  formatRedeemFeeRate,
  formatSymbolDisplay,
  formatTotalShares,
  formatYearPercent,
  resolveFundFeeRate,
  resolveRedeemFeeRate,
  resolvePremiumPercent
} from './marketDisplayUtils.js';
import {
  formatSwitchLimitAmount,
  switchLimitToneFor,
  switchLimitLabelFor,
} from '../switchStrategyHelpers.js';
import {
  getExpectedLatestNavDate,
  getTodayShanghaiDate,
  normalizeFundKind,
} from '../../app/holdingsLedgerBasics.js';

const numericSortFn = (rowA, rowB, columnId) => {
  const a = rowA.getValue(columnId);
  const b = rowB.getValue(columnId);
  const aN = !Number.isFinite(Number(a));
  const bN = !Number.isFinite(Number(b));
  if (aN && bN) return 0;
  if (aN) return 1;
  if (bN) return -1;
  return Number(a) - Number(b);
};

function normalizeDateKey(value) {
  return String(value || '').trim().slice(0, 10);
}

function isExpectedLatestChangeRow(row, todayDate) {
  const latestNavDate = normalizeDateKey(row?.latestNavDate);
  if (!latestNavDate) return false;
  const kind = normalizeFundKind(row?.kind || row?.assetType, row?.code || row?.symbol, row?.name || '');
  const expectedLatestNavDate = getExpectedLatestNavDate(kind, todayDate);
  return latestNavDate >= expectedLatestNavDate && latestNavDate <= todayDate;
}

export function MarketListTable({
  rows = [],
  klineMap = {},
  selectedSymbol = '',
  onSelect,
  compact = false,
  stickyHeader = false,
  stickyFirstColumn = false,
  showLimitColumn = false,
  hidePremiumColumn = false,
  hideTrendColumn = false,
  dataTable = false,
}) {
  const todayDate = getTodayShanghaiDate();
  const isLatestChangeRow = (row) => {
    return isExpectedLatestChangeRow(row, todayDate);
  };
  const columns = useMemo(() => ([
    {
      id: 'symbol',
      accessorFn: (row) => formatSymbolDisplay(row.symbol),
      meta: { label: '代码' },
      enableHiding: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="代码" />,
      cell: ({ row }) => <span className="font-mono text-xs font-semibold tabular-nums">{formatSymbolDisplay(row.original.symbol)}</span>,
    },
    {
      id: 'name',
      accessorFn: (row) => row.name || '',
      meta: { label: '名称' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="名称" />,
      cell: ({ row }) => {
        const displaySymbol = formatSymbolDisplay(row.original.symbol);
        return (
          <div className="min-w-0">
            <div className="truncate font-medium text-[#1f1f1f]">{row.original.name || displaySymbol}</div>
            {row.original.meta ? <div className="truncate text-[10px] text-[#5f6368]">{row.original.meta}</div> : null}
          </div>
        );
      },
    },
    {
      id: 'price',
      accessorFn: (row) => Number(row.price),
      meta: { label: '最新价' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="最新价" />,
      cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.price)}</span>,
      sortingFn: numericSortFn,
    },
    {
      id: 'changePercent',
      accessorFn: (row) => Number(row.changePercent),
      meta: { label: '涨跌幅' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="涨跌幅" />,
      cell: ({ row }) => {
        const pct = Number(row.original.changePercent);
        const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
        const latest = isExpectedLatestChangeRow(row.original, todayDate);
        return (
          <span className="inline-flex items-center justify-end gap-1.5">
            <span className={cx('font-semibold tabular-nums', flat ? 'text-[#5f6368]' : pct > 0 ? 'text-[#a50e0e]' : 'text-[#137333]')}>{formatPercent(row.original.changePercent)}</span>
            {latest ? <span className="rounded-full bg-[#e8f0fe] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#1a73e8]">最新</span> : null}
          </span>
        );
      },
      sortingFn: numericSortFn,
    },
    showLimitColumn ? {
      id: 'limit',
      accessorFn: (row) => Number(row.fundLimit?.maxPurchasePerDay) || 0,
      meta: { label: '限额' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="限额" />,
      cell: ({ row }) => row.original.fundLimit ? (
        <div className="flex flex-col items-end gap-0.5">
          <span className={cx(
            'inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
            switchLimitToneFor(row.original.fundLimit.buyStatus) === 'emerald' ? 'bg-emerald-50 text-emerald-700' :
            switchLimitToneFor(row.original.fundLimit.buyStatus) === 'amber' ? 'bg-amber-50 text-amber-700' :
            switchLimitToneFor(row.original.fundLimit.buyStatus) === 'red' ? 'bg-red-50 text-red-700' :
            'bg-slate-50 text-slate-500'
          )}>{switchLimitLabelFor(row.original.fundLimit.buyStatus)}</span>
          {Number(row.original.fundLimit.maxPurchasePerDay) > 0 ? (
            <span className="tabular-nums text-[#5f6368]">{formatSwitchLimitAmount(row.original.fundLimit.maxPurchasePerDay)}</span>
          ) : null}
        </div>
      ) : <span className="text-[#9aa0a6]">—</span>,
      sortingFn: numericSortFn,
    } : null,
    !hidePremiumColumn ? {
      id: 'premium',
      accessorFn: (row) => Number(resolvePremiumPercent(row)),
      meta: { label: '溢价' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="溢价" />,
      cell: ({ row }) => {
        const premiumPct = resolvePremiumPercent(row.original);
        return <span className={cx('font-semibold tabular-nums', changeToneClass(premiumPct))}>{formatPremiumPercent(row.original)}</span>;
      },
      sortingFn: numericSortFn,
    } : null,
    {
      id: 'currentYearPercent',
      accessorFn: (row) => Number(row.currentYearPercent),
      meta: { label: '年内涨幅' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="年内涨幅" />,
      cell: ({ row }) => <span className={cx('font-semibold tabular-nums', changeToneClass(Number(row.original.currentYearPercent)))}>{formatYearPercent(row.original)}</span>,
      sortingFn: numericSortFn,
    },
    {
      id: 'totalShares',
      accessorFn: (row) => Number(row.totalShares),
      meta: { label: '总份额' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="总份额" />,
      cell: ({ row }) => <span className="tabular-nums">{formatTotalShares(row.original.totalShares)}</span>,
      sortingFn: numericSortFn,
    },
    {
      id: 'feeRate',
      accessorFn: (row) => Number(resolveFundFeeRate(row)),
      meta: { label: '费率' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="费率" />,
      cell: ({ row }) => <span className={cx('font-semibold tabular-nums', feeRateToneClass(row.original))}>{formatFeeRate(row.original)}</span>,
      sortingFn: numericSortFn,
    },
    {
      id: 'redeemFeeRate',
      accessorFn: (row) => Number(resolveRedeemFeeRate(row)),
      meta: { label: '卖出费率' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="卖出费率" />,
      cell: ({ row }) => <span className="font-semibold tabular-nums text-[#5f6368]">{formatRedeemFeeRate(row.original)}</span>,
      sortingFn: numericSortFn,
    },
    !hideTrendColumn ? {
      id: 'trend',
      accessorFn: (row) => Number(row.changePercent),
      meta: { label: '趋势' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="趋势" />,
      cell: ({ row }) => {
        const pct = Number(row.original.changePercent);
        const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
        return (
          <div className="inline-flex justify-end">
            <Sparkline points={klineMap[row.original.symbol]} width={86} height={26} tone={flat ? 'flat' : pct > 0 ? 'up' : 'down'} showFill markLast />
          </div>
        );
      },
      sortingFn: numericSortFn,
    } : null,
  ].filter(Boolean)), [showLimitColumn, hidePremiumColumn, hideTrendColumn, klineMap, todayDate]);
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      sorting: [{ id: 'changePercent', desc: true }],
      pagination: { pageSize: 50 },
    },
  });

  if (!rows.length) {
    return <p className="px-2 py-2 text-sm text-[#5f6368]">未配置自选。</p>;
  }
  if (dataTable) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <DataTableToolbar table={table}>
          <DataTableViewOptions table={table} />
        </DataTableToolbar>
        <DataTable
          table={table}
          className="[&_td]:text-right [&_td:first-child]:text-left [&_td:nth-child(2)]:text-left [&_th]:whitespace-nowrap"
          onRowClick={(tableRow) => onSelect?.(tableRow.original)}
        />
      </div>
    );
  }
  const cellPad = compact ? 'px-2 py-2' : 'px-3 py-2';
  const stickyHeadCell = stickyFirstColumn
    ? 'sticky left-0 z-20 border-r border-[#e8eaed] bg-[#f8fafd] shadow-[8px_0_12px_-12px_rgba(60,64,67,0.45)]'
    : '';
  const stickyBodyCell = (selected) => stickyFirstColumn
    ? cx('sticky left-0 z-10 border-r border-[#e8eaed] shadow-[8px_0_12px_-12px_rgba(60,64,67,0.35)]', selected ? 'bg-[#e8f0fe]' : 'bg-white group-hover:bg-[#f1f3f4]')
    : '';
  return (
    <div className={cx('overflow-x-auto', compact ? 'rounded-xl border border-[#e8eaed] bg-white' : 'rounded-2xl border border-[#e8eaed] bg-white shadow-sm')}>
      <table className={cx('w-full min-w-[980px] border-separate border-spacing-0 text-sm', compact && 'min-w-[900px] text-[12px]')}>
        <thead className={cx('bg-[#f8fafd] text-[11px] font-semibold text-[#5f6368]', stickyHeader && 'sticky top-0 z-10')}>
          <tr>
            <th className={cx(cellPad, 'text-left', stickyHeadCell)}>代码</th>
            <th className={cx(cellPad, 'text-left')}>名称</th>
            <th className={cx(cellPad, 'text-right')}>最新价</th>
            <th className={cx(cellPad, 'text-right')}>涨跌幅</th>
            {showLimitColumn ? <th className={cx(cellPad, 'text-right')}>限额</th> : null}
            {!hidePremiumColumn ? <th className={cx(cellPad, 'text-right')}>溢价</th> : null}
            <th className={cx(cellPad, 'text-right')}>年内涨幅</th>
            <th className={cx(cellPad, 'text-right')}>总份额</th>
            <th className={cx(cellPad, 'text-right')}>费率</th>
            <th className={cx(cellPad, 'text-right')}>卖出费率</th>
            {!hideTrendColumn ? <th className={cx(cellPad, 'text-right')}>趋势</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e8eaed]">
          {rows.map((row) => {
            const displaySymbol = formatSymbolDisplay(row.symbol);
            const pct = Number(row.changePercent);
            const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
            const up = pct > 0;
            const premiumPct = resolvePremiumPercent(row);
            const selected = row.symbol === selectedSymbol;
            return (
              <tr
                key={row.symbol}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={() => onSelect?.(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect?.(row);
                  }
                }}
                className={cx(
                  'group cursor-pointer transition hover:bg-[#f1f3f4] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30',
                  selected && 'bg-[#e8f0fe] hover:bg-[#e8f0fe]'
                )}
              >
                <td className={cx(cellPad, 'w-[88px] whitespace-nowrap font-mono text-xs font-semibold text-[#1f1f1f]', stickyBodyCell(selected))}>{displaySymbol}</td>
                <td className={cx(cellPad, 'min-w-[120px] text-[#1f1f1f]')}>
                  <div className="truncate font-medium">{row.name || displaySymbol}</div>
                  {row.meta ? <div className="truncate text-[10px] text-[#5f6368]">{row.meta}</div> : null}
                </td>
                <td className={cx(cellPad, 'whitespace-nowrap text-right tabular-nums text-[#1f1f1f]')}>{formatNumber(row.price)}</td>
                <td className={cx(cellPad, 'whitespace-nowrap text-right')}>
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <span className={cx('font-semibold tabular-nums', flat ? 'text-[#5f6368]' : up ? 'text-[#a50e0e]' : 'text-[#137333]')}>{formatPercent(row.changePercent)}</span>
                    {isLatestChangeRow(row) ? <span className="rounded-full bg-[#e8f0fe] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#1a73e8]">最新</span> : null}
                  </span>
                </td>
                {showLimitColumn ? (
                  <td className={cx(cellPad, 'whitespace-nowrap text-right text-xs')}>
                    {row.fundLimit ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={cx(
                          'inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                          switchLimitToneFor(row.fundLimit.buyStatus) === 'emerald' ? 'bg-emerald-50 text-emerald-700' :
                          switchLimitToneFor(row.fundLimit.buyStatus) === 'amber' ? 'bg-amber-50 text-amber-700' :
                          switchLimitToneFor(row.fundLimit.buyStatus) === 'red' ? 'bg-red-50 text-red-700' :
                          'bg-slate-50 text-slate-500'
                        )}>{switchLimitLabelFor(row.fundLimit.buyStatus)}</span>
                        {Number(row.fundLimit.maxPurchasePerDay) > 0 ? (
                          <span className="tabular-nums text-[#5f6368]">{formatSwitchLimitAmount(row.fundLimit.maxPurchasePerDay)}</span>
                        ) : null}
                      </div>
                    ) : <span className="text-[#9aa0a6]">—</span>}
                  </td>
                ) : null}
                {!hidePremiumColumn ? (
                  <td className={cx(cellPad, 'whitespace-nowrap text-right font-semibold tabular-nums', changeToneClass(premiumPct))}>{formatPremiumPercent(row)}</td>
                ) : null}
                <td className={cx(cellPad, 'whitespace-nowrap text-right font-semibold tabular-nums', changeToneClass(Number(row.currentYearPercent)))}>{formatYearPercent(row)}</td>
                <td className={cx(cellPad, 'whitespace-nowrap text-right tabular-nums text-[#1f1f1f]')}>{formatTotalShares(row.totalShares)}</td>
                <td className={cx(cellPad, 'whitespace-nowrap text-right font-semibold tabular-nums', feeRateToneClass(row))}>{formatFeeRate(row)}</td>
                <td className={cx(cellPad, 'whitespace-nowrap text-right font-semibold tabular-nums text-[#5f6368]')}>{formatRedeemFeeRate(row)}</td>
                {!hideTrendColumn ? (
                  <td className={cx(cellPad, 'text-right')}>
                    <div className="inline-flex justify-end">
                      <Sparkline points={klineMap[row.symbol]} width={compact ? 72 : 86} height={compact ? 24 : 26} tone={flat ? 'flat' : up ? 'up' : 'down'} showFill markLast />
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
