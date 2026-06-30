import { HelpCircle } from 'lucide-react';

/**
 * 转换分析快速提示卡片（精简版，用于页面顶部）
 */
export function FundSwitchQuickTip() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <HelpCircle className="h-5 w-5 flex-shrink-0 text-slate-400" />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium text-slate-700">💡 使用提示</p>
        <p className="text-sm leading-relaxed text-slate-600">
          输入当前持有的基金代码，系统会自动分析转换收益。切换“转换链”可查看多个基金之间的转换关系。
        </p>
      </div>
    </div>
  );
}
