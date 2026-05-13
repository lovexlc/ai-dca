import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ExternalLink,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
  TrendingDown,
  TrendingUp
} from 'lucide-react';
import {
  Card,
  Pill,
  TextInput,
  cx,
  primaryButtonClass,
  secondaryButtonClass
} from '../components/experience-ui.jsx';
import {
  addToWatchlist,
  askMarkets,
  fetchIndices,
  fetchMovers,
  fetchNews,
  fetchQuotes,
  loadWatchlist,
  removeFromWatchlist
} from '../app/marketsApi.js';
import { showActionToast } from '../app/toast.js';

const MARKETS = [
  { key: 'us', label: '美股' },
  { key: 'cn', label: 'A股' }
];

function formatNumber(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

function formatPercent(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(fractionDigits) + '%';
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function changeToneClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'text-slate-500';
  return n > 0 ? 'text-emerald-600' : 'text-rose-500';
}

function IndexCard({ entry, onPick }) {
  const positive = Number(entry.changePercent) > 0;
  const negative = Number(entry.changePercent) < 0;
  return (
    <button
      type="button"
      onClick={() => onPick && onPick(entry)}
      className="group flex flex-col items-start gap-2 rounded-2xl border border-slate-200/70 bg-white/80 p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-600">{entry.name || entry.symbol}</span>
        <span className={cx('inline-flex items-center gap-1 text-xs font-medium', changeToneClass(entry.changePercent))}>
          {positive ? <ArrowUp size={12} /> : negative ? <ArrowDown size={12} /> : null}
          {formatPercent(entry.changePercent)}
        </span>
      </div>
      <div className="text-2xl font-semibold tabular-nums text-slate-900">{formatNumber(entry.price)}</div>
      <div className="flex w-full items-center justify-between text-xs text-slate-400">
        <span>{entry.symbol}</span>
        <span className={changeToneClass(entry.change)}>{formatNumber(entry.change)}</span>
      </div>
    </button>
  );
}

function MoversTable({ rows = [], onPick }) {
  if (!rows.length) {
    return <p className="text-sm text-slate-400">暂无榜单数据。</p>;
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80">
      <table className="min-w-full divide-y divide-slate-200/70 text-sm">
        <thead className="bg-slate-50/70 text-xs font-medium uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">代码</th>
            <th className="px-3 py-2 text-left">名称</th>
            <th className="px-3 py-2 text-right">最新价</th>
            <th className="px-3 py-2 text-right">涨跌幅</th>
            <th className="px-3 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.symbol} className="hover:bg-indigo-50/40">
              <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.symbol}</td>
              <td className="px-3 py-2 text-slate-800">{row.name}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.price)}</td>
              <td className={cx('px-3 py-2 text-right tabular-nums', changeToneClass(row.changePercent))}>
                {formatPercent(row.changePercent)}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
                  onClick={() => onPick && onPick(row)}
                  title="加入自选"
                >
                  <Plus size={12} /> 自选
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WatchlistTable({ rows = [], market, onRemove }) {
  if (!rows.length) {
    return <p className="text-sm text-slate-400">尚未添加自选。可在涨跌榜里加，也可在搜索框输入代码后回车。</p>;
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80">
      <table className="min-w-full divide-y divide-slate-200/70 text-sm">
        <thead className="bg-slate-50/70 text-xs font-medium uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">代码</th>
            <th className="px-3 py-2 text-left">名称</th>
            <th className="px-3 py-2 text-right">最新价</th>
            <th className="px-3 py-2 text-right">涨跌幅</th>
            <th className="px-3 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.symbol} className="hover:bg-indigo-50/40">
              <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.symbol}</td>
              <td className="px-3 py-2 text-slate-800">{row.name || row.symbol}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.price)}</td>
              <td className={cx('px-3 py-2 text-right tabular-nums', changeToneClass(row.changePercent))}>
                {formatPercent(row.changePercent)}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-400 hover:border-rose-300 hover:text-rose-500"
                  onClick={() => onRemove && onRemove(market, row.symbol)}
                  title="移除自选"
                >
                  <Trash2 size={12} /> 移除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NewsList({ items = [] }) {
  if (!items.length) {
    return <p className="text-sm text-slate-400">暂无新闻。</p>;
  }
  return (
    <ul className="space-y-2">
      {items.slice(0, 20).map((it) => (
        <li key={it.url || it.title} className="rounded-xl border border-slate-200/70 bg-white/80 p-3 text-sm transition hover:border-indigo-200">
          <a
            href={it.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-start justify-between gap-3"
          >
            <div>
              <div className="font-medium text-slate-800">{it.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                {it.source && <span>{it.source}</span>}
                {it.publishedAt && <span>{formatTime(it.publishedAt)}</span>}
              </div>
            </div>
            <ExternalLink size={14} className="shrink-0 text-slate-300" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function AskPanel({ market, contextSymbols }) {
  const [question, setQuestion] = useState('');
  const [depth, setDepth] = useState('fast');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleAsk(event) {
    if (event) event.preventDefault();
    const q = question.trim();
    if (!q) return;
    setLoading(true);
    setErrorMsg('');
    setAnswer('');
    setSources([]);
    try {
      const res = await askMarkets({ question: q, symbols: contextSymbols || [], depth });
      setAnswer(String(res.answer || ''));
      setSources(Array.isArray(res.sources) ? res.sources : []);
      if (res.searchError) setErrorMsg('（联网检索失败：' + res.searchError + '）');
    } catch (err) {
      setErrorMsg(String((err && err.message) || err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Bot size={16} className="text-indigo-500" />
        <h2 className="text-base font-semibold text-slate-800">AI 市场问答</h2>
        <span className="text-xs text-slate-400">基于 Tavily 联网检索 + Workers AI 生成</span>
      </div>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleAsk}>
        <TextInput
          className="flex-1"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={market === 'cn' ? '例如：今天 A 股大盘怎么看？' : '例如：苹果今晚财报有什么重点？'}
          disabled={loading}
        />
        <select
          value={depth}
          onChange={(e) => setDepth(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-600"
          disabled={loading}
        >
          <option value="fast">快速</option>
          <option value="deep">深度</option>
        </select>
        <button type="submit" className={cx(primaryButtonClass, 'inline-flex items-center gap-1')} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          提问
        </button>
      </form>
      {errorMsg && <p className="text-xs text-rose-500">{errorMsg}</p>}
      {answer && (
        <div className="whitespace-pre-wrap rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-sm text-slate-700">
          {answer}
        </div>
      )}
      {sources.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">参考来源</div>
          <ul className="space-y-1">
            {sources.slice(0, 6).map((s) => (
              <li key={s.url || s.title} className="text-xs">
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-indigo-500 hover:underline">
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function MarketsExperience() {
  const [market, setMarket] = useState('us');
  const [indices, setIndices] = useState([]);
  const [indicesLoading, setIndicesLoading] = useState(false);
  const [movers, setMovers] = useState([]);
  const [moversDir, setMoversDir] = useState('gainers');
  const [moversLoading, setMoversLoading] = useState(false);
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [watch, setWatch] = useState(() => loadWatchlist());
  const [watchQuotes, setWatchQuotes] = useState({});
  const [watchLoading, setWatchLoading] = useState(false);
  const [symbolInput, setSymbolInput] = useState('');
  const [generatedAt, setGeneratedAt] = useState('');
  const reqIdRef = useRef(0);

  const watchSymbols = useMemo(() => watch[market] || [], [watch, market]);
  const contextSymbols = useMemo(() => watchSymbols.slice(0, 5), [watchSymbols]);

  const refreshIndices = useCallback(async (forceRefresh = false) => {
    setIndicesLoading(true);
    const reqId = ++reqIdRef.current;
    try {
      const r = await fetchIndices(market, { refresh: forceRefresh });
      if (reqId !== reqIdRef.current) return;
      setIndices(Array.isArray(r.indexes) ? r.indexes : []);
      setGeneratedAt(r.generatedAt || '');
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      showActionToast('指数加载失败', 'error');
    } finally {
      if (reqId === reqIdRef.current) setIndicesLoading(false);
    }
  }, [market]);

  const refreshMovers = useCallback(async (forceRefresh = false) => {
    setMoversLoading(true);
    try {
      const r = await fetchMovers(market, { direction: moversDir, refresh: forceRefresh });
      setMovers(Array.isArray(r.list) ? r.list : []);
    } catch (err) {
      showActionToast('涨跌榜加载失败', 'error');
    } finally {
      setMoversLoading(false);
    }
  }, [market, moversDir]);

  const refreshNews = useCallback(async () => {
    setNewsLoading(true);
    try {
      const r = await fetchNews(market);
      setNews(Array.isArray(r.items) ? r.items : []);
    } catch (err) {
      // news is optional
    } finally {
      setNewsLoading(false);
    }
  }, [market]);

  const refreshWatch = useCallback(async () => {
    const list = watch[market] || [];
    if (!list.length) {
      setWatchQuotes({});
      return;
    }
    setWatchLoading(true);
    try {
      const r = await fetchQuotes(list);
      setWatchQuotes(r.quotes || {});
    } catch (err) {
      // ignore
    } finally {
      setWatchLoading(false);
    }
  }, [watch, market]);

  useEffect(() => {
    refreshIndices(false);
    refreshNews();
  }, [refreshIndices, refreshNews]);

  useEffect(() => {
    refreshMovers(false);
  }, [refreshMovers]);

  useEffect(() => {
    refreshWatch();
  }, [refreshWatch]);

  function handleAddSymbol(event) {
    if (event) event.preventDefault();
    const raw = symbolInput.trim();
    if (!raw) return;
    const next = addToWatchlist(market, raw);
    setWatch(next);
    setSymbolInput('');
  }

  function handleRemove(market, symbol) {
    const next = removeFromWatchlist(market, symbol);
    setWatch(next);
  }

  function handlePickMover(row) {
    const next = addToWatchlist(market, row.symbol);
    setWatch(next);
    showActionToast('已加入自选', 'success');
  }

  const watchRows = useMemo(
    () =>
      (watch[market] || []).map((sym) => {
        const q = watchQuotes[sym] || {};
        return {
          symbol: sym,
          name: q.name || sym,
          price: q.price,
          changePercent: q.changePercent,
          change: q.change
        };
      }),
    [watch, market, watchQuotes]
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {MARKETS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={cx(
                'rounded-full px-3 py-1 text-sm font-medium transition',
                market === m.key
                  ? 'bg-indigo-500 text-white shadow-sm'
                  : 'bg-white/70 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
              )}
              onClick={() => setMarket(m.key)}
            >
              {m.label}
            </button>
          ))}
          {generatedAt && <span className="text-xs text-slate-400">更新于 {formatTime(generatedAt)}</span>}
        </div>
        <button
          type="button"
          className={cx(secondaryButtonClass, 'inline-flex items-center gap-1 text-xs')}
          onClick={() => {
            refreshIndices(true);
            refreshMovers(true);
            refreshNews();
            refreshWatch();
          }}
        >
          <RefreshCw size={12} /> 刷新
        </button>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-500" />
          <h2 className="text-base font-semibold text-slate-800">主要指数</h2>
          {indicesLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {indices.map((entry) => (
            <IndexCard key={entry.symbol} entry={entry} onPick={(e) => handlePickMover(e)} />
          ))}
          {!indices.length && !indicesLoading && (
            <p className="text-sm text-slate-400">暂无指数数据。</p>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {moversDir === 'gainers' ? <TrendingUp size={16} className="text-emerald-500" /> : <TrendingDown size={16} className="text-rose-500" />}
              <h2 className="text-base font-semibold text-slate-800">{moversDir === 'gainers' ? '涨幅榜' : '跌幅榜'}</h2>
              {moversLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
            </div>
            <div className="flex items-center gap-1 text-xs">
              <button
                type="button"
                className={cx(
                  'rounded-full px-2 py-1 transition',
                  moversDir === 'gainers' ? 'bg-emerald-500 text-white' : 'bg-white/80 text-slate-500 hover:bg-emerald-50'
                )}
                onClick={() => setMoversDir('gainers')}
              >
                涨幅
              </button>
              <button
                type="button"
                className={cx(
                  'rounded-full px-2 py-1 transition',
                  moversDir === 'losers' ? 'bg-rose-500 text-white' : 'bg-white/80 text-slate-500 hover:bg-rose-50'
                )}
                onClick={() => setMoversDir('losers')}
              >
                跌幅
              </button>
            </div>
          </div>
          <MoversTable rows={movers} onPick={handlePickMover} />
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Star size={16} className="text-amber-400" />
              <h2 className="text-base font-semibold text-slate-800">自选</h2>
              {watchLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
            </div>
            <form className="flex items-center gap-1" onSubmit={handleAddSymbol}>
              <TextInput
                className="w-32"
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value)}
                placeholder={market === 'cn' ? 'sh600519' : 'AAPL'}
              />
              <button type="submit" className={cx(primaryButtonClass, 'inline-flex items-center gap-1 text-xs')}>
                <Plus size={12} /> 添加
              </button>
            </form>
          </div>
          <WatchlistTable rows={watchRows} market={market} onRemove={handleRemove} />
        </Card>
      </div>

      <AskPanel market={market} contextSymbols={contextSymbols} />

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Newspaper size={16} className="text-indigo-500" />
          <h2 className="text-base font-semibold text-slate-800">市场新闻</h2>
          {newsLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
          {market === 'cn' && <Pill tone="slate">A 股新闻源建设中</Pill>}
        </div>
        <NewsList items={news} />
      </Card>
    </div>
  );
}
