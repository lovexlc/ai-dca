/**
 * 把 beta 持仓明细核心绑到真实账本与行情网关上。
 *
 * 与持仓 tab 共用同一本账、同一个网关实例（fund-quote 共享 90s 缓存），
 * 所以明细页与列表页的市值、均价、今日盈亏一定对得上。只读不写。
 */

import { readLedgerState } from '../../app/holdingsLedgerStorage.js';
import { createHoldingsDetailController } from './holdingsDetailCore.js';
import { marketsGateway } from './marketsScreen.js';

export const holdingsDetailController = createHoldingsDetailController({
  readLedger: readLedgerState,
  callAction: (action, params) => marketsGateway.callAction(action, params)
});

/** 拉一只基金的持仓明细与历史流水。 */
export function loadHoldingsDetail(options = {}) {
  return holdingsDetailController.load(options);
}

export default holdingsDetailController;
