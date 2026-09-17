import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, ExternalLink, Sparkles } from 'lucide-react';
import { getCurrentReleaseAnnouncement } from '../app/releaseAnnouncement.js';
import { SITE_UPDATE_NOTICE_ID, isSiteUpdateTarget } from '../app/siteUpdateProbe.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog.jsx';
import { cx, primaryButtonClass, secondaryButtonClass } from './experience-ui.jsx';

const DISMISSED_KEY_PREFIX = 'aiDcaSiteUpdatePromptDismissed:';

function readDismissed(noticeId) {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(DISMISSED_KEY_PREFIX + noticeId) === '1';
  } catch {
    return false;
  }
}

function saveDismissed(noticeId) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(DISMISSED_KEY_PREFIX + noticeId, '1');
  } catch {
    // 隐私模式或存储配额不足时不阻断跳转
  }
}

export function ReleaseAnnouncementModal({ siteUpdate }) {
  const announcement = getCurrentReleaseAnnouncement();
  const noticeId = String(siteUpdate?.noticeId || SITE_UPDATE_NOTICE_ID);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => readDismissed(noticeId));

  useEffect(() => {
    setDismissed(readDismissed(noticeId));
  }, [noticeId]);

  useEffect(() => {
    if (
      announcement.enabled
      && siteUpdate?.recommended?.ok
      && !dismissed
      && !isSiteUpdateTarget()
    ) {
      setOpen(true);
    }
  }, [announcement.enabled, dismissed, siteUpdate]);

  function dismiss() {
    saveDismissed(noticeId);
    setDismissed(true);
    setOpen(false);
  }

  function openSite(site) {
    if (!site?.ok || typeof window === 'undefined') return;
    dismiss();
    window.open(site.targetUrl || site.url, '_blank', 'noopener,noreferrer');
  }

  if (
    !announcement.enabled
    || !siteUpdate?.recommended?.ok
    || dismissed
    || !open
    || isSiteUpdateTarget()
  ) {
    return null;
  }

  const results = Array.isArray(siteUpdate.results) ? siteUpdate.results : [];
  const recommended = siteUpdate.recommended;
  const otherAvailable = results.filter((site) => site.ok && site.id !== recommended.id);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          dismiss();
        } else {
          setOpen(true);
        }
      }}
    >
      <DialogContent className="z-[180] max-h-[88vh] overflow-y-auto border-indigo-100 bg-white text-slate-900 sm:max-w-lg">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-indigo-600">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-bold uppercase tracking-[0.18em]">站点更新提示</span>
          </div>
          <DialogTitle className="text-xl font-bold text-slate-950">推荐前往新版站点</DialogTitle>
          <DialogDescription className="text-sm leading-6 text-slate-600">
            CN 站点和 Fast 站点相较当前网站进行了大幅功能更新，建议前往使用。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2.5 text-sm leading-6 text-indigo-900">
            {recommended.id === 'cn'
              ? '两个站点均可访问，已按优先级推荐 CN 国内站。'
              : 'CN 国内站当前不可达，已自动推荐可用的 Fast 站点。'}
          </div>

          <div className="space-y-2" aria-label="站点探活结果">
            {results.map((site) => (
              <div
                key={site.id}
                className={cx(
                  'flex items-center gap-3 rounded-xl border px-3 py-2.5',
                  site.ok
                    ? 'border-emerald-100 bg-emerald-50/60'
                    : 'border-slate-100 bg-slate-50'
                )}
              >
                {site.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                ) : (
                  <CircleAlert className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800">{site.label}</div>
                  <div className="text-xs text-slate-500">
                    {site.ok ? '探活成功' : '当前不可达'}
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

          <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
            当前登录态保存在当前网站，跨域打开后不会自动共享。请在目标站点使用同一账号登录，云端数据仍可继续同步。
          </p>
        </div>

        <DialogFooter className="mt-1 sm:flex-row sm:justify-end">
          <button type="button" className={secondaryButtonClass} onClick={dismiss}>
            稍后再说
          </button>
          <button type="button" className={primaryButtonClass} onClick={() => openSite(recommended)}>
            前往 {recommended.label}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </button>
          {otherAvailable.length ? (
            <button
              type="button"
              className={cx(secondaryButtonClass, 'sm:hidden')}
              onClick={() => openSite(otherAvailable[0])}
            >
              前往 {otherAvailable[0].label}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
