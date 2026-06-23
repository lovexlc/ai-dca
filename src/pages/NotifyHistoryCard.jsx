import { History, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, Pill, cx, secondaryButtonClass } from '../components/experience-ui.jsx';

export function NotifyHistoryCard({
  visibleEvents,
  eventsLoading,
  eventsError,
  eventsLastSyncedAt,
  refreshNotifyEvents,
  formatEventTimeLabel,
  resolveEventStatusMeta,
  expanded,
  onToggleExpand
}) {
  const eventsLastSyncedLabel = eventsLastSyncedAt
    ? formatEventTimeLabel(eventsLastSyncedAt)
    : '尚未拉取';
  const showEmpty = !eventsLoading && !eventsError && visibleEvents.length === 0;

  return (
    <Card>
      <button
        onClick={onToggleExpand}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
            <History className="h-3.5 w-3.5 text-slate-400" />
            提醒历史
          </div>
          <div className="mt-1 text-base font-bold text-slate-900 sm:text-lg">最近推送记录</div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            集中展示交易计划与定投提醒的推送记录。测试通知仅保留 30 分钟，超过后从列表中自动移除。
          </p>
        </div>
        {expanded ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
      </button>

      {expanded && (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-400">上次拉取：{eventsLastSyncedLabel}</p>
            <button
              type="button"
              className={cx(secondaryButtonClass, eventsLoading && 'cursor-not-allowed opacity-60')}
              onClick={(e) => {
                e.stopPropagation();
                refreshNotifyEvents();
              }}
              disabled={eventsLoading}
            >
              <RefreshCw className="h-4 w-4" />
              {eventsLoading ? '正在加载' : '刷新历史'}
            </button>
          </div>
      {eventsError ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {eventsError}
        </div>
      ) : null}
      {showEmpty ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          暂无推送记录。发出测试通知或等待交易计划规则触发后可在此查看。
        </p>
      ) : null}
      {visibleEvents.length ? (
        <ul className="mt-4 space-y-2">
          {visibleEvents.map((event, index) => {
            const statusKey = String(event?.status || '').trim();
            const meta = resolveEventStatusMeta
              ? resolveEventStatusMeta(statusKey)
              : { tone: statusKey === 'delivered' ? 'emerald' : 'rose', label: statusKey || '未知' };
            const timeLabel = formatEventTimeLabel(event?.createdAt);
            const title = String(event?.title || event?.summary || event?.eventType || '未命名事件');
            const summary = String(event?.summary || event?.body || '');
            const ruleId = String(event?.ruleId || '').trim();
            const channelDetails = Array.isArray(event?.channels)
              ? event.channels
                .map((channel) => {
                  const name = String(channel?.channel || '').trim();
                  const status = String(channel?.status || '').trim();
                  const detail = String(channel?.detail || '').trim();
                  return [name, status, detail].filter(Boolean).join(' · ');
                })
                .filter(Boolean)
              : [];
            const key = `${event?.id || ''}-${event?.createdAt || ''}-${index}`;
            return (
              <li key={key} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-sm font-semibold text-slate-800">{title}</div>
                  <div className="flex items-center gap-2">
                    <Pill tone={meta?.tone || 'slate'}>{meta?.label || event?.status || '未知'}</Pill>
                    <span className="text-xs text-slate-400">{timeLabel}</span>
                  </div>
                </div>
                {summary ? (
                  <p className="mt-1 text-xs leading-5 text-slate-500">{summary}</p>
                ) : null}
                {ruleId ? (
                  <p className="mt-1 text-[11px] text-slate-400">规则标识：{ruleId}</p>
                ) : null}
                {channelDetails.length ? (
                  <div className="mt-2 space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
                    {channelDetails.map((detail, detailIndex) => (
                      <div key={`${key}-channel-${detailIndex}`} className="break-words">{detail}</div>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
        </>
      )}
    </Card>
  );
}
