import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  History,
  Inbox,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { Pill, cx } from '../components/experience-ui.jsx';

function safeTimestamp(value = '') {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTone(tone = '', status = '') {
  if (tone === 'rose') return 'red';
  if (tone) return tone;
  if (status === 'delivered') return 'emerald';
  if (status === 'failed') return 'red';
  if (status === 'queued') return 'amber';
  return 'slate';
}

export function NotifyHistoryCard({
  visibleEvents = [],
  eventsLoading,
  eventsError,
  eventsLastSyncedAt,
  refreshNotifyEvents,
  formatEventTimeLabel,
  resolveEventStatusMeta,
  expanded,
  onToggleExpand
}) {
  const sortedEvents = [...visibleEvents].sort((a, b) => safeTimestamp(b?.createdAt) - safeTimestamp(a?.createdAt));
  const deliveredCount = sortedEvents.filter((event) => String(event?.status || '') === 'delivered').length;
  const failedCount = sortedEvents.filter((event) => String(event?.status || '') === 'failed').length;
  const latestEvent = sortedEvents[0] || null;
  const eventsLastSyncedLabel = eventsLastSyncedAt
    ? formatEventTimeLabel(eventsLastSyncedAt)
    : '尚未拉取';
  const showEmpty = !eventsLoading && !eventsError && sortedEvents.length === 0;

  function getEventMeta(event) {
    const status = String(event?.status || '').trim();
    const meta = resolveEventStatusMeta
      ? resolveEventStatusMeta(status)
      : { tone: status === 'delivered' ? 'emerald' : status === 'failed' ? 'red' : 'slate', label: status || '未知' };
    return {
      ...meta,
      tone: normalizeTone(meta?.tone, status),
      label: meta?.label || status || '未知'
    };
  }

  return (
    <section data-scroll-card="true" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full min-w-0 items-center justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-slate-50 sm:px-6"
        aria-expanded={expanded}
        aria-label="展开或收起送达记录"
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
            <History className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-slate-900 sm:text-lg">送达记录</span>
              <Pill tone={failedCount > 0 ? 'red' : sortedEvents.length > 0 ? 'emerald' : 'slate'}>
                {sortedEvents.length} 条
              </Pill>
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">
              已送达 {deliveredCount} · 失败 {failedCount} · 上次刷新 {eventsLastSyncedLabel}
            </span>
          </span>
        </span>
        {expanded ? <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />}
      </button>

      {!expanded && latestEvent ? (
        <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0 truncate text-slate-600">
            <span className="mr-2 font-semibold text-slate-800">最近：</span>
            {latestEvent?.title || latestEvent?.summary || latestEvent?.eventType || '未命名事件'}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Pill tone={getEventMeta(latestEvent).tone} className="px-2 py-1 text-[10px]">{getEventMeta(latestEvent).label}</Pill>
            <span className="text-slate-400">{formatEventTimeLabel(latestEvent?.createdAt)}</span>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-5 sm:px-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs leading-5 text-slate-500">查看业务通知的送达结果与渠道明细。</p>
            <button
              type="button"
              className={cx(
                'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
                eventsLoading && 'cursor-not-allowed opacity-60'
              )}
              onClick={refreshNotifyEvents}
              disabled={eventsLoading}
            >
              {eventsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {eventsLoading ? '正在刷新' : '刷新'}
            </button>
          </div>

          {eventsError ? (
            <div role="alert" className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{eventsError}</span>
            </div>
          ) : null}
          {showEmpty ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <Inbox className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">暂无推送记录</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">发送一条测试通知，或等待业务规则触发后即可在这里查看送达情况。</p>
            </div>
          ) : null}
          {sortedEvents.length > 0 ? (
            <ol className="space-y-3">
              {sortedEvents.map((event, index) => {
                const meta = getEventMeta(event);
                const timeLabel = formatEventTimeLabel(event?.createdAt);
                const title = String(event?.title || event?.summary || event?.eventType || '未命名事件');
                const summary = String(event?.summary || event?.body || '');
                const ruleId = String(event?.ruleId || '').trim();
                const channels = Array.isArray(event?.channels) ? event.channels : [];
                const key = `${event?.id || ''}-${event?.createdAt || ''}-${index}`;
                const delivered = String(event?.status || '') === 'delivered';
                return (
                  <li key={key} className="relative rounded-2xl border border-slate-200 bg-white px-4 py-4 sm:px-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={cx(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                          delivered ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                        )}>
                          {delivered ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">{title}</div>
                          {summary ? <p className="mt-1 text-xs leading-5 text-slate-500">{summary}</p> : null}
                          {ruleId ? <p className="mt-1 text-[11px] text-slate-400">规则：{ruleId}</p> : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pl-11 sm:pl-0">
                        <Pill tone={meta.tone}>{meta.label}</Pill>
                        <span className="whitespace-nowrap text-xs text-slate-400">{timeLabel}</span>
                      </div>
                    </div>
                    {channels.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2 pl-11">
                        {channels.map((channel, channelIndex) => {
                          const channelName = String(channel?.channel || '未知渠道').trim();
                          const channelStatus = String(channel?.status || '').trim();
                          const channelDetail = String(channel?.detail || '').trim();
                          const channelDelivered = channelStatus === 'delivered';
                          return (
                            <span
                              key={`${key}-channel-${channelIndex}`}
                              className={cx(
                                'inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px]',
                                channelDelivered ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                              )}
                              title={channelDetail || undefined}
                            >
                              <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', channelDelivered ? 'bg-emerald-500' : 'bg-slate-400')} />
                              <span className="truncate">{channelName}{channelStatus ? ` · ${channelStatus}` : ''}</span>
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
          <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">测试通知只保留 30 分钟，超过后会从列表中自动移除。</p>
        </div>
      ) : null}
    </section>
  );
}
