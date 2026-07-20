import { Loader2, Play, RefreshCw } from 'lucide-react';
import { SwitchButton } from './ui.jsx';

export function StrategyRunStatus({ latestRun, running = false, onRun, onRetry }) {
  if (running)
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-4 text-sm font-semibold text-indigo-700">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在检测...
      </div>
    );
  const failed = latestRun?.status === 'failed' || latestRun?.error;
  if (!latestRun)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
        <div>
          <div className="font-bold text-slate-900">还没有运行记录</div>
          <div className="mt-1 text-xs text-slate-500">手动跑一次会分析全部启用中的规则。</div>
        </div>
        <SwitchButton variant="secondary" onClick={onRun}>
          <Play className="h-4 w-4" />
          手动运行
        </SwitchButton>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <div>
        <div className={failed ? 'font-bold text-rose-700' : 'font-bold text-slate-900'}>
          {failed ? '检测失败' : '运行结果'}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>成功 {latestRun.successCount ?? latestRun.ruleCount ?? 0} 条</span>
          <span>触发 {latestRun.triggered ?? 0} 条</span>
          <span>
            未触发{' '}
            {latestRun.notTriggered ?? Math.max(0, (latestRun.ruleCount || 0) - (latestRun.triggered || 0))}{' '}
            条
          </span>
        </div>
        {latestRun.finishedAt ? (
          <div className="mt-1 text-xs text-slate-400">上次运行 {latestRun.finishedAt}</div>
        ) : null}
      </div>
      <SwitchButton variant="secondary" onClick={failed ? onRetry : onRun}>
        <RefreshCw className="h-4 w-4" />
        {failed ? '重新运行' : '手动运行'}
      </SwitchButton>
    </div>
  );
}
