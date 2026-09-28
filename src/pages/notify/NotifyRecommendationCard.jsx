// NotifyRecommendationCard.jsx
//
// 通知 Tab 顶部的「为你推荐」区块：基于持仓 + 实时行情自动生成推荐配置。
// 每条推荐一句话说明（含实时数据）+ 开关一键开启 + 阈值可调 + 可关闭。
// 开启/阈值调整复用预设的现有链路（onTogglePreset/onChangeThreshold）。

import { CalendarClock, Percent, Sparkles, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { trackFeatureEvent } from '../../app/analytics.js';
import { cx } from '../../components/experience-ui.jsx';
import { fetchQuotes } from '../../app/marketsApi.js';
import {
  buildNotifyRecommendations,
  dismissRecommendation,
  readHoldingPositions,
  REC_QUOTE_SYMBOL_LIMIT,
} from './notifyRecommendations.js';

const REC_META = {
  premium: { icon: Percent, tone: 'bg-amber-50 text-amber-600' },
  gain: { icon: TrendingUp, tone: 'bg-rose-50 text-rose-600' },
  loss: { icon: TrendingDown, tone: 'bg-emerald-50 text-emerald-600' },
  daily: { icon: Wallet, tone: 'bg-indigo-50 text-indigo-600' },
  dca: { icon: CalendarClock, tone: 'bg-cyan-50 text-cyan-600' },
};

function RecSwitch({ checked, onChange, label, disabled }) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center" onClick={(event) => event.stopPropagation()}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        className="peer sr-only"
        aria-label={label}
      />
      <span className="h-6 w-11 rounded-full bg-slate-200 transition-colors after:absolute after:left-[3px] after:top-[3px] after:h-[18px] after:w-[18px] after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:content-[''] peer-checked:bg-indigo-600 peer-checked:after:translate-x-5 peer-disabled:opacity-50" />
    </label>
  );
}

function RecThresholdStepper({ value, onChange, disabled }) {
  const step = (delta) => {
    onChange?.(Math.max(1, Number(value || 0) + delta));
  };
  return (
    <span className="mx-0.5 inline-flex items-center overflow-hidden rounded-md border border-slate-200 align-middle">
      <button type="button" disabled={disabled} onClick={() => step(-1)} className="flex h-6 w-6 items-center justify-center bg-slate-50 text-sm font-bold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 cursor-pointer" aria-label="减小">−</button>
      <span className="min-w-10 text-center text-xs font-bold tabular-nums text-slate-900">{value}%</span>
      <button type="button" disabled={disabled} onClick={() => step(1)} className="flex h-6 w-6 items-center justify-center bg-slate-50 text-sm font-bold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 cursor-pointer" aria-label="增大">＋</button>
    </span>
  );
}

function RecDescription({ rec, disabled, onThreshold }) {
  const stepper = rec.threshold != null ? (
    <RecThresholdStepper value={rec.threshold} disabled={disabled} onChange={(value) => onThreshold?.(rec.presetId, value)} />
  ) : null;
  switch (rec.presetId) {
    case 'premium':
      return (<>当前溢价 <b className="font-semibold text-indigo-600">{rec.data.premium}%</b>，超过 {stepper} 时提醒你</>);
    case 'gain':
      return (<>你持有 <b className="font-semibold text-indigo-600">{rec.data.count}</b> 只基金，单日涨幅超过 {stepper} 时提醒</>);
    case 'loss':
      return (<>单日跌幅超过 {stepper} 时提醒</>);
    case 'daily':
      return (<>交易日 <b className="font-semibold text-indigo-600">15:30 / 20:30 / 21:30</b> 推送持仓总览</>);
    case 'dca':
      return (<><b className="font-semibold text-indigo-600">{rec.data.count}</b> 个定投计划，扣款日提醒你</>);
    default:
      return null;
  }
}

