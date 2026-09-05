/**
 * 把 beta 首页核心绑到已有的两个加载器与行情网关上。
 *
 * 首页不自己发请求拉行情，而是复用持仓 tab 与行情 tab 的同一套加载器：
 * 三个 tab 共享 fund-quote 的 90s 缓存，切 tab 不会重复回源，
 * 数字也不会两处对不上。
 */

import { loadHoldingsScreen } from './holdingsScreen.js';
import { marketsGateway, loadMarketsScreen } from './marketsScreen.js';
import { createHomeScreenController } from './homeScreenCore.js';

export const homeScreenController = createHomeScreenController({
  loadHoldings: (options) => loadHoldingsScreen(options),
  loadMarkets: (options) => loadMarketsScreen(options),
  callAction: (action, params) => marketsGateway.callAction(action, params)
});

/** 拉一次首页的三段数据。 */
export function loadHomeScreen(options = {}) {
  return homeScreenController.load(options);
}

export default homeScreenController;
