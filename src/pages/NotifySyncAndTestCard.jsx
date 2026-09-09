import { ChevronDown, ChevronUp, RefreshCw, Send, Zap } from 'lucide-react';
import { cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

export function NotifySyncAndTestCard({
  rulesLastSyncedLabel,
  isSyncingRules,
  onSyncRules,
  onOpenTestDialog,
  expanded,
  onToggleExpand
}) {
  return (
    <section data-scroll-card="true" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-4 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex min-w-0 items-start gap-3 text-left"
          aria-expanded={expanded}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
            <Zap className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-base font-bold text-slate-900 sm:text-lg">快捷操作</span>
              {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">上次规则同步：{rulesLastSyncedLabel}</span>
          </span>
        </button>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button
            type="button"
            className={cx(secondaryButtonClass, 'min-h-10 px-3 text-xs sm:text-sm', isSyncingRules && 'cursor-not-allowed opacity-60')}
            onClick={onSyncRules}
            disabled={isSyncingRules}
          >
            <RefreshCw className={cx('h-4 w-4', isSyncingRules && 'animate-spin')} />
            {isSyncingRules ? '正在同步' : '同步规则'}
          </button>
          <button
            type="button"
            className={cx(primaryButtonClass, 'min-h-10 px-3 text-xs sm:text-sm')}
            onClick={onOpenTestDialog}
          >
            <Send className="h-4 w-4" />
            发送测试
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="grid gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-4 sm:grid-cols-2 sm:px-6">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <RefreshCw className="h-4 w-4 text-indigo-500" />
              规则同步
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">把本机交易计划、定投和预警规则更新到云端。日常编辑会自动同步，这里用于手动补同步。</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Send className="h-4 w-4 text-violet-500" />
              送达测试
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">选择一条已启用规则并发送测试，快速检查当前账号下所有已连接渠道。</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
