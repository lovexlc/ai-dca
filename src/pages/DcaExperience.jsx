import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, TrendingUp } from 'lucide-react';
import { formatCurrency } from '../app/accumulation.js';
import { buildDcaProjection, defaultDcaState, persistDcaState } from '../app/dca.js';
import { syncTradePlanRules } from '../app/notifySync.js';
import { readPlanList } from '../app/plan.js';
import { showToast } from '../app/toast.js';
import { cx } from '../components/experience-ui.jsx';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';

const CALC_APPLY_KEY = 'aiDcaCalcApply';
const CALC_FREQ_TO_DCA = { weekly: '每周', biweekly: '每两周', monthly: '每月' };

function buildInitialDcaState(initialDca = null) {
  if (initialDca?.id) {
    return {
      ...defaultDcaState,
      ...initialDca,
      isConfigured: Boolean(initialDca.isConfigured)
    };
  }

  return {
    ...defaultDcaState,
    ...(initialDca && typeof initialDca === 'object' ? initialDca : {}),
    id: '',
    name: String(initialDca?.name || ''),
    isConfigured: false,
    createdAt: '',
    updatedAt: ''
  };
}

function getDcaExecutionOptions(frequency) {
  if (frequency === '每日') {
    return [
      { value: 1, label: '每个交易日 (开盘后 09:30 / 14:30 自动执行)' }
    ];
  }
  if (frequency === '每周') {
    return [
      { value: 1, label: '每周一' },
      { value: 2, label: '每周二 (推荐 - 避开周一高波动)' },
      { value: 3, label: '每周三' },
      { value: 4, label: '每周四 (推荐 - 周末效应前建仓)' },
      { value: 5, label: '每周五' }
    ];
  }
  if (frequency === '每两周') {
    return [
      { value: 1, label: '每双周 周一' },
      { value: 2, label: '每双周 周二 (推荐)' },
      { value: 3, label: '每双周 周三' },
      { value: 4, label: '每双周 周四' },
      { value: 5, label: '每双周 周五' }
    ];
  }
  if (frequency === '每季') {
    return [
      { value: 1, label: '季首月 1 日 (1/4/7/10月 1日)' },
      { value: 15, label: '季中月 15 日 (2/5/8/11月 15日 - 推荐)' },
      { value: 28, label: '季末月 28 日 (3/6/9/12月 28日)' }
    ];
  }
  // '每月'
  return [
    { value: 1, label: '每月 1 日 (月初扣款)' },
    { value: 8, label: '每月 8 日 (发薪日建仓 - 推荐)' },
    { value: 15, label: '每月 15 日 (月中平滑)' },
    { value: 20, label: '每月 20 日 (下旬布局)' },
    { value: 28, label: '每月 28 日 (月末定投)' }
  ];
}

function getDcaExecutionLabel(frequency, day) {
  const opts = getDcaExecutionOptions(frequency);
  const found = opts.find((o) => Number(o.value) === Number(day));
  if (frequency === '每日') return '每日执行 (每个交易日)';
  if (found) {
    return found.label.split(' (')[0];
  }
  return `${frequency} 第${day}日`;
}

function getDcaNextReminderText(frequency, day) {
  if (frequency === '每日') return '下一个交易日 14:30';
  if (frequency === '每周') return `下周二 14:30`;
  if (frequency === '每两周') return `下双周二 14:30`;
  if (frequency === '每季') return `季中15日 14:30`;
  return `下月 8 日 14:30`;
}

