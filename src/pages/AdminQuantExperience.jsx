import { useCallback, useEffect, useState } from 'react';
import { ArrowDownUp, FlaskConical, RefreshCw, ShieldCheck, Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import { isAnalyticsAdmin } from '../app/analytics.js';
import { loadCloudSession } from '../app/authClient.js';
import { cx } from '../components/experience-ui.jsx';

const STATUS_URL = '/api/market-collector/api/paper-trade/status';
const TRADES_URL = '/api/market-collector/api/paper-trade/trades';
const REFRESH_INTERVAL_MS = 30000;

const SYMBOL_NAMES = { '159659': '招商纳指ETF', '159632': '华安纳指ETF' };

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function formatPct(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num >= 0 ? '+' : ''}${num.toFixed(digits)}%`;
}

function formatShares(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('zh-CN');
}

function formatTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function PortfolioCard({ data, accent }) {
  if (!data) return null;
  const pnl = Number(data.pnl) || 0;
  const pnlPositive = pnl >= 0;
  const holdings = data.holdings || {};
  const holdingEntries = Object.entries(holdings).filter(([, shares]) => Number(shares) > 0);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold', accent)}>
            {data.name === 'quant' ? '量化版 · 即时执行' : '手动版 · 3秒执行'}
          </span>
        </div>
        <span className="text-xs text-slate-400">成交 {data.trade_count || 0} 笔</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-slate-900">{formatMoney(data.market_value)}</span>
        <span className="text-xs text-slate-400">总市值</span>
      </div>
      <div className={cx('mt-1 flex items-center gap-1 text-lg font-bold tabular-nums', pnlPositive ? 'text-rose-600' : 'text-emerald-600')}>
        {pnlPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        {formatMoney(pnl)}（{formatPct(data.pnl_pct)}）
      </div>
      <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">持仓</span>
          <span className="font-semibold tabular-nums text-slate-800">
            {holdingEntries.length ? holdingEntries.map(([code, shares]) => `${code} ${formatShares(shares)}股`).join(' · ') : '空仓'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">现金</span>
          <span className="font-semibold tabular-nums text-slate-800">{formatMoney(data.cash)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">初始本金</span>
          <span className="tabular-nums text-slate-500">{formatMoney(data.initial_capital)}</span>
        </div>
      </div>
    </div>
  );
}

function QuoteRow({ quotes }) {
  const q659 = quotes?.['159659'] || {};
  const q632 = quotes?.['159632'] || {};
  const p659 = Number(q659.premium);
  const p632 = Number(q632.premium);
  const spread = Number.isFinite(p659) && Number.isFinite(p632) ? p659 - p632 : null;
  const signal = spread == null ? null : spread > 0.3 ? '159632' : spread < 0.1 ? '159659' : null;
  const cells = [
    { code: '159659', q: q659 },
    { code: '159632', q: q632 }
  ];
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900">实时行情与价差</h2>
        {spread != null && (
          <span className="text-sm tabular-nums text-slate-500">
            价差 <span className="font-bold text-slate-800">{spread.toFixed(4)}</span>
            {signal && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700"><ArrowDownUp className="h-3 w-3" />信号持有 {signal}</span>}
            {!signal && <span className="ml-2 text-xs text-slate-400">无切换信号</span>}
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cells.map(({ code, q }) => (
          <div key={code} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-800">{code} <span className="font-normal text-slate-400">{SYMBOL_NAMES[code] || ''}</span></span>
              <span className="text-xl font-bold tabular-nums text-slate-900">{Number.isFinite(Number(q.price)) ? Number(q.price).toFixed(3) : '—'}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-slate-500">IOPV <span className="font-semibold tabular-nums text-slate-700">{Number.isFinite(Number(q.iopv)) ? Number(q.iopv).toFixed(4) : '—'}</span></span>
              <span className="text-slate-500">溢价 <span className="font-semibold tabular-nums text-slate-700">{formatPct(q.premium)}</span></span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">价差 = 159659溢价 − 159632溢价；价差 &gt; 0.3 切换到 159632，&lt; 0.1 切换到 159659。</p>
    </div>
  );
}

export function AdminQuantExperience({ embedded = false } = {}) {
  const session = loadCloudSession();
  const isAdmin = isAnalyticsAdmin(session);
  const [status, setStatus] = useState(null);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statusRes, tradesRes] = await Promise.all([
        fetch(STATUS_URL, { cache: 'no-store' }),
        fetch(TRADES_URL, { cache: 'no-store' })
      ]);
      if (!statusRes.ok) throw new Error(`status ${statusRes.status}`);
      if (!tradesRes.ok) throw new Error(`trades ${tradesRes.status}`);
      const statusPayload = await statusRes.json();
      const tradesPayload = await tradesRes.json();
      setStatus(statusPayload);
      setTrades(Array.isArray(tradesPayload) ? tradesPayload : []);
      setUpdatedAt(new Date().toLocaleString('zh-CN', { hour12: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    fetchData();
    const timer = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isAdmin, fetchData]);

  if (!isAdmin) {
    return (
      <div className={cx('mx-auto max-w-4xl', embedded ? 'px-4 sm:px-6' : 'px-6')}>
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <div className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="h-5 w-5" />管理员权限 required</div>
          <p className="mt-2 text-sm leading-6">当前账号没有量化看板权限。请使用 lovexl 登录后访问。</p>
        </div>
      </div>
    );
  }

  const portfolios = status?.portfolios || {};
  const inTradingHours = status?.in_trading_hours;

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700"><FlaskConical className="h-3.5 w-3.5" />管理员量化看板</div>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">159659/159632 溢价套利模拟盘</h1>
            <p className="mt-1 text-sm text-slate-500">100万本金起手买低溢价；价差&gt;0.3切159632、&lt;0.1切159659；全额切换、100手取整、扫五档盘口成交。</p>
            <div className="mt-2 text-xs text-slate-400">
              数据源：cn 主机模拟盘引擎（盘中每秒一轮）
              {inTradingHours != null && <span className={cx('ml-2 inline-flex items-center rounded-full px-2 py-0.5 font-semibold', inTradingHours ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{inTradingHours ? '盘中运行' : '盘后待机'}</span>}
              {updatedAt && <span className="ml-2">更新于 {updatedAt}</span>}
              {error && <span className="ml-2 text-rose-500">拉取失败：{error}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={fetchData} disabled={loading} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"><RefreshCw className={cx('h-3.5 w-3.5', loading && 'animate-spin')} />刷新</button>
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <PortfolioCard data={portfolios.quant} accent="bg-violet-100 text-violet-700" />
        <PortfolioCard data={portfolios.manual} accent="bg-amber-100 text-amber-700" />
      </section>

      <QuoteRow quotes={status?.quotes} />

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-indigo-500" /><h2 className="text-base font-bold text-slate-900">成交记录</h2></div>
          <span className="text-xs text-slate-400">最近 {trades.length} 笔 · 30秒自动刷新</span>
        </div>
        <div className="max-h-96 overflow-auto rounded-2xl border border-slate-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">时间</th>
                <th className="px-3 py-2 text-left">组合</th>
                <th className="px-3 py-2 text-left">方向</th>
                <th className="px-3 py-2 text-left">代码</th>
                <th className="px-3 py-2 text-right">股数</th>
                <th className="px-3 py-2 text-right">均价</th>
                <th className="px-3 py-2 text-right">金额</th>
                <th className="px-3 py-2 text-right">信号价差</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {trades.length ? trades.map((t, idx) => (
                <tr key={`${t.timestamp}-${t.portfolio}-${idx}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{formatTime(t.timestamp)}</td>
                  <td className="px-3 py-2"><span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', t.portfolio === 'quant' ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-700')}>{t.portfolio === 'quant' ? '量化1s' : '手动3s'}</span></td>
                  <td className="px-3 py-2"><span className={cx('font-bold', t.side === 'buy' ? 'text-rose-600' : 'text-emerald-600')}>{t.side === 'buy' ? '买入' : '卖出'}</span></td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{t.symbol}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatShares(t.shares)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{Number.isFinite(Number(t.avg_price)) ? Number(t.avg_price).toFixed(3) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatMoney(t.amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Number.isFinite(Number(t.signal_spread)) ? Number(t.signal_spread).toFixed(4) : '—'}</td>
                </tr>
              )) : <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">暂无成交记录</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
