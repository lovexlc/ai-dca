import { useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../app/accumulation.js';
import { buildFundSwitchSummary, createEmptyFundSwitchRow, persistFundSwitchState, readFundSwitchState } from '../app/fundSwitch.js';
import { MaterialIcon } from '../components/MaterialIcon.jsx';
import { StatusBadge, SurfaceCard, WorkspaceShell } from '../components/PageChrome.jsx';

const sidebarItems = [
  { label: 'Dashboard', icon: 'dashboard' },
  { label: 'Fund Analysis', icon: 'analytics' },
  { label: 'Data Import', icon: 'upload_file', active: true },
  { label: 'History', icon: 'history' },
  { label: 'Settings', icon: 'settings' }
];

export function FundSwitchExperience({ screen, links }) {
  const [state, setState] = useState(() => readFundSwitchState());
  const summary = useMemo(() => buildFundSwitchSummary(state), [state]);
  const workspaceTabs = [
    { key: 'dataProcess', label: 'Data Processing', href: links.fundSwitch },
    { key: 'yieldCalc', label: 'Yield Calculation', href: links.fundSwitch }
  ];

  useEffect(() => {
    persistFundSwitchState(state, summary);
  }, [state, summary]);

  function updateComparison(key, value) {
    setState((current) => ({
      ...current,
      comparison: {
        ...current.comparison,
        [key]: key.includes('Shares') || key.includes('Price') || key === 'switchCost' || key === 'extraCash' || key === 'feeTradeCount'
          ? Number(value) || 0
          : value
      }
    }));
  }

  function updateFeePerTrade(value) {
    setState((current) => ({
      ...current,
      feePerTrade: Number(value) || 0
    }));
  }

  function updateRow(index, key, value) {
    setState((current) => {
      const nextRows = [...current.rows];
      nextRows[index] = {
        ...nextRows[index],
        [key]: key === 'price' || key === 'shares' ? Number(value) || 0 : value
      };

      return { ...current, rows: nextRows };
    });
  }

  function removeRow(index) {
    setState((current) => {
      const nextRows = current.rows.filter((_, rowIndex) => rowIndex !== index);
      return {
        ...current,
        rows: nextRows.length ? nextRows : [createEmptyFundSwitchRow()]
      };
    });
  }

  function addRow() {
    setState((current) => ({
      ...current,
      rows: [...current.rows, createEmptyFundSwitchRow()],
      recognizedRecords: current.recognizedRecords + 1
    }));
  }

  return (
    <WorkspaceShell
      activeTab="yieldCalc"
      brand="Fund Switch Assistant"
      brandHref={links.fundSwitch}
      tabs={workspaceTabs}
      headerRight={
        <>
          <label className="toolbar-search" aria-label="Search data">
            <MaterialIcon className="toolbar-search__icon" name="search" />
            <input placeholder="Search data..." type="text" />
          </label>
          <button className="icon-button" type="button">
            <MaterialIcon className="icon-button__icon" name="notifications" />
          </button>
          <button className="icon-button" type="button">
            <MaterialIcon className="icon-button__icon" name="help_outline" />
          </button>
        </>
      }
      sidebar={
        <>
          <div className="sidebar-block">
            <div className="sidebar-brand-card__title">Financial Architect</div>
            <div className="sidebar-brand-card__meta">Fund Switch Assistant</div>
          </div>
          <div className="sidebar-menu">
            {sidebarItems.map((item) => (
              <a key={item.label} className={item.active ? 'sidebar-menu__item is-active' : 'sidebar-menu__item'} href={item.active ? links.fundSwitch : links.catalog}>
                <MaterialIcon className="sidebar-menu__icon" name={item.icon} />
                <span>{item.label}</span>
              </a>
            ))}
          </div>
          <div className="sidebar-footer">
            <div className="sidebar-block">
              <div className="sidebar-brand-card" style={{ padding: 0, boxShadow: 'none', background: 'transparent' }}>
                <div className="avatar">JD</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>User Profile</div>
                  <div className="sidebar-brand-card__meta">Premium Member</div>
                </div>
              </div>
            </div>
          </div>
        </>
      }
    >
      <section className="page-header">
        <div>
          <h1 className="page-title page-title--compact">基金切换收益助手</h1>
          <p className="page-subtitle">智能识别交易截图，精准计算基金切换过程中的损益表现，助您优化投资策略。</p>
        </div>
        <StatusBadge>识别成功，请确认数据</StatusBadge>
      </section>

      <section className="fund-switch-grid">
        <div className="card-grid">
          <SurfaceCard>
            <button className="upload-dropzone" type="button">
              <div className="upload-dropzone__icon">
                <MaterialIcon className="upload-dropzone__icon-symbol" name="cloud_upload" />
              </div>
              <div className="upload-dropzone__title">点击或拖拽上传交易截图/PDF</div>
              <div className="upload-dropzone__copy">支持 OCR 自动识别，可批量处理</div>
            </button>
          </SurfaceCard>

          <SurfaceCard className="surface-card--tight">
            <div className="section-header">
              <div>
                <div className="section-eyebrow">OCR 识别状态</div>
                <h2 className="section-title">OCR 识别状态</h2>
              </div>
              <div className="table-note">已完成 100%</div>
            </div>
            <div className="progress-line" style={{ marginTop: 0 }}>
              <div className="progress-line__track">
                <div className="progress-line__value" style={{ width: '100%' }} />
              </div>
            </div>
            <div className="ocr-file">
              <div className="ocr-file__badge">IMG</div>
              <div className="ocr-file__body">
                <strong>{state.fileName}</strong>
                <span>识别出 {summary.recordCount} 条有效记录</span>
              </div>
              <MaterialIcon className="ocr-file__check" filled name="check_circle" />
            </div>
          </SurfaceCard>

          <div className="summary-tile summary-tile--blue">
            <div className="section-eyebrow">智能计算引擎</div>
            <div className="section-title" style={{ color: 'inherit', marginTop: 4 }}>智能计算引擎</div>
            <p className="promo-card__copy">自动剔除手续费影响，精准对齐切换前后的份额价值差异。</p>
            <div className="summary-lines summary-lines--compact">
              <div className="summary-lines__row">
                <span>不切换现值</span>
                <strong>{formatCurrency(summary.stayValue, '¥ ')}</strong>
              </div>
              <div className="summary-lines__row">
                <span>切换后现值</span>
                <strong>{formatCurrency(summary.switchedValue, '¥ ')}</strong>
              </div>
              <div className="summary-lines__row">
                <span>手续费合计</span>
                <strong>{formatCurrency(summary.feeTotal, '¥ ')}</strong>
              </div>
            </div>
            <div className="promo-card__action">
              <button className="button-secondary" type="button">查看计算逻辑</button>
            </div>
          </div>

          <SurfaceCard className="surface-card--tight">
            <div className="section-header">
              <div>
                <div className="section-eyebrow">收益计算参数</div>
                <h2 className="section-title">切换收益比较</h2>
              </div>
            </div>
            <div className="field-grid field-grid--2">
              <label className="field">
                <span className="field__label">原基金代码</span>
                <div className="field__input-shell">
                  <input type="text" value={summary.comparison.sourceCode} onChange={(event) => updateComparison('sourceCode', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">现基金代码</span>
                <div className="field__input-shell">
                  <input type="text" value={summary.comparison.targetCode} onChange={(event) => updateComparison('targetCode', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">原持有份额</span>
                <div className="field__input-shell">
                  <input type="number" step="0.01" value={summary.comparison.sourceSellShares} onChange={(event) => updateComparison('sourceSellShares', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">原基金现价</span>
                <div className="field__input-shell">
                  <input type="number" step="0.0001" value={summary.comparison.sourceCurrentPrice} onChange={(event) => updateComparison('sourceCurrentPrice', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">现持有份额</span>
                <div className="field__input-shell">
                  <input type="number" step="0.01" value={summary.comparison.targetBuyShares} onChange={(event) => updateComparison('targetBuyShares', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">现基金现价</span>
                <div className="field__input-shell">
                  <input type="number" step="0.0001" value={summary.comparison.targetCurrentPrice} onChange={(event) => updateComparison('targetCurrentPrice', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">买入总成本</span>
                <div className="field__input-shell">
                  <input type="number" step="0.01" value={summary.comparison.switchCost} onChange={(event) => updateComparison('switchCost', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">额外补入现金</span>
                <div className="field__input-shell">
                  <input type="number" step="0.01" value={summary.comparison.extraCash} onChange={(event) => updateComparison('extraCash', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">单笔手续费</span>
                <div className="field__input-shell">
                  <input type="number" step="0.01" value={summary.feePerTrade} onChange={(event) => updateFeePerTrade(event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">手续费笔数</span>
                <div className="field__input-shell">
                  <input type="number" step="1" value={summary.comparison.feeTradeCount} onChange={(event) => updateComparison('feeTradeCount', event.target.value)} />
                </div>
              </label>
            </div>
          </SurfaceCard>

          <SurfaceCard className="surface-card--tight fund-result-card">
            <div className="section-header">
              <div>
                <div className="section-eyebrow">结果输出</div>
                <h2 className="section-title">收益助手结论</h2>
              </div>
            </div>
            <div className="result-grid">
              <div className="result-tile">
                <span className="result-tile__label">不切换现在价值</span>
                <strong className="result-tile__value">{formatCurrency(summary.stayValue, '¥ ')}</strong>
                <span className="result-tile__meta">{summary.comparison.sourceSellShares} 份 × {summary.comparison.sourceCurrentPrice.toFixed(4)}</span>
              </div>
              <div className="result-tile">
                <span className="result-tile__label">切换后现在价值</span>
                <strong className="result-tile__value">{formatCurrency(summary.switchedValue, '¥ ')}</strong>
                <span className="result-tile__meta">{summary.comparison.targetBuyShares} 份 × {summary.comparison.targetCurrentPrice.toFixed(4)}</span>
              </div>
              <div className="result-tile result-tile--accent">
                <span className="result-tile__label">当前持仓浮盈</span>
                <strong className="result-tile__value">{formatCurrency(summary.switchedPositionProfit, '¥ ')}</strong>
                <span className="result-tile__meta">切换后现值 - 买入总成本 - 手续费</span>
              </div>
              <div className={summary.switchAdvantage >= 0 ? 'result-tile result-tile--success' : 'result-tile result-tile--warning'}>
                <span className="result-tile__label">切换额外收益</span>
                <strong className="result-tile__value">{formatCurrency(summary.switchAdvantage, '¥ ')}</strong>
                <span className="result-tile__meta">切换后现值 - 不切换现值 - 补现金 - 手续费</span>
              </div>
            </div>
          </SurfaceCard>
        </div>

        <SurfaceCard className="fund-table-card">
          <div className="section-header">
            <div>
              <div className="section-eyebrow">持仓明细确认</div>
              <h2 className="section-title">持仓明细确认</h2>
            </div>
            <div className="page-header__actions">
              <button className="button-secondary" type="button" onClick={addRow}>
                <MaterialIcon className="icon-button__icon" name="add" />
                新增记录
              </button>
              <button className="button-secondary" type="button">
                <MaterialIcon className="icon-button__icon" name="download" />
                导出模板
              </button>
            </div>
          </div>
          <div className="fund-table-wrap">
            <table className="fund-table">
              <thead>
                <tr>
                  <th>日期 (时间)</th>
                  <th>基金代码</th>
                  <th>交易类型</th>
                  <th>单价 (价格)</th>
                  <th>份额 (股数)</th>
                  <th className="fund-table__action">操作</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 1 ? 'is-striped' : ''}>
                    <td>
                      <input type="text" value={row.date} onChange={(event) => updateRow(index, 'date', event.target.value)} />
                    </td>
                    <td>
                      <input type="text" value={row.code} onChange={(event) => updateRow(index, 'code', event.target.value)} />
                    </td>
                    <td>
                      <select
                        className={row.type === '卖出' ? 'fund-table__type is-sell' : 'fund-table__type is-buy'}
                        value={row.type}
                        onChange={(event) => updateRow(index, 'type', event.target.value)}
                      >
                        <option value="卖出">卖出</option>
                        <option value="买入">买入</option>
                      </select>
                    </td>
                    <td>
                      <input type="number" step="0.0001" value={row.price} onChange={(event) => updateRow(index, 'price', event.target.value)} />
                    </td>
                    <td>
                      <input type="number" step="0.01" value={row.shares} onChange={(event) => updateRow(index, 'shares', event.target.value)} />
                    </td>
                    <td className="fund-table__action">
                      <button className="icon-button" type="button" onClick={() => removeRow(index)}>
                        <MaterialIcon className="icon-button__icon" name="delete_outline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      </section>

      <footer className="fund-footer">
        <div className="fund-footer__meta">
          <div>
            <div className="section-eyebrow">汇总记录</div>
            <div className="fund-footer__value">{summary.recordCount} 条识别记录</div>
          </div>
          <div className="fund-footer__divider" />
          <div>
            <div className="section-eyebrow">预估处理金额</div>
            <div className="fund-footer__value fund-footer__value--primary">{formatCurrency(summary.processedAmount, '¥ ')}</div>
          </div>
          <div className="fund-footer__divider" />
          <div>
            <div className="section-eyebrow">真实额外收益</div>
            <div className={summary.switchAdvantage >= 0 ? 'fund-footer__value fund-footer__value--success' : 'fund-footer__value fund-footer__value--warning'}>
              {formatCurrency(summary.switchAdvantage, '¥ ')}
            </div>
          </div>
        </div>
        <div className="fund-footer__actions">
          <button className="button-outline" type="button">取消导入</button>
          <button className="button-primary" type="button">
            确认导入并计算收益
            <MaterialIcon className="icon-button__icon" name="arrow_forward" />
          </button>
        </div>
      </footer>
    </WorkspaceShell>
  );
}
