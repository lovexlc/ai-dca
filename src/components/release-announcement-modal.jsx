import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Sparkles, X } from 'lucide-react';
import { getAnalyticsVisitorId } from '../app/analytics.js';
import { getCurrentReleaseAnnouncement } from '../app/releaseAnnouncement.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog';

const SEEN_KEY_PREFIX = 'aiDcaReleaseAnnouncementSeen_v1';
const SHOW_DELAY_MS = 3000; // 延迟3秒显示，避免阻塞初始交互

function safeLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const testKey = `${SEEN_KEY_PREFIX}:test`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

function buildSeenKey(releaseId, identity) {
  return `${SEEN_KEY_PREFIX}:${encodeURIComponent(releaseId)}:${encodeURIComponent(identity)}`;
}

function getSeenKeys(releaseId, userIdValue) {
  const keys = [];
  const userId = String(userIdValue || '').trim();
  if (userId) {
    keys.push(buildSeenKey(releaseId, `user:${userId}`));
  }
  if (typeof window !== 'undefined') {
    try {
      keys.push(buildSeenKey(releaseId, getAnalyticsVisitorId()));
    } catch {
      keys.push(buildSeenKey(releaseId, 'visitor:ephemeral'));
    }
  }
  return Array.from(new Set(keys));
}

function hasSeenRelease(releaseId, userId) {
  const storage = safeLocalStorage();
  if (!storage) return false;
  const keys = getSeenKeys(releaseId, userId);
  const seen = keys.some((key) => storage.getItem(key) === '1');
  if (seen) {
    keys.forEach((key) => storage.setItem(key, '1'));
  }
  return seen;
}

function markReleaseSeen(releaseId, userId) {
  const storage = safeLocalStorage();
  if (!storage) return;
  getSeenKeys(releaseId, userId).forEach((key) => storage.setItem(key, '1'));
}

export function ReleaseAnnouncementModal({ cloudSession }) {
  const announcement = useMemo(() => getCurrentReleaseAnnouncement(), []);
  const [open, setOpen] = useState(false);
  const releaseId = String(announcement?.id || '').trim();
  const userId = String(cloudSession?.userId || cloudSession?.username || '').trim().toLowerCase();
  const items = Array.isArray(announcement?.items)
    ? announcement.items.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  useEffect(() => {
    if (!announcement?.enabled || !releaseId || typeof window === 'undefined') return undefined;
    const timer = window.setTimeout(() => {
      if (!hasSeenRelease(releaseId, userId)) {
        markReleaseSeen(releaseId, userId);
        setOpen(true);
      }
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [announcement?.enabled, releaseId, userId]);

  const handleClose = useCallback(() => {
    if (releaseId) {
      markReleaseSeen(releaseId, userId);
    }
    setOpen(false);
  }, [releaseId, userId]);

  const handleOpenChange = useCallback((nextOpen) => {
    if (nextOpen) {
      setOpen(true);
      return;
    }
    handleClose();
  }, [handleClose]);

  if (!open || !announcement?.enabled || !releaseId) return null;

  const title = announcement.title || '近期变更记录';
  const summary = announcement.summary || '';
  const sourceLabel = String(announcement.sourceLabel || '').trim();
  const embedUrl = String(announcement.embedUrl || '').trim();
  const externalUrl = String(announcement.externalUrl || '').trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[88vh] max-w-[calc(100%-2rem)] overflow-hidden border-slate-200 bg-white p-0 shadow-2xl sm:max-w-3xl"
        showCloseButton={false}
        onPointerDownOutside={(e) => {
          // 允许点击外部关闭，避免完全阻塞交互
          e.preventDefault();
          handleClose();
        }}
        onEscapeKeyDown={handleClose}
      >
        <button
          type="button"
          aria-label="关闭"
          className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="overflow-y-auto px-5 pb-5 pt-5 sm:px-6 sm:pb-6">
          <div className="flex items-center gap-2 pr-10 text-xs font-semibold text-indigo-600">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span>{announcement.eyebrow || '更新公告'}</span>
          </div>
          <DialogTitle className="mt-2 pr-10 text-xl font-bold leading-tight text-slate-950 sm:text-2xl">
            {title}
          </DialogTitle>
          {summary ? (
            <DialogDescription className="mt-2 text-sm leading-6 text-slate-500">
              {summary}
            </DialogDescription>
          ) : null}
          {sourceLabel ? <p className="mt-1 text-xs leading-5 text-slate-400">{sourceLabel}</p> : null}

          {embedUrl ? (
            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              <iframe
                title={title}
                src={embedUrl}
                className="h-[46vh] min-h-[280px] w-full bg-white"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          ) : null}

          {items.length > 0 ? (
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm font-bold text-slate-900">本期重点</div>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
                {items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {externalUrl ? (
            <a
              href={externalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              查看完整变更记录
            </a>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            onClick={handleClose}
          >
            知道了
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
