/**
 * 把 beta「我的」tab 绑到四份真实本地存储上（全部只读）。
 *
 * 这四份就是 beta 各个 tab 在用的同一份数据，所以这页的数字
 * 可以当体检用：跟正式版对不上时，一眼就能看出是哪一份没读到。
 */

import { readDcaStore } from '../../app/dca.js';
import { readLedgerState } from '../../app/holdingsLedgerStorage.js';
import { readPlanStore } from '../../app/plan.js';
import { BETA_PAGES } from '../betaScreens.js';
import { getActiveWatchlistCodes } from './marketsListing.js';
import { createProfileScreenController } from './profileScreenCore.js';

/** 已经接上真实数据的页面（五个 tab 主页）。 */
export const PORTED_PAGE_KEYS = ['home', 'markets', 'holdings', 'tradeplans', 'profile'];

export const profileScreenController = createProfileScreenController({
  readLedger: () => readLedgerState(),
  readWatchlistCodes: () => getActiveWatchlistCodes(),
  readDcaPlans: () => readDcaStore(),
  readLayeredPlans: () => readPlanStore(),
  getPages: () => BETA_PAGES,
  portedKeys: PORTED_PAGE_KEYS
});

/** 读一次本地数据体检。 */
export function loadProfileScreen() {
  return profileScreenController.load();
}

export default profileScreenController;
