import { useCallback, useEffect, useReducer, useRef } from 'react';
import { loadHomeScreen } from './data/homeScreen.js';
import { INITIAL_HOME_STATE, directionOf, homeScreenReducer } from './data/homeScreenCore.js';

/**
 * HomeScreen - beta 首页 tab。
 * 三张卡片：账户概览、自选领涨领跌、大盘概览。
 * 每张卡片自己带状态，一段挂掉其余照常显示。拼装逻辑在 homeScreenCore.js。
 */

const DIRECTION_CLASS = {
  up: 'text-rose-600',
  down: 'text-emerald-600',
  flat: 'text-slate-400'
};

function formatMoney(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  try {
    return num.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch (error) {
    return num.toFixed(digits);
  }
}

function formatSigned(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return (num > 0 ? '+' : '') + formatMoney(num, digits);
}

function formatPercent(value) {
  const num = Number(value);
  if (value === null || value === undefined || !Number.isFinite(num)) return '—';
  return (num > 0 ? '+' : '') + num.toFixed(2) + '%';
}

function formatClock(stamp) {
  const num = Number(stamp);
  if (!Number.isFinite(num) || num <= 0) return '';
  try {
    return new Date(num).toLocaleTimeString('zh-CN', { hour12: false });
  } catch (error) {
    return '';
  }
}

function SectionCard({ title, note, children }) {
  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {note ? <span className="shrink-0 text-xs text-slate-400">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function MoverList({ label, rows, empty }) {
  return (
    <div className="mt-2">
      <p className="text-xs text-slate-500">{label}</p>
      {rows.length ? (
        <ul className="mt-1 space-y-1">
          {rows.map((row) => (
            <li key={row.code} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-slate-800">{row.name || row.code}</span>
              <span className={'shrink-0 font-medium ' + DIRECTION_CLASS[row.direction || directionOf(row.changePercent)]}>
                {formatPercent(row.changePercent)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-slate-400">{empty}</p>
      )}
    </div>
  );
}

export function HomeScreen() {
  const [state, dispatch] = useReducer(homeScreenReducer, INITIAL_HOME_STATE);
  const requestRef = useRef(0);
  const aliveRef = useRef(true);

  const runLoad = useCallback(async (options = {}) => {
    requestRef.current += 1;
    const requestId = requestRef.current;
    dispatch({ type: 'request', requestId });
    let result;
    try {
      result = await loadHomeScreen(options);
    } catch (error) {
      result = { ok: false, error };
    }
    if (!aliveRef.current) return;
    if (result && result.ok) {
      dispatch({ type: 'success', requestId, ...result });
    } else {
      dispatch({ type: 'failure', requestId, error: result && result.error });
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    runLoad();
    return () => {
      aliveRef.current = false;
    };
  }, [runLoad]);

  const handleRefresh = useCallback(() => {
    runLoad({ refresh: true });
  }, [runLoad]);

  const busy = state.status === 'loading' || state.status === 'refreshing';
  const holdings = state.holdings;
  const markets = state.markets;
  const overview = state.overview;
  const summary = holdings.summary;
  const clock = formatClock(state.updatedAt);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">首页</h2>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={busy}
          className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? '刷新中' : '刷新'}
        </button>
      </div>

      {state.error ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {state.error}
        </div>
      ) : null}

      <section className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <p className="text-xs text-slate-500">账户市值</p>
        <p className="mt-0.5 text-2xl font-semibold text-slate-900">
          {summary ? formatMoney(summary.marketValue) : '—'}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-slate-500">今日</p>
            <p className={'mt-0.5 font-semibold ' + DIRECTION_CLASS[directionOf(summary && summary.dayProfit)]}>
              {summary ? formatSigned(summary.dayProfit) : '—'}
            </p>
          </div>
          <div>
            <p className="text-slate-500">浮盈亏</p>
            <p className={'mt-0.5 font-semibold ' + DIRECTION_CLASS[directionOf(summary && summary.profit)]}>
              {summary ? formatSigned(summary.profit) : '—'}
            </p>
          </div>
          <div>
            <p className="text-slate-500">收益率</p>
            <p className={'mt-0.5 font-semibold ' + DIRECTION_CLASS[directionOf(summary && summary.profitPercent)]}>
              {summary ? formatPercent(summary.profitPercent) : '—'}
            </p>
          </div>
        </div>

        {holdings.status === 'empty' ? (
          <p className="mt-3 text-xs text-slate-400">还没有持仓。先到正式版记一笔买入。</p>
        ) : null}
        {holdings.error ? <p className="mt-3 text-xs text-amber-700">{holdings.error}</p> : null}

        {holdings.rows.length ? (
          <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2">
            {holdings.rows.map((row) => (
              <li key={row.code} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-slate-800">{row.name || row.code}</span>
                <span className="shrink-0 text-slate-500">
                  {formatMoney(row.marketValue)}
                  <span className={'ml-2 font-medium ' + DIRECTION_CLASS[row.direction]}>
                    {formatPercent(row.profitPercent)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <SectionCard
        title="自选涨跌"
        note={markets.summary ? markets.summary.withData + ' / ' + markets.summary.total + ' 有行情' : ''}
      >
        {markets.status === 'empty' ? (
          <p className="mt-2 text-xs text-slate-400">自选单是空的，先到正式版添加基金。</p>
        ) : null}
        {markets.error ? <p className="mt-2 text-xs text-amber-700">{markets.error}</p> : null}
        {markets.status === 'ready' ? (
          <>
            <MoverList label="领涨" rows={markets.gainers} empty="今天没有上涨的" />
            <MoverList label="领跌" rows={markets.losers} empty="今天没有下跌的" />
          </>
        ) : null}
      </SectionCard>

      <SectionCard title="大盘">
        {overview.status === 'ready' ? (
          <ul className="mt-2 space-y-1">
            {overview.indices.map((item) => (
              <li key={item.code || item.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-slate-800">{item.name}</span>
                <span className="shrink-0 text-slate-500">
                  {item.price === null ? '' : formatMoney(item.price, 2)}
                  <span className={'ml-2 font-medium ' + DIRECTION_CLASS[item.direction]}>
                    {formatPercent(item.changePercent)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-400">
            {overview.status === 'unsupported'
              ? '大盘概览还没接线，等行情服务补上首页端点后自动出现。'
              : (overview.error || '暂无大盘数据。')}
          </p>
        )}
      </SectionCard>

      {clock ? <p className="mt-3 text-center text-xs text-slate-400">{'更新于 ' + clock}</p> : null}
    </div>
  );
}

export default HomeScreen;
