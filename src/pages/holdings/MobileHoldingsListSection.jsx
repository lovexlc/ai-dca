import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { formatCurrency } from '../../app/accumulation.js';
import {
  KIND_LABELS,
  formatShares,
  formatSignedCurrency,
  formatSignedPercent,
} from '../../app/holdingsHelpers.js';
import { cx } from '../../components/experience-ui.jsx';

const KIND_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'exchange', label: '场内' },
  { key: 'otc', label: '场外' },
  { key: 'qdii', label: 'QDII' },
];

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function rowKindKey(row) {
  const tags = Array.isArray(row?.tags) ? row.tags : [];
  if (tags.includes('qdii') || row?.kind === 'qdii') return 'qdii';
  if (tags.includes('otc') || row?.kind === 'otc') return 'otc';
  return 'exchange';
}

function toneForValue(value) {
  const numeric = finiteNumber(value);
  if (numeric == null || numeric === 0) return 'text-slate-500';
  return numeric > 0 ? 'text-rose-600' : 'text-emerald-600';
}

function compactCurrency(value) {
  const numeric = finiteNumber(value);
  if (numeric == null) return '暂未更新';
  const sign = numeric < 0 ? '-' : '';
  const absolute = Math.abs(numeric);
  if (absolute >= 100000000) return sign + '¥' + (absolute / 100000000).toFixed(2) + '亿';
  if (absolute >= 10000) return sign + '¥' + (absolute / 10000).toFixed(2) + '万';
  return formatCurrency(numeric, '¥', 2);
}

function priceText(value) {
  const numeric = finiteNumber(value);
  return numeric != null && numeric > 0 ? numeric.toFixed(4) : '暂未更新';
}

function priceDateText(row) {
  const date = row?.kind === 'exchange' ? row?.quoteDate : row?.latestNavDate;
  if (!date) return '';
  return (row?.kind === 'exchange' ? '行情 ' : '净值 ') + String(date).slice(5).replace('-', '/');
}

function pendingText(row) {
  const buyAmount = finiteNumber(row?.pendingBuyAmount) || 0;
  const sellShares = finiteNumber(row?.pendingSellShares) || 0;
  if (buyAmount > 0) return '待确认买入 ' + formatCurrency(buyAmount, '¥', 2);
  if (sellShares > 0) return '待确认卖出 ' + formatShares(sellShares) + ' 份';
  return '';
}

function todayText(row) {
  if (!row?.hasCurrentPrice) return '暂未更新';
  if (!row?.hasTodayNav) return '待更新';
  return formatSignedCurrency(row.todayProfit, 2);
}

function todayRateText(row) {
  if (!row?.hasCurrentPrice || !row?.hasTodayNav) return '';
  return formatSignedPercent(row.todayReturnRate);
}

function premiumText(row) {
  if (rowKindKey(row) !== 'exchange') return '';
  const value = finiteNumber(row?.premiumPercent);
  return value == null ? '' : '溢价 ' + formatSignedPercent(value);
}

function displayRows(tableData, search, activeKind) {
  const query = String(search || '').trim().toLowerCase();
  return (Array.isArray(tableData) ? tableData : [])
    .filter((row) => {
      const kind = rowKindKey(row);
      if (activeKind !== 'all' && kind !== activeKind) return false;
      if (!query) return true;
      return (String(row?.code || '') + ' ' + String(row?.name || '')).toLowerCase().includes(query);
    })
    .sort((a, b) => {
      const marketValueDiff = (finiteNumber(b?.marketValue) || 0) - (finiteNumber(a?.marketValue) || 0);
      return marketValueDiff || String(a?.name || a?.code || '').localeCompare(String(b?.name || b?.code || ''));
    });
}

function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const name = row?.companyName || '未识别基金公司';
    if (!groups.has(name)) {
      groups.set(name, {
        key: name,
        name,
        short: row?.companyShort || '其他',
        color: row?.companyColor || '#94a3b8',
        icon: row?.companyIcon || '',
        rows: [],
      });
    }
    groups.get(name).rows.push(row);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      totalMarketValue: group.rows.reduce((sum, row) => sum + (finiteNumber(row?.marketValue) || 0), 0),
    }))
    .sort((a, b) => b.totalMarketValue - a.totalMarketValue || a.name.localeCompare(b.name));
}