function RecommendationRow({ rec, disabled, onEnable, onDismiss, onThreshold }) {
  const meta = REC_META[rec.presetId] || {};
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5 last:border-b-0">
      {Icon ? (
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', meta.tone)}>
          <Icon className="h-4 w-4" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-slate-900">{rec.title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-slate-500">
          <RecDescription rec={rec} disabled={disabled} onThreshold={onThreshold} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => onDismiss?.(rec)}
        aria-label="不再推荐"
        title="不再推荐"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500 cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <RecSwitch checked={false} disabled={disabled} onChange={() => onEnable?.(rec)} label={`开启${rec.title}`} />
    </div>
  );
}

export function NotifyRecommendationSection({
  presets,
  dcaCount = 0,
  disabled = false,
  notifyMeta,
  onTogglePreset,
  onChangeThreshold,
}) {
  const [positions] = useState(() => readHoldingPositions());
  const [quotesBySymbol, setQuotesBySymbol] = useState(null);
  const [dismissTick, setDismissTick] = useState(0);
  const viewedRef = useRef(false);

  const premiumEnabled = Boolean(presets?.premium?.enabled);

  // 溢价预设已开时不需要拉行情；失败时降级为空行情（只生成非行情推荐）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (premiumEnabled) {
        if (!cancelled) setQuotesBySymbol({});
        return;
      }
      const symbols = positions
        .map((position) => position.symbol)
        .filter((symbol) => /^\d{6}$/.test(symbol))
        .slice(0, REC_QUOTE_SYMBOL_LIMIT);
      if (!symbols.length) {
        if (!cancelled) setQuotesBySymbol({});
        return;
      }
      try {
        const result = await fetchQuotes(symbols);
        const quotes = result?.quotes && typeof result.quotes === 'object' ? result.quotes : {};
        if (!cancelled) setQuotesBySymbol(quotes);
      } catch {
        if (!cancelled) setQuotesBySymbol({});
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premiumEnabled]);

  const recs = useMemo(() => {
    if (quotesBySymbol === null) return null;
    return buildNotifyRecommendations({ positions, quotesBySymbol, presets, dcaCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotesBySymbol, presets, dcaCount, dismissTick]);

  useEffect(() => {
    if (!viewedRef.current && recs && recs.length > 0) {
      viewedRef.current = true;
      trackFeatureEvent('notify', 'recommendation_view', {
        ...(typeof notifyMeta === 'function' ? notifyMeta() : {}),
        count: recs.length,
        ids: recs.map((rec) => rec.id).join(','),
      });
    }
  }, [recs, notifyMeta]);

  if (!recs || recs.length === 0) return null;

  const handleEnable = (rec) => {
    trackFeatureEvent('notify', 'recommendation_enable', {
      ...(typeof notifyMeta === 'function' ? notifyMeta() : {}),
      recId: rec.id,
      presetId: rec.presetId,
    });
    onTogglePreset?.(rec.presetId, true);
  };

  const handleDismiss = (rec) => {
    dismissRecommendation(rec.id);
    setDismissTick((tick) => tick + 1);
    trackFeatureEvent('notify', 'recommendation_dismiss', {
      ...(typeof notifyMeta === 'function' ? notifyMeta() : {}),
      recId: rec.id,
    });
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 px-5 py-4">
        <Sparkles className="h-4 w-4 text-indigo-600" />
        <h2 className="text-lg font-bold text-slate-950">为你推荐</h2>
        <span className="ml-auto text-xs text-slate-400">基于持仓 · 实时行情</span>
      </div>
      <div className="border-t border-slate-100">
        {recs.map((rec) => (
          <RecommendationRow
            key={rec.id}
            rec={rec}
            disabled={disabled}
            onEnable={handleEnable}
            onDismiss={handleDismiss}
            onThreshold={onChangeThreshold}
          />
        ))}
      </div>
    </section>
  );
}

export default NotifyRecommendationSection;
