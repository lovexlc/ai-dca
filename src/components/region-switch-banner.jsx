import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { detectRegionFromEnvironment, detectRegionSync, dismissRegionBanner, fetchEdgeCountryCode, isRegionBannerDismissed, persistRegion, readRegionOverride, readSiteRegionConfig, readStoredRegion, resolveRegionBanner } from '../app/regionEnvironment.js';
import { flushRemoteUserData } from '../app/remoteStorage.js';

export function RegionSwitchBanner() {
  const config = useMemo(() => readSiteRegionConfig(import.meta.env || {}), []);
  const [region, setRegion] = useState('');
  const [dismissed, setDismissed] = useState(() => isRegionBannerDismissed());
  const [href, setHref] = useState(() => (typeof window === 'undefined' ? '' : window.location.href));
  const [switching, setSwitching] = useState(false);
  useEffect(() => { if (typeof window === 'undefined') return; setHref(window.location.href); const initial = detectRegionSync(); if (initial) setRegion(initial); }, []);
  useEffect(() => { if (typeof window === 'undefined' || readRegionOverride(window.location.href)) return undefined; let cancelled = false; fetchEdgeCountryCode().then((code) => { if (cancelled || !code) return; const next = detectRegionFromEnvironment({ countryCode: code }); if (next) { persistRegion(next); setRegion(next); } }); return () => { cancelled = true; }; }, []);
  useEffect(() => { if (region && !readStoredRegion()) persistRegion(region); }, [region]);
  const banner = useMemo(() => resolveRegionBanner({ region, config, currentHref: href, dismissed }), [region, config, href, dismissed]);
  useEffect(() => { if (typeof document === 'undefined') return undefined; document.body.style.paddingTop = banner ? '44px' : ''; return () => { document.body.style.paddingTop = ''; }; }, [banner]);
  const dismiss = useCallback((event) => { event.stopPropagation(); dismissRegionBanner(); setDismissed(true); }, []);
  const navigate = useCallback(async () => { if (!banner?.targetUrl || switching) return; setSwitching(true); try { await flushRemoteUserData(); persistRegion(banner.region); window.location.assign(banner.targetUrl); } catch { setSwitching(false); window.alert('数据正在保存到远端，请稍后再切换地址。'); } }, [banner, switching]);
  if (!banner) return null;
  return <div role="region" aria-label={banner.title} style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '8px 44px 8px 16px', background: 'linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%)', color: '#fff', fontSize: 13 }}>
    <button type="button" onClick={navigate} disabled={switching} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', background: 'transparent', border: 0, color: 'inherit', font: 'inherit', cursor: switching ? 'wait' : 'pointer', opacity: switching ? 0.75 : 1 }}>
      <span style={{ fontWeight: 600 }}>{banner.title}</span><span style={{ opacity: 0.85 }}>{switching ? '正在保存远端数据…' : banner.description}</span><span style={{ padding: '2px 10px', borderRadius: 999, background: 'rgba(255,255,255,.18)', fontWeight: 600 }}>{switching ? '保存中…' : `${banner.actionLabel} →`}</span>
    </button>
    <button type="button" onClick={dismiss} aria-label="关闭" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, borderRadius: 999, border: 0, background: 'rgba(255,255,255,.16)', color: '#fff', cursor: 'pointer' }}>×</button>
  </div>;
}
export default RegionSwitchBanner;
