import { ExternalLink } from 'lucide-react';
import { DataTableColumnHeader } from '../../components/data-table/data-table-column-header';
import { formatCurrency } from '../../app/accumulation.js';
import { ACCOUNT_TYPES, getAssignedAccount } from '../../app/accountManager.js';
import {
  KIND_LABELS,
  KIND_PILL_TONES,
  TAG_LABELS,
  TAG_PILL_TONES,
  formatNav,
  formatShares,
  formatSignedCurrency,
  formatSignedPercent
} from '../../app/holdingsHelpers.js';
import { Pill, cx } from '../../components/experience-ui.jsx';

export function createAggregateHoldingsColumns({
  accountAssignments,
  kindFilterOptions,
  numericSortFn,
  onAccountChange,
  onNavigateToMarkets,
}) {
  return [
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
      cell: ({ row }) => {
        const tags = Array.isArray(row.original.tags) && row.original.tags.length > 0
          ? row.original.tags
          : [row.original.kind];
        return (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Pill key={tag} tone={TAG_PILL_TONES[tag] || KIND_PILL_TONES[tag] || 'slate'}>
                {TAG_LABELS[tag] || KIND_LABELS[tag] || tag}
              </Pill>
            ))}
          </div>
        );
      },
      filterFn: (row, columnId, filterValue) => {
        if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
        const tags = Array.isArray(row.original.tags) ? row.original.tags : [row.original.kind];
        return tags.some((t) => filterValue.includes(t));
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
          onChange={(event) => onAccountChange(row.original.code, event.target.value)}
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
          {row.original.pendingBuyAmount > 0 ? (
            <span className="ml-1 rounded-full bg-sky-50 px-1.5 py-px text-[10px] font-medium text-sky-600" title={row.original.kind === 'qdii' ? 'QDII 申购：T 日净值由 T+1 晚公布，T+2 确认后自动生成份额' : '场外申购：T 日晚公布 NAV，T+1 确认后自动生成份额'}>
              买入{formatCurrency(row.original.pendingBuyAmount, '¥', 2)}待确认
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
      accessorFn: (row) => row.currentPrice ?? row.latestNav,
      meta: { label: '当前价格' },
      header: ({ column }) => <DataTableColumnHeader column={column} label="当前价格" />,
      cell: ({ row }) => {
        const r = row.original;
        if (!r.hasCurrentPrice) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="tabular-nums">
            {formatNav(r.currentPrice ?? r.latestNav)}
            {r.kind === 'exchange' && r.latestNav ? (
              <span className="ml-1 text-[10px] text-muted-foreground">NAV {formatNav(r.latestNav)}</span>
            ) : null}
          </span>
        );
      },
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
        if (!row.original.hasCurrentPrice) return <span className="text-muted-foreground">—</span>;
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
        if (!row.original.hasCurrentPrice) return <span className="text-muted-foreground">—</span>;
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
        if (!row.original.hasCurrentPrice) return <span className="text-muted-foreground">—</span>;
        const v = row.original.hasTodayNav ? row.original.todayProfit : 0;
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
        if (!row.original.hasCurrentPrice) return <span className="text-muted-foreground">—</span>;
        const v = row.original.hasTodayNav ? row.original.todayReturnRate : 0;
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
          onClick={(event) => { event.stopPropagation(); onNavigateToMarkets(event, row.original.code); }}
          title="查看行情详情"
        >
          <ExternalLink className="h-3.5 w-3.5" />行情
        </button>
      ),
    },
  ];
}
