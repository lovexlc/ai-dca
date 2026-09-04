/**
 * beta 行情列表的视图模型。
 *
 * 职责：把「自选单」+「行情快照」拼成可以直接渲染的行，涨跌一律交给
 * changeDisplayCore 的闸门判定，渲染层不再各自处理字段别名与
 * 「数据还没到」这类情况。
 *
 * 后端不同 action 返回的字段名并不统一（code/symbol、price/close、
 * premiumPercent/premiumPct…），别名兜底集中放在这里，避免每个页面各写一份。
 *
 * 本文件刻意不 import 任何东西：外部能力全部注入，单测可完全离线跑。
 * 真实绑定见同目录的 marketsListing.js。
 */

const REQUIRED_DEPS = ['getDisplayChangePercent'];

// 自选单的 type 决定这一列按场内还是场外解读涨跌与最新数据日期。
const LIST_TYPE_KINDS = {
  cn_etf: 'exchange',
  cn_otc: 'otc',
  cn_qdii: 'qdii'
};

const CODE_KEYS = ['code', 'symbol', 'fundCode', 'secid', 'secId'];
const NAME_KEYS = ['name', 'fundName', 'shortName', 'secName'];
const PRICE_KEYS = ['price', 'currentPrice', 'close', 'lastPrice'];
const NAV_KEYS = ['latestNav', 'nav', 'navBase', 'unitNav'];
const PREMIUM_KEYS = ['premiumPercent', 'premiumPct', 'premium'];

const EMPTY_TEXT = '—';