function MobileEmptyState({ hasRows, onCreateFirstTransaction, onInstallDemoData }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/75 px-5 py-10 text-center">
      <div className="text-sm font-semibold text-slate-800">{hasRows ? '没有匹配的持仓' : '还没有持仓记录'}</div>
      <div className="mt-2 text-xs leading-5 text-slate-500">
        {hasRows ? '试试清空搜索或切换持仓类型。' : '录入第一笔交易后，这里会显示你的基金持仓。'}
      </div>
      {!hasRows ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onCreateFirstTransaction}
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
          >
            录入第一笔交易
          </button>
          {onInstallDemoData ? (
            <button
              type="button"
              onClick={onInstallDemoData}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600"
            >
              生成 demo 数据
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MobileHoldingCard({ row, onRowClick }) {
  const kind = rowKindKey(row);
  const kindLabel = KIND_LABELS[kind] || kind;
  const pending = pendingText(row);
  const priceDate = priceDateText(row);
  const premium = premiumText(row);
  const currentPrice = row?.currentPrice ?? row?.latestNav;

  return (
    <button
      type="button"
      className="block w-full border-b border-slate-200/80 px-1 py-4 text-left transition-colors active:bg-slate-50"
      onClick={() => onRowClick?.({ original: row })}
      aria-label={'查看' + (row?.name || row?.code || '基金') + '持仓详情'}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-6 text-slate-900">
            {row?.name || row?.code || '未命名基金'}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-slate-400">
            {row?.code || '无代码'} · {formatShares(row?.totalShares)} 份
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cx('text-[17px] font-bold tabular-nums', toneForValue(row?.todayProfit))}>
            {todayText(row)}
          </div>
          {todayRateText(row) ? (
            <div className={cx('mt-0.5 text-[11px] font-semibold tabular-nums', toneForValue(row?.todayReturnRate))}>
              {todayRateText(row)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-slate-400">持有收益</div>
          <div className={cx('mt-0.5 truncate text-[15px] font-semibold tabular-nums', toneForValue(row?.unrealizedProfit))}>
            {row?.hasCurrentPrice ? formatSignedCurrency(row.unrealizedProfit, 2) : '待更新'}
            {row?.hasCurrentPrice ? ' ' + formatSignedPercent(row.unrealizedReturnRate) : ''}
          </div>
        </div>
        <div className="flex max-w-[62%] flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] tabular-nums text-slate-400">
          <span>成本 {priceText(row?.avgCost)}</span>
          <span>现价 {priceText(currentPrice)}</span>
          <span>市值 {compactCurrency(row?.marketValue)}</span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{kindLabel}</span>
        {pending ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{pending}</span> : null}
        {premium ? <span className="tabular-nums text-slate-500">{premium}</span> : null}
        {priceDate ? <span>{priceDate}</span> : null}
        {row?.snapshotError ? <span className="text-amber-600">净值同步异常</span> : null}
      </div>
    </button>
  );
}

export function MobileHoldingsListSection({
  tableData = [],
  onCreateFirstTransaction,
  onInstallDemoData,
  onRowClick,
}) {
  const [search, setSearch] = useState('');
  const [activeKind, setActiveKind] = useState('all');
  const rows = useMemo(() => displayRows(tableData, search, activeKind), [tableData, search, activeKind]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  const totalMarketValue = rows.reduce((sum, row) => sum + (finiteNumber(row?.marketValue) || 0), 0);
  const totalProfit = rows.reduce((sum, row) => sum + (row?.hasCurrentPrice ? (finiteNumber(row?.unrealizedProfit) || 0) : 0), 0);
  const totalTodayProfit = rows.reduce((sum, row) => sum + (row?.hasTodayNav ? (finiteNumber(row?.todayProfit) || 0) : 0), 0);
  const hasRows = Array.isArray(tableData) && tableData.length > 0;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <div className="text-base font-bold text-slate-900">持仓总览</div>
          <div className="mt-1 text-[11px] text-slate-400">
            {rows.length} 只基金 · 按基金公司聚合
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] tabular-nums text-slate-400">
          市值 {compactCurrency(totalMarketValue)}
        </div>
      </div>

      <label className="flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-3 shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索持仓代码或名称"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          aria-label="搜索持仓代码或名称"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="rounded-full p-1 text-slate-400"
            aria-label="清空搜索"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </label>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {KIND_FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setActiveKind(item.key)}
            className={cx(
              'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
              activeKind === item.key
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white/75 text-slate-500',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!rows.length ? (
        <MobileEmptyState
          hasRows={hasRows}
          onCreateFirstTransaction={onCreateFirstTransaction}
          onInstallDemoData={onInstallDemoData}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white/65 px-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  {group.icon ? (
                    <img
                      src={group.icon}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-full border border-slate-200 bg-white object-contain p-0.5"
                    />
                  ) : (
                    <span
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold"
                      style={{
                        color: group.color,
                        borderColor: group.color + '55',
                        backgroundColor: group.color + '12',
                      }}
                    >
                      {group.short}
                    </span>
                  )}
                  <span className="truncate text-[15px] font-bold text-slate-800">{group.name}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{group.rows.length} 只</span>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                  {compactCurrency(group.totalMarketValue)}
                </span>
              </div>
              {group.rows.map((row) => (
                <MobileHoldingCard
                  key={row.aggregationKey || (String(row.code || '') + ':' + String(row.kind || ''))}
                  row={row}
                  onRowClick={onRowClick}
                />
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-200/80 px-1 py-3 text-[11px] tabular-nums text-slate-500">
            <span>合计 {rows.length} 只</span>
            <span>持有收益 {formatSignedCurrency(totalProfit, 2)}</span>
            <span>今日 {formatSignedCurrency(totalTodayProfit, 2)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
