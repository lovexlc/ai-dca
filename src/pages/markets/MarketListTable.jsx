import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
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
  formatMarketPrice,
  formatPercent,
  formatPremiumPercent,
  formatRedeemFeeRate,
  formatRedeemFeeTiers,
  formatSignedPercent,
  formatSymbolDisplay,
  formatTotalShares,
  formatTurnover,
  formatYearPercent,
  resolveFundFeeRate,
  resolveRedeemFeeRate,
  resolvePremiumPercent
} from './marketDisplayUtils.js';
import {
  formatSwitchLimitAmount,
  shouldShowAppTag,
  switchLimitToneFor,
  switchLimitLabelFor,
} from '../switchStrategyHelpers.js';
import {
  getExpectedLatestNavDate,
  getTodayShanghaiDate,
  normalizeFundKind,
} from '../../app/holdingsLedgerBasics.js';
import { resolveHighDrawdown } from './marketHighDrawdown.js';

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

const textIncludesFilterFn = (row, columnId, filterValue) => {
  const query = String(filterValue || '').trim().toLowerCase();
  if (!query) return true;
  return String(row.getValue(columnId) ?? '').toLowerCase().includes(query);
};

const numberRangeFilterFn = (row, columnId, filterValue) => {
  if (!filterValue || typeof filterValue !== 'object' || Array.isArray(filterValue)) return true;
  const min = filterValue.min === '' || filterValue.min == null ? null : Number(filterValue.min);
  const max = filterValue.max === '' || filterValue.max == null ? null : Number(filterValue.max);
  const hasMin = Number.isFinite(min);
  const hasMax = Number.isFinite(max);
  if (!hasMin && !hasMax) return true;
  const value = Number(row.getValue(columnId));
  if (!Number.isFinite(value)) return false;
  if (hasMin && value < min) return false;
  if (hasMax && value > max) return false;
  return true;
};

const LIMIT_FILTER_OPTIONS = [
  { value: 'open', label: '正常申购' },
  { value: 'limit_large', label: '限大额' },
  { value: 'limit', label: '限额' },
  { value: 'suspended', label: '暂停申购' },
  { value: 'closed', label: '已关闭' },
  { value: 'app', label: 'App' },
  { value: 'none', label: '无限额' },
];

function normalizeLimitStatus(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  if (['open', 'limit_large', 'limit', 'suspended', 'closed'].includes(key)) return key;
  if (/已关闭|关闭|停止/.test(raw)) return 'closed';
  if (/暂停申购|暂停/.test(raw)) return 'suspended';
  if (/限大额|大额限制|大额申购/.test(raw)) return 'limit_large';
  if (/限额|限购/.test(raw)) return 'limit';
  if (/正常|开放|开通|可申购|不限/.test(raw)) return 'open';
  if (raw === '0' || raw === '001') return 'open';
  if (raw === '1' || raw === '002') return 'limit_large';
  if (raw === '2' || raw === '003') return 'suspended';
  return '';
}

function resolveLimitFilterValues(row) {
  const values = [];
  const status = normalizeLimitStatus(row?.fundLimit?.buyStatus || row?.fundLimit?.buyStatusText);
  if (status) values.push(status);
  if (shouldShowAppTag(row?.fundMeta, row?.fundLimit)) values.push('app');
  if (!status && !shouldShowAppTag(row?.fundMeta, row?.fundLimit)) values.push('none');
  return values;
}

function getAvailableLimitFilterOptions(rows) {
  const available = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    resolveLimitFilterValues(row).forEach((value) => available.add(value));
  }
  return LIMIT_FILTER_OPTIONS.filter((option) => available.has(option.value));
}

const limitFilterFn = (row, _columnId, filterValue) => {
  const selected = Array.isArray(filterValue) ? filterValue : filterValue ? [filterValue] : [];
  if (!selected.length) return true;
  const values = resolveLimitFilterValues(row.original);
  return selected.some((item) => values.includes(item));
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

function formatHighDrawdownPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : '—';
}

function highDrawdownToneClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'text-[#9aa0a6]';
  return number > 0.05 ? 'text-[#137333]' : 'text-[#5f6368]';
}

function highDrawdownTitle(drawdown, row) {
  if (!drawdown) return '';
  const parts = [`高点 ${formatMarketPrice(drawdown.high, row)}`];
  if (drawdown.highDate) parts.push(drawdown.highDate);
  return parts.join(' · ');
}

function resolveLimitSortValue(limit) {
  if (!limit || limit.buyStatus === 'suspended' || limit.buyStatus === 'closed') return 0;
  return Number(limit.maxPurchasePerDay) || 0;
}

const RETURN_COLUMNS = [
  { id: 'return1w', label: '近1周' },
  { id: 'return1m', label: '近1月' },
  { id: 'return3m', label: '近3月' },
  { id: 'return6m', label: '近6月' },
  { id: 'return1y', label: '近1年' },
  { id: 'returnBase', label: '成立以来' },
];

const DEFAULT_HIDDEN_COLUMNS = {
  premium: true,  // 溢价率列默认显示
  highDrawdown: true,
  historicalPercentile: false,  // 历史水位列默认隐藏，用户可手动开启
  ...Object.fromEntries(RETURN_COLUMNS.map((c) => [c.id, false])),
};

