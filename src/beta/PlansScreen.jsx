import { useCallback, useEffect, useReducer, useRef } from 'react';
import { loadPlansScreen } from './data/plansScreen.js';
import { INITIAL_PLANS_STATE, plansScreenReducer } from './data/plansScreenCore.js';

/**
 * PlansScreen - beta 计划 tab。
 * 两类卡片：定投计划、加仓计划。只读，新建与编辑回正式版。
 * 拼装与归一化在 plansScreenCore.js。
 */

const SMART_MODE_LABEL = {
  fixed: '固定金额',
  pyramid: '金字塔加仓',
  'high-level': '高位减投'
};

function formatMoney(value, digits = 2) {
  const num = Number(value);
  if (value === null || value === undefined || !Number.isFinite(num)) return '—';
  try {
    return num.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch (error) {
    return num.toFixed(digits);
  }
}

function formatPercent(value) {
  const num = Number(value);
  if (value === null || value === undefined || !Number.isFinite(num)) return '—';
  return num.toFixed(2) + '%';
}

function formatCount(value, unit) {
  const num = Number(value);
  if (value === null || value === undefined || !Number.isFinite(num)) return '—';
  return num + unit;
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-slate-500">{label}</p>
      <p className="mt-0.5 font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function PlanCard({ title, badge, active, fields, footer }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
        <div className="flex shrink-0 items-center gap-1">
          {active ? (
            <span className="rounded-full bg-[var(--brand-tint)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-text)]">
              当前
            </span>
          ) : null}
          {badge ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{badge}</span>
          ) : null}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        {fields.map((field) => (
          <Field key={field.label} label={field.label} value={field.value} />
        ))}
      </div>
      {footer ? <p className="mt-2 truncate text-xs text-slate-400">{footer}</p> : null}
    </li>
  );
}

function SectionShell({ title, count, section, empty, children }) {
  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {section.status === 'ready' ? <span className="text-xs text-slate-400">{count}</span> : null}
      </div>
      {section.status === 'empty' ? <p className="mt-2 text-xs text-slate-400">{empty}</p> : null}
      {section.status === 'error' ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {section.error}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function PlansScreen() {
  const [state, dispatch] = useReducer(plansScreenReducer, INITIAL_PLANS_STATE);
  const requestRef = useRef(0);
  const aliveRef = useRef(true);

  const runLoad = useCallback(async () => {
    requestRef.current += 1;
    const requestId = requestRef.current;
    dispatch({ type: 'request', requestId });
    let result;
    try {
      result = await loadPlansScreen();
    } catch (error) {
      result = { ok: false, error };
    }
    if (!aliveRef.current) return;
    if (result && result.ok) {
      dispatch({ type: 'success', requestId, ...result });
    } else {
      dispatch({ type: 'failure', requestId, error: result && result.error });
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    runLoad();
    return () => {
      aliveRef.current = false;
    };
  }, [runLoad]);

  const busy = state.status === 'loading' || state.status === 'refreshing';

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">计划</h2>
        <button
          type="button"
          onClick={runLoad}
          disabled={busy}
          className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? '读取中' : '刷新'}
        </button>
      </div>

      {state.error ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {state.error}
        </div>
      ) : null}

      <SectionShell
        title="定投计划"
        count={state.dca.rows.length + ' 条'}
        section={state.dca}
        empty="还没有定投计划。到正式版新建一条，这里会同步显示。"
      >
        {state.dca.rows.length ? (
          <ul className="mt-2 space-y-2">
            {state.dca.rows.map((plan) => (
              <PlanCard
                key={plan.id}
                title={plan.name}
                badge={SMART_MODE_LABEL[plan.smartMode] || plan.smartMode}
                active={plan.active}
                fields={[
                  { label: '每期', value: formatMoney(plan.perExecution) },
                  { label: '总投入', value: formatMoney(plan.totalInvestment) },
                  { label: '期数', value: formatCount(plan.executionCount, ' 期') }
                ]}
                footer={plan.cadence || plan.frequency}
              />
            ))}
          </ul>
        ) : null}
      </SectionShell>

      <SectionShell
        title="加仓计划"
        count={state.plans.rows.length + ' 条'}
        section={state.plans}
        empty="还没有加仓计划。到正式版把预算按跌幅分批，这里会同步显示。"
      >
        {state.plans.rows.length ? (
          <ul className="mt-2 space-y-2">
            {state.plans.rows.map((plan) => (
              <PlanCard
                key={plan.id}
                title={plan.name}
                badge={plan.strategyLabel}
                active={plan.active}
                fields={[
                  { label: '预算', value: formatMoney(plan.totalBudget) },
                  { label: '可投', value: formatMoney(plan.investable) },
                  { label: '批次', value: formatCount(plan.layerCount, ' 批') }
                ]}
                footer={'最大跌幅 ' + formatPercent(plan.maxDrawdown) + ' · 均成本 ' + formatMoney(plan.averageCost)}
              />
            ))}
          </ul>
        ) : null}
      </SectionShell>

      <p className="mt-4 text-center text-xs text-slate-400">beta 只读计划，新建与编辑请回正式版。</p>
    </div>
  );
}

export default PlansScreen;
