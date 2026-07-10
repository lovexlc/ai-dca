import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  BellRing,
  ChevronRight,
  CircleHelp,
  Eye,
  EyeOff,
  PieChart,
  RefreshCw,
  ReceiptText,
  Search,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { formatCurrency, formatPercent } from '../../../app/accumulation.js';
import { cx } from '../../experience-ui.jsx';

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
      <div className="mt-5 grid grid-cols-[112px_minmax(0,1fr)] items-center gap-5">
        <div className="relative h-28 w-28 shrink-0 rounded-full p-[11px]" style={donutStyle}>
          <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[#151922] text-center"><span className="text-[11px] text-[#70798D]">投资占比</span><strong className="mt-1 text-[24px] leading-none text-[#F5F7FF] tabular-nums">{formatPercent(investmentPct, 0)}</strong></div>
        </div>
        <div className="min-w-0 space-y-3">
          <AllocationRow color="bg-[#7C4DFF]" label="投资资产" percent={investmentPct} value={accountAllocation?.investmentValue} />
          <AllocationRow color="bg-[#303746]" label="现金资产" percent={cashPct} value={accountAllocation?.cashValue} />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.08] pt-4 text-[12px] text-[#A8B0C2]"><div>现金收益 <span className="ml-1 font-medium tabular-nums text-[#F5F7FF]">{formatCurrency(0, '¥', 2)}</span></div><div className="text-right">年化收益（预估）<span className="ml-1 font-medium tabular-nums text-[#F5F7FF]">{formatCurrency(accountAllocation?.cashAnnualIncome, '¥', 2)}</span></div></div>
    </section>
  );
}

function AllocationRow({ color, label, percent, value }) {
  return <div className="flex min-w-0 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[12px] text-[#A8B0C2]"><span className={cx('h-2 w-2 shrink-0 rounded-full', color)} />{label}<span className="tabular-nums text-[#70798D]">{formatPercent(percent, 0)}</span></div><span className="shrink-0 whitespace-nowrap text-[14px] font-semibold tabular-nums text-[#F5F7FF]">{formatCurrency(value, '¥', 2)}</span></div>;
}

const QUICK_ACTIONS = [
  { label: '收益明细', Icon: BarChart3, route: 'income' },
  { label: '清仓', Icon: ReceiptText, route: 'liquidation' },
  { label: '持仓分析', Icon: PieChart, route: 'breakdown' },
  { label: '交易记录', Icon: ArrowLeftRight, route: 'transactions' },
];

export function PortfolioQuickActions({ navigate }) {
  return <section className="portfolio-mobile-quick-actions" aria-label="快捷操作">{QUICK_ACTIONS.map(({ label, Icon, route }) => <button type="button" key={route} onClick={() => navigate?.(route)}><span className="portfolio-mobile-action-icon"><Icon className="h-5 w-5" /></span><span>{label}</span></button>)}</section>;
}

