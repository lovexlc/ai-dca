import { useMemo, useState } from 'react';
import {
  BellRing,
  ChevronRight,
  CircleHelp,
  Check,
  Columns3,
  Bookmark,
  LayoutGrid,
  Plus,
  Table2,
  SlidersHorizontal,
  ArrowUpDown,
  X,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { formatCurrency, formatPercent } from '../../../app/accumulation.js';
import { cx } from '../../experience-ui.jsx';
import { isNativeApp } from '../../../app/platform.js';

const POSITIVE = 'text-[#FF4569]';
const NEGATIVE = 'text-[#20C997]';
const MUTED = 'text-[#A8B0C2]';

function signedCurrency(value) {
  const amount = formatCurrency(Math.abs(Number(value) || 0), '¥', 2);
  const numeric = Number(value) || 0;
  return numeric > 0 ? `+${amount}` : numeric < 0 ? `-${amount}` : amount;
}

function signedPercent(value) {
  const numeric = Number(value) || 0;
  return `${numeric > 0 ? '+' : numeric < 0 ? '-' : ''}${formatPercent(Math.abs(numeric))}`;
}

function tone(value) {
  const numeric = Number(value) || 0;
  return numeric > 0 ? POSITIVE : numeric < 0 ? NEGATIVE : MUTED;
}

function displayDate(value) {
  if (!value) return '刚刚更新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace('T', ' ');
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function TrendBackground({ value }) {
  const numeric = Number(value) || 0;
  const points = numeric < 0 ? '0,52 18,45 34,48 52,35 68,41 88,26 108,32 128,18 150,24 172,6 196,17 220,3' : '0,52 20,47 38,51 58,39 78,43 98,28 118,34 138,18 158,25 178,8 198,14 220,2';
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full opacity-80" viewBox="0 0 220 60" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="portfolio-trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8D68FF" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8D68FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${points} 220,60 0,60`} fill="url(#portfolio-trend-fill)" />
      <polyline points={points} fill="none" stroke="#9B7BFF" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function AssetHeroCard({ portfolio, accountAllocation, navRefresh }) {
  const [visible, setVisible] = useState(true);
  const total = Number(accountAllocation?.totalAccountValue ?? portfolio?.marketValue) || 0;
  return (
    <section className="portfolio-mobile-hero" aria-label="总资产">
      <TrendBackground value={portfolio?.todayProfit} />
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-medium text-[#A8B0C2]">
            <span>总资产</span>
            <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#A8B0C2] hover:bg-white/10" aria-label={visible ? '隐藏总资产' : '显示总资产'} onClick={() => setVisible((value) => !value)}>
              {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
          </div>
          <div className="portfolio-mobile-total tabular-nums">{visible ? formatCurrency(total, '¥', 2) : '¥ ••••••'}</div>
          <div className="mt-2 text-[12px] text-[#70798D]">更新于 {displayDate(portfolio?.latestSnapshotAt || portfolio?.latestNavDate)}</div>
        </div>
        {navRefresh ? (
          <button type="button" onClick={navRefresh.onClick} disabled={navRefresh.loading} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[#A8B0C2] transition hover:bg-white/10 disabled:opacity-50" aria-label="刷新行情" title="刷新行情">
            <RefreshCw className={cx('h-4 w-4', navRefresh.loading && 'animate-spin')} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Metric({ label, value, rate, status }) {
  return (
    <div className="portfolio-mobile-metric min-w-0">
      <div className="text-[12px] leading-4 text-[#A8B0C2]">{label}</div>
      <div className={cx('mt-2 whitespace-nowrap text-[17px] font-semibold leading-5 tabular-nums min-[390px]:text-[19px]', tone(value))}>{signedCurrency(value)}</div>
      <div className={cx('mt-1 whitespace-nowrap text-[13px] font-medium leading-4 tabular-nums', tone(rate))}>{status || signedPercent(rate)}</div>
    </div>
  );
}

export function PerformanceMetricsGrid({ portfolio }) {
  return (
    <section className="portfolio-mobile-card portfolio-mobile-kpis" aria-label="收益指标">
      <Metric label="今日收益" value={portfolio?.todayProfit} rate={portfolio?.todayReturnRate} status={portfolio?.navDateCoverage === 'full' ? '已更新' : undefined} />
      <Metric label="持有收益" value={portfolio?.unrealizedProfit} rate={portfolio?.unrealizedReturnRate} />
      <Metric label="累计收益" value={portfolio?.cumulativeProfit} rate={portfolio?.cumulativeReturnRate} />
      <Metric label="累计收益率" value={portfolio?.cumulativeProfit} rate={portfolio?.cumulativeReturnRate} />
    </section>
  );
}

export function AssetAllocationCard({ accountAllocation, onDetails, onSettings }) {
  const investmentPct = Math.max(0, Math.min(100, Number(accountAllocation?.investmentPct) || 0));
  const cashPct = Math.max(0, Math.min(100, Number(accountAllocation?.cashPct) || 0));
  const donutStyle = { background: `conic-gradient(#7C4DFF 0 ${investmentPct}%, #303746 ${investmentPct}% 100%)` };
  return (
    <section className="portfolio-mobile-card portfolio-mobile-allocation" aria-label="资产配置">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[16px] font-semibold text-[#F5F7FF]"><WalletCards className="h-5 w-5 text-[#9B7BFF]" />资产配置</div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onSettings} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#A8B0C2] hover:bg-white/10" aria-label="资产配置说明"><CircleHelp className="h-4 w-4" /></button>
          <button type="button" onClick={onDetails} className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-[#A8B0C2] hover:bg-white/10">资产详情<ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-[90px_minmax(0,1fr)] items-center gap-4">
        <div className="relative h-[90px] w-[90px] shrink-0 rounded-full p-[9px]" style={donutStyle}>
          <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[#151922] text-center"><span className="text-[11px] text-[#70798D]">投资占比</span><strong className="mt-1 text-[24px] leading-none text-[#F5F7FF] tabular-nums">{formatPercent(investmentPct, 0)}</strong></div>
        </div>
        <div className="min-w-0 space-y-3">
          <AllocationRow color="bg-[#7C4DFF]" label="投资资产" percent={investmentPct} value={accountAllocation?.investmentValue} />
          <AllocationRow color="bg-[#303746]" label="现金资产" percent={cashPct} value={accountAllocation?.cashValue} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.08] pt-4 text-[12px] text-[#A8B0C2]"><div>现金收益 <span className="ml-1 font-medium tabular-nums text-[#F5F7FF]">{formatCurrency(0, '¥', 2)}</span></div><div className="text-right">年化收益（预估）<span className="ml-1 font-medium tabular-nums text-[#F5F7FF]">{formatCurrency(accountAllocation?.cashAnnualIncome, '¥', 2)}</span></div></div>
    </section>
  );
}

function AllocationRow({ color, label, percent, value }) {
  return <div className="portfolio-mobile-allocation-row flex min-w-0 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[12px] text-[#A8B0C2]"><span className={cx('h-2 w-2 shrink-0 rounded-full', color)} />{label}<span className="tabular-nums text-[#70798D]">{formatPercent(percent, 0)}</span></div><span className="shrink-0 whitespace-nowrap text-[14px] font-semibold tabular-nums text-[#F5F7FF]">{formatCurrency(value, '¥', 2)}</span></div>;
}



export function SignalSummaryCard({ todaySignals }) {
  const switchCount = Number(todaySignals?.switchSummary?.count) || 0;
  const exitCount = Number(todaySignals?.exitSummary?.count) || 0;
  const hasSignal = switchCount > 0 || exitCount > 0;
  return <section className="portfolio-mobile-card portfolio-mobile-signal" aria-label="今日信号"><div className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', hasSignal ? 'bg-[#F6C453]/15 text-[#F6C453]' : 'bg-[#22C77A]/15 text-[#22C77A]')}><ShieldCheck className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="text-[15px] font-semibold text-[#F5F7FF]">今日信号</div><div className="mt-1 text-[12px] text-[#A8B0C2]">{hasSignal ? '今天有需要确认的动作' : '今日无信号，持仓稳定'}</div></div><div className="grid shrink-0 grid-cols-2 gap-3 text-right"><div><div className="text-[11px] text-[#70798D]">换仓</div><div className="mt-1 text-[14px] font-semibold tabular-nums text-[#F5F7FF]">{switchCount}只</div></div><div><div className="text-[11px] text-[#70798D]">出场</div><div className="mt-1 text-[14px] font-semibold tabular-nums text-[#F5F7FF]">{exitCount}只</div></div></div></section>;
}

function HoldingMobileCard({ holding, onClick, onOpenAlert }) {
  const marketValue = holding?.hasLatestNav ? formatCurrency(holding.marketValue, '¥', 2) : '—';
  return <article className="portfolio-mobile-holding"><button type="button" onClick={() => onClick?.({ original: holding })} className="flex min-w-0 flex-1 items-center gap-3 text-left"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="rounded-md bg-[#7C4DFF]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#B7A4FF]">{holding?.kind === 'exchange' ? '场内 ETF' : '场外基金'}</span><span className="type-data text-[11px] text-[#70798D]">{holding?.code || '—'}</span></div><div className="mt-2 truncate text-[14px] font-semibold text-[#F5F7FF]">{holding?.name || '未命名基金'}</div><div className="mt-1 text-[11px] text-[#70798D]">市值 {marketValue}</div></div><div className="shrink-0 text-right"><div className="text-[13px] font-semibold tabular-nums text-[#F5F7FF]">持有 {holding?.hasLatestNav ? signedCurrency(holding.unrealizedProfit) : '—'}</div><div className={cx('mt-1 text-[12px] font-medium tabular-nums', tone(holding?.todayProfit))}>今日 {holding?.hasTodayNav ? signedCurrency(holding.todayProfit) : '—'}</div></div><ChevronRight className="h-5 w-5 shrink-0 text-[#70798D]" /></button>{onOpenAlert ? <button type="button" className="ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#70798D] hover:bg-white/10" aria-label={`设置 ${holding?.name || holding?.code || '基金'} 预警`} onClick={(event) => { event.stopPropagation(); onOpenAlert(holding); }}><BellRing className="h-4 w-4" /></button> : null}</article>;
}

const FILTERS = [
  ['all', '全部'],
  ['exchange', '场内 ETF'],
  ['otc', '场外基金'],
  ['favorite', '自选分组'],
];

function PortfolioViewToolbar({ view, setView, search, setSearch, filter, setFilter, sort, setSort, showFilterPanel, setShowFilterPanel, showSortPanel, setShowSortPanel, showColumnsPanel, setShowColumnsPanel, showSavePanel, setShowSavePanel, savedViews, onSaveView, onDeleteView }) {
  const activeFilters = [
    filter !== 'all' ? FILTERS.find(([key]) => key === filter)?.[1] : null,
    sort === 'marketValue' ? null : sort === 'profitRate' ? '收益率 > 5%' : null,
  ].filter(Boolean);
  return (
    <div className="portfolio-mobile-tools">
      <div className="portfolio-mobile-tool-row">
        <div className="portfolio-mobile-view-switch" role="tablist" aria-label="持仓视图">
          <button type="button" role="tab" aria-selected={view === 'cards'} className={cx(view === 'cards' && 'is-active')} onClick={() => setView('cards')}><LayoutGrid className="h-3.5 w-3.5" />卡片</button>
          <button type="button" role="tab" aria-selected={view === 'table'} className={cx(view === 'table' && 'is-active')} onClick={() => setView('table')}><Table2 className="h-3.5 w-3.5" />表格</button>
        </div>
        <button type="button" className={cx('portfolio-mobile-tool-button', showFilterPanel && 'is-active')} onClick={() => { setShowFilterPanel((value) => !value); setShowSortPanel(false); setShowColumnsPanel(false); }}><SlidersHorizontal className="h-3.5 w-3.5" />筛选{filter !== 'all' ? <span className="portfolio-mobile-tool-count">1</span> : null}</button>
        <button type="button" className={cx('portfolio-mobile-tool-button', showSortPanel && 'is-active')} onClick={() => { setShowSortPanel((value) => !value); setShowFilterPanel(false); setShowColumnsPanel(false); }}><ArrowUpDown className="h-3.5 w-3.5" />排序</button>
        <button type="button" className={cx('portfolio-mobile-tool-button', showColumnsPanel && 'is-active')} onClick={() => { setShowColumnsPanel((value) => !value); setShowFilterPanel(false); setShowSortPanel(false); }}><Columns3 className="h-3.5 w-3.5" />列设置</button>
        <button type="button" className={cx('portfolio-mobile-tool-button', showSavePanel && 'is-active')} onClick={() => setShowSavePanel((value) => !value)}><Bookmark className="h-3.5 w-3.5" />保存视图</button>
      </div>
      <div className="portfolio-mobile-current-view">
        <span>当前视图：<strong>默认持仓</strong></span>
        <span className="flex min-w-0 items-center gap-2 overflow-x-auto">{activeFilters.map((label) => <span key={label} className="portfolio-mobile-filter-chip">{label}<button type="button" aria-label={'移除' + label + '筛选'} onClick={() => label === '收益率 > 5%' ? setSort('marketValue') : setFilter('all')}><X className="h-3 w-3" /></button></span>)}{activeFilters.length ? <button type="button" className="portfolio-mobile-clear-button" onClick={() => { setFilter('all'); setSort('marketValue'); }}>清空</button> : null}</span>
      </div>
      {showFilterPanel ? <div className="portfolio-mobile-panel"><div className="portfolio-mobile-panel-title">筛选条件<button type="button" onClick={() => setShowFilterPanel(false)} aria-label="关闭筛选"><X className="h-4 w-4" /></button></div><div className="portfolio-mobile-panel-label">基金类型</div><div className="portfolio-mobile-panel-options">{FILTERS.slice(1, 4).map(([key, label]) => <button type="button" key={key} className={cx(filter === key && 'is-selected')} onClick={() => setFilter(key)}>{label}{filter === key ? <Check className="h-3.5 w-3.5" /> : null}</button>)}</div><div className="portfolio-mobile-panel-label">收益率 (%)</div><div className="portfolio-mobile-panel-options"><button type="button" className={cx(sort === 'profitRate' && 'is-selected')} onClick={() => setSort('profitRate')}>大于 5%</button><button type="button" className={cx(sort !== 'profitRate' && 'is-selected')} onClick={() => setSort('marketValue')}>不限</button></div></div> : null}
      {showSortPanel ? <div className="portfolio-mobile-panel"><div className="portfolio-mobile-panel-title">排序<button type="button" onClick={() => setShowSortPanel(false)} aria-label="关闭排序"><X className="h-4 w-4" /></button></div><div className="portfolio-mobile-panel-options portfolio-mobile-panel-options--stack"><button type="button" className={cx(sort === 'marketValue' && 'is-selected')} onClick={() => setSort('marketValue')}>总市值 <span>降序</span>{sort === 'marketValue' ? <Check className="h-3.5 w-3.5" /> : null}</button><button type="button" className={cx(sort === 'profitRate' && 'is-selected')} onClick={() => setSort('profitRate')}>收益率 <span>降序</span>{sort === 'profitRate' ? <Check className="h-3.5 w-3.5" /> : null}</button><button type="button" className={cx(sort === 'todayProfit' && 'is-selected')} onClick={() => setSort('todayProfit')}>今日收益 <span>降序</span>{sort === 'todayProfit' ? <Check className="h-3.5 w-3.5" /> : null}</button></div></div> : null}
      {showColumnsPanel ? <div className="portfolio-mobile-panel"><div className="portfolio-mobile-panel-title">列设置<button type="button" onClick={() => setShowColumnsPanel(false)} aria-label="关闭列设置"><X className="h-4 w-4" /></button></div><p className="portfolio-mobile-panel-hint">卡片视图固定展示核心字段；表格视图可横向查看更多数据。</p><div className="portfolio-mobile-column-list"><span>名称 / 代码</span><span>总市值</span><span>持有收益</span><span>收益率</span><span>今日收益</span></div></div> : null}
      {showSavePanel ? <div className="portfolio-mobile-panel"><div className="portfolio-mobile-panel-title">保存视图<button type="button" onClick={() => setShowSavePanel(false)} aria-label="关闭保存视图"><X className="h-4 w-4" /></button></div><div className="portfolio-mobile-save-row"><input id="portfolio-view-name" placeholder="输入视图名称" defaultValue="我的持仓" /><button type="button" onClick={() => { const name = document.getElementById('portfolio-view-name')?.value?.trim() || '我的持仓'; onSaveView(name); setShowSavePanel(false); }}>保存</button></div>{savedViews.length ? <div className="portfolio-mobile-saved-views">{savedViews.map((name) => <div key={name}><span>{name}</span><button type="button" onClick={() => onDeleteView(name)} aria-label={'删除' + name}><X className="h-3.5 w-3.5" /></button></div>)}</div> : null}</div> : null}
      <label className="portfolio-mobile-search"><Search className="h-4 w-4" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索基金名称或代码" /></label>
    </div>
  );
}

function PortfolioHoldingsTable({ holdings, onRowClick }) {
  const columns = [['name', '名称 / 代码'], ['marketValue', '总市值'], ['unrealizedProfit', '持有收益'], ['unrealizedReturnRate', '收益率'], ['todayProfit', '今日收益'], ['totalCost', '成本']];
  return <div className="portfolio-mobile-table-wrap"><table className="portfolio-mobile-table"><thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}<th aria-label="详情" /></tr></thead><tbody>{holdings.map((holding) => <tr key={holding.code} onClick={() => onRowClick?.({ original: holding })}><td><strong>{holding.name || '未命名基金'}</strong><span className="type-data">{holding.code || '—'}</span></td><td>{holding.hasLatestNav ? formatCurrency(holding.marketValue, '¥', 2) : '—'}</td><td className={tone(holding.unrealizedProfit)}>{holding.hasLatestNav ? signedCurrency(holding.unrealizedProfit) : '—'}</td><td className={tone(holding.unrealizedReturnRate)}>{holding.hasLatestNav ? signedPercent(holding.unrealizedReturnRate) : '—'}</td><td className={tone(holding.todayProfit)}>{holding.hasTodayNav ? signedCurrency(holding.todayProfit) : '—'}</td><td>{holding.hasLatestNav ? formatCurrency(holding.totalCost, '¥', 2) : '—'}</td><td><ChevronRight className="h-4 w-4" /></td></tr>)}</tbody></table></div>;
}

export function HoldingsSummarySection({ aggregates = [], onRowClick, onOpenAlertDialog, onCreateTransaction }) {
  const [view, setView] = useState('cards');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('marketValue');
  const [search, setSearch] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showSortPanel, setShowSortPanel] = useState(false);
  const [showColumnsPanel, setShowColumnsPanel] = useState(false);
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [savedViews, setSavedViews] = useState([]);
  const filtered = useMemo(() => aggregates.filter((item) => {
    const keyword = search.trim().toLowerCase();
    if (keyword && !String(item.name || '').toLowerCase().includes(keyword) && !String(item.code || '').toLowerCase().includes(keyword)) return false;
    if (filter === 'exchange' && item.kind !== 'exchange') return false;
    if (filter === 'otc' && item.kind === 'exchange') return false;
    if (filter === 'favorite' && !(item.isFavorite || item.favorite)) return false;
    if (sort === 'profitRate' && Number(item.unrealizedReturnRate) <= 5) return false;
    return true;
  }).sort((a, b) => {
    if (sort === 'profitRate') return (Number(b.unrealizedReturnRate) || 0) - (Number(a.unrealizedReturnRate) || 0);
    if (sort === 'todayProfit') return (Number(b.todayProfit) || 0) - (Number(a.todayProfit) || 0);
    return (Number(b.marketValue) || 0) - (Number(a.marketValue) || 0);
  }), [aggregates, filter, search, sort]);
  return <section className="portfolio-mobile-holdings-section"><div className="flex items-end justify-between gap-3"><div><h2 className="text-[17px] font-semibold text-[#F5F7FF]">基金汇总</h2><p className="mt-1 text-[12px] text-[#70798D]">共 {filtered.length} 只基金 · 总市值 {formatCurrency(filtered.reduce((sum, item) => sum + (Number(item.marketValue) || 0), 0), '¥', 2)}</p></div><div className="flex items-center gap-1"><button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#A8B0C2] hover:bg-white/10" aria-label="新增持仓" onClick={onCreateTransaction}><Plus className="h-4 w-4" /></button><button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#A8B0C2] hover:bg-white/10" aria-label="搜索持仓" onClick={() => setSearch((value) => value ? '' : ' ')}><Search className="h-4 w-4" /></button></div></div><PortfolioViewToolbar view={view} setView={setView} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} showFilterPanel={showFilterPanel} setShowFilterPanel={setShowFilterPanel} showSortPanel={showSortPanel} setShowSortPanel={setShowSortPanel} showColumnsPanel={showColumnsPanel} setShowColumnsPanel={setShowColumnsPanel} showSavePanel={showSavePanel} setShowSavePanel={setShowSavePanel} savedViews={savedViews} onSaveView={(name) => setSavedViews((current) => current.includes(name) ? current : [...current, name])} onDeleteView={(name) => setSavedViews((current) => current.filter((item) => item !== name))} />{view === 'table' ? <PortfolioHoldingsTable holdings={filtered} onRowClick={onRowClick} /> : <><div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="持仓分类">{FILTERS.map(([key, label]) => <button type="button" role="tab" aria-selected={filter === key} key={key} onClick={() => setFilter(key)} className={cx('shrink-0 rounded-full border px-3 py-2 text-[12px] font-medium', filter === key ? 'border-[#7C4DFF] bg-[#7C4DFF]/15 text-[#C7B9FF]' : 'border-white/[0.08] bg-[#151922] text-[#A8B0C2]')}>{label}</button>)}</div><div className="mt-3 space-y-2">{filtered.length ? filtered.map((holding) => <HoldingMobileCard key={holding.code} holding={holding} onClick={onRowClick} onOpenAlert={onOpenAlertDialog} />) : <div className="portfolio-mobile-empty">暂无持仓</div>}</div></>}</section>;
}

export function MobilePortfolioOverview({ portfolio, accountAllocation, navRefresh, quickActions, aggregates, todaySignals, onAggregateRowClick, onOpenAlertDialog }) {
  const navigate = quickActions?.navigate;
  const nativeApp = isNativeApp();
  return <div className="portfolio-mobile-overview"><AssetHeroCard portfolio={portfolio} accountAllocation={accountAllocation} navRefresh={navRefresh} /><PerformanceMetricsGrid portfolio={portfolio} /><AssetAllocationCard accountAllocation={accountAllocation} onDetails={() => navigate?.('breakdown')} onSettings={() => quickActions?.onAccountSettings?.()} />{nativeApp ? null : <SignalSummaryCard todaySignals={todaySignals} />}<HoldingsSummarySection aggregates={aggregates} onRowClick={onAggregateRowClick} onOpenAlertDialog={onOpenAlertDialog} onCreateTransaction={quickActions?.onNewTransaction} /></div>;
}

export default MobilePortfolioOverview;
