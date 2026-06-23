import { addToWatchlist } from '../../app/marketsApi.js';

/**
 * 批量添加基金到自选列表
 */
export function batchAddToWatchlist(symbols, currentWatch, activeListId) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return currentWatch;
  }

  let next = currentWatch;
  symbols.forEach(item => {
    next = addToWatchlist(item.market, item.symbol, activeListId);
  });

  return next;
}
