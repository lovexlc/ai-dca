import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, RefreshCw, ShieldCheck } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';
import { isAnalyticsAdmin } from '../app/analytics.js';
import { loadCloudSession } from '../app/authClient.js';
import { formatClock } from './quant/quantFormat.js';
import { QuantAccountCards } from './quant/QuantAccountCards.jsx';
import { QuantComparisonCard } from './quant/QuantComparisonCard.jsx';
import { QuantNavChart } from './quant/QuantNavChart.jsx';
import { QuantPremiumRankTable } from './quant/QuantPremiumRankTable.jsx';
import { QuantSpreadChart } from './quant/QuantSpreadChart.jsx';
import { QuantStrategyParamsCard } from './quant/QuantStrategyParamsCard.jsx';
import { QuantTradesTable } from './quant/QuantTradesTable.jsx';

const STATUS_URL = '/api/market-collector/api/paper-trade/status';
const TRADES_URL = '/api/market-collector/api/paper-trade/trades?limit=1000';
const HISTORY_URL = '/api/market-collector/api/paper-trade/history?limit=2000';
const REFRESH_FAST_MS = 2000;
const REFRESH_SLOW_MS = 30000;

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

  const { strategy, quotes, portfolios, symbols, symbolNames, specs } = useMemo(() => {
    const strategy = status?.strategy || null;
    const specs = strategy?.portfolios || [];
    return {
      strategy,
      quotes: status?.quotes || {},
      portfolios: status?.portfolios || {},
      symbols: strategy?.symbols || [],
      symbolNames: strategy?.symbol_names || {},
      specs
    };
  }, [status]);
  const quoteTs = useMemo(() => Object.values(quotes).find((q) => q?.quote_ts)?.quote_ts || null, [quotes]);
  // 每只标的被哪些盘持有，用于溢价排名表高亮
  const holdingsBySymbol = useMemo(() => {
    const map = {};
    for (const spec of specs) {
      const data = portfolios[spec.key];
      if (!data) continue;
      for (const [code, shares] of Object.entries(data.holdings || {})) {
        if (Number(shares) > 0) {
          map[code] = [...(map[code] || []), spec];
        }
      }
    }
    return map;
  }, [specs, portfolios]);

  if (!isAdmin) {
    return (
      <div className={cx('mx-auto max-w-4xl', embedded ? 'px-4 sm:px-6' : 'px-6')}>
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <div className="flex items-center gap-2 text-lg font-bold">
            <ShieldCheck className="h-5 w-5" />
            管理员权限 required
          </div>
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
            <h1 className="text-xl font-bold text-slate-900">纳指ETF轮动·实时看板</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
              <FlaskConical className="h-3 w-3" />
              多Q并行模拟
            </span>
            {inTradingHours != null && (
              <span
                className={cx(
                  'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
                  inTradingHours ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'
                )}
              >
                {inTradingHours ? '盘中运行中' : '盘后待机'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm tabular-nums text-slate-400">
              {now.toLocaleString('zh-CN', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })}
              {' · '}tick #{status?.tick_seq ?? '—'}
              {' · '}行情 {formatClock(quoteTs)}
            </span>
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={cx('h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-rose-500">拉取失败：{error}</p>}
      </header>

      <QuantPremiumRankTable
        quotes={quotes}
        symbols={symbols}
        symbolNames={symbolNames}
        holdingsBySymbol={holdingsBySymbol}
        specs={specs}
      />

      <QuantAccountCards specs={specs} portfolios={portfolios} symbolNames={symbolNames} />

      <section className="grid gap-4 lg:grid-cols-2">
        <QuantComparisonCard
          specs={specs}
          portfolios={portfolios}
          nav={history.nav}
          initialCapital={strategy?.initial_capital}
        />
        <QuantStrategyParamsCard strategy={strategy} symbols={symbols} symbolNames={symbolNames} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <QuantNavChart nav={history.nav} specs={specs} initialCapital={strategy?.initial_capital} />
        <QuantSpreadChart spread={history.spread} />
      </section>

      <QuantTradesTable trades={trades} specs={specs} symbolNames={symbolNames} />
    </div>
  );
}
