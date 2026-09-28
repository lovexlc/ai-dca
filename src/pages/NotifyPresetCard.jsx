import { CalendarClock, ChevronDown, Percent, Target, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useState } from 'react';
import { cx } from '../components/experience-ui.jsx';
import { useNotifyPresets } from './notify/useNotifyPresets.js';

const PRESET_META = [
  { id: 'daily', icon: Wallet, tone: 'bg-indigo-50 text-indigo-600', name: '每日收盘汇总' },
  { id: 'gain', icon: TrendingUp, tone: 'bg-rose-50 text-rose-600', name: '持仓大涨提醒' },
  { id: 'loss', icon: TrendingDown, tone: 'bg-emerald-50 text-emerald-600', name: '持仓大跌提醒' },
  { id: 'premium', icon: Percent, tone: 'bg-amber-50 text-amber-600', name: '溢价异常提醒' },
  { id: 'dca', icon: CalendarClock, tone: 'bg-cyan-50 text-cyan-600', name: '定投执行提醒' },
  { id: 'plan', icon: Target, tone: 'bg-purple-50 text-purple-600', name: '交易计划提醒' },
];

function Switch({ checked, onChange, label, disabled }) {
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

function ThresholdStepper({ value, onChange, unit = '%', disabled, label }) {
  const step = (delta) => {
    const next = Math.max(1, Number(value || 0) + delta);
    onChange?.(next);
  };
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200">
        <button type="button" disabled={disabled} onClick={() => step(-1)} className="flex h-8 w-8 items-center justify-center bg-slate-50 text-base font-bold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 cursor-pointer" aria-label="减小">−</button>
        <span className="min-w-14 text-center text-sm font-bold tabular-nums text-slate-900">{value}{unit}</span>
        <button type="button" disabled={disabled} onClick={() => step(1)} className="flex h-8 w-8 items-center justify-center bg-slate-50 text-base font-bold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 cursor-pointer" aria-label="增大">＋</button>
      </span>
    </div>
  );
}

function presetDescription(id, presets, counts) {
  const p = presets?.[id] || {};
  switch (id) {
    case 'daily':
      return (<>交易日 <b className="font-semibold text-indigo-600">15:30 / 20:30 / 21:30</b> 推送持仓总览</>);
    case 'gain':
      return (<>任一持仓单日涨幅超过 <b className="font-semibold text-indigo-600">{p.threshold}%</b></>);
    case 'loss':
      return (<>任一持仓单日跌幅超过 <b className="font-semibold text-indigo-600">{p.threshold}%</b></>);
    case 'premium':
      return (<>QDII / ETF 溢价率超过 <b className="font-semibold text-indigo-600">{p.threshold}%</b></>);
    case 'dca':
      return (<>定投扣款日提醒{counts.dca ? <>（<b className="font-semibold text-indigo-600">{counts.dca}</b> 个计划）</> : '（暂无定投计划）'}</>);
    case 'plan':
      return (<>价格触及计划买入 / 卖出价时提醒{counts.plan ? <>（<b className="font-semibold text-indigo-600">{counts.plan}</b> 个计划）</> : '（暂无交易计划）'}</>);
    default:
      return null;
  }
}

