/**
 * 把 beta 行情页核心绑到真实网关与自选单上。
 *
 * 与 marketsListing.js 一个套路：纯逻辑与单测在 ./marketsScreenCore.js，
 * 这里只做绑定。网关实例模块级单例，因为 fund-quote 的 90s 缓存
 * 就在网关内部，换页重建网关等于每次都回源。
 */

import { createMarketsGateway } from './marketsGateway.js';
import {
  buildWatchlistRows,
  getActiveListKind,
  getActiveWatchlistCodes,
  summarizeRows
} from './marketsListing.js';
import { createMarketsScreenController } from './marketsScreenCore.js';

export const marketsGateway = createMarketsGateway();

export const marketsScreenController = createMarketsScreenController({
  callAction: (action, params) => marketsGateway.callAction(action, params),
  buildRows: buildWatchlistRows,
  getActiveWatchlistCodes,
  getActiveListKind,
  summarizeRows
});

/** 拉一次当前自选单的行情，返回可直接渲染的行。 */
export function loadMarketsScreen(options = {}) {
  return marketsScreenController.load(options);
}

export default marketsScreenController;
