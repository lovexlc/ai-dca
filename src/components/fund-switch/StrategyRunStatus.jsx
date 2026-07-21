import { Bell, CalendarClock, CheckCircle2, Loader2, Settings2 } from 'lucide-react';
import { SwitchButton } from './ui.jsx';

function formatRunTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function notificationLabel(status) {
  if (status === 'enabled') return '已开启推送通知';
  if (status === 'disabled') return '推送通知已关闭';
  if (status === 'unconfigured') return '未开启推送通知';
  return '通知状态未知';
}

export function StrategyRunStatus({
  latestRun,
  running = false,
  nextScheduledAt,
  scheduleStatus = 'unknown',
  notificationStatus = 'unknown',
  onOpenNotificationSettings
}) {
  const run = latestRun || {};
  const failed = run.status === 'failed' || run.error;
  const partial = run.status === 'partial';
  const success = run.successRuleCount ?? run.ruleCount ?? 0;
  const triggered = run.triggeredSignalCount ?? run.triggered ?? 0;
  const notTriggered = run.notTriggeredRuleCount ?? run.notTriggered ?? Math.max(0, success - triggered);
  const next = nextScheduledAt || run.nextScheduledAt;
  const scheduleText = scheduleStatus === 'disabled' ? '自动运行已关闭' : next ? `${formatRunTime(next)} 自动运行` : '等待首次运行';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="grid gap-4 md:grid-cols-3 md:divide-x md:divide-slate-100">
        <div className="min-w-0 md:pr-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            {running ? <Loader2 className="h-4 w-4 animate-spin text-indigo-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            运行结果
          </div>
          <div className={failed ? 'mt-2 text-lg font-bold text-rose-700' : partial ? 'mt-2 text-lg font-bold text-amber-700' : 'mt-2 text-lg font-bold text-slate-900'}>
            {running ? '正在检测…' : failed ? '检测失败' : latestRun ? '检测完成' : '暂无运行记录'}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>成功 {success} 条</span>
            <span>触发 {triggered} 条</span>
            <span>未触发 {notTriggered} 条</span>
            {run.failedRuleCount ? <span className="text-rose-600">失败 {run.failedRuleCount} 条</span> : null}
          </div>
          {run.finishedAt ? <div className="mt-2 text-xs text-slate-400">上次运行 {formatRunTime(run.finishedAt)}</div> : null}
          {run.stale ? <div className="mt-2 text-xs font-semibold text-amber-700">上次运行结果已过期</div> : null}
        </div>
        <div className="md:px-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <CalendarClock className="h-4 w-4 text-indigo-500" />
            下一次运行
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900">{scheduleText}</div>
          <div className="mt-2 text-xs text-slate-500">
            {scheduleStatus === 'enabled' ? '工作日交易时段自动分析全部启用规则' : '请先启用自动运行'}
          </div>
        </div>
        <div className="md:pl-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Bell className="h-4 w-4 text-indigo-500" />
            提醒设置
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900">{notificationLabel(notificationStatus)}</div>
          <div className="mt-2">
            <SwitchButton variant="secondary" className="border-indigo-200 px-4 py-2 text-xs text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50" onClick={onOpenNotificationSettings}>
              <Settings2 className="h-3.5 w-3.5" />
              设置提醒
            </SwitchButton>
          </div>
        </div>
      </div>
    </section>
  );
}