function presetDetail(id, presets, counts, onChangeThreshold, disabled) {
  const p = presets?.[id] || {};
  switch (id) {
    case 'daily':
      return <p className="text-xs text-slate-400">覆盖全部持仓标的 · 由服务端定时触发</p>;
    case 'gain':
    case 'loss':
      return (
        <div className="space-y-1.5">
          <ThresholdStepper value={p.threshold} disabled={disabled} onChange={(v) => onChangeThreshold?.(id, v)} label={id === 'gain' ? '涨幅阈值' : '跌幅阈值'} />
          <p className="text-xs text-slate-400">适用于全部 {counts.holdings} 只持仓 · 每个标的每天最多提醒 1 次 · 手工逐条配置的规则不受影响</p>
        </div>
      );
    case 'premium':
      return (
        <div className="space-y-1.5">
          <ThresholdStepper value={p.threshold} disabled={disabled} onChange={(v) => onChangeThreshold?.(id, v)} label="溢价阈值" />
          <p className="text-xs text-slate-400">仅场内标的 · 适用于全部 {counts.holdings} 只持仓中有溢价数据的标的</p>
        </div>
      );
    case 'dca':
      return <p className="text-xs text-slate-400">一键开关全部定投计划的到期提醒 · 当前 {counts.dca} 个计划</p>;
    case 'plan':
      return <p className="text-xs text-slate-400">在交易计划中设置买入 / 卖出价后自动生效 · 当前 {counts.plan} 个计划</p>;
    default:
      return null;
  }
}

export function NotifyPresetCard({
  presets,
  counts = { holdings: 0, dca: 0, plan: 0 },
  hasChannel = true,
  disabled = false,
  onTogglePreset,
  onChangeThreshold,
}) {
  const [openId, setOpenId] = useState(null);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="px-5 py-4">
        <h2 className="text-lg font-bold text-slate-950">提醒预设</h2>
      </div>

      {!hasChannel ? (
        <div className="mx-5 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          还没配置推送渠道。先在「消息推送配置」里配好 Bark / 邮件 / Server酱³，预设才能生效。
        </div>
      ) : null}

      <div className="border-t border-slate-100">
        {PRESET_META.map(({ id, icon: Icon, tone, name }) => {
          const enabled = Boolean(presets?.[id]?.enabled);
          const isOpen = openId === id;
          return (
            <div key={id} className="border-b border-slate-100 last:border-b-0">
              <div
                className="flex cursor-pointer items-center gap-3 px-5 py-3.5 hover:bg-slate-50/60"
                onClick={() => setOpenId(isOpen ? null : id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenId(isOpen ? null : id); } }}
              >
                <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', tone)}>
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900">{name}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{presetDescription(id, presets, counts)}</div>
                </div>
                <ChevronDown className={cx('h-4 w-4 shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
                <Switch checked={enabled} disabled={disabled} onChange={(next) => onTogglePreset?.(id, next)} label={`${name}开关`} />
              </div>
              {isOpen ? (
                <div className="px-5 pb-4 pl-[68px]">
                  {presetDetail(id, presets, counts, onChangeThreshold, disabled || !enabled)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default NotifyPresetCard;

// 预设区整体：把 useNotifyPresets 的接线收拢在这里，页面层只渲染一行。
export function NotifyPresetSection({
  holdingsRule,
  holdingAlerts,
  marketAlerts,
  handleApplyPresetAlerts,
  handleToggleHoldingsRule,
  tradePlans,
  setTradePlans,
  dcaPlans,
  setDcaPlans,
  notifyMeta,
  setNotifyError,
  isLoggedIn,
  barkConfigured,
  serverChan3Configured,
  emailConfigured,
  pcConfigured,
}) {
  const {
    notifyPresets,
    presetHoldingsCount,
    isApplyingPreset,
    handleTogglePreset,
    handlePresetThreshold,
  } = useNotifyPresets({
    holdingsRule,
    holdingAlerts,
    marketAlerts,
    handleApplyPresetAlerts,
    handleToggleHoldingsRule,
    setTradePlans,
    setDcaPlans,
    notifyMeta,
    setNotifyError,
    isLoggedIn,
  });
  return (
    <NotifyPresetCard
      presets={notifyPresets}
      counts={{ holdings: presetHoldingsCount, dca: dcaPlans.length, plan: tradePlans.length }}
      hasChannel={Boolean(barkConfigured || serverChan3Configured || emailConfigured || pcConfigured)}
      disabled={isApplyingPreset}
      onTogglePreset={handleTogglePreset}
      onChangeThreshold={handlePresetThreshold}
    />
  );
}
