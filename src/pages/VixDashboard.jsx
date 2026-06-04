import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  VIX_THRESHOLDS,
  fetchVixSnapshot,
  listVixLevels,
  readVixSnapshot,
  resolveVixSignal
} from '../app/vixSignal.js';
import { loadBacktestCandles } from '../app/dcaCalculator.js';
import { LineChart, Line, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { showToast } from '../app/toast.js';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';
import {
  Card,
  SectionHeading,
  StatCard,
  cx,
  primaryButtonClass,
  secondaryButtonClass
} from '../components/experience-ui.jsx';

// PR 2a：VIX 面板。
// 依赖 markets worker 的 `/quote/^VIX`。拉取失败时允许手动输入 VIX 数值。
// PR 2b：30 日走势图、notifySync vix digest。Home 卡、worker 跨阈推送待补。

const VIX_HISTORY_TIMEFRAME = '1mo';
const VIX_CHART_MARGIN = Object.freeze({ top: 8, right: 16, bottom: 8, left: 0 });
const VIX_CHART_TICK = Object.freeze({ fontSize: 11, fill: '#94a3b8' });
const VIX_CHART_TOOLTIP_STYLE = Object.freeze({ borderRadius: 12, fontSize: 12, border: '1px solid #e2e8f0' });

const TONE_BG = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  yellow: 'bg-yellow-50 text-yellow-700 ring-yellow-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  orange: 'bg-orange-50 text-orange-700 ring-orange-100',
  red: 'bg-rose-50 text-rose-700 ring-rose-100',
  slate: 'bg-slate-50 text-slate-600 ring-slate-200'
};

const VIX_LEVEL_ACCENT = {
  emerald: 'from-emerald-400 to-emerald-500',
  yellow: 'from-yellow-300 to-yellow-500',
  amber: 'from-amber-400 to-orange-500',
  orange: 'from-orange-500 to-rose-500',
  red: 'from-rose-600 to-red-700',
  slate: 'from-slate-300 to-slate-400'
};

const VIX_REFERENCE_COLORS = {
  watch: '#facc15',
  buyIndex: '#fb923c',
  buyAll: '#f43f5e',
  heavyBuy: '#991b1b'
};

function formatChange(snapshot) {
  if (!snapshot || !Number.isFinite(snapshot.change)) return '—';
  const sign = snapshot.change >= 0 ? '+' : '−';
  const pct = Number.isFinite(snapshot.changePct)
    ? ` (${snapshot.changePct >= 0 ? '+' : '−'}${Math.abs(snapshot.changePct).toFixed(2)}%)`
    : '';
  return `${sign}${Math.abs(snapshot.change).toFixed(2)}${pct}`;
}

function getVixPosition(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(100, (Number(value) / 60) * 100));
}