/** 数字兜底：接受 1.23 / '1.23' / '+1.23%' / '1,234.5'；识别不了返回 null。 */
export function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[%,\s]/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** 依次尝试一组别名，返回第一个有值的字段；空串视为没值。 */
export function pickField(source, keys) {
  if (!source || typeof source !== 'object') return undefined;
  for (let i = 0; i < keys.length; i += 1) {
    const value = source[keys[i]];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return undefined;
}

export function pickNumberField(source, keys) {
  return toFiniteNumber(pickField(source, keys));
}

/** 代码归一：去空格并统一大写，便于自选单与快照对齐。 */
export function normalizeRowCode(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toUpperCase();
}

/** 自选单 type 到品种的映射；没标 type 的旧列表按 fallback 处理。 */
export function resolveListKind(list, fallback = 'otc') {
  if (!list || typeof list !== 'object') return fallback;
  const type = String(list.type || '').trim();
  return LIST_TYPE_KINDS[type] || fallback;
}

/** 取出某个市场下的代码：保持自选单原有顺序，去重并丢掉空值。 */
export function getListCodes(list, market = 'cn') {
  const raw = list && typeof list === 'object' ? list[market] : null;
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const codes = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    const source = item && typeof item === 'object' ? pickField(item, CODE_KEYS) : item;
    const code = normalizeRowCode(source);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

/** 选出当前激活的列表；结构异常时尽量退化成一个可用列表而不是抛错。 */
export function selectActiveList(watchlist) {
  if (!watchlist || typeof watchlist !== 'object') return null;
  const lists = Array.isArray(watchlist.lists) ? watchlist.lists.filter(Boolean) : [];
  if (!lists.length) {
    // 极早期或被清过的存量数据：只有裸的 us / cn 两个数组。
    if (Array.isArray(watchlist.cn) || Array.isArray(watchlist.us)) {
      return {
        id: 'default',
        name: '默认',
        type: watchlist.type || undefined,
        us: Array.isArray(watchlist.us) ? watchlist.us : [],
        cn: Array.isArray(watchlist.cn) ? watchlist.cn : []
      };
    }
    return null;
  }
  const activeId = String(watchlist.activeListId || '');
  for (let i = 0; i < lists.length; i += 1) {
    if (String(lists[i].id) === activeId) return lists[i];
  }
  return lists[0];
}

/** 预设名录索引：先出现的分组优先（场内预设应排在场外之前）。 */
export function buildPresetIndex(...groups) {
  const index = new Map();
  const visit = (group) => {
    if (!Array.isArray(group)) return;
    for (let i = 0; i < group.length; i += 1) {
      const item = group[i];
      if (Array.isArray(item)) {
        visit(item);
        continue;
      }
      const code = normalizeRowCode(pickField(item, CODE_KEYS));
      if (!code || index.has(code)) continue;
      index.set(code, item);
    }
  };
  for (let i = 0; i < groups.length; i += 1) visit(groups[i]);
  return index;
}

/**
 * 行情快照索引：数组、{items:[]} / {rows:[]} 包装、以代码为键的对象都能吃。
 * 同一代码后出现的覆盖先出现的——刷新结果通常追加在缓存结果之后。
 */
export function indexSnapshots(quotes, normalizeCode) {
  const normalize = typeof normalizeCode === 'function' ? normalizeCode : normalizeRowCode;
  const index = new Map();
  if (!quotes || typeof quotes !== 'object') return index;
  let entries = null;
  if (Array.isArray(quotes)) entries = quotes;
  else if (Array.isArray(quotes.items)) entries = quotes.items;
  else if (Array.isArray(quotes.rows)) entries = quotes.rows;
  if (entries) {
    for (let i = 0; i < entries.length; i += 1) {
      const item = entries[i];
      const code = normalize(pickField(item, CODE_KEYS));
      if (!code) continue;
      index.set(code, item);
    }
    return index;
  }
  const keys = Object.keys(quotes);
  for (let i = 0; i < keys.length; i += 1) {
    const value = quotes[keys[i]];
    if (!value || typeof value !== 'object') continue;
    const code = normalize(pickField(value, CODE_KEYS) || keys[i]);
    if (!code) continue;
    index.set(code, value);
  }
  return index;
}

export function formatPercent(value, options = {}) {
  const digits = options.digits === undefined ? 2 : options.digits;
  const blank = options.blank === undefined ? EMPTY_TEXT : options.blank;
  const num = toFiniteNumber(value);
  if (num === null) return blank;
  const sign = num > 0 ? '+' : (num < 0 ? '-' : '');
  return sign + Math.abs(num).toFixed(digits) + '%';
}

export function formatPrice(value, options = {}) {
  const digits = options.digits === undefined ? 3 : options.digits;
  const blank = options.blank === undefined ? EMPTY_TEXT : options.blank;
  const num = toFiniteNumber(value);
  if (num === null) return blank;
  return num.toFixed(digits);
}

/** 行的品种：快照自带 > 注入的探测 > 列表 type。 */
export function resolveRowKind(options = {}) {
  const fromSnapshot = pickField(options.snapshot, ['kind', 'fundKind']);
  if (fromSnapshot) return String(fromSnapshot).trim().toLowerCase();
  if (typeof options.detectKind === 'function') {
    const detected = options.detectKind(options.code, options.name);
    if (detected) return String(detected).trim().toLowerCase();
  }
  return options.listKind || 'otc';
}

/** 排序：没数据的行永远沉底，不参与涨跌比较。 */
export function sortRows(rows, options = {}) {
  const by = options.by || 'changePercent';
  const direction = options.direction === 'asc' ? 'asc' : 'desc';
  const list = Array.isArray(rows) ? rows.slice() : [];
  const factor = direction === 'asc' ? -1 : 1;
  return list.sort((a, b) => {
    if (by === 'code' || by === 'name') {
      const av = String((a && a[by]) || '');
      const bv = String((b && b[by]) || '');
      return av.localeCompare(bv, 'zh-CN') * (direction === 'asc' ? 1 : -1);
    }
    const an = toFiniteNumber(a && a[by]);
    const bn = toFiniteNumber(b && b[by]);
    if (an === null && bn === null) return 0;
    if (an === null) return 1;
    if (bn === null) return -1;
    if (an === bn) return 0;
    return an < bn ? factor : -factor;
  });
}

/** 列表头要用的计数：多少行有数据、多少行是今天的、多少行停牌。 */
export function summarizeRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const summary = {
    total: 0,
    withData: 0,
    missing: 0,
    fresh: 0,
    stale: 0,
    suspended: 0,
    marketClosed: 0
  };
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!row) continue;
    summary.total += 1;
    if (row.missing) summary.missing += 1;
    else summary.withData += 1;
    if (row.fresh) summary.fresh += 1;
    if (row.reason === 'stale' || row.reason === 'missing-date') summary.stale += 1;
    if (row.reason === 'suspended') summary.suspended += 1;
    if (row.reason === 'market-closed') summary.marketClosed += 1;
  }
  return summary;
}

