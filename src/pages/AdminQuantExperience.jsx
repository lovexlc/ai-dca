import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { isAnalyticsAdmin } from '../app/analytics.js';
import { loadCloudSession } from '../app/authClient.js';
import { cx } from '../components/experience-ui.jsx';

const STATUS_URL = '/api/market-collector/api/paper-trade/status';
const TRADES_URL = '/api/market-collector/api/paper-trade/trades';
const HISTORY_URL = '/api/market-collector/api/paper-trade/history?limit=2000';
const REFRESH_FAST_MS = 2000;
const REFRESH_SLOW_MS = 30000;

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatSignedMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const sign = num > 0 ? '+' : num < 0 ? '−' : '';
  return `${sign}¥${Math.abs(num).toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatPct(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num >= 0 ? '+' : '−'}${Math.abs(num).toFixed(digits)}%`;
}

function formatShares(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('zh-CN');
}

function formatClock(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatAxisTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function premiumClass(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'text-slate-400';
  return num >= 0 ? 'text-rose-600' : 'text-emerald-600';
}

const DARK_TOOLTIP = {
  backgroundColor: '#1f2937',
  border: 'none',
  borderRadius: 12,
  color: '#fff',
  fontSize: 12,
  padding: '10px 12px'
};

function MarketCard({ tag, code, name, quote }) {
  const q = quote || {};
  const bids = Array.isArray(q.bids) ? q.bids : [];
  const asks = Array.isArray(q.asks) ? q.asks : [];
  const price = Number(q.price);
  const iopv = Number(q.iopv);
  const premium = Number(q.premium);
  const rows = [];
  for (let i = 0; i < 5; i += 1) {
    const ask = asks[4 - i]; // 卖5 → 卖1
    const bid = bids[i]; // 买1 → 买5
    rows.push({ ask, bid, askLevel: 5 - i, bidLevel: i + 1 });
  }
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white">{tag}</span>
          <span className="text-sm font-bold text-slate-800">{name}</span>
          <span className="text-xs tabular-nums text-slate-400">sz{code}</span>
        </div>
        <div className="text-sm text-slate-500">
          溢价率 <span className={cx('text-lg font-bold tabular-nums', premiumClass(premium))}>{formatPct(premium)}</span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <div className="grid grid-cols-3 text-xs text-slate-400">
            <span>卖盘</span><span>档位 / 价格</span><span className="text-right">量(份)</span>
          </div>
          <div className="mt-1 space-y-1">
            {rows.map(({ ask, askLevel }) => (
              <div key={askLevel} className="grid grid-cols-3 text-sm tabular-nums">
                <span className="text-slate-400">卖{askLevel}</span>
                <span className="font-semibold text-rose-600">{ask ? Number(ask[0]).toFixed(3) : '—'}</span>
                <span className="text-right text-slate-500">{ask ? formatShares(ask[1]) : '—'}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="grid grid-cols-3 text-xs text-slate-400">
            <span>买盘</span><span>档位 / 价格</span><span className="text-right">量(份)</span>
          </div>
          <div className="mt-1 space-y-1">
            {rows.map(({ bid, bidLevel }) => (
              <div key={bidLevel} className="grid grid-cols-3 text-sm tabular-nums">
                <span className="text-slate-400">买{bidLevel}</span>
                <span className="font-semibold text-emerald-600">{bid ? Number(bid[0]).toFixed(3) : '—'}</span>
                <span className="text-right text-slate-500">{bid ? formatShares(bid[1]) : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 border-t border-slate-100 pt-3 text-center">
        <span className="text-2xl font-bold tabular-nums text-slate-900">{Number.isFinite(price) ? price.toFixed(3) : '—'}</span>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
        <span className="text-slate-400">IOPV（实时估值）</span>
        <span className="font-bold tabular-nums text-slate-800">{Number.isFinite(iopv) ? iopv.toFixed(4) : '—'}</span>
      </div>
    </div>
  );
}

function tagOfSymbol(symbol, strategy) {
  if (strategy?.symbol_x === symbol) return 'X';
  if (strategy?.symbol_y === symbol) return 'Y';
  return symbol;
}

function AccountCard({ tag, title, delayMs, data, strategy }) {
  const d = data || {};
  const holdings = d.holdings || {};
  const holdingEntries = Object.entries(holdings).filter(([, shares]) => Number(shares) > 0);
  const badgeClass = tag === 'A' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700';
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cx('inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold', badgeClass)}>{tag}</span>
          <span className="text-sm font-bold text-slate-700">{title}</span>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs tabular-nums text-slate-500">延迟 {delayMs}ms</span>
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums text-rose-600">{formatMoney(d.market_value)}</div>
      <div className="mt-1 flex items-center justify-between text-sm">
        <span className="text-slate-400">收益率</span>
        <span className={cx('font-bold tabular-nums', premiumClass(d.pnl_pct))}>{formatPct(d.pnl_pct, 4)}</span>
      </div>
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">当前持仓</span>
          <span className="font-semibold tabular-nums text-slate-800">
            {holdingEntries.length
              ? holdingEntries.map(([code, shares]) => `${tagOfSymbol(code, strategy)} · ${formatShares(shares)} 份`).join(' · ')
              : '空仓'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">可用现金</span>
          <span className="font-semibold tabular-nums text-slate-800">{formatMoney(d.cash)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">轮换次数</span>
          <span className="font-semibold tabular-nums text-slate-800">{Number(d.rotation_count) || 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">累计手续费</span>
          <span className="font-semibold tabular-nums text-slate-800">{formatMoney(d.total_fees)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">累计冲击成本</span>
          <span className="font-semibold tabular-nums text-slate-800">{formatMoney(d.total_impact_cost)}</span>
        </div>
      </div>
    </div>
  );
}

function DiffCard({ quant, manual, spread, strategy }) {
  const a = Number(quant?.market_value);
  const b = Number(manual?.market_value);
  const diff = Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
  const capital = Number(strategy?.initial_capital) || 1000000;
  const ratio = diff == null ? null : (diff / capital) * 100;
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-slate-700">时延差异</span>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-500">B − A</span>
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums text-rose-600">
        {diff == null ? '—' : formatSignedMoney(diff)}
      </div>
      <div className="mt-1 flex items-center justify-between text-sm">
        <span className="text-slate-400">B 相对 A</span>
        <span className="font-bold text-slate-800">{diff == null ? '—' : diff >= 0 ? '高出' : '低于'}</span>
      </div>
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">占本金比例</span>
          <span className={cx('font-semibold tabular-nums', premiumClass(ratio))}>{ratio == null ? '—' : formatPct(ratio, 4)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">溢价差 X−Y</span>
          <span className={cx('font-semibold tabular-nums', premiumClass(spread))}>{formatPct(spread, 3)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">阈值 Q / W</span>
          <span className="font-semibold tabular-nums text-slate-800">
            {strategy ? `${Number(strategy.q_threshold).toFixed(1)}% / ${Number(strategy.w_threshold).toFixed(1)}%` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">下单粒度</span>
          <span className="font-semibold tabular-nums text-slate-800">
            {strategy ? `${formatShares(strategy.lot_shares)} 份/笔` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

function NavChart({ nav, initialCapital }) {
  const data = useMemo(() => (nav || []).map((p) => ({
    t: p.t,
    A量化实时: Number(p.quant),
    B手动3秒: Number(p.manual),
    本金: Number(initialCapital) || 1000000
  })), [nav, initialCapital]);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-center text-sm font-bold text-slate-700">账户净值</h2>
      <div className="mt-2 h-64">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="t" tickFormatter={formatAxisTime} tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={48} />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={(v) => `¥${(v / 10000).toFixed(2)}万`}
                domain={['auto', 'auto']}
                width={72}
              />
              <Tooltip contentStyle={DARK_TOOLTIP} labelFormatter={formatClock} formatter={(v) => [formatMoney(v), '']} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="A量化实时" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="B手动3秒" stroke="#ea580c" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="本金" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无净值数据（盘中每秒记录）</div>
        )}
      </div>
    </div>
  );
}

function SpreadChart({ spread, qThreshold, wThreshold }) {
  const data = useMemo(() => (spread || []).map((p) => ({
    t: p.t,
    'X−Y 溢价差(%)': Number(p.spread)
  })), [spread]);
  const domain = useMemo(() => {
    const vals = data.map((p) => p['X−Y 溢价差(%)']).filter(Number.isFinite);
    const q = Number(qThreshold);
    const w = Number(wThreshold);
    const all = [...vals];
    if (Number.isFinite(q)) all.push(q);
    if (Number.isFinite(w)) all.push(w);
    if (!all.length) return ['auto', 'auto'];
    const min = Math.min(...all);
    const max = Math.max(...all);
    const pad = Math.max((max - min) * 0.15, 0.2);
    return [min - pad, max + pad];
  }, [data, qThreshold, wThreshold]);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-center text-sm font-bold text-slate-700">溢价差与轮换阈值</h2>
      <div className="mt-2 h-64">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="t" tickFormatter={formatAxisTime} tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={48} />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                domain={domain}
                width={56}
              />
              <Tooltip contentStyle={DARK_TOOLTIP} labelFormatter={formatClock} formatter={(v) => [`${Number(v).toFixed(3)}%`, '']} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {Number.isFinite(Number(qThreshold)) && (
                <ReferenceLine y={Number(qThreshold)} stroke="#ef4444" strokeDasharray="6 4" label={{ value: 'Q 阈值', fontSize: 11, fill: '#ef4444', position: 'insideTopRight' }} />
              )}
              {Number.isFinite(Number(wThreshold)) && (
                <ReferenceLine y={Number(wThreshold)} stroke="#10b981" strokeDasharray="6 4" label={{ value: 'W 阈值', fontSize: 11, fill: '#10b981', position: 'insideTopRight' }} />
              )}
              <Line type="monotone" dataKey="X−Y 溢价差(%)" stroke="#111827" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无价差数据（盘中每秒记录）</div>
        )}
      </div>
    </div>
  );
}

function TradesTable({ trades, strategy }) {
  const tagOf = (symbol) => tagOfSymbol(symbol, strategy);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-bold text-slate-700">成交明细</h2>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{trades.length} 笔（最近）</span>
      </div>
      <div className="max-h-96 overflow-auto rounded-2xl border border-slate-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">账户</th>
              <th className="px-3 py-2 text-left">时间</th>
              <th className="px-3 py-2 text-left">标的</th>
              <th className="px-3 py-2 text-left">方向</th>
              <th className="px-3 py-2 text-right">成交份数</th>
              <th className="px-3 py-2 text-right">成交均价</th>
              <th className="px-3 py-2 text-right">对手一档价</th>
              <th className="px-3 py-2 text-right">冲击成本</th>
              <th className="px-3 py-2 text-right">吃档</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {trades.length ? trades.map((t, idx) => (
              <tr key={`${t.timestamp}-${t.portfolio}-${idx}`}>
                <td className="px-3 py-2">
                  <span className={cx(
                    'inline-flex h-5 w-5 items-center justify-center rounded text-xs font-bold',
                    t.portfolio === 'quant' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'
                  )}>
                    {t.portfolio === 'quant' ? 'A' : 'B'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500">{formatClock(t.timestamp)}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-900 text-xs font-bold text-white">{tagOf(t.symbol)}</span>
                </td>
                <td className="px-3 py-2">
                  <span className={cx('font-bold', t.side === 'buy' ? 'text-rose-600' : 'text-emerald-600')}>
                    {t.side === 'buy' ? '买入' : '卖出'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatShares(t.shares)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{Number.isFinite(Number(t.avg_price)) ? Number(t.avg_price).toFixed(3) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Number.isFinite(Number(t.counter_price)) ? Number(t.counter_price).toFixed(3) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatMoney(t.impact_cost)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{Number(t.levels_consumed) || '—'}</td>
              </tr>
            )) : (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">暂无成交记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminQuantExperience({ embedded = false } = {}) {
  const session = loadCloudSession();
  const isAdmin = isAnalyticsAdmin(session);
  const [status, setStatus] = useState(null);
  const [trades, setTrades] = useState([]);
  const [history, setHistory] = useState({ nav: [], spread: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statusRes, tradesRes, historyRes] = await Promise.all([
        fetch(STATUS_URL, { cache: 'no-store' }),
        fetch(TRADES_URL, { cache: 'no-store' }),
        fetch(HISTORY_URL, { cache: 'no-store' })
      ]);
      if (!statusRes.ok) throw new Error(`status ${statusRes.status}`);
      if (!tradesRes.ok) throw new Error(`trades ${tradesRes.status}`);
      setStatus(await statusRes.json());
      const tradesPayload = await tradesRes.json();
      setTrades(Array.isArray(tradesPayload) ? tradesPayload : []);
      if (historyRes.ok) {
        const historyPayload = await historyRes.json();
        setHistory({
          nav: Array.isArray(historyPayload?.nav) ? historyPayload.nav : [],
          spread: Array.isArray(historyPayload?.spread) ? historyPayload.spread : []
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const inTradingHours = status?.in_trading_hours;

  useEffect(() => {
    if (!isAdmin) return undefined;
    fetchData();
    const timer = setInterval(fetchData, inTradingHours === false ? REFRESH_SLOW_MS : REFRESH_FAST_MS);
    return () => clearInterval(timer);
  }, [isAdmin, inTradingHours, fetchData]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const strategy = status?.strategy || null;
  const quotes = status?.quotes || {};
  const portfolios = status?.portfolios || {};
  const symbolNames = strategy?.symbol_names || { '159659': '招商纳斯达克100ETF', '159632': '华安纳斯达克100ETF' };
  const quoteX = quotes[strategy?.symbol_x || '159659'];
  const quoteY = quotes[strategy?.symbol_y || '159632'];
  const spread = useMemo(() => {
    const px = Number(quoteX?.premium);
    const py = Number(quoteY?.premium);
    return Number.isFinite(px) && Number.isFinite(py) ? px - py : null;
  }, [quoteX, quoteY]);

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

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">溢价差轮动·实时看板</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
              <FlaskConical className="h-3 w-3" />实时行情
            </span>
            {inTradingHours != null && (
              <span className={cx(
                'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
                inTradingHours ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'
              )}>
                {inTradingHours ? '盘中运行中' : '盘后待机'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm tabular-nums text-slate-400">
              {now.toLocaleString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              {' · '}tick #{status?.tick_seq ?? '—'}
              {' · '}行情 {formatClock(quoteX?.quote_ts || quoteY?.quote_ts)}
            </span>
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={cx('h-3.5 w-3.5', loading && 'animate-spin')} />刷新
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-rose-500">拉取失败：{error}</p>}
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <MarketCard tag="X" code={strategy?.symbol_x || '159659'} name={symbolNames[strategy?.symbol_x || '159659'] || ''} quote={quoteX} />
        <MarketCard tag="Y" code={strategy?.symbol_y || '159632'} name={symbolNames[strategy?.symbol_y || '159632'] || ''} quote={quoteY} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <AccountCard tag="A" title="量化实时" delayMs={0} data={portfolios.quant} strategy={strategy} />
        <AccountCard tag="B" title="手动3秒" delayMs={3000} data={portfolios.manual} strategy={strategy} />
        <DiffCard quant={portfolios.quant} manual={portfolios.manual} spread={spread} strategy={strategy} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <NavChart nav={history.nav} initialCapital={strategy?.initial_capital} />
        <SpreadChart spread={history.spread} qThreshold={strategy?.q_threshold} wThreshold={strategy?.w_threshold} />
      </section>

      <TradesTable trades={trades} strategy={strategy} />
    </div>
  );
}
