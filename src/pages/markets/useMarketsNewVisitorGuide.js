import { useEffect } from 'react';

import { hasSeenAnyConversionPrompt } from '../../app/conversionPrompts.js';
import { promptMarketsNewVisitorGuide } from './marketsConversionPrompts.js';

const NEW_VISITOR_GUIDE_DELAY_MS = 60_000;

// 匿名新访客在行情 tab 停留达到阈值后，推一次上下文引导。
// 频控/冷却沿用 conversionPrompts 的统一逻辑；已登录用户由 trigger 内部直接过滤。
export function useMarketsNewVisitorGuide(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    if (hasSeenAnyConversionPrompt()) return undefined;
    const timer = window.setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      promptMarketsNewVisitorGuide({ source: 'markets_dwell', dwellMs: NEW_VISITOR_GUIDE_DELAY_MS });
    }, NEW_VISITOR_GUIDE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled]);
}
