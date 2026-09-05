/**
 * 把 beta 持仓页核心绑到真实账本与行情网关上。
 *
 * 账本直接读正式版的本地存储（holdingsLedgerStorage），不另开一份：
 * beta 与正式版看到的是同一本账，切回去不会对不上。这里只读不写。
 *
 * 行情网关复用行情 tab 的同一个实例，两个 tab 共享 fund-quote 的 90s 缓存。
 */

import { readLedgerState } from '../../app/holdingsLedgerStorage.js';
import { marketsGateway } from './marketsScreen.js';
import { createHoldingsScreenController } from './holdingsScreenCore.js';

export const holdingsScreenController = createHoldingsScreenController({
  readLedger: readLedgerState,
  callAction: (action, params) => marketsGateway.callAction(action, params)
});

/** 拉一次当前持仓，返回可直接渲染的行。 */
export function loadHoldingsScreen(options = {}) {
  return holdingsScreenController.load(options);
}

export default holdingsScreenController;
