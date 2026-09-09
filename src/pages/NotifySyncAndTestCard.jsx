import { ArrowRight, ChevronDown, ChevronUp, RefreshCw, Send, Zap } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';

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
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full min-w-0 items-center justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-slate-50 sm:px-6"
        aria-expanded={expanded}
        aria-label="展开或收起快捷操作"
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
            <Zap className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-bold text-slate-900 sm:text-lg">快捷操作</span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">上次规则同步：{rulesLastSyncedLabel}</span>
          </span>
        </span>
        {expanded ? <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />}
      </button>

      {expanded ? (
        <div className="grid gap-3 border-t border-slate-100 bg-slate-50/50 p-4 sm:grid-cols-2 sm:px-6 sm:py-5">
          <button
            type="button"
            className={cx(
              'group flex min-h-[88px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition-all hover:border-indigo-200 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
              isSyncingRules && 'cursor-not-allowed opacity-60'
            )}
            onClick={onSyncRules}
            disabled={isSyncingRules}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <RefreshCw className={cx('h-4 w-4', isSyncingRules && 'animate-spin')} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">{isSyncingRules ? '正在同步规则' : '同步通知规则'}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">将本机交易计划、定投与预警规则补同步到云端。</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
          </button>

          <button
            type="button"
            className="group flex min-h-[88px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition-all hover:border-violet-200 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            onClick={onOpenTestDialog}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Send className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">发送送达测试</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">选择已启用规则，检查当前账号的全部接收渠道。</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-violet-500" />
          </button>
        </div>
      ) : null}
    </section>
  );
}
