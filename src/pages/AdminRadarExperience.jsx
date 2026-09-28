/**
 * 管理员纳指ETF套利雷达（测试版）
 * 数据来自 /api/notify/nasdaq-radar（每日15:30收盘后计算）
 */
import { useEffect, useState } from 'react';
import { isAnalyticsAdmin } from '../app/analytics.js';
import { cx } from '../components/experience-ui.jsx';

function PercentileBar({ percentile }) {
  const pct = Math.max(0, Math.min(100, Number(percentile) || 0));
  return (
    <div>
      <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-300 via-amber-300 to-rose-400 transition-all duration-1000"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="relative h-8 mt-1">
        <div className="absolute -translate-x-1/2 flex flex-col items-center transition-all duration-1000" style={{ left: `${pct}%` }}>
          <div className="w-0.5 h-3 bg-slate-800" />
          <div className="mt-0.5 px-2 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-bold whitespace-nowrap">
            {pct}分位
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminRadarExperience({ session }) {
  const isAdmin = isAnalyticsAdmin(session);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [computing, setComputing] = useState(false);

  const fetchRadar = async () => {
    try {
      const resp = await fetch('/api/notify/nasdaq-radar', { credentials: 'include' });
      const json = await resp.json();
      setData(json?.data || null);
      if (!json?.data) setError('暂无雷达数据（每日15:30收盘后计算）');
      else setError('');
    } catch (e) {
      setError('加载失败：' + (e?.message || '网络错误'));
    }
  };

  const triggerCompute = async () => {
    setComputing(true);
    try {
      const resp = await fetch('/api/notify/nasdaq-radar/compute', { method: 'POST', credentials: 'include' });
      const json = await resp.json();
      if (json?.ok && json?.data) {
        setData(json.data);
        setError('');
      } else {
        setError('计算失败: ' + (json?.error || '未知错误'));
      }
    } catch (e) {
      setError('触发失败：' + (e?.message || '网络错误'));
    } finally {
      setComputing(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      if (!cancelled) await fetchRadar();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="max-w-lg mx-auto px-5 py-10 text-center">
        <p className="text-sm text-slate-500">当前账号没有权限。请使用 lovexl 登录后访问。</p>
      </div>
    );
  }

  const pair = data?.bestPair;
  const etfs = Array.isArray(data?.etfs) ? data.etfs : [];
  const maxP = etfs.length ? Math.max(...etfs.map(e => e.premium)) : 1;
  const minP = etfs.length ? Math.min(...etfs.map(e => e.premium)) : 0;

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-10 space-y-4">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-300 text-amber-600 bg-amber-50">测试中</span>
        <span className="text-xs text-slate-400">仅管理员可见 · 数据每日15:30更新</span>
        <button
          onClick={triggerCompute}
          disabled={computing}
          className="ml-auto px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-bold disabled:opacity-50"
        >
          {computing ? '计算中…' : '手动计算'}
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-sm text-slate-400">加载中…</div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-sm text-slate-400">{error}</div>
      ) : !pair ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-sm text-slate-400">暂无数据</div>
      ) : (
        <>
          {/* 最优机会卡 */}
          <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-5 text-white shadow-lg">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
              <span className="text-xs font-medium text-indigo-100">今日最优套利机会</span>
              <span className="ml-auto text-[11px] text-indigo-200">{data.date} 收盘</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="text-[11px] text-indigo-200 mb-1">高溢价卖出</div>
                <div className="font-bold text-lg">{pair.sell.code}</div>
                <div className="text-xs text-indigo-200 truncate">{pair.sell.name}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{pair.sell.premium.toFixed(2)}%</div>
              </div>
              <div className="flex flex-col items-center px-2">
                <div className="text-2xl">→</div>
                <div className="mt-1 px-2.5 py-1 rounded-full bg-white/20 text-xs font-bold whitespace-nowrap">
                  价差 {pair.spread.toFixed(2)}%
                </div>
              </div>
              <div className="flex-1 text-right">
                <div className="text-[11px] text-indigo-200 mb-1">低溢价买入</div>
                <div className="font-bold text-lg">{pair.buy.code}</div>
                <div className="text-xs text-indigo-200 truncate">{pair.buy.name}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{pair.buy.premium.toFixed(2)}%</div>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-white/15 flex items-center justify-between text-xs">
              <span className="text-indigo-100">价差处于近20天 <b className="text-white text-sm">{pair.percentile}</b> 分位</span>
              {pair.percentile >= 85 ? (
                <span className="px-2.5 py-1 rounded-full bg-emerald-400/90 text-emerald-950 font-bold text-[11px]">建议关注</span>
              ) : (
                <span className="px-2.5 py-1 rounded-full bg-white/20 text-white text-[11px]">观望</span>
              )}
            </div>
          </div>

          {/* 分位条 */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900 mb-1">溢价差分位</h2>
            <p className="text-xs text-slate-500 mb-4">当前价差 {pair.spread.toFixed(2)}%，超过了近20天 {pair.percentile}% 的日子</p>
            <PercentileBar percentile={pair.percentile} />
          </div>

          {/* 排行 */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900">{etfs.length}只纳指ETF溢价排行</h2>
              <span className="text-[11px] text-slate-400">按溢价率排序</span>
            </div>
            <div className="space-y-2.5">
              {etfs.map((e, i) => {
                const w = maxP > minP ? ((e.premium - minP) / (maxP - minP) * 100).toFixed(0) : 0;
                const isHigh = e.code === pair.sell.code;
                const isLow = e.code === pair.buy.code;
                return (
                  <div key={e.code} className="flex items-center gap-3">
                    <span className={cx('w-5 text-[11px] tabular-nums', i < 3 ? 'font-bold text-slate-700' : 'text-slate-300')}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-800 tabular-nums">{e.code}</span>
                        <span className="text-[11px] text-slate-400 truncate">{e.name}</span>
                        {isHigh && <span className="px-1.5 py-px rounded bg-rose-100 text-rose-700 text-[10px] font-bold">卖出候选</span>}
                        {isLow && <span className="px-1.5 py-px rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">买入候选</span>}
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={cx('h-full rounded-full', isHigh ? 'bg-rose-400' : isLow ? 'bg-emerald-400' : 'bg-indigo-300')}
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    </div>
                    <span className={cx('text-xs font-bold tabular-nums w-14 text-right', isHigh ? 'text-rose-600' : isLow ? 'text-emerald-600' : 'text-slate-600')}>
                      {e.premium.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 近期机会 */}
          {Array.isArray(data.recentOpportunities) && data.recentOpportunities.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900 mb-3">近期套利机会</h2>
              <div className="space-y-2 text-xs">
                {data.recentOpportunities.map((o, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <span className="text-slate-500">{o.date}</span>
                    <span className="font-medium text-slate-700">{o.pair}</span>
                    <span className="tabular-nums text-slate-500">价差{o.spread.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default AdminRadarExperience;
