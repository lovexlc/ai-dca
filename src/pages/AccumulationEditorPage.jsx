import { useEffect, useMemo, useState } from 'react';
import { pageLinks } from '../app/links.js';
import {
  buildStages,
  defaultAccumulationState,
  formatCurrency,
  formatPercent,
  persistAccumulationState,
  readAccumulationState,
  round
} from '../app/accumulation.js';
import { AppShell } from '../components/AppShell.jsx';
import { StatCard } from '../components/StatCard.jsx';

const frequencyOptions = ['每日', '每周', '每月', '每季'];

function NumberField({ label, value, onChange, prefix, suffix, step = '0.01', readOnly = false }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <div className={readOnly ? 'field__input-shell is-readonly' : 'field__input-shell'}>
        {prefix ? <span className="field__prefix">{prefix}</span> : null}
        <input step={step} type="number" value={value} onChange={onChange} readOnly={readOnly} />
        {suffix ? <span className="field__suffix">{suffix}</span> : null}
      </div>
    </label>
  );
}

export function AccumulationEditorPage() {
  const [state, setState] = useState(() => readAccumulationState());

  const computed = useMemo(() => buildStages(state), [state]);

  useEffect(() => {
    persistAccumulationState(state, computed);
  }, [state, computed]);

  const nextBuyPrice = computed.stages[1]?.price ?? computed.stages[0]?.price ?? state.basePrice;
  const riskNote = computed.stages.length > 2
    ? `末层最大跌幅 ${formatPercent(state.maxDrawdown, 2)}，每次改动权重都会按累计权重重新分配入场位。`
    : '建议至少保留三层加仓，避免在震荡行情中过早打满仓位。';

  return (
    <AppShell
      activeTab="accumEdit"
      sideNav={{
        title: '加仓模块',
        subtitle: '统一策略架构',
        items: [
          { label: '策略概览', icon: '▣', href: pageLinks.home },
          { label: '加仓配置', icon: '◉', href: pageLinks.accumEdit, active: true },
          { label: '策略分析', icon: '△', href: pageLinks.history },
          { label: '风险提示', icon: '!', href: pageLinks.catalog }
        ],
        footer: <a className="side-nav__cta" href={pageLinks.history}>查看交易历史</a>
      }}
      headerMeta={[
        { label: '标的', value: state.symbol },
        { label: '再平衡', value: state.frequency },
        { label: '状态', value: '运行中' }
      ]}
    >
      <section className="page-section page-section--hero">
        <div>
          <div className="page-eyebrow">组件化前端页面</div>
          <h1 className="page-title">修改策略配置 - {state.symbol}</h1>
          <p className="page-copy">这页已经迁到共享 React 布局。顶部主导航、侧边栏和摘要卡都来自统一组件，不再是独立拼接的静态 HTML。</p>
        </div>
        <div className="hero-grid">
          <StatCard label="计划总预算" value={formatCurrency(state.totalCapital)} note="用于本次金字塔加仓模型" tone="primary" />
          <StatCard label="预估平均成本" value={formatCurrency(computed.averageCost)} note={`总权重 ${formatPercent(computed.totalWeight, 2)}`} />
          <StatCard label="下次买入价" value={formatCurrency(nextBuyPrice)} note={riskNote} />
        </div>
      </section>

      <div className="content-grid">
        <section className="panel">
          <div className="panel__header">
            <div>
              <div className="panel__eyebrow">基本参数</div>
              <h2 className="panel__title">全局设置</h2>
            </div>
          </div>
          <div className="field-grid">
            <NumberField
              label="初始投资额"
              prefix="$"
              value={state.totalCapital}
              onChange={(event) => setState((current) => ({ ...current, totalCapital: Number(event.target.value) || 0 }))}
            />
            <NumberField
              label="首笔价格"
              prefix="$"
              value={state.basePrice}
              onChange={(event) => setState((current) => ({ ...current, basePrice: Number(event.target.value) || 0 }))}
            />
            <NumberField
              label="末层最大跌幅"
              suffix="%"
              value={state.maxDrawdown}
              onChange={(event) => setState((current) => ({ ...current, maxDrawdown: Number(event.target.value) || 0 }))}
            />
            <label className="field">
              <span className="field__label">再平衡频率</span>
              <div className="field__input-shell">
                <select value={state.frequency} onChange={(event) => setState((current) => ({ ...current, frequency: event.target.value }))}>
                  {frequencyOptions.map((option) => <option key={option}>{option}</option>)}
                </select>
              </div>
            </label>
          </div>
        </section>

        <section className="panel panel--stages">
          <div className="panel__header">
            <div>
              <div className="panel__eyebrow">目标跌幅加仓点</div>
              <h2 className="panel__title">权重联动入场价格</h2>
            </div>
          </div>
          <div className="stage-list">
            {computed.stages.map((stage, index) => (
              <article key={stage.id} className={index === 0 ? 'stage-card is-primary' : 'stage-card'}>
                <div className="stage-card__index">{String(index + 1).padStart(2, '0')}</div>
                <div className="stage-card__fields">
                  <NumberField
                    label="分配权重"
                    suffix="%"
                    step="1"
                    value={state.weights[index]}
                    onChange={(event) => {
                      const nextWeights = [...state.weights];
                      nextWeights[index] = Number(event.target.value) || 0;
                      setState((current) => ({ ...current, weights: nextWeights }));
                    }}
                  />
                  <NumberField label="入场价格" prefix="$" value={round(stage.price, 2)} readOnly onChange={() => {}} />
                  <NumberField label="计划金额" prefix="$" value={round(stage.amount, 2)} readOnly onChange={() => {}} />
                </div>
                <div className="stage-card__meta">
                  <span>{index === 0 ? '首笔基准层' : `目标跌幅 ${formatPercent(stage.drawdown, 2)}`}</span>
                  <strong>{formatCurrency(stage.shares, '', 3)} 股</strong>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="panel panel--table">
        <div className="panel__header">
          <div>
            <div className="panel__eyebrow">执行摘要</div>
            <h2 className="panel__title">分层资金配置</h2>
          </div>
          <a className="text-link" href={pageLinks.history}>查看交易历史</a>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>阶段</th>
              <th>权重</th>
              <th>跌幅</th>
              <th>入场价格</th>
              <th>计划金额</th>
            </tr>
          </thead>
          <tbody>
            {computed.stages.map((stage, index) => (
              <tr key={stage.id}>
                <td>{stage.label}</td>
                <td>{formatPercent(stage.weightPercent, 1)}</td>
                <td>{index === 0 ? '基准' : formatPercent(-stage.drawdown, 2)}</td>
                <td>{formatCurrency(stage.price)}</td>
                <td>{formatCurrency(stage.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}
