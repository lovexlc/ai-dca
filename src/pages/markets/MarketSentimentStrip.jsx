import { useState } from 'react';
import { ChevronDown, RefreshCw, Sliders, X } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { BREADTH_ITEMS, DEFAULT_RULES, useMarketSentimentWeather } from './marketSentimentWeather.js';

function createDefaultSettings() {
  return { rules: { ...DEFAULT_RULES } };
}


function fearGreedLabel(value) {
  if (value <= 25) return '极度恐慌';
  if (value <= 45) return '恐慌避险';
  if (value < 55) return '中性';
  if (value < 75) return '贪婪';
  return '极度贪婪';
}

function vixLabel(value) {
  if (value < 15) return '极度平静';
  if (value < 20) return '平静';
  if (value < 25) return '正常波动';
  if (value < 30) return '警戒升温';
  return '恐慌升温';
}

export function MarketSentimentStrip() {
  const [settings, setSettings] = useState(createDefaultSettings);
  const { refreshing, error, refresh, fearGreed, vix, breadth, tempLabel, weather } = useMarketSentimentWeather(settings.rules);

  const updateRule = (key, fallback, value) => {
    const parsed = Number(value);
    setSettings((previous) => ({
      ...previous,
      rules: { ...previous.rules, [key]: Number.isFinite(parsed) ? parsed : fallback },
    }));
  };

  return (
    <>
      <section className={cx('relative isolate overflow-hidden rounded-2xl border px-3 py-2.5 shadow-sm transition-colors sm:px-4', weather.surfaceClass)} aria-label="市场情绪指标">
        <span className={cx('pointer-events-none absolute -right-2 -top-5 select-none text-7xl opacity-30', weather.decorClass)} aria-hidden="true">{weather.icon}</span>
        <span className={cx('pointer-events-none absolute -bottom-12 -left-4 h-28 w-28 rounded-full blur-3xl', weather.orbClass)} aria-hidden="true" />
        <div className="relative z-[1] flex min-w-0 flex-wrap items-center gap-2">
          <div className="shrink-0 text-xs font-bold text-[var(--market-text-muted)]">市场情绪</div>
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap pb-0.5">
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--market-border)] bg-white/60 backdrop-blur-sm dark:bg-slate-900/35 px-2.5 py-1" title="由纳指、F&G、VIX和ETF晴雨比综合计算">
              <span className={cx('text-sm', weather.glow)}>{weather.icon}</span>
              <span className="text-xs font-bold text-[var(--market-text-strong)]">{weather.name}</span>
              <span className="font-mono text-xs font-black text-[var(--market-rise)]">{tempLabel}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--market-border)] bg-white/60 backdrop-blur-sm dark:bg-slate-900/35 px-2 py-1" title="CNN 贪婪与恐慌指数">
              <span className="text-[10px] text-[var(--market-text-muted)]">F&G</span>
              <span className="font-mono text-xs font-black text-sky-500">{fearGreed}</span>
              <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400">{fearGreedLabel(fearGreed)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--market-border)] bg-white/60 backdrop-blur-sm dark:bg-slate-900/35 px-2 py-1" title="CBOE 波动率指数">
              <span className="text-[10px] text-[var(--market-text-muted)]">VIX</span>
              <span className="font-mono text-xs font-black text-emerald-500">{vix.toFixed(1)}</span>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{vixLabel(vix)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--market-border)] bg-white/60 backdrop-blur-sm dark:bg-slate-900/35 px-2 py-1">
              <span className="text-[10px] text-[var(--market-text-muted)]">晴雨比</span>
              <span className="font-mono text-xs font-bold text-[var(--market-rise)]">{breadth.up}晴</span>
              <div className="h-1.5 w-6 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div className="h-full rounded-full bg-[var(--market-rise)]" style={{ width: (breadth.up / BREADTH_ITEMS.length) * 100 + '%' }} />
              </div>
              <span className="font-mono text-xs font-bold text-[var(--market-text-muted)]">{breadth.down}雨</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--market-border)] px-2 py-1 text-xs font-medium text-[var(--market-text-muted)] transition hover:bg-[var(--market-surface-muted)]" title="展开或收起研报" onClick={() => setReportOpen((value) => !value)}>
              <span>💡</span><span>研报</span><ChevronDown size={12} className={cx('transition-transform', reportOpen && 'rotate-180')} />
            </button>
            <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-[var(--market-accent)] px-2.5 py-1 text-xs font-bold text-white transition hover:opacity-90" onClick={() => setSettingsOpen(true)}>
              <Sliders size={12} /><span>设置</span>
            </button>
            <button type="button" aria-label="刷新市场情绪" title={error || '刷新市场情绪'} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--market-border)] text-[var(--market-text-muted)] transition hover:bg-[var(--market-surface-muted)]" onClick={() => refresh(true)} disabled={refreshing}>
              <RefreshCw size={13} className={cx(refreshing && 'animate-spin')} />
            </button>
          </div>
        </div>
        {error ? <div className="mt-1 text-[10px] text-amber-600">指标暂时使用最近可用值</div> : null}
      </section>

      {reportOpen ? (
        <section className="mt-2 rounded-2xl border border-indigo-100 bg-indigo-50/80 px-3 py-3 text-xs text-slate-700 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-slate-300">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-bold text-indigo-950 dark:text-indigo-200">纳指市场情绪研报</div>
              <p className="mt-1 leading-6">
                当前体感温标为 <strong>{tempLabel}</strong>，晴雨比为 <strong>{breadth.up} 晴 / {breadth.down} 雨</strong>。F&G 为 <strong>{fearGreed}</strong>，处于“{fearGreedLabel(fearGreed)}”；VIX 为 <strong>{vix.toFixed(1)}</strong>，处于“{vixLabel(vix)}”。温标综合 QQQ 当日涨跌、市场情绪和纳指 ETF 广度计算，仅用于快速观察市场状态。
              </p>
            </div>
            <button type="button" aria-label="关闭研报" className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-white/70 hover:text-slate-700 dark:hover:bg-slate-800" onClick={() => setReportOpen(false)}>
              <X size={15} />
            </button>
          </div>
        </section>
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-slate-900/45 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="市场情绪设置">
          <div className="h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl dark:bg-slate-900 sm:h-full sm:w-[420px] sm:rounded-none">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <div><h3 className="text-sm font-bold text-slate-900 dark:text-white">市场情绪设置</h3><p className="mt-1 text-[10px] text-slate-400">调整天气状态的显示分界线</p></div>
              <button type="button" aria-label="关闭设置" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setSettingsOpen(false)}><X size={16} /></button>
            </div>
            <div className="mt-4 space-y-2">
              {[
                ['blazingSunTemp', '☀️ 艳阳高照，温标 ≥', 25],
                ['partlyCloudyTemp', '🌤️ 多云见晴，温标 ≥', 10],
                ['overcastTemp', '☁️ 阴云密布，温标 ≥', 0],
                ['rainyTemp', '🌧️ 细雨连绵，温标 ≥', -10],
                ['fgGreed', 'F&G 贪婪阈值 ≥', 75],
                ['fgStorm', 'F&G 恐慌阈值 ≤', 20],
                ['vixStorm', 'VIX 恐慌阈值 ≥', 30],
              ].map(([key, label, fallback]) => (
                <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-800/60">
                  <span className="text-slate-700 dark:text-slate-200">{label}</span>
                  <input type="number" value={settings.rules[key]} onChange={(event) => updateRule(key, fallback, event.target.value)} className="w-16 rounded border border-slate-200 bg-white px-1.5 py-1 text-right font-mono font-bold dark:border-slate-700 dark:bg-slate-900" />
                </label>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-800">
              <button type="button" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" onClick={() => setSettings(createDefaultSettings())}>恢复默认</button>
              <button type="button" className="rounded-lg bg-[var(--market-accent)] px-4 py-1.5 text-xs font-bold text-white hover:opacity-90" onClick={() => setSettingsOpen(false)}>保存设置</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
