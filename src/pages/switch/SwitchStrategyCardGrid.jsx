import { Plus } from 'lucide-react';
import { SwitchStrategyCardItem } from './SwitchStrategyCardItem.jsx';

// 看板视图：App 端单列、平板两列、PC（≥1024px）三列。
export function SwitchStrategyCardGrid({ rows, busyRuleId = '', onToggle, onEdit, onDuplicate, onDelete, onBacktest, onQuickTrade, onCreate }) {
  return (
    <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <SwitchStrategyCardItem
          key={row.id}
          row={row}
          busy={busyRuleId === row.id}
          onToggle={() => onToggle?.(row)}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onBacktest={onBacktest}
          onQuickTrade={onQuickTrade}
        />
      ))}
      {onCreate ? (
        <button
          type="button"
          onClick={onCreate}
          className="flex min-h-[160px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-6 text-center transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
            <Plus className="h-5 w-5" />
          </span>
          <span className="text-sm font-bold text-slate-900">新建切换方案</span>
          <span className="text-xs text-slate-500">配置 H / L 双腿与双向阈值</span>
        </button>
      ) : null}
    </div>
  );
}

export default SwitchStrategyCardGrid;
