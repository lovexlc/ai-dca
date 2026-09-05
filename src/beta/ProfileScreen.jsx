import { useCallback, useEffect, useRef, useState } from 'react';
import { disableBeta } from '../app/betaEnvironment.js';
import { loadProfileScreen } from './data/profileScreen.js';
import { INITIAL_PROFILE_STATE } from './data/profileScreenCore.js';

/**
 * ProfileScreen - beta「我的」tab。
 * 本地数据体检 + 搬运进度 + 退回正式版。统计与降级逻辑在 profileScreenCore.js。
 */

function formatValue(stat) {
  if (stat.error) return '—';
  if (stat.value === null || stat.value === undefined) return '—';
  return String(stat.value);
}

export function ProfileScreen() {
  const [state, setState] = useState(INITIAL_PROFILE_STATE);
  const aliveRef = useRef(true);

  const runLoad = useCallback(async () => {
    setState((prev) => ({ ...prev, status: prev.updatedAt ? 'refreshing' : 'loading', error: '' }));
    let result;
    try {
      result = await loadProfileScreen();
    } catch (error) {
      result = { ok: false, error };
    }
    if (!aliveRef.current) return;
    if (result && result.ok) {
      setState({
        status: 'ready',
        stats: result.stats,
        progress: result.progress,
        error: '',
        updatedAt: result.updatedAt
      });
      return;
    }
    const message = result && result.error && result.error.message ? result.error.message : '本地数据读取失败';
    setState((prev) => ({ ...prev, status: 'error', error: message }));
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    runLoad();
    return () => {
      aliveRef.current = false;
    };
  }, [runLoad]);

  const busy = state.status === 'loading' || state.status === 'refreshing';
  const failing = state.stats.filter((stat) => stat.error);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">我的</h2>
        <button
          type="button"
          onClick={runLoad}
          disabled={busy}
          className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? '检查中' : '重新检查'}
        </button>
      </div>

      {state.error ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {state.error}
        </div>
      ) : null}

      <section className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">本地数据</h3>
        <p className="mt-1 text-xs text-slate-500">beta 读的就是正式版这几份数据，只读不写。</p>
        <ul className="mt-2 divide-y divide-slate-100">
          {state.stats.map((stat) => (
            <li key={stat.key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-slate-700">{stat.label}</span>
              <span className={stat.error ? 'text-xs text-amber-700' : 'font-semibold text-slate-900'}>
                {stat.error ? stat.error : formatValue(stat)}
              </span>
            </li>
          ))}
        </ul>
        {state.status === 'ready' && !state.stats.length ? (
          <p className="mt-2 text-xs text-slate-400">没有可检查的本地数据。</p>
        ) : null}
        {failing.length ? (
          <p className="mt-2 text-xs text-amber-700">
            {failing.length + ' 项没读到；其余项不受影响。浏览器禁用本地存储时会出现这种情况。'}
          </p>
        ) : null}
      </section>

      <section className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">搬运进度</h3>
          <span className="text-xs text-slate-400">
            {state.progress.ported + ' / ' + state.progress.total + ' 页'}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">五个 tab 主页已接上真实数据，二级页面还在分批搬。</p>
        {state.progress.pendingLabels.length ? (
          <p className="mt-2 text-xs text-slate-400">{'待搬：' + state.progress.pendingLabels.join('、')}</p>
        ) : null}
      </section>

      <section className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">关于 beta</h3>
        <ul className="mt-2 space-y-1 text-xs text-slate-500">
          <li>· beta 是小程序版的网页实现，与正式版共用同一份本地数据。</li>
          <li>· 只读：记账、改自选单、新建计划仍然回正式版做。</li>
          <li>· 随时可以退回正式版，不会丢任何数据。</li>
        </ul>
        <button
          type="button"
          onClick={disableBeta}
          className="mt-3 w-full rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
        >
          退出 beta，回正式版
        </button>
      </section>
    </div>
  );
}

export default ProfileScreen;