/**
 * 绑定涨跌闸门，返回行构造器。
 *
 * @param {object} deps
 * @param {(item: object, context: object) => object} deps.getDisplayChangePercent 涨跌闸门
 * @param {(value: unknown) => string} [deps.normalizeCode] 代码归一（默认只做 trim + 大写）
 * @param {(code: string, name: string) => string} [deps.detectKind] 按代码/名称探测品种
 */
export function createMarketsViewModel(deps = {}) {
  for (let i = 0; i < REQUIRED_DEPS.length; i += 1) {
    const name = REQUIRED_DEPS[i];
    if (typeof deps[name] !== 'function') {
      throw new TypeError('createMarketsViewModel requires a ' + name + ' function');
    }
  }

  const getDisplayChangePercent = deps.getDisplayChangePercent;
  const normalizeCode = typeof deps.normalizeCode === 'function' ? deps.normalizeCode : normalizeRowCode;
  const detectKind = typeof deps.detectKind === 'function' ? deps.detectKind : null;

  function buildRow(options = {}) {
    const code = normalizeCode(options.code);
    const snapshot = options.snapshot || null;
    const preset = options.preset || null;
    const listKind = options.listKind || 'otc';
    const name = String(pickField(snapshot, NAME_KEYS) || pickField(preset, NAME_KEYS) || code);
    const kind = resolveRowKind({ snapshot, code, name, listKind, detectKind });

    // 没有快照不等于涨跌为 0：单独标成 no-data，渲染层显示占位而不是 0.00%。
    const display = snapshot
      ? getDisplayChangePercent(snapshot, { kind, todayDate: options.todayDate || '' })
      : { changePercent: null, fresh: false, reason: 'no-data' };

    const reason = (display && display.reason) || 'no-data';
    const changePercent = toFiniteNumber(display && display.changePercent);
    const price = pickNumberField(snapshot, PRICE_KEYS);
    const nav = pickNumberField(snapshot, NAV_KEYS);
    const premiumPercent = pickNumberField(snapshot, PREMIUM_KEYS);

    return {
      code,
      name,
      kind,
      missing: !snapshot,
      suspended: reason === 'suspended',
      price,
      priceText: formatPrice(price),
      nav,
      navText: formatPrice(nav, { digits: 4 }),
      changePercent,
      changeText: reason === 'suspended' ? '停牌' : formatPercent(changePercent),
      direction: changePercent === null || changePercent === 0 ? 'flat' : (changePercent > 0 ? 'up' : 'down'),
      premiumPercent,
      premiumText: formatPercent(premiumPercent),
      fresh: Boolean(display && display.fresh),
      reason,
      exchange: String(pickField(preset, ['exchange']) || pickField(snapshot, ['exchange']) || ''),
      snapshot
    };
  }

  function buildRows(options = {}) {
    const list = options.list || selectActiveList(options.watchlist || null);
    const listKind = options.listKind || resolveListKind(list);
    const market = options.market || 'cn';
    const rawCodes = Array.isArray(options.codes) && options.codes.length
      ? options.codes
      : getListCodes(list, market);
    const presets = options.presets instanceof Map ? options.presets : buildPresetIndex(options.presets);
    const snapshots = indexSnapshots(options.quotes, normalizeCode);
    const todayDate = options.todayDate || '';

    const seen = new Set();
    const rows = [];
    for (let i = 0; i < rawCodes.length; i += 1) {
      // 注入的归一可能比 getListCodes 更激进（比如剥掉 sh/sz 前缀），这里再去一次重。
      const code = normalizeCode(rawCodes[i]);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      rows.push(buildRow({
        code,
        snapshot: snapshots.get(code) || null,
        preset: presets.get(code) || presets.get(normalizeRowCode(code)) || null,
        listKind,
        todayDate
      }));
    }
    return rows;
  }

  return { buildRow, buildRows };
}