export function SignalSummaryCard({ todaySignals }) {
  const switchCount = Number(todaySignals?.switchSummary?.count) || 0;
  const exitCount = Number(todaySignals?.exitSummary?.count) || 0;
  const hasSignal = switchCount > 0 || exitCount > 0;
  return <section className="portfolio-mobile-card portfolio-mobile-signal" aria-label="今日信号"><div className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', hasSignal ? 'bg-[#F6C453]/15 text-[#F6C453]' : 'bg-[#22C77A]/15 text-[#22C77A]')}><ShieldCheck className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="text-[15px] font-semibold text-[#F5F7FF]">今日信号</div><div className="mt-1 text-[12px] text-[#A8B0C2]">{hasSignal ? '今天有需要确认的动作' : '今日无信号，持仓稳定'}</div></div><div className="grid shrink-0 grid-cols-2 gap-3 text-right"><div><div className="text-[11px] text-[#70798D]">换仓</div><div className="mt-1 text-[14px] font-semibold tabular-nums text-[#F5F7FF]">{switchCount}只</div></div><div><div className="text-[11px] text-[#70798D]">出场</div><div className="mt-1 text-[14px] font-semibold tabular-nums text-[#F5F7FF]">{exitCount}只</div></div></div></section>;
}

function HoldingMobileCard({ holding, onClick, onOpenAlert }) {
  const marketValue = holding?.hasLatestNav ? formatCurrency(holding.marketValue, '¥', 2) : '—';
  return <article className="portfolio-mobile-holding"><button type="button" onClick={() => onClick?.({ original: holding })} className="flex min-w-0 flex-1 items-center gap-3 text-left"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="rounded-md bg-[#7C4DFF]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#B7A4FF]">{holding?.kind === 'exchange' ? '场内 ETF' : '场外基金'}</span><span className="font-mono text-[11px] text-[#70798D]">{holding?.code || '—'}</span></div><div className="mt-2 truncate text-[14px] font-semibold text-[#F5F7FF]">{holding?.name || '未命名基金'}</div><div className="mt-1 text-[11px] text-[#70798D]">市值 {marketValue}</div></div><div className="shrink-0 text-right"><div className="text-[13px] font-semibold tabular-nums text-[#F5F7FF]">持有 {holding?.hasLatestNav ? signedCurrency(holding.unrealizedProfit) : '—'}</div><div className={cx('mt-1 text-[12px] font-medium tabular-nums', tone(holding?.todayProfit))}>今日 {holding?.hasTodayNav ? signedCurrency(holding.todayProfit) : '—'}</div></div><ChevronRight className="h-5 w-5 shrink-0 text-[#70798D]" /></button>{onOpenAlert ? <button type="button" className="ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#70798D] hover:bg-white/10" aria-label={`设置 ${holding?.name || holding?.code || '基金'} 预警`} onClick={(event) => { event.stopPropagation(); onOpenAlert(holding); }}><BellRing className="h-4 w-4" /></button> : null}</article>;
}

export function HoldingsSummarySection({ aggregates = [], onRowClick, onOpenAlertDialog }) {
  const [filter, setFilter] = useState('all');
  const filtered = useMemo(() => aggregates.filter((item) => {
    if (filter === 'exchange') return item.kind === 'exchange';
    if (filter === 'otc') return item.kind !== 'exchange';
    if (filter === 'favorite') return item.isFavorite || item.favorite;
    return true;
  }), [aggregates, filter]);
  const filters = [['all', '全部'], ['exchange', '场内 ETF'], ['otc', '场外基金'], ['favorite', '自选分组']];
  return <section className="portfolio-mobile-holdings-section"><div className="flex items-end justify-between gap-3"><div><h2 className="text-[17px] font-semibold text-[#F5F7FF]">基金汇总</h2><p className="mt-1 text-[12px] text-[#70798D]">{filtered.length} 只持仓 · 总市值 {formatCurrency(filtered.reduce((sum, item) => sum + (Number(item.marketValue) || 0), 0), '¥', 2)}</p></div><button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#A8B0C2] hover:bg-white/10" aria-label="搜索持仓"><Search className="h-4 w-4" /></button></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="持仓分类">{filters.map(([key, label]) => <button type="button" role="tab" aria-selected={filter === key} key={key} onClick={() => setFilter(key)} className={cx('shrink-0 rounded-full border px-3 py-2 text-[12px] font-medium', filter === key ? 'border-[#7C4DFF] bg-[#7C4DFF]/15 text-[#C7B9FF]' : 'border-white/[0.08] bg-[#151922] text-[#A8B0C2]')}>{label}</button>)}</div><div className="mt-3 space-y-2">{filtered.length ? filtered.map((holding) => <HoldingMobileCard key={holding.code} holding={holding} onClick={onRowClick} onOpenAlert={onOpenAlertDialog} />) : <div className="portfolio-mobile-empty">暂无持仓</div>}</div></section>;
}

export function MobilePortfolioOverview({ portfolio, accountAllocation, navRefresh, quickActions, aggregates, todaySignals, onAggregateRowClick, onOpenAlertDialog }) {
  const navigate = quickActions?.navigate;
  return <div className="portfolio-mobile-overview"><AssetHeroCard portfolio={portfolio} accountAllocation={accountAllocation} navRefresh={navRefresh} /><PerformanceMetricsGrid portfolio={portfolio} /><AssetAllocationCard accountAllocation={accountAllocation} onDetails={() => navigate?.('breakdown')} onSettings={() => quickActions?.onAccountSettings?.()} /><PortfolioQuickActions navigate={navigate} /><SignalSummaryCard todaySignals={todaySignals} /><HoldingsSummarySection aggregates={aggregates} onRowClick={onAggregateRowClick} onOpenAlertDialog={onOpenAlertDialog} /></div>;
}

export default MobilePortfolioOverview;