export function VixDashboard({ embedded = false }) {
  const [snapshot, setSnapshot] = useState(() => readVixSnapshot());
  const [manualValue, setManualValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoTried, setAutoTried] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const signal = useMemo(() => resolveVixSignal(snapshot?.value), [snapshot]);
  const levels = useMemo(() => listVixLevels(), []);
  const vixPosition = getVixPosition(snapshot?.value);

  const vixMeta = () => ({
    embedded,
    hasSnapshot: Boolean(snapshot),
    signalLevel: signal.level || '',
    historyCount: history.length,
    hasHistoryError: Boolean(historyError)
  });

  async function handleRefresh() {
    if (loading) return;
    const previousValue = Number(snapshot?.value);
    const startedAt = Date.now();
    setLoading(true);
    setError('');
    trackFeatureEvent('vix', 'refresh_start', vixMeta());
    try {
      const next = await fetchVixSnapshot();
      if (next) {
        setSnapshot(next);
        const unchanged = Number.isFinite(previousValue) && Math.abs(previousValue - Number(next.value)) < 0.005;
        showToast({
          title: unchanged ? 'VIX 暂无变化' : 'VIX 已更新',
          description: `${Number(next.value).toFixed(2)} · ${new Date(next.asOf || Date.now()).toLocaleString('zh-CN', { hour12: false })}`,
          tone: unchanged ? 'slate' : 'emerald'
        });
        trackActionResult('vix', 'refresh', 'success', {
          ...vixMeta(),
          unchanged,
          durationMs: Date.now() - startedAt
        });
      } else {
        setError('后端返回了一个无法解析的数据包。');
        trackActionResult('vix', 'refresh', 'empty', {
          ...vixMeta(),
          durationMs: Date.now() - startedAt
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '拉取 ^VIX 失败');
      trackActionResult('vix', 'refresh', 'error', {
        ...vixMeta(),
        durationMs: Date.now() - startedAt,
        errorMessage: err?.message || ''
      });
    } finally {
      setLoading(false);
    }
  }

  // 首次进页如果本地还没有缓存，试一次自动拉取。
  useEffect(() => {
    if (autoTried || snapshot) return;
    setAutoTried(true);
    handleRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTried, snapshot]);

  // PR 2b：入页拉 ^VIX 30 日日 K。
  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    setHistoryLoading(true);
    setHistoryError('');
    trackFeatureEvent('vix', 'history_load_start', { embedded });
    loadBacktestCandles('^VIX', VIX_HISTORY_TIMEFRAME)
      .then((candles) => {
        if (cancelled) return;
        const rows = (Array.isArray(candles) ? candles : [])
          .slice(-30)
          .map((c) => ({
            date: c.date instanceof Date ? c.date.toISOString().slice(0, 10) : String(c.date).slice(0, 10),
            close: Number.isFinite(c.close) ? Number(c.close) : null
          }))
          .filter((row) => row.close != null);
        setHistory(rows);
        trackActionResult('vix', 'history_load', rows.length ? 'success' : 'empty', {
          embedded,
          candleCount: rows.length,
          durationMs: Date.now() - startedAt
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setHistoryError(err instanceof Error ? err.message : '拉取 ^VIX 历史失败');
        trackActionResult('vix', 'history_load', 'error', {
          embedded,
          durationMs: Date.now() - startedAt,
          errorMessage: err?.message || ''
        });
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function handleManualApply() {
    const num = Number(manualValue);
    if (!Number.isFinite(num) || num <= 0) {
      setError('请输入一个有效的 VIX 数值');
      trackActionResult('vix', 'manual_apply', 'validation_error', { ...vixMeta(), reason: 'invalid_number' });
      return;
    }
    setError('');
    const next = {
      value: num,
      previousClose: snapshot?.value ?? null,
      change: snapshot ? num - (snapshot.value || 0) : 0,
      changePct: snapshot && snapshot.value ? ((num - snapshot.value) / snapshot.value) * 100 : 0,
      asOf: new Date().toISOString(),
      manual: true
    };
    setSnapshot(next);
    setManualValue('');
    showToast({ title: '已使用手动 VIX', description: `当前 VIX ${num.toFixed(2)}`, tone: 'emerald' });
    trackActionResult('vix', 'manual_apply', 'success', {
      ...vixMeta(),
      hadPrevious: Number.isFinite(Number(snapshot?.value))
    });
  }

  function renderVixThermometer() {
    return (
      <Card className="min-w-0 border-indigo-100 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-200">VIX 温度计</div>
            <div className="mt-2 text-4xl font-black tabular-nums tracking-tight">{valueLabel}</div>
            <div className="mt-2 text-sm text-slate-300">{signal.levelLabel} · {signal.headline}</div>
          </div>
          <div className="min-w-0 flex-1 lg:max-w-3xl">
            <div className="relative pt-7">
              <div className="absolute top-0 -translate-x-1/2 text-indigo-100" style={{ left: `${vixPosition}%` }}>
                <div className="mx-auto h-0 w-0 border-x-[7px] border-t-[10px] border-x-transparent border-t-white" />
                <div className="mt-1 whitespace-nowrap rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold backdrop-blur">当前位置</div>
              </div>
              <div className="h-4 overflow-hidden rounded-full bg-gradient-to-r from-emerald-400 via-yellow-300 via-orange-400 to-rose-700 shadow-inner" />
              <div className="mt-2 flex justify-between text-xs font-semibold text-slate-300">
                <span>0</span>
                <span>25</span>
                <span>30</span>
                <span>40</span>
                <span>50</span>
                <span>60+</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  function renderLevelCards() {
    return (
      <Card className="min-w-0">
        <SectionHeading eyebrow="阈值区间" title="VIX 信号分区" description="横向查看当前 VIX 落在哪个恐慌区间，当前区间会高亮。" />
        <div className="mt-5 grid gap-3 md:grid-cols-5">
          {levels.map((lvl) => {
            const isActive = signal.level === lvl.level;
            return (
              <div
                key={lvl.level}
                className={cx(
                  'relative overflow-hidden rounded-2xl border p-4 ring-1 transition-all duration-200',
                  TONE_BG[lvl.tone] || TONE_BG.slate,
                  isActive ? 'scale-[1.02] border-indigo-300 ring-2 ring-indigo-300 shadow-lg shadow-indigo-100' : 'border-transparent'
                )}
              >
                <div className={cx('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', VIX_LEVEL_ACCENT[lvl.tone] || VIX_LEVEL_ACCENT.slate)} />
                <div className="text-sm font-black">{lvl.label}</div>
                <div className="mt-1 text-xs font-semibold opacity-80">{lvl.range}</div>
                <div className="mt-3 text-xs leading-5">{lvl.summary}</div>
                {isActive ? <div className="mt-3 text-xs font-black">当前位置</div> : null}
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  const valueLabel = snapshot?.value != null ? snapshot.value.toFixed(2) : '—';
  const asOfLabel = snapshot?.asOf ? new Date(snapshot.asOf).toLocaleString('zh-CN', { hour12: false }) : '—';

  return (
    <div className={cx('space-y-6', embedded ? '' : 'mx-auto max-w-6xl px-6 pt-8')}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          accent={signal.tone === 'red' ? 'rose' : signal.tone === 'orange' ? 'amber' : signal.tone === 'emerald' ? 'emerald' : 'indigo'}
          eyebrow="当前 VIX"
          value={valueLabel}
          note={asOfLabel}
        />
        <StatCard eyebrow="日变动" value={formatChange(snapshot)} note={snapshot?.previousClose != null ? `昨收盘 ${snapshot.previousClose.toFixed(2)}` : '暂无昨收盘参考'} />
        <StatCard eyebrow="信号等级" value={signal.levelLabel} note={signal.headline} />
        <StatCard
          accent={signal.tone === 'red' || signal.tone === 'orange' ? 'amber' : 'slate'}
          eyebrow="跳阈提醒"
          value={`${VIX_THRESHOLDS.watch}/${VIX_THRESHOLDS.buyIndex}/${VIX_THRESHOLDS.buyAll}/${VIX_THRESHOLDS.heavyBuy}`}
          note="watch / buyIndex / buyAll / heavyBuy"
        />
      </div>

      {renderVixThermometer()}

      {error ? (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <div className="flex-1">
            <div className="font-semibold">拉取 VIX 失败</div>
            <div className="mt-0.5 text-amber-700">{error}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                className="h-9 w-32 rounded-lg border border-amber-300 bg-white px-3 text-sm outline-none focus:border-amber-500"
                placeholder="手动输入 VIX"
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
              />
              <button type="button" className={cx(secondaryButtonClass, 'h-9 px-3')} onClick={handleManualApply}>
                使用该值
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3 min-w-0">
          <SectionHeading
            eyebrow="操作建议"
            title={signal.headline}
            description="根据锁定阈值生成，仅供参考。后续 PR 4 会与仓位联动。"
            action={(
              <button type="button" className={cx(primaryButtonClass, 'inline-flex items-center gap-1.5')} onClick={handleRefresh} disabled={loading}>
                <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} />
                {loading ? '刷新中...' : '刷新 VIX'}
              </button>
            )}
          />
          <div className="mt-5 space-y-2">
            {signal.actions.map((action, index) => (
              <div key={index} className={cx('rounded-xl px-4 py-3 text-sm ring-1', TONE_BG[signal.tone] || TONE_BG.slate)}>
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex-1">{action}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="lg:col-span-2">
          {renderLevelCards()}
        </div>
      </div>

      <Card className="min-w-0">
        <SectionHeading
          eyebrow="走势"
          title="^VIX 30 日走势"
          description="最近 30 个交易日的收盘。阈值线颜色与上方分区保持一致。"
        />
        <div className="mt-4 h-64 w-full">
          {historyLoading && history.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">拉取中…</div>
          ) : historyError && history.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-rose-600">{historyError}</div>
          ) : history.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">暂无历史数据</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={VIX_CHART_MARGIN}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={VIX_CHART_TICK} minTickGap={20} />
                <YAxis tick={VIX_CHART_TICK} domain={['auto', 'auto']} />
                <Tooltip contentStyle={VIX_CHART_TOOLTIP_STYLE} />
                <ReferenceLine y={VIX_THRESHOLDS.watch} stroke={VIX_REFERENCE_COLORS.watch} strokeDasharray="4 4" label="25" />
                <ReferenceLine y={VIX_THRESHOLDS.buyIndex} stroke={VIX_REFERENCE_COLORS.buyIndex} strokeDasharray="4 4" label="30" />
                <ReferenceLine y={VIX_THRESHOLDS.buyAll} stroke={VIX_REFERENCE_COLORS.buyAll} strokeDasharray="4 4" label="40" />
                <ReferenceLine y={VIX_THRESHOLDS.heavyBuy} stroke={VIX_REFERENCE_COLORS.heavyBuy} strokeDasharray="4 4" label="50" />
                <Line type="monotone" dataKey="close" stroke="#6366f1" strokeWidth={2} dot={false} name="VIX 收盘" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
          <Activity className="h-3.5 w-3.5" />
          阈值锁定于 D5，调整需同步改 `vixSignal.js`
        </div>
      </Card>
    </div>
  );
}
