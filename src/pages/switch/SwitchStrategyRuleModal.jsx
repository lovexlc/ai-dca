import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog.jsx';
import { Field, TextInput, cx, primaryButtonClass, secondaryButtonClass } from '../../components/experience-ui.jsx';
import { resolveCnFundName } from '../markets/marketsCatalog.js';
import { SWITCH_CHANNEL_DEFS, SWITCH_CHANNEL_KEYS } from './switchBoardModel.js';

const CODE_PATTERN = /^\d{6}$/;

function sanitizeCodeInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function sanitizePctInput(value) {
  return String(value || '').replace(/[^\d.-]/g, '').slice(0, 8);
}

export function SwitchStrategyRuleModal({ open = false, row = null, channelStatus = {}, saving = false, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [highCode, setHighCode] = useState('');
  const [lowCode, setLowCode] = useState('');
  const [lowerPct, setLowerPct] = useState('0.10');
  const [upperPct, setUpperPct] = useState('0.90');
  const [channels, setChannels] = useState(SWITCH_CHANNEL_KEYS);

  useEffect(() => {
    if (!open) return;
    setName(row?.name && row.name !== '未命名方案' ? row.name : '');
    setHighCode(sanitizeCodeInput(row?.highCode));
    setLowCode(sanitizeCodeInput(row?.lowCode));
    setLowerPct(Number.isFinite(Number(row?.lowerPct)) ? String(row.lowerPct) : '0.10');
    setUpperPct(Number.isFinite(Number(row?.upperPct)) ? String(row.upperPct) : '0.90');
    setChannels(Array.isArray(row?.channels) && row.channels.length ? row.channels : SWITCH_CHANNEL_KEYS);
  }, [open, row]);

  const validation = useMemo(() => {
    if (!CODE_PATTERN.test(highCode) || !CODE_PATTERN.test(lowCode)) return 'H / L 组都需要填写 6 位基金代码。';
    if (highCode === lowCode) return 'H 组与 L 组不能是同一只基金。';
    const lower = Number(lowerPct);
    const upper = Number(upperPct);
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) return '阈值需要填写数字。';
    if (upper <= lower) return 'H→L 切出阈值必须大于 L→H 切回阈值。';
    if (!channels.length) return '至少选择一个通知渠道。';
    return '';
  }, [highCode, lowCode, lowerPct, upperPct, channels]);

  function toggleChannel(key) {
    setChannels((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  function submit() {
    if (validation) return;
    onSubmit?.({
      ruleId: row?.id || '',
      name: String(name || '').trim() || `${highCode} 切换方案`,
      highCode,
      lowCode,
      lowerPct: Number(lowerPct),
      upperPct: Number(upperPct),
      channels
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto p-0 sm:max-w-xl" overlayClassName="bg-slate-950/45 backdrop-blur-[2px]">
        <DialogHeader className="border-b border-slate-100 px-5 py-4 pr-12 text-left">
          <DialogTitle>{row?.id ? '编辑切换方案' : '新建切换方案'}</DialogTitle>
          <DialogDescription>配置 H / L 双腿与双向阈值，命中后按所选渠道推送。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <Field label="方案名称">
            <TextInput value={name} placeholder="例如：纳指100轮动套利" maxLength={40} onChange={(event) => setName(event.target.value)} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="H 组标的代码" helper={CODE_PATTERN.test(highCode) ? resolveCnFundName(highCode) || '高溢价腿' : '高溢价腿，6 位代码'}>
              <TextInput value={highCode} inputMode="numeric" placeholder="159632" onChange={(event) => setHighCode(sanitizeCodeInput(event.target.value))} />
            </Field>
            <Field label="L 组标的代码" helper={CODE_PATTERN.test(lowCode) ? resolveCnFundName(lowCode) || '低溢价腿' : '低溢价腿，6 位代码'}>
              <TextInput value={lowCode} inputMode="numeric" placeholder="513100" onChange={(event) => setLowCode(sanitizeCodeInput(event.target.value))} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="L→H 切回阈值" rightLabel="%" helper="利差回落到该值以下时提醒切回 H 组">
              <TextInput value={lowerPct} inputMode="decimal" placeholder="0.10" onChange={(event) => setLowerPct(sanitizePctInput(event.target.value))} />
            </Field>
            <Field label="H→L 切出阈值" rightLabel="%" helper="利差扩大到该值以上时提醒切出到 L 组">
              <TextInput value={upperPct} inputMode="decimal" placeholder="0.90" onChange={(event) => setUpperPct(sanitizePctInput(event.target.value))} />
            </Field>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500">通知渠道</div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SWITCH_CHANNEL_DEFS.map((channel) => {
                const active = channels.includes(channel.key);
                const linked = Boolean(channelStatus?.[channel.key]);
                return (
                  <button
                    key={channel.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleChannel(channel.key)}
                    className={cx(
                      'min-h-16 rounded-xl border px-2 py-2 text-left transition-colors',
                      active ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    )}
                  >
                    <span className={cx('block text-xs font-black', active ? 'text-indigo-700' : 'text-slate-700')}>{channel.label}</span>
                    <span className={cx('mt-1 block text-[10px] font-bold', linked ? 'text-emerald-600' : 'text-slate-400')}>{linked ? '已连接' : '未连接'}</span>
                  </button>
                );
              })}
            </div>