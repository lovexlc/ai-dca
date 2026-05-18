import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  VIX_THRESHOLDS,
  fetchVixSnapshot,
  listVixLevels,
  readVixSnapshot,
  resolveVixSignal
} from '../app/vixSignal.js';
import {
  Card,
  Pill,
  SectionHeading,
  StatCard,
  cx,
  primaryButtonClass,
  secondaryButtonClass
} from '../components/experience-ui.jsx';

// PR 2a：VIX 面板。
// 依赖 markets worker 的 `/quote/^VIX`。拉取失败时允许手动输入 VIX 数值。
// 30 日走势、Home 卡、notifySync 接入在 PR 2b。

const TONE_BG = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  yellow: 'bg-yellow-50 text-yellow-700 ring-yellow-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  orange: 'bg-orange-50 text-orange-700 ring-orange-100',
  red: 'bg-rose-50 text-rose-700 ring-rose-100',
  slate: 'bg-slate-50 text-slate-600 ring-slate-200'
};

function formatChange(snapshot) {
  if (!snapshot || !Number.isFinite(snapshot.change)) return '—';
  const sign = snapshot.change >= 0 ? '+' : '−';
  const pct = Number.isFinite(snapshot.changePct)
    ? ` (${snapshot.changePct >= 0 ? '+' : '−'}${Math.abs(snapshot.changePct).toFixed(2)}%)`
    : '';
  return `${sign}${Math.abs(snapshot.change).toFixed(2)}${pct}`;
}

export function VixDashboard({ embedded = false }) {
  const [snapshot, setSnapshot] = useState(() => readVixSnapshot());
  const [manualValue, setManualValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoTried, setAutoTried] = useState(false);

  const signal = useMemo(() => resolveVixSignal(snapshot?.value), [snapshot]);
  const levels = useMemo(() => listVixLevels(), []);

  async function handleRefresh() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const next = await fetchVixSnapshot();
      if (next) {
        setSnapshot(next);
      } else {
        setError('后端返回了一个无法解析的数据包。');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '拉取 ^VIX 失败');
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

  function handleManualApply() {
    const num = Number(manualValue);
    if (!Number.isFinite(num) || num <= 0) {
      setError('请输入一个有效的 VIX 数值');
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
                {loading ? '拉取中…' : '刷新 VIX'}
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

        <Card className="lg:col-span-2 min-w-0">
          <SectionHeading eyebrow="阈值表" title="VIX 信号分区" />
          <div className="mt-5 space-y-2">
            {levels.map((lvl) => (
              <div
                key={lvl.level}
                className={cx(
                  'rounded-xl px-3 py-2 ring-1 transition-colors',
                  TONE_BG[lvl.tone] || TONE_BG.slate,
                  signal.level === lvl.level ? 'ring-2 ring-offset-1' : ''
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Pill tone={lvl.tone === 'yellow' ? 'amber' : lvl.tone}>{lvl.label}</Pill>
                    <span className="text-xs text-slate-500">{lvl.range}</span>
                  </div>
                  {signal.level === lvl.level ? (
                    <span className="text-xs font-semibold">← 当前</span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs">{lvl.summary}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
            <Activity className="h-3.5 w-3.5" />
            阈值锁定于 D5，调整需同步改 `vixSignal.js`
          </div>
        </Card>
      </div>
    </div>
  );
}
