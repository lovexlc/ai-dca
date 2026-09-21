import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, RefreshCw, Sliders, X } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { fetchQuotes } from './marketsApiLoader.js';

const BREADTH_ITEMS = [
  ['159509', 2.89], ['513100', 2.21], ['159501', 1.62], ['159941', 2.32],
  ['159696', 1.79], ['159659', 1.72], ['159632', 1.97], ['513300', 1.80],
  ['513870', 2.06], ['513110', 2.03], ['159660', 1.92], ['513390', 1.62],
  ['159513', 2.13], ['161130', 1.70],
];

const DEFAULT_RULES = {
  blazingSunTemp: 25,
  fgGreed: 75,
  partlyCloudyTemp: 10,
  overcastTemp: 0,
  rainyTemp: -10,
  vixStorm: 30,
  fgStorm: 20,
};

const WEATHER_STATES = {
  blazingSun: { name: '艳阳高照', icon: '☀️', glow: 'text-amber-500' },
  partlyCloudy: { name: '多云见晴', icon: '🌤️', glow: 'text-amber-500' },
  overcast: { name: '阴云密布', icon: '☁️', glow: 'text-slate-400' },
  rainy: { name: '细雨连绵', icon: '🌧️', glow: 'text-sky-500' },
  storm: { name: '恐慌雷暴', icon: '⚡', glow: 'text-indigo-500' },
};

function createDefaultSettings() {
  return { rules: { ...DEFAULT_RULES } };
}

function cleanCode(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function findQuote(quoteMap, rawCode) {
  if (!quoteMap || typeof quoteMap !== 'object') return null;
  const code = String(rawCode || '');
  const digits = cleanCode(code);
  const candidates = [code, digits, 'sh' + digits, 'sz' + digits, 'SH' + digits, 'SZ' + digits];
  for (const candidate of candidates) {
    if (quoteMap[candidate] && typeof quoteMap[candidate] === 'object') return quoteMap[candidate];
  }
  return null;
}

function quoteNumber(quote, keys) {
  for (const key of keys) {
    const value = Number(quote?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
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
  const [liveQuotes, setLiveQuotes] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(createDefaultSettings);

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError('');
    try {
      const [etfPayload, usPayload] = await Promise.all([
        fetchQuotes(BREADTH_ITEMS.map(([code]) => code)).catch(() => null),
        fetchQuotes(['^VIX', 'CNN_FNG', 'QQQ']).catch(() => null),
      ]);
      const etfQuotes = etfPayload?.quotes || etfPayload || {};
      const usQuotes = usPayload?.quotes || usPayload || {};
      const merged = {
        ...(typeof etfQuotes === 'object' ? etfQuotes : {}),
        ...(typeof usQuotes === 'object' ? usQuotes : {}),
      };
      if (Object.keys(merged).length) setLiveQuotes((previous) => ({ ...previous, ...merged }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '行情指标暂不可用');
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(), 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const ndxChange = useMemo(() => {
    const value = quoteNumber(findQuote(liveQuotes, 'QQQ'), ['changePercent', 'change', 'pctChange']);
    return value == null ? 0.63 : Number(value.toFixed(2));
  }, [liveQuotes]);

  const fearGreed = useMemo(() => {
    const value = quoteNumber(findQuote(liveQuotes, 'CNN_FNG'), ['price', 'value', 'close']);
    return value == null || value <= 0 ? 29 : Math.round(value);
  }, [liveQuotes]);

  const vix = useMemo(() => {
    const value = quoteNumber(findQuote(liveQuotes, '^VIX'), ['price', 'value', 'close']);
    return value == null || value <= 0 ? 14.81 : Number(value.toFixed(2));
  }, [liveQuotes]);

  const breadth = useMemo(() => {
    let up = 0;
    let down = 0;
    for (const [code, fallback] of BREADTH_ITEMS) {
      const change = quoteNumber(findQuote(liveQuotes, code), ['changePercent', 'change', 'pctChange']);
      if ((change == null ? fallback : change) >= 0) up += 1;
      else down += 1;
    }
    return { up, down };
  }, [liveQuotes]);

  const compositeTemp = useMemo(() => {
    const ndxDelta = ndxChange * 5.2;
    const fgDelta = (fearGreed - 50) * 0.32;
    const vixDelta = vix >= 25 ? -4 - (vix - 25) * 1.2 : vix >= 18 ? -(vix - 18) * 0.5 : (18 - vix) * 0.65;
    const breadthDelta = ((breadth.up - breadth.down) / BREADTH_ITEMS.length) * 4;
    return Math.round((16 + ndxDelta + fgDelta + vixDelta + breadthDelta) * 10) / 10;
  }, [breadth.down, breadth.up, fearGreed, ndxChange, vix]);

  const tempLabel = (compositeTemp >= 0 ? '+' : '') + compositeTemp.toFixed(1) + '°C';
  const weather = useMemo(() => {
    const rules = settings.rules;
    if (vix >= rules.vixStorm || fearGreed <= rules.fgStorm) return WEATHER_STATES.storm;
    if (compositeTemp >= rules.blazingSunTemp || fearGreed >= rules.fgGreed) return WEATHER_STATES.blazingSun;
    if (compositeTemp >= rules.partlyCloudyTemp) return WEATHER_STATES.partlyCloudy;
    if (compositeTemp >= rules.overcastTemp) return WEATHER_STATES.overcast;
    return WEATHER_STATES.rainy;
  }, [compositeTemp, fearGreed, settings.rules, vix]);

  const updateRule = (key, fallback, value) => {
    const parsed = Number(value);
    setSettings((previous) => ({
      ...previous,
      rules: { ...previous.rules, [key]: Number.isFinite(parsed) ? parsed : fallback },
    }));
  };

  return (
    <>
      <section className="rounded-2xl border border-[var(--market-border)] bg-[var(--market-surface)] px-3 py-2.5 shadow-sm sm:px-4" aria-label="市场情绪指标">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="shrink-0 text-xs font-bold text-[var(--market-text-muted)]">市场情绪</div>
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap pb-0.5">
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--market-border)] bg-[var(--market-surface-muted)] px-2.5 py-1" title="由纳指、F&G、VIX和ETF晴雨比综合计算">
              <span className={cx('text-sm', weather.glow)}>{weather.icon}</span>
              <span className="text-xs font-bold text-[var(--market-text-strong)]">{weather.name}</span>
              <span className="font-mono text-xs font-black text-[var(--market-rise)]">{tempLabel}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--market-border)] bg-[var(--market-surface-muted)] px-2 py-1" title="CNN 贪婪与恐慌指数">
              <span className="text-[10px] text-[var(--market-text-muted)]">F&G</span>
              <span className="font-mono text-xs font-black text-sky-500">{fearGreed}</span>
              <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400">{fearGreedLabel(fearGreed)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--market-border)] bg-[var(--market-surface-muted)] px-2 py-1" title="CBOE 波动率指数">
              <span className="text-[10px] text-[var(--market-text-muted)]">VIX</span>
              <span className="font-mono text-xs font-black text-emerald-500">{vix.toFixed(1)}</span>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{vixLabel(vix)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--market-border)] bg-[var(--market-surface-muted)] px-2 py-1">
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
