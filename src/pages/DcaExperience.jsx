import { useEffect, useMemo, useState } from 'react';
import { formatCurrency, formatPercent } from '../app/accumulation.js';
import { buildDcaProjection, frequencyOptions, persistDcaState, readDcaState } from '../app/dca.js';
import { createTopTabs } from '../app/screens.js';
import { NumberField, TextField } from '../components/FormFields.jsx';
import { MaterialIcon } from '../components/MaterialIcon.jsx';
import { SurfaceCard, WorkspaceShell } from '../components/PageChrome.jsx';

const APP_MENU = [
  { label: 'Dashboard', icon: 'dashboard' },
  { label: 'Strategies', icon: 'insights', active: true },
  { label: 'Markets', icon: 'show_chart' },
  { label: 'Portfolio', icon: 'account_balance_wallet' },
  { label: 'Settings', icon: 'settings' }
];

const DAY_OPTIONS = [1, 8, 15, 28];

export function DcaExperience({ screen, links, inPagesDir }) {
  const [state, setState] = useState(() => readDcaState());
  const projection = useMemo(() => buildDcaProjection(state), [state]);
  const tabs = createTopTabs({ inPagesDir });

  useEffect(() => {
    persistDcaState(state, projection);
  }, [state, projection]);

  return (
    <WorkspaceShell
      activeTab="dca"
      tabs={tabs}
      headerRight={
        <>
          <button className="icon-button" type="button">
            <MaterialIcon className="icon-button__icon" name="notifications" />
          </button>
          <button className="icon-button" type="button">
            <MaterialIcon className="icon-button__icon" name="account_circle" />
          </button>
        </>
      }
      sidebar={
        <>
          <div className="sidebar-menu">
            {APP_MENU.map((item) => (
              <a key={item.label} className={item.active ? 'sidebar-menu__item is-active' : 'sidebar-menu__item'} href={links.dca}>
                <MaterialIcon className="sidebar-menu__icon" name={item.icon} />
                <span>{item.label}</span>
              </a>
            ))}
          </div>
        </>
      }
    >
      <div className="page-breadcrumb">
        <MaterialIcon className="icon-button__icon" name="arrow_back" />
        <span>项目策略模板</span>
      </div>

      <section className="page-header">
        <div>
          <h1 className="page-title page-title--compact">修改定期定额投资策略</h1>
          <p className="page-subtitle">通过金额配置和买入频率，优化资金在不同时段的长期分配节奏。</p>
        </div>
      </section>

      <section className="content-split">
        <div className="card-grid">
          <SurfaceCard>
            <div className="section-header">
              <div>
                <div className="section-eyebrow">策略参数设置</div>
                <h2 className="section-title">策略参数设置</h2>
              </div>
            </div>

            <div className="field-grid">
              <div className="field-grid field-grid--2">
                <NumberField
                  label="初始投资额"
                  value={state.initialInvestment}
                  onChange={(event) => setState((current) => ({ ...current, initialInvestment: Number(event.target.value) || 0 }))}
                  prefix="$"
                />
                <NumberField
                  label="定期投资额"
                  value={state.recurringInvestment}
                  onChange={(event) => setState((current) => ({ ...current, recurringInvestment: Number(event.target.value) || 0 }))}
                  prefix="$"
                />
              </div>

              <TextField
                label="标的代码"
                value={state.symbol}
                onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value || 'QQQ' }))}
              />

              <div className="field">
                <span className="field__label">买入频率</span>
                <div className="segmented-control">
                  {frequencyOptions.map((option) => (
                    <button
                      key={option}
                      className={state.frequency === option ? 'is-active' : ''}
                      type="button"
                      onClick={() => setState((current) => ({ ...current, frequency: option }))}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="field__label">执行日期</span>
                <div className="date-chip-list">
                  {DAY_OPTIONS.map((day) => (
                    <button
                      key={day}
                      className={state.executionDay === day ? 'is-active' : ''}
                      type="button"
                      onClick={() => setState((current) => ({ ...current, executionDay: day }))}
                    >
                      每月 {day} 号
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-grid field-grid--2">
                <NumberField
                  label="投资周期(月)"
                  step="1"
                  value={state.termMonths}
                  onChange={(event) => setState((current) => ({ ...current, termMonths: Number(event.target.value) || 1 }))}
                />
                <NumberField
                  label="目标收益"
                  step="1"
                  suffix="%"
                  value={state.targetReturn}
                  onChange={(event) => setState((current) => ({ ...current, targetReturn: Number(event.target.value) || 0 }))}
                />
              </div>
            </div>
          </SurfaceCard>

          <div className="action-rail">
            <a className="button-primary action-rail__main" href={links.home}>
              <MaterialIcon className="icon-button__icon" name="save" />
              保存并开始策略
            </a>
            <a className="button-secondary" href={links.home}>取消</a>
          </div>
        </div>

        <div className="card-grid">
          <div className="summary-tile summary-tile--blue">
            <div className="section-header">
              <div>
                <div className="section-eyebrow">策略资金概览</div>
              </div>
              <span className="summary-pill">
                <MaterialIcon className="icon-button__icon" filled name="trending_up" />
                +{formatPercent(state.targetReturn * 0.414, 1).replace('%', '')}%
              </span>
            </div>
            <div className="summary-tile__value">{formatCurrency(projection.totalInvestment, '¥ ')}</div>
            <div className="summary-lines">
              <div className="summary-lines__row">
                <span>总投资额</span>
                <strong>{formatCurrency(projection.totalInvestment, '¥ ')}</strong>
              </div>
              <div className="summary-lines__row">
                <span>预计收益</span>
                <strong>{formatCurrency(projection.totalInvestment * state.targetReturn / 100, '¥ ')}</strong>
              </div>
              <div className="summary-lines__row">
                <span>风险级别</span>
                <strong>{formatPercent(Math.min(state.targetReturn / 3, 99), 0)}</strong>
              </div>
            </div>
          </div>

          <SurfaceCard className="surface-card--tight">
            <div className="section-eyebrow">资本增长变化</div>
            <div className="bar-preview">
              {projection.schedule.map((row, index) => (
                <span key={row.id} style={{ height: `${36 + index * 14}px` }} />
              ))}
            </div>
            <div className="table-note">{projection.cadenceLabel}</div>
          </SurfaceCard>

          <SurfaceCard className="surface-card--tight">
            <div className="section-header">
              <div>
                <div className="section-eyebrow">执行序列</div>
                <h2 className="section-title">前六次定投预览</h2>
              </div>
            </div>
            <div className="summary-list">
              {projection.schedule.map((row) => (
                <div key={row.id} className="summary-list__row">
                  <span>{row.label}</span>
                  <strong>{formatCurrency(row.cumulative, '¥ ')}</strong>
                </div>
              ))}
            </div>
            <div className="table-note">总投入 = 初始投资额 + 定期投资额 × 执行次数</div>
          </SurfaceCard>
        </div>
      </section>
    </WorkspaceShell>
  );
}
