import { AlertTriangle, CheckCircle2, Clock3, Inbox, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { cx } from '../components/experience-ui.jsx';
import { NotifyEventDetailDialog } from './NotifyEventDetailDialog.jsx';

function safeTimestamp(value = '') {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

const CHANNEL_MAP = {
  bark: { label: 'iOS', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  ios: { label: 'iOS', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  serverchan3: { label: '安卓', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  serverchan: { label: '安卓', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  android: { label: '安卓', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  email: { label: '邮箱', bg: 'bg-sky-50 text-sky-700 border-sky-200' },
  mail: { label: '邮箱', bg: 'bg-sky-50 text-sky-700 border-sky-200' },
  pc: { label: 'PC 浏览器', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
  web: { label: 'PC 浏览器', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
  ws: { label: 'PC 浏览器', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
};

function resolveChannelInfo(rawChannel) {
  const key = String(rawChannel || '').toLowerCase();
  for (const [prefix, info] of Object.entries(CHANNEL_MAP)) {
    if (key.includes(prefix)) return info;
  }
  return { label: rawChannel || '—', bg: 'bg-slate-100 text-slate-700 border-slate-200' };
}

function renderEventChannels(event) {
  const channels = Array.isArray(event?.channels) ? event.channels : [];
  // 优先提取真正已送达或排队中的渠道，自动过滤 skipped（未配置而跳过的渠道）
  const delivered = channels.filter((c) => c.status === 'delivered' || c.status === 'queued');
  const active = delivered.length > 0
    ? delivered
    : channels.filter((c) => c.status !== 'skipped');
  const list = active.length > 0 ? active : channels;

  if (!list.length) {
    const fallback = resolveChannelInfo(event?.channel);
    return (
      <span className={cx('inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold border', fallback.bg)}>
        {fallback.label}
      </span>
    );
  }

  // 按 label 去重并展示徽章
  const seen = new Set();
  const items = [];
  for (const c of list) {
    const info = resolveChannelInfo(c?.channel);
    if (!seen.has(info.label)) {
      seen.add(info.label);
      items.push(info);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((info) => (
        <span key={info.label} className={cx('inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold border', info.bg)}>
          {info.label}
        </span>
      ))}
    </div>
  );
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

export function NotifyHistoryCard({
  visibleEvents = [],
  eventsLoading,
  eventsError,
  eventsLastSyncedAt,
  refreshNotifyEvents,
  formatEventTimeLabel,
  expanded,
  onToggleExpand
}) {
  const [selectedEvent, setSelectedEvent] = useState(null);

  const events = [...visibleEvents].sort((a, b) => safeTimestamp(b?.createdAt) - safeTimestamp(a?.createdAt));
  const latest = events.slice(0, 6);
  const lastSynced = eventsLastSyncedAt ? formatEventTimeLabel(eventsLastSyncedAt) : '尚未拉取';

  return (
    <section data-scroll-card="true" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-950">送达记录</h2>
          <p className="mt-1 text-sm text-slate-500">查看最近的通知推送记录，方便排查和确认。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleExpand}
            className="min-h-9 rounded-lg px-3 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 cursor-pointer"
          >
            {expanded ? '收起记录' : '查看全部记录'} →
          </button>
          <button
            type="button"
            onClick={refreshNotifyEvents}
            disabled={eventsLoading}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-indigo-200 hover:text-indigo-600 cursor-pointer"
            aria-label="刷新送达记录"
          >
            {eventsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {eventsError ? (
        <div role="alert" className="mx-5 mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{eventsError}</span>
        </div>
      ) : null}

      <div className="overflow-x-auto border-t border-slate-100">
        <div className="grid min-w-[840px] grid-cols-[170px_150px_minmax(330px,1fr)_150px_130px_80px] bg-slate-50/80 px-5 py-2.5 text-xs font-semibold text-slate-500">
          <span>时间</span>
          <span>事件类型</span>
          <span>内容</span>
          <span>发送渠道</span>
          <span>状态</span>
          <span className="text-right">操作</span>
        </div>
        {latest.map((event, index) => {
          const status = String(event?.status || '');
          const delivered = status === 'delivered';
          const failed = status === 'failed';
          const key = `${event?.id || ''}-${event?.createdAt || ''}-${index}`;

          return (
            <div key={key} className="grid min-w-[840px] grid-cols-[170px_150px_minmax(330px,1fr)_150px_130px_80px] items-center border-t border-slate-100 px-5 py-3 text-xs">
              <span className="tabular-nums text-slate-500">{formatEventTimeLabel(event?.createdAt)}</span>
              <span className="font-medium text-slate-700">{eventTypeLabel(event)}</span>
              <span className="truncate pr-5 text-slate-600" title={event?.summary || event?.body || event?.title}>
                {event?.summary || event?.body || event?.title || '—'}
              </span>
              <div>{renderEventChannels(event)}</div>
              <span className={cx('inline-flex w-fit items-center gap-1.5 font-medium', delivered ? 'text-emerald-600' : failed ? 'text-rose-600' : 'text-amber-600')}>
                {delivered ? <CheckCircle2 className="h-4 w-4" /> : failed ? <XCircle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                <span>{delivered ? '发送成功' : failed ? '发送失败' : '处理中'}</span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedEvent(event)}
                className="justify-self-end rounded-lg px-2 py-1.5 font-semibold text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 cursor-pointer transition"
              >
                详情
              </button>
            </div>
          );
        })}
        {!eventsLoading && !latest.length ? (
          <div className="flex min-h-28 items-center justify-center gap-2 border-t border-slate-100 text-sm text-slate-500">
            <Inbox className="h-5 w-5 text-slate-300" />
            <span>暂无推送记录</span>
          </div>
        ) : null}
      </div>
      <div className="border-t border-slate-100 px-5 py-2 text-right text-[11px] text-slate-400">
        上次刷新：{lastSynced} · 测试通知保留 30 分钟
      </div>

      {/* 送达记录详情弹窗 */}
      <NotifyEventDetailDialog
        open={Boolean(selectedEvent)}
        onClose={() => setSelectedEvent(null)}
        event={selectedEvent}
      />
    </section>
  );
}

export default NotifyHistoryCard;
