/**
 * 把 beta 行情视图模型绑到网页端已有的自选单、代码归一与涨跌闸门上。
 *
 * 与 marketChangeDisplay.js 一个套路：纯逻辑与单测在 ./marketsViewModel.js，
 * 这里只做绑定，不重复实现任何业务规则。
 */

import {
  CN_ETF_WATCHLIST_PRESETS,
  CN_OTC_WATCHLIST_PRESETS,
  loadWatchlist
} from '../../app/marketsWatchlistStorage.js';
import { normalizeFundCode } from './marketActions.js';
import { getDisplayChangePercent } from './marketChangeDisplay.js';
import {
  buildPresetIndex,
  createMarketsViewModel,
  getListCodes,
  normalizeRowCode,
  resolveListKind,
  selectActiveList,
  sortRows,
  summarizeRows
} from './marketsViewModel.js';

// 场内预设排在前面：161130 这类 LOF 两边都有，列表里应当优先当场内看。
const PRESET_INDEX = buildPresetIndex(CN_ETF_WATCHLIST_PRESETS, CN_OTC_WATCHLIST_PRESETS);

// normalizeFundCode 只认六位基金代码，遇到 ^VIX / CNN_FNG 这类指标代码会给空串，
// 这里回退到只做 trim + 大写，避免整行被丢掉。
function normalizeCode(value) {
  return normalizeFundCode(value) || normalizeRowCode(value);
}

const viewModel = createMarketsViewModel({
  getDisplayChangePercent,
  normalizeCode
});

/** 给定（或读取本地）自选单 + 行情快照，拼出可直接渲染的行。 */
export function buildWatchlistRows(options = {}) {
  const watchlist = options.watchlist || loadWatchlist();
  return viewModel.buildRows({
    ...options,
    watchlist,
    presets: options.presets || PRESET_INDEX
  });
}

/** 当前激活自选单的代码，用于批量拉行情。 */
export function getActiveWatchlistCodes(watchlist) {
  return getListCodes(selectActiveList(watchlist || loadWatchlist()));
}

/** 当前激活自选单是场内还是场外。 */
export function getActiveListKind(watchlist) {
  return resolveListKind(selectActiveList(watchlist || loadWatchlist()));
}

export { PRESET_INDEX, getListCodes, resolveListKind, selectActiveList, sortRows, summarizeRows };
export default viewModel;