export function DcaExperience({
  links,
  inPagesDir = false,
  embedded = false,
  initialDca = null,
  mode = 'create',
  onCancel = null,
  onAfterSave = null,
  onBack = null
}) {
  const isEditing = mode === 'replace' && Boolean(initialDca?.id);
  const [state, setState] = useState(() => buildInitialDcaState(initialDca));
  const [planList] = useState(() => readPlanList());
  const [isSaving, setIsSaving] = useState(false);

  const projection = useMemo(() => buildDcaProjection(state), [state]);
  const executionOptions = useMemo(() => getDcaExecutionOptions(state.frequency), [state.frequency]);

  const totalInvestment = (Number(state.initialInvestment) || 0) + (Number(state.recurringInvestment) || 0) * (Number(state.termMonths) || 12);

  // 从回测计算器反向预填
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raw;
    try { raw = window.sessionStorage.getItem(CALC_APPLY_KEY); } catch { return; }
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      const mappedFreq = CALC_FREQ_TO_DCA[payload.frequency] || '每两周';
      setState((current) => ({
        ...current,
        symbol: payload.symbol || current.symbol,
        frequency: mappedFreq,
        recurringInvestment: Number(payload.amount) || current.recurringInvestment
      }));
      showToast({
        title: '已从回测结果填充表单',
        description: `${payload.symbol} · 频率 ${mappedFreq} · 单期 $${payload.amount}`,
        tone: 'emerald'
      });
    } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(CALC_APPLY_KEY); } catch { /* ignore */ }
  }, []);

  function handleFrequencyChange(f) {
    const opts = getDcaExecutionOptions(f);
    const exists = opts.some((o) => Number(o.value) === Number(state.executionDay));
    let nextDay = state.executionDay;
    if (!exists) {
      if (f === '每周' || f === '每两周') nextDay = 2;
      else if (f === '每月') nextDay = 8;
      else if (f === '每季') nextDay = 15;
      else nextDay = 1;
    }
    setState((cur) => ({
      ...cur,
      frequency: f,
      executionDay: nextDay
    }));
  }

  async function handleSave() {
    if (isSaving) return;

    const sym = String(state.symbol || '').trim().toUpperCase();
    if (!sym) {
      showToast({ title: '请填写标的代码', tone: 'amber' });
      return;
    }

    setIsSaving(true);
    const startedAt = Date.now();
    trackFeatureEvent('dca', isEditing ? 'edit_save_start' : 'save_start', { symbol: sym });

    const persisted = persistDcaState(
      { ...state, symbol: sym, isConfigured: true },
      projection,
      { mode: isEditing ? 'replace' : 'create', activate: true }
    );

    let syncFailed = false;
    try {
      await syncTradePlanRules();
    } catch {
      syncFailed = true;
    } finally {
      setIsSaving(false);
      showToast({
        title: isEditing ? '定投计划已更新' : '定投计划已保存',
        description: syncFailed ? '计划已保存，本次提醒规则未同步。' : '计划已保存并加入监控看板。',
        tone: syncFailed ? 'amber' : 'emerald',
        persist: true
      });
      trackActionResult('dca', isEditing ? 'edit_save' : 'save', syncFailed ? 'partial' : 'success', {
        symbol: sym,
        durationMs: Date.now() - startedAt
      });
      if (typeof onAfterSave === 'function') {
        onAfterSave(persisted);
      } else if (typeof onBack === 'function') {
        onBack();
      } else if (typeof onCancel === 'function') {
        onCancel();
      } else if (links?.tradePlans) {
        window.location.href = links.tradePlans;
      }
    }
  }

  const handleBack = onCancel || onBack;

  return (
    <div className="bg-slate-50 text-slate-900 rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xl">
      {/* Header Banner (1:1 原型顶栏) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-600">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            SMART DCA STRATEGY WIZARD
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-950 mt-1">智能周期定投计划设计器</h2>
          <p className="text-xs text-slate-500 mt-1">定制买入频率与扣款日，支持结合均线偏离度高位少投、低位多投智能加权</p>
        </div>

        <div className="flex items-center gap-2.5">
          {handleBack && (
            <button
              type="button"
              onClick={handleBack}
              className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
            >
              <ArrowLeft className="w-4 h-4" />
              返回看板
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-lg shadow-emerald-500/25 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {isSaving ? '保存中...' : '保存定投计划并加入监控'}
          </button>
        </div>
      </div>

      {/* Main 2-Column Grid (1:1 原型布局) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(360px,1fr)] gap-7 mt-6 items-start">
        {/* Left Side: DCA Config */}
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 text-xs">
            <div className="text-xs font-bold uppercase text-slate-400">第一步</div>
            <div className="text-base font-bold text-slate-950">设定定投频率与扣款日</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">定投标的代码</label>
                <input
                  type="text"
                  value={state.symbol || ''}
                  onChange={(e) => setState((cur) => ({ ...cur, symbol: e.target.value.toUpperCase() }))}
                  placeholder="如 513500、159632、QQQ..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">标的简称</label>
                <input
                  type="text"
                  value={state.name || ''}
                  onChange={(e) => setState((cur) => ({ ...cur, name: e.target.value }))}
                  placeholder="如 标普500 ETF"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>

            {/* Frequency Selection Pills (5 pills) */}
            <div>
              <label className="block font-bold text-slate-700 mb-1.5">买入频率设置</label>
              <div className="grid grid-cols-5 gap-1.5">
                {['每日', '每周', '每两周', '每月', '每季'].map((f) => {
                  const isSelected = state.frequency === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => handleFrequencyChange(f)}
                      className={cx(
                        'py-2 rounded-xl border text-center font-bold text-xs transition-all',
                        isSelected
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      )}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Execution Day & Term Months */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1 flex items-center justify-between">
                  <span>定投扣款节点</span>
                  <span className="text-xs text-emerald-600 font-normal">
                    {state.frequency === '每日' ? '自动执行' : '跟随' + state.frequency}
                  </span>
                </label>
                <select
                  value={state.executionDay || 1}
                  disabled={state.frequency === '每日'}
                  onChange={(e) => setState((cur) => ({ ...cur, executionDay: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-medium text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-100 disabled:text-slate-500"
                >
                  {executionOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">计划周期 (月数)</label>
                <input
                  type="number"
                  value={state.termMonths || 12}
                  onChange={(e) => setState((cur) => ({ ...cur, termMonths: Number(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>

            {/* Amounts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">单期定期投资额 (¥)</label>
                <input
                  type="number"
                  value={state.recurringInvestment || ''}
                  onChange={(e) => setState((cur) => ({ ...cur, recurringInvestment: Number(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">初始底仓资金 (¥)</label>
                <input
                  type="number"
                  value={state.initialInvestment || 0}
                  onChange={(e) => setState((cur) => ({ ...cur, initialInvestment: Number(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>

            {/* Smart Features Toggle */}
            <div className="pt-2 border-t border-slate-100 space-y-2.5">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(state.linkedPlanId || projection?.isLinkedPlan)}
                  onChange={(e) => setState((cur) => ({ ...cur, linkedPlanId: e.target.checked ? (planList[0]?.id || 'auto') : '' }))}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 mt-0.5"
                />
                <div>
                  <span className="font-bold text-slate-800 text-xs">联动加仓策略 (Smart DCA)</span>
                  <p className="text-[11px] text-slate-500">跌破 120 日均线或阶段高点时自动触发额外档位分批加仓</p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  defaultChecked
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 mt-0.5"
                />
                <div>
                  <span className="font-bold text-slate-800 text-xs">估值加权定投</span>
                  <p className="text-[11px] text-slate-500">高估值区间 0.7x 投入防守，低估值区间 1.3x 投入吸筹</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Right Side: DCA Simulation Preview */}
        <div className="space-y-5 lg:sticky lg:top-4">
          <div className="bg-white rounded-2xl border border-emerald-100 p-5 shadow-md bg-gradient-to-br from-emerald-50/40 via-white to-white">
            <div className="text-[10px] font-bold text-emerald-600">定投测算看板</div>
            <h3 className="text-base font-bold text-slate-950 mt-0.5">周期收益与现金流测算</h3>

            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-slate-500 block text-[11px]">预计总投入本金</span>
                <span className="text-lg font-bold text-slate-900 font-mono mt-1 block">
                  ¥ {totalInvestment.toLocaleString()}
                </span>
              </div>
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                <span className="text-emerald-700 block font-semibold text-[11px]">目标预期收益率</span>
                <span className="text-lg font-bold text-emerald-700 font-mono mt-1 block">
                  +{state.targetReturn || 15}%
                </span>
              </div>
            </div>

            <div className="mt-4 p-4 rounded-xl bg-white border border-slate-200 text-xs space-y-2.5">
              <div className="font-bold text-slate-800 flex justify-between">
                <span>定投执行节奏：</span>
                <span className="text-emerald-700 font-mono">
                  {getDcaExecutionLabel(state.frequency, state.executionDay)}
                </span>
              </div>
              <div className="text-slate-500 flex justify-between">
                <span>单次扣款预算：</span>
                <span className="font-mono text-slate-800 font-bold">
                  ¥ {(Number(state.recurringInvestment) || 0).toLocaleString()}
                </span>
              </div>
              <div className="text-slate-500 flex justify-between">
                <span>下期扣款提醒：</span>
                <span className="font-mono text-indigo-600 font-bold">
                  {getDcaNextReminderText(state.frequency, state.executionDay)}
                </span>
              </div>
              <div className="text-slate-500 flex justify-between">
                <span>智能加权状态：</span>
                <span className="text-emerald-600 font-bold">已启用 (均线+估值双因子)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="w-full mt-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              将此定投计划加入监控中心
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
