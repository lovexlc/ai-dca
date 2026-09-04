import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  detectRegionFromEnvironment,
  detectRegionSync,
  dismissRegionBanner,
  fetchEdgeCountryCode,
  isRegionBannerDismissed,
  persistRegion,
  readRegionOverride,
  readSiteRegionConfig,
  readStoredRegion,
  resolveRegionBanner
} from '../app/regionEnvironment.js';

const BAR_HEIGHT_VAR = '--region-banner-height';

export function RegionSwitchBanner() {
  const config = useMemo(() => readSiteRegionConfig(import.meta.env || {}), []);
  const [region, setRegion] = useState('');
  const [dismissed, setDismissed] = useState(() => isRegionBannerDismissed());
  const [href, setHref] = useState(() => (typeof window === 'undefined' ? '' : window.location.href));

  // 第一步：同步兜底（时区 / 语言 / 本地记忆），首屏立即可用。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setHref(window.location.href);
    const initial = detectRegionSync();
    if (initial) setRegion(initial);
  }, []);

  // 第二步：异步用边缘节点国家码校正（更准确），仅在没有显式 override 时执行。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (readRegionOverride(window.location.href)) return;
    let cancelled = false;
    (async () => {
      const countryCode = await fetchEdgeCountryCode();
      if (cancelled || !countryCode) return;
      const resolved = detectRegionFromEnvironment({ countryCode });
      if (!resolved) return;
      persistRegion(resolved);
      setRegion(resolved);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (region && !readStoredRegion()) persistRegion(region);
  }, [region]);

  const banner = useMemo(
    () => resolveRegionBanner({ region, config, currentHref: href, dismissed }),
    [region, config, href, dismissed]
  );

  // 固定在顶层，同时给 body 增加占位内边距，避免遮挡应用顶栏。
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    if (!banner) {
      root.style.removeProperty(BAR_HEIGHT_VAR);
      document.body.style.paddingTop = '';
      return undefined;
    }
    root.style.setProperty(BAR_HEIGHT_VAR, '44px');
    document.body.style.paddingTop = '44px';
    return () => {
      root.style.removeProperty(BAR_HEIGHT_VAR);
      document.body.style.paddingTop = '';
    };
  }, [banner]);

  const handleDismiss = useCallback((event) => {
    event.stopPropagation();
    dismissRegionBanner();
    setDismissed(true);
  }, []);

  const handleNavigate = useCallback(() => {
    if (!banner?.targetUrl || typeof window === 'undefined') return;
    persistRegion(banner.region);
    window.location.assign(banner.targetUrl);
  }, [banner]);

  if (!banner) return null;

  return (
    <div
      role="region"
      aria-label={banner.title}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '8px 44px 8px 16px',
        background: 'linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%)',
        color: '#ffffff',
        fontSize: 13,
        lineHeight: 1.35,
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.18)'
      }}
    >
      <button
        type="button"
        onClick={handleNavigate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
          padding: 0,
          textAlign: 'left'
        }}
      >
        <span style={{ fontWeight: 600 }}>{banner.title}</span>
        <span style={{ opacity: 0.85 }}>{banner.description}</span>
        <span
          style={{
            padding: '2px 10px',
            borderRadius: 999,
            background: 'rgba(255, 255, 255, 0.18)',
            fontWeight: 600,
            whiteSpace: 'nowrap'
          }}
        >
          {banner.actionLabel} →
        </span>
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={banner.region === 'cn' ? '关闭提示' : 'Dismiss'}
        style={{
          position: 'absolute',
          right: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 26,
          height: 26,
          borderRadius: 999,
          border: 'none',
          background: 'rgba(255, 255, 255, 0.16)',
          color: '#ffffff',
          fontSize: 15,
          lineHeight: 1,
          cursor: 'pointer'
        }}
      >
        ×
      </button>
    </div>
  );
}

export default RegionSwitchBanner;