const MOBILE_DATA_TABLE_HIDDEN_COLUMNS = {
  heldRank: false,
  limit: false,
  premium: false,
  highDrawdown: true,
  historicalPercentile: false,
  currentYearPercent: false,
  return1w: false,
  return1m: false,
  return3m: false,
  return6m: false,
  return1y: false,
  returnBase: false,
  totalShares: false,
  feeRate: false,
  redeemFeeRate: false,
  trend: false,
};

const PLAIN_TABLE_TOGGLE_COLUMNS = [
  { id: 'highDrawdown', label: '高点下跌' },
  { id: 'historicalPercentile', label: '历史水位' },
  ...RETURN_COLUMNS,
];

const COLUMN_VISIBILITY_STORAGE_KEY = 'markets:columnVisibility';
const TABLE_VIEW_STATE_STORAGE_KEY = 'markets:tableViewState:v1';
const TABLE_VIEW_PRESETS_STORAGE_KEY = 'markets:tableViewPresets:v1';
const TABLE_VIEW_SCOPE_MIGRATION_KEY = 'markets:tableViewScopeMigration:v1';

function scopedStorageKey(baseKey, scope) {
  const normalizedScope = String(scope || '').trim();
  return normalizedScope ? `${baseKey}:${normalizedScope}` : baseKey;
}

function readJsonStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function readColumnVisibility() {
  return readJsonStorage(COLUMN_VISIBILITY_STORAGE_KEY, DEFAULT_HIDDEN_COLUMNS);
}

function writeColumnVisibility(visibility) {
  writeJsonStorage(COLUMN_VISIBILITY_STORAGE_KEY, visibility);
}

function readTableViewState(key = TABLE_VIEW_STATE_STORAGE_KEY) {
  return readJsonStorage(key, {});
}

function writeTableViewState(state, key = TABLE_VIEW_STATE_STORAGE_KEY) {
  writeJsonStorage(key, state || {});
}

function readTableViewPresets(key = TABLE_VIEW_PRESETS_STORAGE_KEY) {
  const list = readJsonStorage(key, []);
  return Array.isArray(list) ? list.filter((item) => item && item.id && item.name && item.state) : [];
}

function writeTableViewPresets(presets, key = TABLE_VIEW_PRESETS_STORAGE_KEY) {
  writeJsonStorage(key, Array.isArray(presets) ? presets.slice(0, 12) : []);
}

