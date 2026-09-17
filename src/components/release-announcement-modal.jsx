import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, ExternalLink } from 'lucide-react';
import { getCurrentReleaseAnnouncement } from '../app/releaseAnnouncement.js';
import { SITE_UPDATE_NOTICE_ID, isSiteUpdateTarget } from '../app/siteUpdateProbe.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog.jsx';
import { cx } from './experience-ui.jsx';

const SITE_UPDATE_OPEN_EVENT = 'site-update:open';

function formatLatency(value) {
  const latency = Number(value);
  if (!Number.isFinite(latency) || latency <= 0) return '—';
  return `${Math.round(latency)} ms`;
}

export function ReleaseAnnouncementModal({ siteUpdate }) {
  const announcement = getCurrentReleaseAnnouncement();
  const noticeId = String(siteUpdate?.noticeId || SITE_UPDATE_NOTICE_ID);
  const [open, setOpen] = useState(false);
  const canRender = Boolean(
    announcement.enabled
    && siteUpdate?.recommended?.ok
    && !isSiteUpdateTarget()
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function handleOpen(event) {
      if (!canRender) return;
      if (typeof event?.preventDefault === 'function') event.preventDefault();
      setOpen(true);
    }
    window.addEventListener(SITE_UPDATE_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(SITE_UPDATE_OPEN_EVENT, handleOpen);
  }, [canRender, noticeId]);

  function openSite(site) {
    if (!site?.ok || typeof window === 'undefined') return;
    setOpen(false);
    window.open(site.targetUrl || site.url, '_blank', 'noopener,noreferrer');
  }

  if (!canRender) return null;

  const results = Array.isArray(siteUpdate.results) ? siteUpdate.results : [];
  const recommended = siteUpdate.recommended;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="z-[180] border-slate-200 bg-white text-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-950">选择新版站点</DialogTitle>
          <DialogDescription className="sr-only">
            查看新版站点的当前连接状态和访问时延。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5" aria-label="新版站点测速结果">
          {results.map((site) => (
            <div
              key={site.id}
              className={cx(
                'flex items-center gap-3 rounded-xl border px-3 py-3',
                site.ok
                  ? 'border-emerald-100 bg-emerald-50/60'
                  : 'border-slate-100 bg-slate-50'
              )}
            >
              {site.ok ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
              ) : (
                <CircleAlert className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">{site.label}</span>
                  {site.id === recommended?.id ? (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">推荐</span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {site.ok ? `访问时延 ${formatLatency(site.latencyMs)}` : '当前不可达'}
                </div>
              </div>
              {site.ok ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-indigo-600 transition-colors hover:bg-white hover:text-indigo-800"
                  onClick={() => openSite(site)}
                >
                  打开
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
