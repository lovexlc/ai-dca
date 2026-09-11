import { AlertTriangle, CheckCircle2, Clock3, Inbox, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';

function safeTimestamp(value = '') { const parsed = Date.parse(String(value || '')); return Number.isFinite(parsed) ? parsed : 0; }

function channelLabel(channel) {
  const value = String(channel || '').toLowerCase();
  if (value.includes('bark') || value.includes('ios')) return 'iOS';
  if (value.includes('server') || value.includes('android')) return 'Android';
  if (value.includes('mail')) return 'Email';
  if (value.includes('pc') || value.includes('web')) return 'PC';
  return channel || '—';
}

function eventTypeLabel(event) {
  const type = String(event?.eventType || '').toLowerCase();
  if (type.includes('price')) return '价格提醒';
  if (type.includes('premium')) return '溢价提醒';
  if (type.includes('dca')) return '定投提醒';
  if (type.includes('announce')) return '公告提醒';
  if (type.includes('holding')) return '持仓提醒';
  if (type.includes('test')) return '测试通知';
  return event?.strategyName || event?.eventType || '业务通知';
}

export function NotifyHistoryCard({ visibleEvents = [], eventsLoading, eventsError, eventsLastSyncedAt, refreshNotifyEvents, formatEventTimeLabel, expanded, onToggleExpand }) {
  const events = [...visibleEvents].sort((a, b) => safeTimestamp(b?.createdAt) - safeTimestamp(a?.createdAt));
  const latest = events.slice(0, 6);
  const lastSynced = eventsLastSyncedAt ? formatEventTimeLabel(eventsLastSyncedAt) : '尚未拉取';

  return (
    <section data-scroll-card="true" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h2 className="text-lg font-bold text-slate-950">送达记录</h2><p className="mt-1 text-sm text-slate-500">查看最近的通知推送记录，方便排查和确认。</p></div>
        <div className="flex items-center gap-2"><button type="button" onClick={onToggleExpand} className="min-h-9 rounded-lg px-3 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">{expanded ? '收起记录' : '查看全部记录'} →</button><button type="button" onClick={refreshNotifyEvents} disabled={eventsLoading} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-indigo-200 hover:text-indigo-600" aria-label="刷新送达记录">{eventsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button></div>
      </div>

      {eventsError ? <div role="alert" className="mx-5 mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4" />{eventsError}</div> : null}

      <div className="overflow-x-auto border-t border-slate-100">
        <div className="grid min-w-[840px] grid-cols-[170px_150px_minmax(330px,1fr)_150px_130px_80px] bg-slate-50/80 px-5 py-2.5 text-xs font-semibold text-slate-500"><span>时间</span><span>事件类型</span><span>内容</span><span>发送渠道</span><span>状态</span><span className="text-right">操作</span></div>
        {latest.map((event, index) => {
          const status = String(event?.status || '');
          const delivered = status === 'delivered';
          const failed = status === 'failed';
          const channels = Array.isArray(event?.channels) ? event.channels : [];
          const channel = channelLabel(channels[0]?.channel || event?.channel || '');
          const key = `${event?.id || ''}-${event?.createdAt || ''}-${index}`;
          return <div key={key} className="grid min-w-[840px] grid-cols-[170px_150px_minmax(330px,1fr)_150px_130px_80px] items-center border-t border-slate-100 px-5 py-3 text-xs">
            <span className="tabular-nums text-slate-500">{formatEventTimeLabel(event?.createdAt)}</span>
            <span className="font-medium text-slate-700">{eventTypeLabel(event)}</span>
            <span className="truncate pr-5 text-slate-600" title={event?.summary || event?.body || event?.title}>{event?.summary || event?.body || event?.title || '—'}</span>
            <span className="text-slate-600">{channel}</span>
            <span className={cx('inline-flex w-fit items-center gap-1.5 font-medium', delivered ? 'text-emerald-600' : failed ? 'text-rose-600' : 'text-amber-600')}>{delivered ? <CheckCircle2 className="h-4 w-4" /> : failed ? <XCircle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}{delivered ? '发送成功' : failed ? '发送失败' : '处理中'}</span>
            <button type="button" className="justify-self-end rounded-lg px-2 py-1.5 font-semibold text-indigo-600 hover:bg-indigo-50">详情</button>
          </div>;
        })}
        {!eventsLoading && !latest.length ? <div className="flex min-h-28 items-center justify-center gap-2 border-t border-slate-100 text-sm text-slate-500"><Inbox className="h-5 w-5 text-slate-300" />暂无推送记录</div> : null}
      </div>
      <div className="border-t border-slate-100 px-5 py-2 text-right text-[11px] text-slate-400">上次刷新：{lastSynced} · 测试通知保留 30 分钟</div>
    </section>
  );
}