function hasViewState(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function readInitialTableViewStorage(scope, stateKey, presetsKey) {
  const scopedState = readTableViewState(stateKey);
  const scopedPresets = readTableViewPresets(presetsKey);
  const normalizedScope = String(scope || '').trim();
  if (!normalizedScope || scopedPresets.length) {
    return { state: scopedState, presets: scopedPresets };
  }

  const migratedScope = readJsonStorage(TABLE_VIEW_SCOPE_MIGRATION_KEY, '');
  if (migratedScope) return { state: scopedState, presets: scopedPresets };

  const legacyState = readTableViewState(TABLE_VIEW_STATE_STORAGE_KEY);
  const legacyPresets = readTableViewPresets(TABLE_VIEW_PRESETS_STORAGE_KEY);
  const shouldMigrateState = !hasViewState(scopedState) && hasViewState(legacyState);
  const shouldMigratePresets = legacyPresets.length > 0;
  if (!shouldMigrateState && !shouldMigratePresets) return { state: scopedState, presets: scopedPresets };

  if (shouldMigrateState) writeTableViewState(legacyState, stateKey);
  if (shouldMigratePresets) writeTableViewPresets(legacyPresets, presetsKey);
  writeJsonStorage(TABLE_VIEW_SCOPE_MIGRATION_KEY, normalizedScope);
  return {
    state: shouldMigrateState ? legacyState : scopedState,
    presets: shouldMigratePresets ? legacyPresets : scopedPresets,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildTableViewKey(state = {}) {
  return stableStringify({
    sorting: Array.isArray(state.sorting) ? state.sorting : [],
    columnFilters: Array.isArray(state.columnFilters) ? state.columnFilters : [],
    columnVisibility: state.columnVisibility && typeof state.columnVisibility === 'object' ? state.columnVisibility : {},
  });
}

function normalizeTableViewState(value = {}, fallbackVisibility = {}) {
  return {
    sorting: Array.isArray(value.sorting) ? value.sorting : [{ id: 'heldRank', desc: true }, { id: 'changePercent', desc: true }],
    columnFilters: Array.isArray(value.columnFilters) ? value.columnFilters : [],
    columnVisibility: value.columnVisibility && typeof value.columnVisibility === 'object' && !Array.isArray(value.columnVisibility)
      ? value.columnVisibility
      : fallbackVisibility,
  };
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
  columnVisibility: controlledVisibility,
  onColumnVisibilityChange,
  onColumnVisibilityStateChange,
  dataTableHeader,
  dataTableChrome,
  dataTableViewOptionsProps,
  tableChromeClassName,
  containerClassName = '',
  dataTableClassName = '',
  dataTableContainerClassName = '',
  autoPinColumn = false,
  onVisibleSymbolsChange,
  viewStorageScope = '',
  rowTestIdPrefix = '',
}) {
  const todayDate = getTodayShanghaiDate();
  const tableScrollRef = useRef(null);
  const [columnPinning, setColumnPinning] = useState({ left: [] });
  const [pinTargetColumnId, setPinTargetColumnId] = useState('');
  const defaultColumnVisibility = compact ? MOBILE_DATA_TABLE_HIDDEN_COLUMNS : {
    heldRank: false,
    return1w: false,
    return1m: false,
    return3m: false,
    return6m: false,
    return1y: false,
    returnBase: false,
    ...readColumnVisibility(),
  };
  const viewStateStorageKey = scopedStorageKey(TABLE_VIEW_STATE_STORAGE_KEY, viewStorageScope);
  const viewPresetsStorageKey = scopedStorageKey(TABLE_VIEW_PRESETS_STORAGE_KEY, viewStorageScope);
  const initialViewStorage = readInitialTableViewStorage(viewStorageScope, viewStateStorageKey, viewPresetsStorageKey);
  const initialViewState = normalizeTableViewState(initialViewStorage.state, defaultColumnVisibility);
  const [sorting, setSorting] = useState(initialViewState.sorting);
  const [columnFilters, setColumnFilters] = useState(initialViewState.columnFilters);
  const [localVisibility, setLocalVisibility] = useState(initialViewState.columnVisibility);
  const [viewPresets, setViewPresets] = useState(initialViewStorage.presets);
  const limitFilterOptions = useMemo(() => getAvailableLimitFilterOptions(rows), [rows]);
  const isLatestChangeRow = (row) => {
    return isExpectedLatestChangeRow(row, todayDate);
  };
  const columns = useMemo(() => ([
    {
      id: 'heldRank',
      accessorFn: (row) => (row.isHeld ? 1 : 0),
      enableHiding: false,
      header: () => null,
      cell: () => null,
      sortingFn: numericSortFn,
    },
    {
      id: 'symbol',
      accessorFn: (row) => formatSymbolDisplay(row.symbol),
      meta: { label: '代码', variant: 'text' },
      size: 96,
      enableHiding: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="代码" />,
      cell: ({ row }) => (
        <span className={cx('font-mono text-xs font-semibold tabular-nums', row.original.isHeld ? 'text-[#a50e0e]' : '')}>
          {formatSymbolDisplay(row.original.symbol)}
        </span>
      ),
      filterFn: textIncludesFilterFn,
    },
    {
      id: 'name',
      accessorFn: (row) => [row.name, row.meta, row.symbol].filter(Boolean).join(' '),
      meta: { label: '名称', variant: 'text' },
      size: compact ? 168 : 220,
      header: ({ column }) => <DataTableColumnHeader column={column} label="名称" />,
      cell: ({ row }) => {
        const displaySymbol = formatSymbolDisplay(row.original.symbol);
        return (
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={cx('truncate font-medium', row.original.isHeld ? 'text-[#a50e0e]' : 'text-[#1f1f1f]')}>{row.original.name || displaySymbol}</span>
              {row.original.isHeld ? <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#a50e0e]">持仓</span> : null}
            </div>
            {row.original.meta ? <div className="truncate text-[10px] text-[#5f6368]">{row.original.meta}</div> : null}
          </div>
        );
      },
      filterFn: textIncludesFilterFn,
    },
    {
      id: 'price',
      accessorFn: (row) => Number(row.price),
      meta: { label: '最新价', variant: 'number', align: 'center' },
      size: 96,
      header: ({ column }) => <DataTableColumnHeader column={column} label="最新价" />,
      cell: ({ row }) => <span className="tabular-nums">{formatMarketPrice(row.original.price, row.original)}</span>,
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'changePercent',
      accessorFn: (row) => Number(row.changePercent),
      meta: { label: '涨跌幅', variant: 'number', align: 'center' },
      size: 104,
      header: ({ column }) => <DataTableColumnHeader column={column} label="涨跌幅" />,
      cell: ({ row }) => {
        const pct = Number(row.original.changePercent);
        const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
        const latest = isExpectedLatestChangeRow(row.original, todayDate);
        return (
          <span className="inline-flex items-center justify-center gap-1.5">
            <span className={cx('font-semibold tabular-nums', flat ? 'text-[#5f6368]' : pct > 0 ? 'text-[#a50e0e]' : 'text-[#137333]')}>{formatPercent(row.original.changePercent)}</span>
            {latest ? <span className="rounded-full bg-[#e8f0fe] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#1a73e8]">最新</span> : null}
          </span>
        );
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'highDrawdown',
      accessorFn: (row) => {
        const drawdown = resolveHighDrawdown(row);
        const value = Number(drawdown?.drawdownPct);
        return Number.isFinite(value) ? value : Number.NaN;
      },
      meta: { label: '高点下跌', variant: 'number', align: 'center' },
      size: 104,
      header: ({ column }) => <DataTableColumnHeader column={column} label="高点下跌" />,
      cell: ({ row }) => {
        const drawdown = resolveHighDrawdown(row.original);
        const value = Number(drawdown?.drawdownPct);
        if (!Number.isFinite(value)) return <span className="text-[#9aa0a6]">—</span>;
        return (
          <span className={cx('font-semibold tabular-nums', highDrawdownToneClass(value))} title={highDrawdownTitle(drawdown, row.original)}>
            {formatHighDrawdownPercent(value)}
          </span>
        );
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'historicalPercentile',
      accessorFn: (row) => Number(row.historicalPercentile),
      meta: { label: '历史水位', variant: 'number', align: 'center' },
      size: 96,
      header: ({ column }) => <DataTableColumnHeader column={column} label="历史水位" />,
      cell: ({ row }) => {
        const v = Number(row.original.historicalPercentile);
        return Number.isFinite(v) ? <span className="tabular-nums text-[#1f1f1f]">{v.toFixed(2)}%</span> : <span className="text-[#9aa0a6]">—</span>;
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'turnover',
      accessorFn: (row) => Number(row.turnover ?? row.amount),
      meta: { label: '成交额', variant: 'number', align: 'center' },
      size: 112,
      header: ({ column }) => <DataTableColumnHeader column={column} label="成交额" />,
      cell: ({ row }) => <span className="tabular-nums text-[#1f1f1f]">{formatTurnover(row.original.turnover ?? row.original.amount)}</span>,
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    showLimitColumn ? {
      id: 'limit',
      accessorFn: (row) => resolveLimitSortValue(row.fundLimit),
      size: 120,
      meta: {
        label: '限额',
        variant: 'multiSelect',
        align: 'center',
        options: limitFilterOptions,
      },
      header: ({ column }) => <DataTableColumnHeader column={column} label="限额" />,
      cell: ({ row }) => {
        const limit = row.original.fundLimit;
        const appTag = shouldShowAppTag(row.original.fundMeta, limit);
        if (!limit && !appTag) return <span className="text-[#9aa0a6]">—</span>;
        const hideLimitAmount = limit?.buyStatus === 'suspended' || limit?.buyStatus === 'closed';
        return (
          <div className="flex flex-col items-center gap-0.5">
            <div className="flex flex-wrap justify-center gap-1">
              {limit ? (
                <span className={cx(
                  'inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  switchLimitToneFor(limit.buyStatus) === 'emerald' ? 'bg-emerald-50 text-emerald-700' :
                  switchLimitToneFor(limit.buyStatus) === 'amber' ? 'bg-amber-50 text-amber-700' :
                  switchLimitToneFor(limit.buyStatus) === 'red' ? 'bg-red-50 text-red-700' :
                  'bg-slate-50 text-slate-500'
                )}>{switchLimitLabelFor(limit.buyStatus)}</span>
              ) : null}
              {appTag ? <span className="inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">App</span> : null}
            </div>
            {!hideLimitAmount && Number(limit?.maxPurchasePerDay) > 0 ? (
              <span className="tabular-nums text-[#5f6368]">{formatSwitchLimitAmount(limit.maxPurchasePerDay)}</span>
            ) : null}
          </div>
        );
      },
      sortingFn: numericSortFn,
      filterFn: limitFilterFn,
    } : null,
    !hidePremiumColumn ? {
      id: 'premium',
      accessorFn: (row) => Number(resolvePremiumPercent(row)),
      meta: { label: '溢价', variant: 'number', align: 'center' },
      size: 92,
      header: ({ column }) => <DataTableColumnHeader column={column} label="溢价" />,
      cell: ({ row }) => {
        const premiumPct = resolvePremiumPercent(row.original);
        return <span className={cx('font-semibold tabular-nums', changeToneClass(premiumPct))}>{formatPremiumPercent(row.original)}</span>;
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    } : null,
    {
      id: 'currentYearPercent',
      accessorFn: (row) => Number(row.ytdReturn ?? row.currentYearPercent),
      meta: { label: '今年以来', variant: 'number', align: 'center' },
      size: 108,
      header: ({ column }) => <DataTableColumnHeader column={column} label="今年以来" />,
      cell: ({ row }) => <span className={cx('font-semibold tabular-nums', changeToneClass(Number(row.original.ytdReturn ?? row.original.currentYearPercent)))}>{formatYearPercent(row.original)}</span>,
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'return1w',
      accessorFn: (row) => Number(row.return1w),
      meta: { label: '近1周', variant: 'number', align: 'center' },
      size: 96,
      header: ({ column }) => <DataTableColumnHeader column={column} label="近1周" />,
      cell: ({ row }) => {
        const v = Number(row.original.return1w);
        return Number.isFinite(v) ? <span className={cx('font-semibold tabular-nums', changeToneClass(v))}>{formatSignedPercent(v)}</span> : <span className="text-[#9aa0a6]">—</span>;
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'return1m',
      accessorFn: (row) => Number(row.return1m),
      meta: { label: '近1月', variant: 'number', align: 'center' },
      size: 96,
      header: ({ column }) => <DataTableColumnHeader column={column} label="近1月" />,
      cell: ({ row }) => {
        const v = Number(row.original.return1m);
        return Number.isFinite(v) ? <span className={cx('font-semibold tabular-nums', changeToneClass(v))}>{formatSignedPercent(v)}</span> : <span className="text-[#9aa0a6]">—</span>;
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'return3m',
      accessorFn: (row) => Number(row.return3m),
      meta: { label: '近3月', variant: 'number', align: 'center' },
      size: 96,
      header: ({ column }) => <DataTableColumnHeader column={column} label="近3月" />,
      cell: ({ row }) => {
        const v = Number(row.original.return3m);
        return Number.isFinite(v) ? <span className={cx('font-semibold tabular-nums', changeToneClass(v))}>{formatSignedPercent(v)}</span> : <span className="text-[#9aa0a6]">—</span>;
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'return6m',
      accessorFn: (row) => Number(row.return6m),
      meta: { label: '近6月', variant: 'number', align: 'center' },
      size: 96,
      header: ({ column }) => <DataTableColumnHeader column={column} label="近6月" />,
      cell: ({ row }) => {
        const v = Number(row.original.return6m);
        return Number.isFinite(v) ? <span className={cx('font-semibold tabular-nums', changeToneClass(v))}>{formatSignedPercent(v)}</span> : <span className="text-[#9aa0a6]">—</span>;
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'return1y',
      accessorFn: (row) => Number(row.return1y),
      meta: { label: '近1年', variant: 'number', align: 'center' },
      size: 96,
      header: ({ column }) => <DataTableColumnHeader column={column} label="近1年" />,
      cell: ({ row }) => {
        const v = Number(row.original.return1y);
        return Number.isFinite(v) ? <span className={cx('font-semibold tabular-nums', changeToneClass(v))}>{formatSignedPercent(v)}</span> : <span className="text-[#9aa0a6]">—</span>;
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'returnBase',
      accessorFn: (row) => Number(row.returnBase),
      meta: { label: '成立以来', variant: 'number', align: 'center' },
      size: 104,
      header: ({ column }) => <DataTableColumnHeader column={column} label="成立以来" />,
      cell: ({ row }) => {
        const v = Number(row.original.returnBase);
        return Number.isFinite(v) ? <span className={cx('font-semibold tabular-nums', changeToneClass(v))}>{formatSignedPercent(v)}</span> : <span className="text-[#9aa0a6]">—</span>;
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'totalShares',
      accessorFn: (row) => Number(row.totalShares),
      meta: { label: '总份额', variant: 'number', align: 'center' },
      size: 112,
      header: ({ column }) => <DataTableColumnHeader column={column} label="总份额" />,
      cell: ({ row }) => <span className="tabular-nums">{formatTotalShares(row.original.totalShares)}</span>,
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'feeRate',
      accessorFn: (row) => Number(resolveFundFeeRate(row)),
      meta: { label: '费率', variant: 'number', align: 'center' },
      size: 92,
      header: ({ column }) => <DataTableColumnHeader column={column} label="费率" />,
      cell: ({ row }) => <span className={cx('font-semibold tabular-nums', feeRateToneClass(row.original))}>{formatFeeRate(row.original)}</span>,
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    {
      id: 'redeemFeeRate',
      accessorFn: (row) => {
        const isOtc = row.valueType === 'nav'
          || String(row.assetType || row.type || '').toLowerCase().includes('otc')
          || String(row.assetType || row.type || '').toLowerCase().includes('场外')
          || String(row.exchange || '').toLowerCase().includes('场外');
        return isOtc ? Number(resolveRedeemFeeRate(row)) : null;
      },
      meta: { label: '卖出费率', variant: 'number', align: 'center' },
      size: 118,
      header: ({ column }) => <DataTableColumnHeader column={column} label="卖出费率" />,
      cell: ({ row }) => {
        const isOtc = row.original.valueType === 'nav'
          || String(row.original.assetType || row.original.type || '').toLowerCase().includes('otc')
          || String(row.original.assetType || row.original.type || '').toLowerCase().includes('场外')
          || String(row.original.exchange || '').toLowerCase().includes('场外');
        if (!isOtc) return <span className="font-semibold tabular-nums text-slate-400">—</span>;
        const redeemTiers = formatRedeemFeeTiers(row.original);
        if (!redeemTiers || redeemTiers === '—') {
          return <span className="font-semibold tabular-nums text-[#5f6368]">{formatRedeemFeeRate(row.original)}</span>;
        }
        return (
          <div className="space-y-0.5 text-[10px] leading-tight text-[#5f6368]">
            {redeemTiers.split('\n').map((tier, idx) => (
              <div key={idx} className="whitespace-nowrap">{tier}</div>
            ))}
          </div>
        );
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    },
    !hideTrendColumn ? {
      id: 'trend',
      accessorFn: (row) => Number(row.changePercent),
      meta: { label: '趋势', variant: 'number', align: 'center' },
      size: 116,
      header: ({ column }) => <DataTableColumnHeader column={column} label="趋势" />,
      cell: ({ row }) => {
        const pct = Number(row.original.changePercent);
        const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
        return (
          <div className="inline-flex justify-center">
            <Sparkline points={klineMap[row.original.symbol]} width={86} height={26} tone={flat ? 'flat' : pct > 0 ? 'up' : 'down'} showFill markLast />
          </div>
        );
      },
      sortingFn: numericSortFn,
      filterFn: numberRangeFilterFn,
    } : null,
  ].filter(Boolean)), [showLimitColumn, hidePremiumColumn, hideTrendColumn, klineMap, todayDate, limitFilterOptions, compact]);
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: { columnPinning, sorting, columnFilters, columnVisibility: controlledVisibility ?? localVisibility },
    onColumnPinningChange: setColumnPinning,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: onColumnVisibilityChange ?? setLocalVisibility,
    meta: {
      pinningEnabled: Boolean(autoPinColumn),
      pinnedColumnId: pinTargetColumnId,
      onPinColumn: setPinTargetColumnId,
    },
    initialState: {
      pagination: { pageSize: 50 },
    },
    autoResetPageIndex: false,
  });
  const visibility = controlledVisibility ?? localVisibility;
  const setVisibility = onColumnVisibilityChange ?? ((updater) => {
    setLocalVisibility((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return next;
    });
  });
  const isColVisible = (id) => visibility[id] !== false;
  const toggleCol = (id) => setVisibility((prev) => ({ ...prev, [id]: prev[id] === false }));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const autoPinOffsetsRef = useRef({});
  useEffect(() => {
    if (!autoPinColumn || !dataTable) return undefined;
    const el = tableScrollRef.current;
    if (!el) return undefined;
    const measure = () => {
      const offsets = {};
      let acc = 0;
      table.getVisibleLeafColumns().forEach((column) => {
        offsets[column.id] = acc;
        acc += column.getSize();
      });
      autoPinOffsetsRef.current = offsets;
    };
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [autoPinColumn, dataTable, table, rows.length]);

  useEffect(() => {
    if (!pinTargetColumnId) {
      setColumnPinning({ left: [] });
      return;
    }
    if (!autoPinColumn || !dataTable) return;
    const el = tableScrollRef.current;
    const offset = autoPinOffsetsRef.current?.[pinTargetColumnId];
    const shouldPin = el && typeof offset === 'number' ? el.scrollLeft >= offset : false;
    setColumnPinning({ left: shouldPin ? [pinTargetColumnId] : [] });
  }, [autoPinColumn, dataTable, pinTargetColumnId]);

  const handleDataTableScroll = (event) => {
    if (!autoPinColumn || !dataTable || !pinTargetColumnId) return;
    const scrollLeft = event.currentTarget.scrollLeft;
    const offset = autoPinOffsetsRef.current?.[pinTargetColumnId];
    const nextLeft = typeof offset === 'number' && scrollLeft >= offset ? [pinTargetColumnId] : [];
    const currentLeft = columnPinning.left || [];
    if (nextLeft.length === currentLeft.length && nextLeft.every((id, index) => id === currentLeft[index])) return;
    setColumnPinning({ left: nextLeft });
  };

  const handleVisibleRowsChange = useCallback((visibleRows = []) => {
    if (typeof onVisibleSymbolsChange !== 'function') return;
    const symbols = [];
    const seen = new Set();
    visibleRows.forEach((row) => {
      const symbol = String(row?.symbol || '').trim();
      if (!symbol || seen.has(symbol)) return;
      seen.add(symbol);
      symbols.push(symbol);
    });
    onVisibleSymbolsChange(symbols);
  }, [onVisibleSymbolsChange]);

  useEffect(() => {
    const state = { sorting, columnFilters, columnVisibility: visibility };
    writeTableViewState(state, viewStateStorageKey);
    writeColumnVisibility(visibility);
    onColumnVisibilityStateChange?.(visibility);
  }, [sorting, columnFilters, visibility, viewStateStorageKey, onColumnVisibilityStateChange]);

  function applyViewState(state) {
    const normalized = normalizeTableViewState(state, defaultColumnVisibility);
    setSorting(normalized.sorting);
    setColumnFilters(normalized.columnFilters);
    setVisibility(normalized.columnVisibility);
  }

  function saveCurrentView() {
    if (typeof window === 'undefined') return;
    const name = window.prompt('保存当前筛选视图名称', '我的筛选');
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const preset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed.slice(0, 18),
      state: { sorting, columnFilters, columnVisibility: visibility },
      createdAt: new Date().toISOString(),
    };
    setViewPresets((prev) => {
      const next = [preset, ...prev.filter((item) => item.name !== preset.name)].slice(0, 12);
      writeTableViewPresets(next, viewPresetsStorageKey);
      return next;
    });
  }

  function deleteViewPreset(id) {
    setViewPresets((prev) => {
      const next = prev.filter((item) => item.id !== id);
      writeTableViewPresets(next, viewPresetsStorageKey);
      return next;
    });
  }

  const currentViewKey = useMemo(
    () => buildTableViewKey({ sorting, columnFilters, columnVisibility: visibility }),
    [sorting, columnFilters, visibility]
  );

  const presetControls = dataTable ? (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {viewPresets.map((preset) => {
        const active = buildTableViewKey(normalizeTableViewState(preset.state, defaultColumnVisibility)) === currentViewKey;
        return (
          <span key={preset.id} className={cx(
            'inline-flex h-8 max-w-[180px] items-center overflow-hidden rounded-full border text-xs transition',
            active
              ? 'border-[#1a73e8] bg-[#e8f0fe] text-[#174ea6] shadow-[inset_0_0_0_1px_rgba(26,115,232,0.12)]'
              : 'border-[#dadce0] bg-white text-[#3c4043]'
          )}>
            <button
              type="button"
              onClick={() => applyViewState(preset.state)}
              aria-pressed={active}
              className={cx(
                'min-w-0 truncate px-3 py-1.5 font-medium transition',
                active ? 'hover:bg-[#d2e3fc]' : 'hover:bg-[#f1f3f4]'
              )}
              title={preset.name}
            >
              {preset.name}
            </button>
            <button
              type="button"
              onClick={() => deleteViewPreset(preset.id)}
              aria-label={`删除筛选视图 ${preset.name}`}
              className={cx(
                'inline-flex h-full w-7 shrink-0 items-center justify-center border-l transition',
                active
                  ? 'border-[#c6dafc] text-[#174ea6] hover:bg-[#d2e3fc]'
                  : 'border-[#e8eaed] text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1f1f1f]'
              )}
            >
              <Trash2 size={13} />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={saveCurrentView}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-[#dadce0] px-3 text-xs font-medium text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
      >
        <Save size={14} /> 保存视图
      </button>
    </div>
  ) : null;

  const viewOptions = dataTable ? <DataTableViewOptions table={table} {...dataTableViewOptionsProps} /> : null;
  const header = dataTable
    ? (typeof dataTableHeader === 'function'
      ? dataTableHeader({ table, viewOptions, presetControls })
      : dataTableHeader)
    : null;
  const tableChrome = dataTable && dataTableChrome
    ? (typeof dataTableChrome === 'function'
      ? dataTableChrome({ table, viewOptions, presetControls })
      : dataTableChrome)
    : null;

  if (!rows.length) {
    if (dataTable) {
      return (
        <div className={cx('flex min-w-0 flex-col gap-2', containerClassName)}>
          {header || (
            <DataTableToolbar table={table}>
              {viewOptions}
            </DataTableToolbar>
          )}
          <div className="rounded-2xl border border-[#e8eaed] bg-white px-4 py-12 text-center text-sm text-[#5f6368]">
            未配置自选。
          </div>
        </div>
      );
    }
    return <p className="px-2 py-2 text-sm text-[#5f6368]">未配置自选。</p>;
  }
  if (dataTable) {
    return (
      <div className={cx('flex min-w-0 flex-col gap-2', containerClassName)}>
        {header || (
          <DataTableToolbar table={table}>
            {viewOptions}
          </DataTableToolbar>
        )}
        <DataTable
          table={table}
          tableScrollRef={tableScrollRef}
          onHorizontalScroll={handleDataTableScroll}
          onVisibleRowsChange={handleVisibleRowsChange}
          rowTestIdPrefix={rowTestIdPrefix}
          tableContainerClassName={cx(compact ? 'rounded-xl' : undefined, dataTableContainerClassName)}
          tableClassName="min-w-max table-fixed"
          tableChrome={tableChrome}
          tableChromeClassName={tableChromeClassName}
          className={cx(
            '[&_td]:text-center [&_td:first-child]:text-left [&_td:nth-child(2)]:text-left [&_th]:whitespace-nowrap',
            compact && '[&_table]:min-w-[360px] [&_td]:px-2 [&_td]:py-3 [&_th]:px-2 [&_th]:py-2 [&_td:nth-child(2)]:max-w-[160px] [&_td:nth-child(2)>div]:max-w-[160px]',
            dataTableClassName
          )}
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
      <div ref={menuRef} className="relative flex items-center justify-end px-2 py-1">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-[#5f6368] hover:bg-[#f1f3f4]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
          列
        </button>
        {menuOpen && (
          <div className="absolute right-2 top-full z-30 min-w-[120px] rounded-lg border border-[#e8eaed] bg-white py-1 shadow-lg">
            {PLAIN_TABLE_TOGGLE_COLUMNS.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] text-[#1f1f1f] hover:bg-[#f1f3f4]">
                <input
                  type="checkbox"
                  checked={isColVisible(c.id)}
                  onChange={() => toggleCol(c.id)}
                  className="accent-[#1a73e8]"
                />
                {c.label}
              </label>
            ))}
          </div>
        )}
      </div>
      <table className={cx('w-full min-w-[980px] border-separate border-spacing-0 text-sm', compact && 'min-w-[900px] text-[12px]')}>
        <thead className={cx('bg-[#f8fafd] text-[11px] font-semibold text-[#5f6368]', stickyHeader && 'sticky top-0 z-10')}>
          <tr>
            <th className={cx(cellPad, 'text-left', stickyHeadCell)}>代码</th>
            <th className={cx(cellPad, 'text-left')}>名称</th>
            <th className={cx(cellPad, 'text-center')}>最新价</th>
            <th className={cx(cellPad, 'text-center')}>涨跌幅</th>
            {isColVisible('highDrawdown') ? <th className={cx(cellPad, 'text-center')}>高点下跌</th> : null}
            {isColVisible('historicalPercentile') ? <th className={cx(cellPad, 'text-center')}>历史水位</th> : null}
            <th className={cx(cellPad, 'text-center')}>成交额</th>
            {showLimitColumn ? <th className={cx(cellPad, 'text-center')}>限额</th> : null}
            {!hidePremiumColumn ? <th className={cx(cellPad, 'text-center')}>溢价</th> : null}
            <th className={cx(cellPad, 'text-center')}>今年以来</th>
            {RETURN_COLUMNS.map((c) => isColVisible(c.id) ? <th key={c.id} className={cx(cellPad, 'text-center')}>{c.label}</th> : null)}
            <th className={cx(cellPad, 'text-center')}>总份额</th>
            <th className={cx(cellPad, 'text-center')}>费率</th>
            <th className={cx(cellPad, 'text-center')}>卖出费率</th>
            {!hideTrendColumn ? <th className={cx(cellPad, 'text-center')}>趋势</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e8eaed]">
          {rows.map((row) => {
            const displaySymbol = formatSymbolDisplay(row.symbol);
            const pct = Number(row.changePercent);
            const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
            const up = pct > 0;
            const premiumPct = resolvePremiumPercent(row);
            const highDrawdown = resolveHighDrawdown(row);
            const highDrawdownPct = Number(highDrawdown?.drawdownPct);
            const historicalPercentile = Number(row.historicalPercentile);
            const selected = row.symbol === selectedSymbol;
            return (
              <tr
                key={row.symbol}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                data-row-symbol={row.symbol}
                data-testid={rowTestIdPrefix ? `${rowTestIdPrefix}-${row.symbol}` : undefined}
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
                <td className={cx(cellPad, 'w-[88px] whitespace-nowrap font-mono text-xs font-semibold', row.isHeld ? 'text-[#a50e0e]' : 'text-[#1f1f1f]', stickyBodyCell(selected))}>{displaySymbol}</td>
                <td className={cx(cellPad, 'min-w-[120px] text-[#1f1f1f]')}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={cx('truncate font-medium', row.isHeld ? 'text-[#a50e0e]' : 'text-[#1f1f1f]')}>{row.name || displaySymbol}</span>
                    {row.isHeld ? <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#a50e0e]">持仓</span> : null}
                  </div>
                  {row.meta ? <div className="truncate text-[10px] text-[#5f6368]">{row.meta}</div> : null}
                </td>
                <td className={cx(cellPad, 'whitespace-nowrap text-center tabular-nums text-[#1f1f1f]')}>{formatMarketPrice(row.price, row)}</td>
                <td className={cx(cellPad, 'whitespace-nowrap text-center')}>
                  <span className="inline-flex items-center justify-center gap-1.5">
                    <span className={cx('font-semibold tabular-nums', flat ? 'text-[#5f6368]' : up ? 'text-[#a50e0e]' : 'text-[#137333]')}>{formatPercent(row.changePercent)}</span>
                    {isLatestChangeRow(row) ? <span className="rounded-full bg-[#e8f0fe] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#1a73e8]">最新</span> : null}
                  </span>
                </td>
                {isColVisible('highDrawdown') ? (
                  <td className={cx(cellPad, 'whitespace-nowrap text-center font-semibold tabular-nums', highDrawdownToneClass(highDrawdownPct))} title={highDrawdownTitle(highDrawdown, row)}>
                    {formatHighDrawdownPercent(highDrawdownPct)}
                  </td>
                ) : null}
                {isColVisible('historicalPercentile') ? (
                  <td className={cx(cellPad, 'whitespace-nowrap text-center tabular-nums', Number.isFinite(historicalPercentile) ? 'text-[#1f1f1f]' : 'text-[#9aa0a6]')}>
                    {Number.isFinite(historicalPercentile) ? `${historicalPercentile.toFixed(2)}%` : '—'}
                  </td>
                ) : null}
                <td className={cx(cellPad, 'whitespace-nowrap text-center tabular-nums text-[#1f1f1f]')}>{formatTurnover(row.turnover ?? row.amount)}</td>
                {showLimitColumn ? (
                  <td className={cx(cellPad, 'whitespace-nowrap text-center text-xs')}>
                    {row.fundLimit || shouldShowAppTag(row.fundMeta, row.fundLimit) ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex flex-wrap justify-center gap-1">
                          {row.fundLimit ? (
                            <span className={cx(
                              'inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                              switchLimitToneFor(row.fundLimit.buyStatus) === 'emerald' ? 'bg-emerald-50 text-emerald-700' :
                              switchLimitToneFor(row.fundLimit.buyStatus) === 'amber' ? 'bg-amber-50 text-amber-700' :
                              switchLimitToneFor(row.fundLimit.buyStatus) === 'red' ? 'bg-red-50 text-red-700' :
                              'bg-slate-50 text-slate-500'
                            )}>{switchLimitLabelFor(row.fundLimit.buyStatus)}</span>
                          ) : null}
                          {shouldShowAppTag(row.fundMeta, row.fundLimit) ? <span className="inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">App</span> : null}
                        </div>
                        {row.fundLimit?.buyStatus !== 'suspended' && row.fundLimit?.buyStatus !== 'closed' && Number(row.fundLimit?.maxPurchasePerDay) > 0 ? (
                          <span className="tabular-nums text-[#5f6368]">{formatSwitchLimitAmount(row.fundLimit.maxPurchasePerDay)}</span>
                        ) : null}
                      </div>
                    ) : <span className="text-[#9aa0a6]">—</span>}
                  </td>
                ) : null}
                {!hidePremiumColumn ? (
                  <td className={cx(cellPad, 'whitespace-nowrap text-center font-semibold tabular-nums', changeToneClass(premiumPct))}>{formatPremiumPercent(row)}</td>
                ) : null}
                <td className={cx(cellPad, 'whitespace-nowrap text-center font-semibold tabular-nums', changeToneClass(Number(row.ytdReturn ?? row.currentYearPercent)))}>{formatYearPercent(row)}</td>
                {RETURN_COLUMNS.map((c) => {
                  if (!isColVisible(c.id)) return null;
                  const v = Number(row[c.id]);
                  return (
                    <td key={c.id} className={cx(cellPad, 'whitespace-nowrap text-center font-semibold tabular-nums', Number.isFinite(v) ? changeToneClass(v) : 'text-[#9aa0a6]')}>
                      {Number.isFinite(v) ? formatSignedPercent(v) : '—'}
                    </td>
                  );
                })}
                <td className={cx(cellPad, 'whitespace-nowrap text-center tabular-nums text-[#1f1f1f]')}>{formatTotalShares(row.totalShares)}</td>
                <td className={cx(cellPad, 'whitespace-nowrap text-center font-semibold tabular-nums', feeRateToneClass(row))}>{formatFeeRate(row)}</td>
                <td className={cx(cellPad, 'text-center text-[#5f6368]')}>
                  {(() => {
                    const tiers = formatRedeemFeeTiers(row);
                    if (!tiers || tiers === '—') return <span className="font-semibold tabular-nums">{formatRedeemFeeRate(row)}</span>;
                    return (
                      <div className="space-y-0.5 text-[10px] leading-tight">
                        {tiers.split('\n').map((tier, idx) => (
                          <div key={idx} className="whitespace-nowrap">{tier}</div>
                        ))}
                      </div>
                    );
                  })()}
                </td>
                {!hideTrendColumn ? (
                  <td className={cx(cellPad, 'text-center')}>
                    <div className="inline-flex justify-center">
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
