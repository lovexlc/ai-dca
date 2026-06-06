import { useEffect, useRef } from 'react';
import { trackAdSlotClick, trackAdSlotView } from '../app/analytics.js';

function viewportBucket() {
  if (typeof window === 'undefined') return 'server';
  const width = window.innerWidth || 0;
  if (width < 640) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export function AdSlot({
  slotId,
  pageTab = '',
  position = '',
  adProvider = 'internal',
  children,
  className = ''
}) {
  const ref = useRef(null);
  const visibleSinceRef = useRef(0);
  const trackedRef = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !slotId || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      const now = Date.now();
      if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) {
        if (!visibleSinceRef.current) visibleSinceRef.current = now;
        return;
      }
      if (!visibleSinceRef.current || trackedRef.current) return;
      const visibleMs = now - visibleSinceRef.current;
      visibleSinceRef.current = 0;
      if (visibleMs < 1000) return;
      trackedRef.current = true;
      trackAdSlotView({
        slotId,
        pageTab,
        position,
        adProvider,
        isMobile: window.innerWidth < 640,
        viewport: viewportBucket(),
        visibleMs
      });
    }, { threshold: [0, 0.5] });

    observer.observe(node);
    return () => {
      observer.disconnect();
      if (!visibleSinceRef.current || trackedRef.current) return;
      const visibleMs = Date.now() - visibleSinceRef.current;
      if (visibleMs >= 1000) {
        trackedRef.current = true;
        trackAdSlotView({
          slotId,
          pageTab,
          position,
          adProvider,
          isMobile: window.innerWidth < 640,
          viewport: viewportBucket(),
          visibleMs
        });
      }
    };
  }, [adProvider, pageTab, position, slotId]);

  function handleClickCapture() {
    trackAdSlotClick({
      slotId,
      pageTab,
      position,
      adProvider,
      isMobile: typeof window !== 'undefined' && window.innerWidth < 640,
      viewport: viewportBucket()
    });
  }

  return (
    <div ref={ref} className={className} data-ad-slot={slotId} onClickCapture={handleClickCapture}>
      {children}
    </div>
  );
}
