import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, ExternalLink } from 'lucide-react';
import {
  detectRegionFromEnvironment,
  detectRegionSync,
  dismissRegionBanner,
  fetchEdgeCountryCode,
  isRegionBannerDismissed,
  persistRegion,
  readSiteRegionConfig,
  REGION_CN,
  REGION_GLOBAL
} from '../app/regionEnvironment.js';
import { probeCnConnectivity } from '../app/networkTrace.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog.jsx';

const FAST_SITE_ORIGIN = 'https://fast.freebacktrack.tech';
const PROBE_TIMEOUT_MS = 4000;
const MINIMIZE_DURATION_MS = 280;

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function buildTargetUrl(origin, currentHref = '') {
  const rawOrigin = String(origin || '').trim();
  if (!rawOrigin) return '';
  try {
    const target = new URL(rawOrigin);
    if (currentHref) {
      const current = new URL(currentHref);
      target.pathname = current.pathname || '/';
      target.search = current.search;
      target.hash = current.hash;
    }
    return target.toString();
  } catch {
    return rawOrigin;
  }
}

function sameSite(a = '', b = '') {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function formatLatency(value) {
  const latency = Number(value);
  return Number.isFinite(latency) && latency > 0 ? `${Math.round(latency)} ms` : '—';
}

async function probeOrigin(origin, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (typeof fetch !== 'function') return { ok: false, latencyMs: 0 };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const startedAt = nowMs();
  try {
    const url = new URL(origin);
    url.searchParams.set('site_probe', String(Date.now()));
    await fetch(url.toString(), {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: controller?.signal
    });
    return { ok: true, latencyMs: Math.max(1, Math.round(nowMs() - startedAt)) };
  } catch {
    return { ok: false, latencyMs: Math.max(1, Math.round(nowMs() - startedAt)) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function selectRecommendedSite(region, cnSite, fastSite) {
  if (region === REGION_CN) {
    if (cnSite.ok) return cnSite;
    if (fastSite.ok) return fastSite;
    return null;
  }
  if (region === REGION_GLOBAL && fastSite.ok) return fastSite;
  return null;
}

export function RegionSwitchBanner() {
  const config = useMemo(() => readSiteRegionConfig(import.meta.env || {}), []);
  const [siteState, setSiteState] = useState(null);
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [minimizing, setMinimizing] = useState(false);
  const minimizeTimerRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let cancelled = false;
    const fallbackRegion = detectRegionSync();

    (async () => {
      const [countryCode, cnProbe, fastProbe] = await Promise.all([
        fetchEdgeCountryCode().catch(() => ''),
        probeCnConnectivity({ timeoutMs: PROBE_TIMEOUT_MS }).catch(() => ({ cnReachable: false, cnLatency: 0 })),
        probeOrigin(FAST_SITE_ORIGIN, { timeoutMs: PROBE_TIMEOUT_MS })
      ]);
      if (cancelled) return;

      const region = detectRegionFromEnvironment({
        countryCode,
        storedRegion: fallbackRegion
      }) || fallbackRegion;
      if (region) persistRegion(region);

      const currentHref = window.location.href;
      const cnTargetUrl = buildTargetUrl(config?.cnOrigin, currentHref);
      const fastTargetUrl = buildTargetUrl(FAST_SITE_ORIGIN, currentHref);
      const cnSite = {
        id: 'cn',
        region: REGION_CN,
        label: 'CN 国内站',
        shortLabel: 'CN',
        ok: cnProbe?.cnReachable === true,
        latencyMs: Number(cnProbe?.cnLatency) || 0,
        targetUrl: cnTargetUrl,
        current: sameSite(currentHref, cnTargetUrl)
      };
      const fastSite = {
        id: 'fast',
        region: REGION_GLOBAL,
        label: 'Fast 站点',
        shortLabel: 'FAST',
        ok: fastProbe.ok === true,
        latencyMs: Number(fastProbe.latencyMs) || 0,
        targetUrl: fastTargetUrl,
        current: sameSite(currentHref, fastTargetUrl)
      };
      const recommended = selectRecommendedSite(region, cnSite, fastSite);

      if (!recommended || recommended.current) {
        setSiteState(null);
        setOpen(false);
        setMinimized(false);
        return;
      }

      setSiteState({ region, sites: [cnSite, fastSite], recommended });
      if (isRegionBannerDismissed()) {
        setOpen(false);
        setMinimized(true);
      } else {
        setMinimized(false);
        setOpen(true);
      }
    })();

    return () => {
      cancelled = true;
      if (minimizeTimerRef.current) clearTimeout(minimizeTimerRef.current);
    };
  }, [config]);

  const minimizePrompt = useCallback(() => {
    if (!open || minimizing) return;
    dismissRegionBanner();
    setMinimizing(true);
    if (minimizeTimerRef.current) clearTimeout(minimizeTimerRef.current);
    minimizeTimerRef.current = setTimeout(() => {
      setOpen(false);
      setMinimizing(false);
      setMinimized(true);
      minimizeTimerRef.current = null;
    }, MINIMIZE_DURATION_MS);
  }, [minimizing, open]);

  const reopenPrompt = useCallback(() => {
    if (!siteState?.recommended) return;
    if (minimizeTimerRef.current) clearTimeout(minimizeTimerRef.current);
    minimizeTimerRef.current = null;
    setMinimizing(false);
    setMinimized(false);
    setOpen(true);
  }, [siteState]);

  const openSite = useCallback((site) => {
    if (!site?.ok || site.current || !site.targetUrl || typeof window === 'undefined') return;
    dismissRegionBanner();
    persistRegion(site.region);
    window.location.assign(site.targetUrl);
  }, []);

  if (!siteState?.recommended) return null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setOpen(true);
            setMinimized(false);
            return;
          }
          minimizePrompt();
        }}
      >
        <DialogContent
          className="z-[180] border-slate-200 bg-white text-slate-900 sm:max-w-md"
          style={{
            transform: minimizing
              ? 'translate(calc(50vw - 76px), calc(50vh - 128px)) scale(0.1)'
              : 'translate(-50%, -50%) scale(1)',
            transformOrigin: 'center',
            opacity: minimizing ? 0.08 : 1,
            transition: `transform ${MINIMIZE_DURATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${MINIMIZE_DURATION_MS}ms ease`
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-950">选择新版站点</DialogTitle>
            <DialogDescription className="sr-only">
              查看新版站点的连接状态和访问时延。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5" aria-label="新版站点测速结果">
            {siteState.sites.map((site) => (
              <div
                key={site.id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${
                  site.ok ? 'border-emerald-100 bg-emerald-50/60' : 'border-slate-100 bg-slate-50'
                }`}
              >
                {site.ok ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                ) : (
                  <CircleAlert className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">{site.label}</span>
                    {site.id === siteState.recommended.id ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">推荐</span>
                    ) : null}
                    {site.current ? (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">当前</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {site.ok ? `访问时延 ${formatLatency(site.latencyMs)}` : '当前不可达'}
                  </div>
                </div>
                {site.ok && !site.current ? (
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

      {minimized ? (
        <button
          type="button"
          onClick={reopenPrompt}
          aria-label={`打开${siteState.recommended.label}站点选择`}
          title="选择新版站点"
          className="fixed bottom-24 right-4 z-[170] inline-flex h-12 min-w-12 items-center justify-center rounded-full bg-indigo-600 px-3 text-xs font-extrabold tracking-wide text-white shadow-xl shadow-indigo-900/25 transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 sm:bottom-8 sm:right-6"
        >
          {siteState.recommended.shortLabel}
        </button>
      ) : null}
    </>
  );
}

export default RegionSwitchBanner;
