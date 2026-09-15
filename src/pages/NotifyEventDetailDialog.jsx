import { CheckCircle2, Clock3, Copy, Info, XCircle } from 'lucide-react';
import { useState } from 'react';
import { cx } from '../components/experience-ui.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.jsx';

const CHANNEL_MAP = {
  bark: { label: 'iOS (Bark)', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  ios: { label: 'iOS (Bark)', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  serverchan3: { label: '安卓 (Server酱³)', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  serverchan: { label: '安卓 (Server酱³)', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  android: { label: '安卓 (Server酱³)', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  email: { label: '邮箱 (Email)', bg: 'bg-sky-50 text-sky-700 border-sky-200' },
  mail: { label: '邮箱 (Email)', bg: 'bg-sky-50 text-sky-700 border-sky-200' },
  pc: { label: 'PC 浏览器', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
  web: { label: 'PC 浏览器', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
  ws: { label: 'PC 浏览器', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
};

function resolveChannelInfo(rawChannel) {
  const key = String(rawChannel || '').toLowerCase();
  for (const [prefix, info] of Object.entries(CHANNEL_MAP)) {
    if (key.includes(prefix)) return info;
  }
  return { label: rawChannel || '未知渠道', bg: 'bg-slate-100 text-slate-700 border-slate-200' };
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

function formatFullTime(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return String(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return String(isoString);
  }
}

export function NotifyEventDetailDialog({ open, onClose, event }) {
  const [copied, setCopied] = useState(false);

  if (!event) return null;

  const status = String(event?.status || '');
  const delivered = status === 'delivered';
  const failed = status === 'failed';
  const channels = Array.isArray(event?.channels) ? event.channels : [];

  function handleCopyJson() {
    try {
      navigator.clipboard.writeText(JSON.stringify(event, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose?.(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-5 sm:p-6" showCloseButton>
        <DialogHeader>
          <div className="flex items-center space-x-2">
            <span className="w-7 h-7 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs">
              <Info className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle className="text-base sm:text-lg font-bold text-slate-900">
                送达记录详情
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                查看通知推送触发时间、各渠道送达反馈与内容
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
          {/* 状态与时间横幅 */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-slate-900">
                  {event.title || eventTypeLabel(event)}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-semibold">
                  {eventTypeLabel(event)}
                </span>
              </div>
              <p className="text-slate-500 font-mono text-[11px]">
                触发时间：{formatFullTime(event.createdAt)}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              {delivered ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>全部已送达</span>
                </span>
              ) : failed ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 font-semibold text-xs">
                  <XCircle className="h-3.5 w-3.5" />
                  <span>发送失败</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold text-xs">
                  <Clock3 className="h-3.5 w-3.5" />
                  <span>排队处理中</span>
                </span>
              )}
            </div>
          </div>

          {/* 消息正文与摘要 */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
            <div className="font-semibold text-slate-700 flex items-center justify-between">
              <span>通知内容</span>
              {event.ruleId ? (
                <span className="font-mono text-[11px] text-slate-400 font-normal">
                  规则: {event.ruleId}
                </span>
              ) : null}
            </div>
            {event.summary ? (
              <div className="p-2.5 rounded-lg bg-slate-50 text-slate-800 font-medium leading-relaxed">
                {event.summary}
              </div>
            ) : null}
            {event.body && event.body !== event.summary ? (
              <div className="p-2.5 rounded-lg bg-slate-50/70 text-slate-600 font-sans leading-relaxed whitespace-pre-wrap">
                {event.body}
              </div>
            ) : null}
          </div>

          {/* 发送渠道送达明细 */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
            <div className="font-semibold text-slate-700">各渠道投递状态</div>
            {channels.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {channels.map((ch, idx) => {
                  const chInfo = resolveChannelInfo(ch.channel);
                  const isDelivered = ch.status === 'delivered' || ch.status === 'queued';
                  const isSkipped = ch.status === 'skipped';
                  const isFailed = ch.status === 'failed';
                  return (
                    <div key={idx} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cx('inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border', chInfo.bg)}>
                            {chInfo.label}
                          </span>
                          <span className="text-slate-500 font-mono text-[11px]">
                            {ch.configLabel || ch.channel}
                          </span>
                        </div>
                        {ch.detail ? (
                          <p className="text-slate-600 text-[11px] break-all leading-normal">
                            {ch.detail}
                          </p>
                        ) : null}
                      </div>

                      <div className="shrink-0">
                        {isDelivered ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>{ch.status === 'queued' ? '已进入队列' : '已送达'}</span>
                          </span>
                        ) : isSkipped ? (
                          <span className="inline-flex items-center gap-1 text-slate-400 font-medium">
                            <span>已跳过</span>
                          </span>
                        ) : isFailed ? (
                          <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                            <XCircle className="h-3.5 w-3.5" />
                            <span>发送失败</span>
                          </span>
                        ) : (
                          <span className="text-slate-500 font-medium">{ch.status}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-slate-400 py-2 text-center text-xs">
                单通道推送或无详细渠道拆分记录
              </div>
            )}
          </div>

          {/* 原始 JSON 折叠面板 */}
          <details className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs">
            <summary className="font-semibold text-slate-600 cursor-pointer select-none flex items-center justify-between">
              <span>原始事件数据 (JSON)</span>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); handleCopyJson(); }}
                className="text-[11px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-100"
              >
                <Copy className="h-3 w-3" />
                <span>{copied ? '已复制' : '复制 JSON'}</span>
              </button>
            </summary>
            <pre className="mt-2.5 p-2 rounded bg-slate-900 text-slate-100 font-mono text-[10px] overflow-x-auto max-h-48 leading-relaxed">
              {JSON.stringify(event, null, 2)}
            </pre>
          </details>
        </div>

        <DialogFooter className="pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition cursor-pointer"
          >
            关闭
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NotifyEventDetailDialog;
