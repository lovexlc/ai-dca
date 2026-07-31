const PUBLIC_METRICS = [
  { key: 'configuredStrategyCount', label: '全站策略配置数' },
  { key: 'notifiedStrategyCount', label: '累计已通知策略数' },
  { key: 'todayTriggeredStrategyCount', label: '今日触发策略数' }
];

const PERSONAL_METRICS = [
  { key: 'configuredStrategyCount', label: '我的策略配置数' },
  { key: 'notifiedStrategyCount', label: '我已收到通知的策略数' },
  { key: 'todayTriggeredStrategyCount', label: '我今日触发的策略数' }
];

function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number.toLocaleString('zh-CN') : '暂缺';
}

export function PortalSummary({ data = null, loading = false, error = '' }) {
  const personal = data?.scope === 'personal';
  const metrics = personal ? PERSONAL_METRICS : PUBLIC_METRICS;
  return (
    <section className="portal-summary" aria-labelledby="portal-summary-title" aria-busy={loading}>
      <div className="portal-summary__heading">
        <div>
          <h2 id="portal-summary-title">策略正在被使用</h2>
          <p>汇总全站策略配置、通知记录与今日触发情况。</p>
        </div>
        <span className="portal-summary__scope">{personal ? '我的汇总' : '全站汇总'}</span>
      </div>
      <div className="portal-summary__metrics">
        {metrics.map((metric) => (
          <div key={metric.key} className="portal-summary__metric">
            <strong className={loading && !data ? 'portal-summary__value portal-summary__value--loading' : 'portal-summary__value'}>
              {loading && !data ? ' ' : formatCount(data?.[metric.key])}
            </strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>
      {error ? <span className="portal-summary__status" role="status">部分统计暂不可用</span> : null}
    </section>
  );
}
