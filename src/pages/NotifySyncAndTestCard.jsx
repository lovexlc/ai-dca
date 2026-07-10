import { RefreshCw, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { cx, secondaryButtonClass } from '../components/experience-ui.jsx';

export function NotifySyncAndTestCard({
  rulesLastSyncedLabel,
  isSyncingRules,
  onSyncRules,
  onOpenTestDialog,
  expanded,
  onToggleExpand
}) {
  return (
    <div className="notify-sync-surface rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        onClick={onToggleExpand}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-slate-50"
      >
        <div>
          <h3 className="text-base font-semibold text-slate-900">规则同步与测试</h3>
          <p className="mt-1 text-sm text-slate-500">
            同步规则到云端，或发送测试通知验证配置
          </p>
        </div>
        {expanded ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-6 py-4">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700">同步通知规则</p>
                <p className="mt-1 text-xs text-slate-500">
                  上次同步：{rulesLastSyncedLabel}
                </p>
              </div>
              <button
                type="button"
                className={cx(secondaryButtonClass, isSyncingRules && 'cursor-not-allowed opacity-60')}
                onClick={onSyncRules}
                disabled={isSyncingRules}
              >
                <RefreshCw size={16} />
                {isSyncingRules ? '正在同步' : '立即同步'}
              </button>
            </div>

            <div className="h-px bg-slate-200"></div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700">发送测试通知</p>
                <p className="mt-1 text-xs text-slate-500">
                  选择规则并发送测试通知到所有渠道
                </p>
              </div>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={onOpenTestDialog}
              >
                <Send size={16} />
                测试通知
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
