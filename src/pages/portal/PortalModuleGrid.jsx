import {
  IconArrowsExchange,
  IconBell,
  IconChartBar,
  IconChartLine,
  IconSearch,
  IconSparkles,
  IconWallet,
} from '@tabler/icons-react';

const MODULES = [
  { key: 'markets', label: '市场行情', description: '实时价格、涨跌与指数动向', Icon: IconChartLine },
  { key: 'holdings', label: '持仓与收益', description: '交易记录与收益看板', Icon: IconWallet },
  { key: 'fundSwitch', label: '策略配置', description: '设置换仓与出场规则', Icon: IconSparkles },
  { key: 'backtest', label: '策略回测', description: '用历史数据验证策略表现', Icon: IconChartBar },
  { key: 'notify', label: '交易提醒', description: '接收策略与持仓异动通知', Icon: IconBell },
  { key: 'markets', label: '基金搜索', description: '按代码或名称快速检索', Icon: IconSearch },
];

export function PortalModuleGrid({ onOpenTab, onSearch }) {
  return (
    <section className="portal-modules" aria-labelledby="portal-modules-title">
      <div className="portal-section-heading">
        <div>
          <h2 id="portal-modules-title">探索全部功能</h2>
          <p>从行情监控到策略回测，一站式管理场内基金轮动。</p>
        </div>
      </div>
      <div className="portal-module-grid">
        {MODULES.map(({ key, label, description, Icon }, index) => (
          <button
            key={`${key}-${label}`}
            type="button"
            className="portal-module-card"
            onClick={() => (label === '基金搜索' ? onSearch?.() : onOpenTab?.(key))}
          >
            <span className="portal-module-card__icon"><Icon aria-hidden="true" /></span>
            <span className="portal-module-card__label">{label}</span>
            <span className="portal-module-card__description">{description}</span>
            {index === 0 ? <IconArrowsExchange className="portal-module-card__arrow" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
    </section>
  );
}
