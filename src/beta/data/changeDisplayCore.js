/**
 * 涨跌展示的「交易日闸门」内核（beta）。
 *
 * 行情列表 / 详情 / 首页的基金涨跌直接取自快照里的 changePercent，
 * 而快照是「上一次成功刷新」的结果。交易日里如果该基金还没开盘、或最新
 * 涨跌还没拉到（quoteDate / latestNavDate 仍停留在更早的交易日），把昨天的
 * 涨跌当成「今天的涨跌」展示会产生歧义。
 *
 * 规则：
 *   - 非交易日（周末 / 法定节假日）：市场本就休市，展示最近一次已知涨跌即可。
 *   - 交易日：仅当最新数据日期等于「预期最新日期」时才展示真实涨跌，
 *     否则展示 0.0%，避免把历史涨跌误读为当日涨跌。
 *
 * 与 holdingsLedgerCore 的 hasTodayNav 闸门语义保持一致。
 *
 * 本文件刻意不 import 任何东西：日历相关能力全部由调用方注入，
 * 这样单测可以完全离线跑，也不会把 beta 逻辑绑死在某一套节假日实现上。
 * 真实绑定见同目录的 marketChangeDisplay.js。
 */

const REQUIRED_DEPS = ['isTradingDay', 'getToday', 'getExpectedDate', 'normalizeKind'];

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * 把各种日期形态归一成 YYYY-MM-DD；识别不了就返回空串（视为「没有日期」）。
 */
export function toDateStr(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.getFullYear() + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate());
  }
  const raw = String(value);
  const matched = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!matched) return '';
  return matched[1] + '-' + pad2(matched[2]) + '-' + pad2(matched[3]);
}

/**
 * 场内（exchange）看行情快照日期；场外（otc / qdii / lof）看净值日期。
 * 'lof' 默认按场外（T-1）处理；调用方传 'exchange' 时走场内（T）。
 * 场外只认 latestNavDate：没有净值日期就返回空串（不 fresh），
 * 避免把场内价格涨跌当成净值涨跌展示。
 */
export function resolveLatestDataDate(item, kind) {
  if (!item) return '';
  if (kind === 'exchange') {
    const candidates = [item.quoteDate, item.asOf, item.updatedAt];
    for (let i = 0; i < candidates.length; i += 1) {
      const date = toDateStr(candidates[i]);
      if (date) return date;
    }
    return '';
  }
  return toDateStr(item.latestNavDate);
}

/**
 * 绑定一套日历实现，返回闸门函数。
 *
 * @param {object} deps
 * @param {(date: string) => boolean} deps.isTradingDay 该自然日是否为交易日
 * @param {() => string} deps.getToday 今天（上海时区）YYYY-MM-DD
 * @param {(kind: string, today: string) => string} deps.getExpectedDate 该品种「预期最新数据日期」
 * @param {(kind: string, code: string, name: string) => string} deps.normalizeKind 品种归一化
 */
export function createChangeDisplay(deps = {}) {
  for (let i = 0; i < REQUIRED_DEPS.length; i += 1) {
    const name = REQUIRED_DEPS[i];
    if (typeof deps[name] !== 'function') {
      throw new TypeError('createChangeDisplay requires a ' + name + ' function');
    }
  }

  const isTradingDay = deps.isTradingDay;
  const getToday = deps.getToday;
  const getExpectedDate = deps.getExpectedDate;
  const normalizeKind = deps.normalizeKind;

  /**
   * 计算某条基金行情记录「应当展示」的涨跌百分比。
   *
   * @param {object} item 行情记录（含 changePercent / quoteDate / asOf / latestNavDate 等）
   * @param {object} [context] { kind?, todayDate? }
   * @returns {{ changePercent: number|null, fresh: boolean, reason: string }}
   *   changePercent 为展示用涨跌（%）；停牌时为 null，由渲染层替换成「停牌」标识。
   *   fresh 表示这是否是「今日/预期最新」的真实涨跌。
   *   reason 便于 UI 与排障区分 0.0% 到底是「真的没涨跌」还是「数据还没到」。
   */
  function getDisplayChangePercent(item, context = {}) {
    // 停牌：零成交无涨跌，展示为空。
    if (item && item.suspended) {
      return { changePercent: null, fresh: false, reason: 'suspended' };
    }

    const kind = normalizeKind(context.kind, item && item.code, item && item.name);
    const today = context.todayDate || getToday();
    const raw = Number(item && item.changePercent);
    const hasRaw = Number.isFinite(raw);

    // 休市日：展示最近一次已知涨跌没有歧义。
    if (!isTradingDay(today)) {
      return { changePercent: hasRaw ? raw : 0, fresh: false, reason: 'market-closed' };
    }

    const expected = getExpectedDate(kind, today);
    const latest = resolveLatestDataDate(item, kind);
    const fresh = Boolean(latest) && latest === expected;

    // 交易日但数据不是最新的（未开盘 / 未拉到最新涨跌）→ 展示 0.0%。
    if (!fresh) {
      return { changePercent: 0, fresh: false, reason: latest ? 'stale' : 'missing-date' };
    }
    return { changePercent: hasRaw ? raw : 0, fresh: true, reason: 'fresh' };
  }

  return { getDisplayChangePercent };
}
