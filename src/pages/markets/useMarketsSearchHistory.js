import { useCallback } from 'react';
import { addToSearchHistory } from './marketsSearchHistory.js';

/**
 * 行情中心搜索历史管理 hook
 */
export function useMarketsSearchHistory() {
  const saveSearchHistory = useCallback((symbol, name, market) => {
    addToSearchHistory(symbol, name, market);
  }, []);

  return { saveSearchHistory };
}
