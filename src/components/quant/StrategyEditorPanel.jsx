import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Card, cx, primaryButtonClass, subtleButtonClass, inputClass } from '../experience-ui.jsx';
import { TagInput } from '../TagInput.jsx';
import {
  normalizeQuantPremiumConfigShape,
  parseQuantPremiumCodes
} from '../../app/quantPremiumSync.js';
import { showToast } from '../../app/toast.js';

function toDecimalText(value, fallback) {
  if (value === '' || value === null || value === undefined) return String(fallback);
  return String(value);
}

function parseDecimalOr(value, fallback) {
  if (value === '' || value === '-' || value === '.') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function strategyToFormState(strategy) {
  const normalized = normalizeQuantPremiumConfigShape(strategy || {});
  return {
    id: normalized.id,
    name: normalized.name,
    highCodes: normalized.highCodes,
    lowCodes: normalized.lowCodes,
    activeSide: normalized.activeSide,
    intraSellLowerPct: toDecimalText(normalized.intraSellLowerPct, 1),
    intraBuyOtherPct: toDecimalText(normalized.intraBuyOtherPct, 3),
    enabled: normalized.enabled,
    notifyEnabled: normalized.notifyEnabled,
    paperEnabled: normalized.paperEnabled,
    liveSignalEnabled: normalized.liveSignalEnabled,
    backtestGate: normalized.backtestGate
  };
}

function DecimalInput({ id, label, suffix, hint, value, onChange, onCommit }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-500">{label}</label>
      <div className="mt-2 flex items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '' || next === '-' || /^-?\d*\.?\d*$/.test(next)) {
              onChange(next);
            }
          }}
          onBlur={(event) => onCommit?.(event.target.value)}
          className={cx(inputClass, 'h-11 w-24 text-center font-semibold tabular-nums')}
        />
        {suffix ? <span className="text-sm text-slate-500">{suffix}</span> : null}
      </div>
      {hint ? <p className="mt-1.5 text-xs leading-5 text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function StrategyEditorPanel({
  strategy,
  saving = false,
  busy = false,
  onSave,
  onDelete
}) {
  const [form, setForm] = useState(() => strategyToFormState(strategy));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setForm(strategyToFormState(strategy));
    setDirty(false);
    // 仅在切换策略或服务端有新版本时重置表单，避免每次父级 re-render 都覆盖用户的编辑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy?.id, strategy?.updatedAt]);

  function patch(next) {
    setForm((current) => ({ ...current, ...next }));
    setDirty(true);
  }

  function buildDraft() {
    return normalizeQuantPremiumConfigShape({
      ...strategy,
      ...form,
      highCodes: parseQuantPremiumCodes(form.highCodes),
      lowCodes: parseQuantPremiumCodes(form.lowCodes),
      intraSellLowerPct: parseDecimalOr(form.intraSellLowerPct, 1),
      intraBuyOtherPct: parseDecimalOr(form.intraBuyOtherPct, 3)
    });
  }

  function validate(draft) {
    if (!draft.highCodes.length || !draft.lowCodes.length) {
      showToast({ title: 'H 和 L 至少各设置一只 ETF', tone: 'amber' });
      return false;
    }
    return true;
  }

  async function handleSave() {
    const draft = buildDraft();
    if (!validate(draft)) return;
    try {
      const saved = await onSave?.(draft);
      if (saved) setForm(strategyToFormState(saved));
      setDirty(false);
    } catch {
      // toast handled upstream
    }
  }

  if (!strategy) {
    return (
      <Card className="flex h-full min-h-[260px] items-center justify-center p-6 text-center text-sm text-slate-500">
        从策略列表中选择一个策略开始配置。
      </Card>
    );
  }

  const gateStatus = strategy.backtestGate?.status || 'none';
  const gateLabel = gateStatus === 'passed' ? '回测有效'
    : gateStatus === 'failed' ? '回测无效'
    : gateStatus === 'stale' ? '需重新回测'
    : '未回测';

  return (
    <Card className="space-y-6 p-5 sm:p-6">
      {/* 标题区 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">STRATEGY CONFIG</div>
          <h2 className="mt-1 truncate text-lg font-bold text-slate-900">{strategy.name || strategy.id}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {gateLabel} · {strategy.liveSignalEnabled ? '实盘已确认' : '未确认实盘信号'}
          </p>
        </div>
      </div>

      {/* 基本信息 */}
      <div className="space-y-4 border-t border-slate-100 pt-6">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">BASIC</div>
        <div>
          <label htmlFor="quant-strategy-name" className="block text-xs font-semibold text-slate-500">策略名称</label>
          <input
            id="quant-strategy-name"
            className={cx(inputClass, 'mt-2')}
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
            maxLength={60}
          />
        </div>
      </div>

      {/* ETF 池 */}
      <div className="space-y-4 border-t border-slate-100 pt-6">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">ETF POOL</div>
        <TagInput
          label="H 高溢价 ETF（卖出方）"
          placeholder="输入代码如 159513"
          tags={form.highCodes}
          onChange={(next) => patch({ highCodes: next })}
        />
        <TagInput
          label="L 低溢价 ETF（买入方）"
          placeholder="输入代码如 513100"
          tags={form.lowCodes}
          onChange={(next) => patch({ lowCodes: next })}
        />
        <div>
          <label htmlFor="quant-strategy-side" className="block text-xs font-semibold text-slate-500">允许的切换方向</label>
          <select
            id="quant-strategy-side"
            className={cx(inputClass, 'mt-2')}
            value={form.activeSide}
            onChange={(event) => patch({ activeSide: event.target.value })}
          >
            <option value="all">双向：H ↔ L 都可切换</option>
            <option value="H">只允许 H → L</option>
            <option value="L">只允许 L → H</option>
          </select>
        </div>
      </div>

      {/* 触发阈值 */}
      <div className="space-y-4 border-t border-slate-100 pt-6">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">RULES</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <DecimalInput
            id="quant-strategy-rule-a"
            label="规则 A · 卖 L 买 H 阈值"
            suffix="%"
            hint="持有 L 时，溢价差缩小到此阈值以内触发卖 L 买 H。"
            value={form.intraSellLowerPct}
            onChange={(next) => patch({ intraSellLowerPct: next })}
            onCommit={(next) => patch({ intraSellLowerPct: String(parseDecimalOr(next, 1)) })}
          />
          <DecimalInput
            id="quant-strategy-rule-b"
            label="规则 B · 卖 H 买 L 阈值"
            suffix="%"
            hint="持有 H 时，溢价差扩大到此阈值以上触发卖 H 买 L。"
            value={form.intraBuyOtherPct}
            onChange={(next) => patch({ intraBuyOtherPct: next })}
            onCommit={(next) => patch({ intraBuyOtherPct: String(parseDecimalOr(next, 3)) })}
          />
        </div>
      </div>

      {/* 运行开关 */}
      <div className="space-y-3 border-t border-slate-100 pt-6">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">SWITCHES</div>
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
          <span className="text-sm font-semibold text-slate-700">启用量化 Worker</span>
          <input
            type="checkbox"
            checked={Boolean(form.enabled)}
            onChange={(event) => patch({ enabled: event.target.checked })}
            className="h-5 w-5"
          />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
          <span className="text-sm font-semibold text-slate-700">触发时推送实盘信号通知</span>
          <input
            type="checkbox"
            checked={Boolean(form.notifyEnabled)}
            onChange={(event) => patch({ notifyEnabled: event.target.checked })}
            className="h-5 w-5"
          />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
          <span className="text-sm font-semibold text-slate-700">模拟盘自动撮合</span>
          <input
            type="checkbox"
            checked={Boolean(form.paperEnabled)}
            onChange={(event) => patch({ paperEnabled: event.target.checked })}
            className="h-5 w-5"
          />
        </label>
      </div>

      {/* 操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
        <div className="flex-1 text-xs text-slate-500">
          {dirty ? '有未保存的改动' : '所有改动已保存'}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={subtleButtonClass}
            onClick={() => onDelete?.(strategy.id)}
            disabled={busy || saving || strategy.id === 'default'}
          >
            <Trash2 className="h-4 w-4" />
            删除
          </button>
          <button
            type="button"
            className={primaryButtonClass}
            onClick={handleSave}
            disabled={saving || busy}
          >
            <Save className="h-4 w-4" />
            {saving ? '保存中' : '保存'}
          </button>
        </div>
      </div>
    </Card>
  );
}
