import { IconArrowDown, IconArrowUp, IconChartBar, IconChevronRight } from '@tabler/icons-react';
import { TodaySignalPanel } from '../holdings/TodaySignalPanel.jsx';

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '暂无数据';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function RankingRow({ row, kind, onOpen }) {
  const positive = Number(row.changePercent) > 0;
  const percentage = kind === 'movers' ? row.changePercent : row.drawdownPercent;
  return (
    <button type="button" className="portal-ranking-row" onClick={() => onOpen?.(row.symbol)}>
      <div className="portal-ranking-row__name">
        <strong>{row.symbol}</strong>
        <span>{row.name}</span>
      </div>
      <span className={kind === 'movers' ? (positive ? 'portal-value--rise' : 'portal-value--fall') : 'portal-value--muted'}>
        {kind === 'movers' ? (positive ? <IconArrowUp aria-hidden="true" /> : <IconArrowDown aria-hidden="true" />) : null}
        {formatPercent(percentage)}
      </span>
    </button>
  );
}

function RankingCard({ title, rows, kind, onMore, onOpen }) {
  return (
    <section className="portal-ranking-card" aria-labelledby={`portal-ranking-${kind}`}>
      <div className="portal-card-heading">
        <h3 id={`portal-ranking-${kind}`}>{title}</h3>
        <button type="button" onClick={onMore}>更多 <IconChevronRight aria-hidden="true" /></button>
      </div>
      {rows.length ? rows.map((row) => <RankingRow key={row.symbol} row={row} kind={kind} onOpen={onOpen} />) : (
        <div className="portal-empty-row">暂无可用数据</div>
      )}
    </section>
  );
}

function DrawdownCard({ rows, onMore, onOpen }) {
  return (
    <section className="portal-ranking-card" aria-labelledby="portal-ranking-drawdown">
      <div className="portal-card-heading">
        <h3 id="portal-ranking-drawdown">回撤深度榜</h3>
        <button type="button" onClick={onMore}>更多 <IconChevronRight aria-hidden="true" /></button>
      </div>
      {rows.length ? rows.map((row) => (
        <button type="button" className="portal-drawdown-row" key={row.symbol} onClick={() => onOpen?.(row.symbol)}>
          <div className="portal-drawdown-row__label">
            <span>{row.symbol} {row.name}</span>
            <strong>{formatPercent(row.drawdownPercent)}</strong>
          </div>
          <div className="portal-drawdown-row__track" aria-hidden="true"><span style={{ width: `${row.drawdownWidth}%` }} /></div>
        </button>
      )) : <div className="portal-empty-row">缺少高点缓存，暂不展示</div>}
    </section>
  );
}

function ExecutionCard({ stats }) {
  const values = [
    { key: 'strategies', label: '策略', value: stats.find((item) => item.key === 'strategies')?.value || 0 },
    { key: 'holdings', label: '持仓', value: stats.find((item) => item.key === 'holdings')?.value || 0 },
    { key: 'signals', label: '信号', value: stats.find((item) => item.key === 'signals')?.value || 0 },
  ];
  return (
    <section className="portal-ranking-card portal-execution-card" aria-labelledby="portal-execution-title">
      <div className="portal-card-heading">
        <h3 id="portal-execution-title">策略执行统计</h3>
        <IconChartBar aria-hidden="true" />
      </div>
      <div className="portal-execution-card__grid">
        {values.map((item) => <div key={item.key}><strong>{item.value}</strong><span>{item.label}</span></div>)}
      </div>
    </section>
  );
}

export function PortalRankings({ todaySignals, rankings, stats, onOpenTab, onOpenMarket }) {
  const goMarkets = () => onOpenTab?.('markets');
  return (
    <section className="portal-insights" aria-label="今日信号与市场极值">
      <div className="portal-insights-grid">
        <div className="portal-signal-card">
          <TodaySignalPanel {...todaySignals} />
        </div>
        <div className="portal-side-stack">
          <RankingCard title="涨跌幅榜" rows={rankings.movers} kind="movers" onMore={goMarkets} onOpen={onOpenMarket} />
          <DrawdownCard rows={rankings.drawdowns} onMore={goMarkets} onOpen={onOpenMarket} />
          <ExecutionCard stats={stats} />
        </div>
      </div>
    </section>
  );
}
