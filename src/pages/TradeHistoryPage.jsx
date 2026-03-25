import { useMemo } from 'react';
import { buildStages, defaultAccumulationState, formatCurrency, readAccumulationState } from '../app/accumulation.js';
import { pageLinks } from '../app/links.js';
import { AppShell } from '../components/AppShell.jsx';
import { StatCard } from '../components/StatCard.jsx';

const sampleHistory = [
  { date: '2026-03-22', type: '买入', shares: 8.4, price: 573.18, status: '已成交' },
  { date: '2026-03-15', type: '买入', shares: 9.7, price: 559.21, status: '已成交' },
  { date: '2026-03-01', type: '买入', shares: 10.2, price: 601.3, status: '已成交' },
  { date: '2026-02-11', type: '观察', shares: 0, price: 548.4, status: '未触发' }
];

export function TradeHistoryPage() {
  const stored = readAccumulationState();
  const effective = stored?.weights ? stored : defaultAccumulationState;
  const computed = useMemo(() => buildStages(effective), [effective]);
  const totalShares = sampleHistory.reduce((sum, row) => sum + row.shares, 0);

  return (
    <AppShell
      activeTab="accumEdit"
      sideNav={{
        title: '加仓模块',
        subtitle: '统一策略架构',
        items: [
          { label: '策略概览', icon: '▣', href: pageLinks.home },
          { label: '加仓配置', icon: '◉', href: pageLinks.accumEdit },
          { label: '交易历史', icon: '↺', href: pageLinks.history, active: true },
          { label: '风险提示', icon: '!', href: pageLinks.catalog }
        ],
        footer: <a className="side-nav__cta" href={pageLinks.accumEdit}>返回加仓配置</a>
      }}
      headerMeta={[
        { label: '标的', value: effective.symbol },
        { label: '记录数', value: `${sampleHistory.length} 条` },
        { label: '状态', value: '已同步' }
      ]}
    >
      <section className="page-section page-section--hero">
        <div>
          <div className="page-eyebrow">共享顶栏与布局</div>
          <h1 className="page-title">{effective.symbol} 交易历史</h1>
          <p className="page-copy">这页和加仓配置页共用同一套顶栏、导航配置和页面壳层。后续再扩展页面时，不需要继续复制整张 HTML。</p>
        </div>
        <div className="hero-grid">
          <StatCard label="累计股数" value={`${totalShares.toFixed(2)} 股`} note="基于最近交易记录" tone="primary" />
          <StatCard label="平均成本" value={formatCurrency(computed.averageCost)} note="来自加仓配置共享状态" />
          <StatCard label="总投入预算" value={formatCurrency(effective.totalCapital)} note={`分为 ${computed.stages.length} 个层级执行`} />
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel__header">
          <div>
            <div className="panel__eyebrow">交易明细</div>
            <h2 className="panel__title">最近执行记录</h2>
          </div>
          <div className="panel__actions">
            <button className="ghost-button" type="button">导出报告</button>
            <button className="ghost-button" type="button">筛选日期</button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>类型</th>
              <th>数量</th>
              <th>价格</th>
              <th>金额</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {sampleHistory.map((row) => (
              <tr key={`${row.date}-${row.type}`}>
                <td>{row.date}</td>
                <td>{row.type}</td>
                <td>{row.shares > 0 ? `${row.shares.toFixed(2)} 股` : '-'}</td>
                <td>{formatCurrency(row.price)}</td>
                <td>{row.shares > 0 ? formatCurrency(row.shares * row.price) : '-'}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="content-grid content-grid--history">
        <section className="panel">
          <div className="panel__header">
            <div>
              <div className="panel__eyebrow">层级快照</div>
              <h2 className="panel__title">当前加仓模型</h2>
            </div>
          </div>
          <div className="history-stage-grid">
            {computed.stages.map((stage) => (
              <article key={stage.id} className="history-stage-card">
                <div className="history-stage-card__label">{stage.label}</div>
                <strong>{formatCurrency(stage.price)}</strong>
                <span>{formatCurrency(stage.amount)} / {stage.weightPercent.toFixed(1)}%</span>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel__header">
            <div>
              <div className="panel__eyebrow">复盘备注</div>
              <h2 className="panel__title">执行观察</h2>
            </div>
          </div>
          <ul className="bullet-list">
            <li>顶栏已经与加仓配置页统一为同一套主导航，避免页面之间切换时视觉断层。</li>
            <li>历史页摘要卡直接读取共享的加仓状态，所以预算、平均成本和层级数量会跟配置页保持一致。</li>
            <li>后续如果要继续迁移更多 Stitch 页面，只需要复用这套布局和数据模块，不需要再复制整页 HTML。</li>
          </ul>
        </section>
      </section>
    </AppShell>
  );
}
