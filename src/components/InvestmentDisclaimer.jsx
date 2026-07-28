import { cx } from './experience-ui.jsx';

export function InvestmentDisclaimer({ className = '' }) {
  return (
    <div className={cx(
      'flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800',
      className
    )}>
      <span className="shrink-0">⚠️</span>
      <span>本工具数据仅供参考，不构成投资建议。投资有风险，请独立判断并自行承担决策结果。</span>
    </div>
  );
}

export default InvestmentDisclaimer;
