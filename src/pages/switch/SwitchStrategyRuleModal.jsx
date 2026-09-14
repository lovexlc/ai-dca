import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog.jsx';
import { Field, TextInput, cx, primaryButtonClass, secondaryButtonClass } from '../../components/experience-ui.jsx';
import { resolveCnFundName } from '../markets/marketsCatalog.js';

const CODE_PATTERN = /^\d{6}$/;

function sanitizeCodeInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function sanitizePctInput(value) {
  return String(value || '').replace(/[^\d.-]/g, '').slice(0, 8);
}

export function SwitchStrategyRuleModal({
  open = false,
  row = null,
  initialRule = null,
  saving = false,
  onClose,
  onSave,
  onSubmit
}) {
  const activeRow = row || initialRule;
  const isEditing = Boolean(activeRow?.id);

  const [name, setName] = useState('');
  const [highCode, setHighCode] = useState('');
  const [lowCode, setLowCode] = useState('');
  const [lowerPct, setLowerPct] = useState('0.10');
  const [upperPct, setUpperPct] = useState('0.90');
  const [holdingSide, setHoldingSide] = useState('H'); // 'H' | 'L' | 'BOTH'

  // 数据精准回填
  useEffect(() => {
    if (!open) return;
    const r = row || initialRule;
    if (r && r.id) {
      setName(r.name && r.name !== '未命名方案' ? r.name : '');
      setHighCode(sanitizeCodeInput(r.highCode || r.high?.code || '159632'));
      setLowCode(sanitizeCodeInput(r.lowCode || r.low?.code || '513100'));
      setLowerPct(Number.isFinite(Number(r.lowerPct ?? r.gauge?.lowerPct)) ? String(r.lowerPct ?? r.gauge.lowerPct) : '0.10');
      setUpperPct(Number.isFinite(Number(r.upperPct ?? r.gauge?.upperPct)) ? String(r.upperPct ?? r.gauge.upperPct) : '0.90');
      setHoldingSide(r.holdingSide || (r.benchmarkClass === 'L' ? 'L' : 'H'));
    } else {
      setName('');
      setHighCode('159632');
      setLowCode('513100');
      setLowerPct('0.10');
      setUpperPct('0.90');
      setHoldingSide('H');
    }
  }, [open, row, initialRule]);

  const validation = useMemo(() => {
    if (!CODE_PATTERN.test(highCode) || !CODE_PATTERN.test(lowCode)) return 'H / L 组都需要填写 6 位基金代码。';
    if (highCode === lowCode) return 'H 组与 L 组不能是同一只基金。';
    const lower = Number(lowerPct);
    const upper = Number(upperPct);
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) return '阈值需要填写数字。';
    if (upper <= lower) return 'H→L 切出阈值必须大于 L→H 切回阈值。';
    return '';
  }, [highCode, lowCode, lowerPct, upperPct]);

  function submit() {
    if (validation) return;
    const payload = {
      ruleId: activeRow?.id || '',
      name: String(name || '').trim() || `${highCode} 切换方案`,
      highCode,
      lowCode,
      lowerPct: Number(lowerPct),
      upperPct: Number(upperPct),
      holdingSide
    };
    (onSave || onSubmit)?.(payload);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto p-0 sm:max-w-xl" overlayClassName="bg-slate-950/45 backdrop-blur-[2px]">
        <DialogHeader className="border-b border-slate-100 px-5 py-4 pr-12 text-left">
          <DialogTitle>{isEditing ? '编辑切换方案' : '新建切换方案'}</DialogTitle>
          <DialogDescription>
            {isEditing ? '修改 H / L 双腿与持仓判断条件，保存后即刻生效。' : '配置 H / L 双腿与持仓判断条件，命中后自动推送提醒。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <Field label="方案名称">
            <TextInput
              value={name}
              placeholder="例如：纳指100轮动套利"
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          {/* 持仓按钮：根据持有 H 或 L 单独判断 */}
          <Field label="当前持仓标的" helper="选择您当前实际持有的标的，系统将据此精准执行单向触发提醒">
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setHoldingSide('H')}
                className={cx(
                  'flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer',
                  holdingSide === 'H'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                )}
              >
                <div className="flex items-center space-x-1">
                  <span className="w-3.5 h-3.5 rounded bg-rose-100 text-rose-700 font-bold flex items-center justify-center text-[9px]">H</span>
                  <span className="font-bold">持有 H 标的</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono mt-1">仅监控切出到 L</span>
              </button>

              <button
                type="button"
                onClick={() => setHoldingSide('L')}
                className={cx(
                  'flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer',
                  holdingSide === 'L'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                )}
              >
                <div className="flex items-center space-x-1">
                  <span className="w-3.5 h-3.5 rounded bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-[9px]">L</span>
                  <span className="font-bold">持有 L 标的</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono mt-1">仅监控切回 H</span>
              </button>

              <button
                type="button"
                onClick={() => setHoldingSide('BOTH')}
                className={cx(
                  'flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer',
                  holdingSide === 'BOTH'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                )}
              >
                <span className="font-bold">双向监控</span>
                <span className="text-[10px] text-slate-400 mt-1">未建仓 / 两者均看</span>
              </button>
            </div>
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

          {validation ? (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-800">{validation}</p>
          ) : null}
        </div>

        <DialogFooter className="border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>取消</button>
          <button type="button" onClick={submit} disabled={Boolean(validation) || saving} className={primaryButtonClass}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存方案
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SwitchStrategyRuleModal;
