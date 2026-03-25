import { buildStages, formatCurrency, readAccumulationState } from '../app/accumulation.js';
import { createTopTabs } from '../app/screens.js';
import { MaterialIcon } from '../components/MaterialIcon.jsx';
import { MetricCard, SurfaceCard, WorkspaceShell } from '../components/PageChrome.jsx';

const sampleHistory = [
  { date: '2024-03-25', type: '买入', shares: 10, price: 445.2, status: '已提交' },
  { date: '2024-03-18', type: '买入', shares: 15, price: 431.1, status: '已提交' },
  { date: '2024-03-11', type: '卖出', shares: 5, price: 445.5, status: '已完成' },
  { date: '2024-03-04', type: '买入', shares: 22, price: 425.8, status: '已提交' },
  { date: '2024-02-26', type: '买入', shares: 12, price: 432.4, status: '已提交' }
];

const SIDEBAR_ITEMS = [
  { label: 'Dashboard', icon: 'dashboard' },
  { label: 'Portfolio', icon: 'account_balance_wallet' },
  { label: 'Transactions', icon: 'receipt_long' },
  { label: 'Strategy', icon: 'monitoring', active: true },
  { label: 'Settings', icon: 'settings' }
];

export function HistoryExperience({ screen, links, inPagesDir }) {
  const accumulationState = readAccumulationState();
  const accumulation = buildStages(accumulationState);
  const totalShares = sampleHistory.reduce((sum, row) => sum + row.shares, 0);
  const totalInvestment = sampleHistory.reduce((sum, row) => sum + row.shares * row.price, 0);
  const tabs = createTopTabs({ inPagesDir });

  return (
    <WorkspaceShell
      activeTab="accumEdit"
      tabs={tabs}
      headerRight={
        <>
          <button className="icon-button" type="button">
            <MaterialIcon className="icon-button__icon" name="search" />
          </button>
          <button className="icon-button" type="button">
            <MaterialIcon className="icon-button__icon" name="notifications" />
          </button>
          <div className="avatar">AT</div>
        </>
      }
      sidebar={
        <>
          <div className="sidebar-brand-card">
            <div className="sidebar-brand-card__mark">
              <MaterialIcon filled name="account_balance" />
            </div>
            <div>
              <div className="sidebar-brand-card__title">Axiom Trade</div>
              <div className="sidebar-brand-card__meta">Financial Architect</div>
            </div>
          </div>

          <div className="sidebar-menu">
            {SIDEBAR_ITEMS.map((item) => (
              <a key={item.label} className={item.active ? 'sidebar-menu__item is-active' : 'sidebar-menu__item'} href={links.history}>
                <MaterialIcon className="sidebar-menu__icon" name={item.icon} />
                <span>{item.label}</span>
              </a>
            ))}
          </div>

          <div className="sidebar-footer">
            <a className="button-primary button-full" href={links.accumNew}>
              <MaterialIcon className="icon-button__icon" name="add" />
              New Transaction
            </a>
          </div>
        </>
      }
    >
      <section className="page-header">
        <div>
          <div className="page-breadcrumb">
            <MaterialIcon className="icon-button__icon" name="arrow_back" />
            <span>QQQ 交易历史</span>
          </div>
          <h1 className="page-title page-title--compact">{screen.title}</h1>
        </div>
        <div className="page-header__actions">
          <span className="asset-chip">
            <span className="asset-chip__dot" />
            QQQ (纳斯达克100 ETF)
          </span>
          <button className="icon-button" type="button">
            <MaterialIcon className="icon-button__icon" name="search" />
          </button>
          <button className="icon-button" type="button">
            <MaterialIcon className="icon-button__icon" name="more_vert" />
          </button>
        </div>
      </section>

      <section className="history-stats">
        <MetricCard label="总累积股数" note="最近执行记录汇总" value={`${totalShares.toFixed(2)} 股`} />
        <MetricCard label="平均买入价格" note="历史成交均价" value={formatCurrency(totalInvestment / Math.max(totalShares, 1))} />
        <MetricCard accent="primary" label="总购买金额" note="共享建仓状态同步" value={formatCurrency(totalInvestment)} />
      </section>

      <SurfaceCard>
        <div className="section-header">
          <div>
            <div className="section-eyebrow">历史记录</div>
            <h2 className="section-title">最近执行记录</h2>
          </div>
          <div className="page-header__actions">
            <button className="button-secondary" type="button">年份筛选</button>
            <button className="button-secondary" type="button">筛选日期</button>
          </div>
        </div>
        <table className="history-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>类型</th>
              <th>数量</th>
              <th>单价</th>
              <th>总金额</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sampleHistory.map((row) => (
              <tr key={`${row.date}-${row.type}-${row.price}`}>
                <td>{row.date}</td>
                <td>{row.type}</td>
                <td>{`${row.shares.toFixed(2)} 股`}</td>
                <td>{formatCurrency(row.price)}</td>
                <td>{formatCurrency(row.shares * row.price)}</td>
                <td>
                  <span className={row.type === '卖出' ? 'history-table__status history-table__status--watch' : 'history-table__status history-table__status--buy'}>
                    {row.status}
                  </span>
                </td>
                <td>
                  <MaterialIcon className="table-chevron" name="chevron_right" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="table-note" style={{ marginTop: 12 }}>显示 1-5 条，共 {sampleHistory.length} 条记录</div>
      </SurfaceCard>

      <section className="history-bottom">
        <SurfaceCard className="dark-promo">
          <div className="section-eyebrow">价值趋势分析</div>
          <h2 className="promo-card__title">价值趋势分析</h2>
          <p className="promo-card__copy">查看您在不同买入区间的执行密度，以及历史成交对当前平均成本的影响。</p>
        </SurfaceCard>

        <SurfaceCard className="promo-blue">
          <div className="section-eyebrow">金字塔加仓建议</div>
          <h2 className="promo-card__title">金字塔加仓建议</h2>
          <p className="promo-card__copy">
            基于您过去 5 次买入操作，当前阶段性加仓仍然偏向第二和第三层。建议保留对 {formatCurrency(accumulation.stages[1]?.price ?? accumulationState.basePrice)} 的观察仓位。
          </p>
          <div className="promo-card__action">
            <a className="button-secondary" href={links.accumEdit}>查看当前建仓计划</a>
          </div>
        </SurfaceCard>
      </section>
    </WorkspaceShell>
  );
}
