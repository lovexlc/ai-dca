import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
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
  onAutoFill,
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
  const [autoPanelOpen, setAutoPanelOpen] = useState(false);
  const [autoCompleted, setAutoCompleted] = useState(false);
  const [autoHoldingCode, setAutoHoldingCode] = useState('');
  const [autoFeeWanRate, setAutoFeeWanRate] = useState('1');
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoError, setAutoError] = useState('');
  const [autoMessage, setAutoMessage] = useState('');
  const [autoMeta, setAutoMeta] = useState(null);
  const saveButtonRef = useRef(null);

  useEffect(() => {
    if (!autoCompleted || typeof window === 'undefined') return undefined;
    const frame = window.requestAnimationFrame(() => {
      saveButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoCompleted]);

  // 数据精准回填
  useEffect(() => {
    if (!open) return;
    const r = row || initialRule;
    const sourceRule = r?.rule || r;
    setAutoPanelOpen(false);
    setAutoCompleted(false);
    setAutoHoldingCode('');
    setAutoFeeWanRate('1');
    setAutoFilling(false);
    setAutoError('');
    setAutoMessage('');
    setAutoMeta(
      sourceRule?.holdingFundCode && Number.isFinite(Number(sourceRule?.feeConfig?.estimatedTotalFee))
        ? {
          holdingFundCode: sourceRule.holdingFundCode,
          holdingFundName: sourceRule.holdingFundName || '',
          holdingQuantity: sourceRule.holdingQuantity,
          holdingNotional: sourceRule.holdingNotional,
          feeConfig: sourceRule.feeConfig,
          backtestTimeframe: sourceRule.backtestTimeframe || '5m'
        }
        : null
    );
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

  async function runAutoFill() {
    const normalizedCode = sanitizeCodeInput(autoHoldingCode);
    const feeWanRate = Number(autoFeeWanRate);
    if (!CODE_PATTERN.test(normalizedCode)) {
      setAutoError('请先填写 6 位当前持仓代码。');
      return;
    }
    if (!Number.isFinite(feeWanRate) || feeWanRate < 0) {
      setAutoError('请填写有效的万分之交易费率。');
      return;
    }
    setAutoFilling(true);
    setAutoError('');
    setAutoMessage('');
    try {
      const result = await onAutoFill?.({
        holdingCode: normalizedCode,
        feeWanRate
      });
      if (!result?.highCode || !result?.lowCode) throw new Error('自动填充结果不完整，请稍后重试。');
      setName((current) => String(current || '').trim() ? current : result.name || `${normalizedCode} 切换方案`);
      setHighCode(sanitizeCodeInput(result.highCode));
      setLowCode(sanitizeCodeInput(result.lowCode));
      setLowerPct(String(result.lowerPct));
      setUpperPct(String(result.upperPct));
      setHoldingSide(result.holdingSide === 'L' ? 'L' : 'H');
      setAutoMeta(result);
      setAutoMessage(result.message || '自动分析完成，其余字段已填写。');
      setAutoPanelOpen(false);
      setAutoCompleted(true);
    } catch (error) {
      setAutoError(error?.message || '自动填充失败，请稍后重试。');
    } finally {
      setAutoFilling(false);
    }
  }

  function submit() {
    if (validation) return;
    const generatedHoldingCode = holdingSide === 'L' ? lowCode : highCode;
    const generatedCandidateCode = holdingSide === 'L' ? highCode : lowCode;
    const payload = {
      ruleId: activeRow?.id || '',
      name: String(name || '').trim() || `${highCode} 切换方案`,
      highCode,
      lowCode,
      lowerPct: Number(lowerPct),
      upperPct: Number(upperPct),
      holdingSide,
      ...(autoMeta ? {
        autoGenerated: true,
        holdingFundCode: generatedHoldingCode,
        holdingFundName: generatedHoldingCode === autoMeta.holdingFundCode ? autoMeta.holdingFundName : '',
        holdingQuantity: generatedHoldingCode === autoMeta.holdingFundCode ? autoMeta.holdingQuantity : null,
        holdingNotional: generatedHoldingCode === autoMeta.holdingFundCode ? autoMeta.holdingNotional : null,
        candidateFundCodes: [generatedCandidateCode],
        feeConfig: autoMeta.feeConfig,
        backtestTimeframe: autoMeta.backtestTimeframe || '5m'
      } : {})
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
          {!isEditing && onAutoFill && !autoCompleted ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-indigo-900">
                    <Sparkles className="h-4 w-4" />
                    智能自动填充
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-indigo-700">填写当前持仓与预计交易费用，由云端 API 匹配候选基金并填写 H/L 标的和阈值。</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAutoPanelOpen((current) => !current);
                    setAutoError('');
                    setAutoMessage('');
                  }}
                  className="shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-700 shadow-xs"
                >
                  {autoPanelOpen ? '收起' : '自动填充'}
                </button>
              </div>

              {autoPanelOpen ? (
                <div className="mt-3 border-t border-indigo-100 pt-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="当前持仓代码" helper="填写实际持有的场内基金代码">
                      <TextInput
                        value={autoHoldingCode}
                        inputMode="numeric"
                        placeholder="例如：159632"
                        onChange={(event) => {
                          setAutoHoldingCode(sanitizeCodeInput(event.target.value));
                          setAutoError('');
                          setAutoMessage('');
                        }}
                      />
                    </Field>
                    <Field label="交易费率" rightLabel="万分之" helper="例如填 1 表示万1，买入和卖出各计算一次">
                      <TextInput
                        value={autoFeeWanRate}
                        inputMode="decimal"
                        placeholder="1"
                        onChange={(event) => {
                          setAutoFeeWanRate(sanitizePctInput(event.target.value));
                          setAutoError('');
                          setAutoMessage('');
                        }}
                      />
                    </Field>
                  </div>
                  <button
                    type="button"
                    onClick={runAutoFill}
                    disabled={autoFilling}
                    className={cx(primaryButtonClass, 'mt-3 w-full')}
                  >
                    {autoFilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {autoFilling ? '正在调用 API…' : '生成并填充方案'}
                  </button>
                  {autoError ? <p role="alert" className="mt-2 text-[11px] font-bold leading-5 text-rose-600">{autoError}</p> : null}
                  <p className="mt-2 text-[11px] leading-5 text-indigo-700">将读取该基金的当前持仓金额计算费用；未找到持仓时按 10,000 元计算。</p>
                </div>
              ) : null}
            </div>
          ) : null}

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

          {autoCompleted && autoMessage ? (
            <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold leading-5 text-emerald-700">{autoMessage}</p>
          ) : null}

          {validation ? (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-800">{validation}</p>
          ) : null}
        </div>

        <DialogFooter className="border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>取消</button>
          <button ref={saveButtonRef} type="button" onClick={submit} disabled={Boolean(validation) || saving} className={primaryButtonClass}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存方案
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SwitchStrategyRuleModal;
