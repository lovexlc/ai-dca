/**
 * 把 beta 行情明细核心绑到真实行情网关与本地账本上。
 *
 * 与行情 tab、持仓 tab 共用同一个网关实例，因此 fund-quote 的 90s 缓存
 * 在三个 tab 与两个二级页之间共享，点进点出不会重复回源。只读不写。
 */

import { readLedgerState } from '../../app/holdingsLedgerStorage.js';
import { createMarketDetailController } from './marketDetailCore.js';
import { marketsGateway } from './marketsScreen.js';

export const marketDetailController = createMarketDetailController({
  callAction: (action, params) => marketsGateway.callAction(action, params),
  readLedger: readLedgerState
});

/** 拉一只基金的报价、指标、日线与我的持仓。 */
export function loadMarketDetail(options = {}) {
  return marketDetailController.load(options);
}

export default marketDetailController;
