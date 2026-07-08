import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMarketSummary } from './marketsApiLoader.js';

export function useMarketSummaryStrip(active) {
  const [summary, setSummary] = useState({ title: 'US Markets', items: [], generatedAt: '' });
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  const refresh = useCallback(async (forceRefresh = false, { signal } = {}) => {
    if (!forceRefresh && loadedRef.current) return;
    setLoading(true);
    try {
      const r = await fetchMarketSummary('US', { refresh: forceRefresh, signal });
      if (signal?.aborted) return;
      setSummary({
        title: r?.title || 'US Markets',
        region: r?.region || 'US',
        generatedAt: r?.generatedAt || '',
        source: r?.source || '',
        items: Array.isArray(r?.items) ? r.items : []
      });
      loadedRef.current = true;
    } catch {
      // 增强条带加载失败时保留旧数据，不影响详情主流程。
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    refresh(false, { signal: controller.signal });
    return () => controller.abort();
  }, [active, refresh]);

  return { summary, loading, refresh };
}
