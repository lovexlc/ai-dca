const STORAGE_KEY = 'markets:groups:v1';
const DEFAULT_GROUPS = [
  { id: 'cn-etf', name: '场内基金', market: 'cn', sourceListId: 'default', isSystem: true },
  { id: 'cn-otc', name: '场外基金', market: 'cn', sourceListId: 'default-otc', isSystem: true },
  { id: 'us-default', name: '美股指标', market: 'us', sourceListId: 'default', isSystem: true },
];

const DEFAULT_COLUMNS = ['kind', 'symbol', 'name', 'price', 'changePercent', 'change', 'updatedAt', 'isHeld', 'alert'];

function now() { return new Date().toISOString(); }

export function defaultMarketGroupState() {
  return { view: 'cards', filters: [], sorting: [{ id: 'heldRank', desc: true }, { id: 'changePercent', desc: true }], columns: [...DEFAULT_COLUMNS] };
}

export function normalizeMarketGroup(group = {}, index = 0) {
  const base = defaultMarketGroupState();
  return {
    id: String(group.id || ('group-' + (index + 1))),
    name: String(group.name || ('分组 ' + (index + 1))),
    market: group.market === 'us' ? 'us' : 'cn',
    sourceListId: String(group.sourceListId || ''),
    isSystem: Boolean(group.isSystem),
    view: group.view === 'table' ? 'table' : base.view,
    filters: Array.isArray(group.filters) ? group.filters : base.filters,
    sorting: Array.isArray(group.sorting) && group.sorting.length ? group.sorting : base.sorting,
    columns: Array.isArray(group.columns) && group.columns.length ? group.columns : base.columns,
    createdAt: group.createdAt || now(),
    updatedAt: group.updatedAt || now(),
  };
}

export function loadMarketGroups() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const storedGroups = Array.isArray(raw?.groups) ? raw.groups.map(normalizeMarketGroup) : [];
    const missingDefaults = DEFAULT_GROUPS.filter((defaultGroup) => !storedGroups.some((group) => group.id === defaultGroup.id)).map(normalizeMarketGroup);
    const groups = [...missingDefaults, ...storedGroups];
    return { groups: groups.length ? groups : DEFAULT_GROUPS.map(normalizeMarketGroup), activeGroupId: raw?.activeGroupId || groups[0]?.id || "cn-etf" };
  } catch {
    return { groups: DEFAULT_GROUPS.map(normalizeMarketGroup), activeGroupId: 'cn-etf' };
  }
}

export function saveMarketGroups(state = {}) {
  const current = loadMarketGroups();
  const groups = (Array.isArray(state.groups) ? state.groups : current.groups).map(normalizeMarketGroup);
  const next = { groups, activeGroupId: groups.some((item) => item.id === state.activeGroupId) ? state.activeGroupId : groups[0]?.id };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore quota errors */ }
  return next;
}

export function updateMarketGroup(groupId, patch = {}) {
  const current = loadMarketGroups();
  const groups = current.groups.map((group) => group.id === groupId ? normalizeMarketGroup({ ...group, ...patch, updatedAt: now() }) : group);
  return saveMarketGroups({ ...current, groups });
}

export function createMarketGroup({ name = '新分组', market = 'cn', sourceListId = '' } = {}) {
  const current = loadMarketGroups();
  const id = 'group-' + Date.now().toString(36);
  const group = normalizeMarketGroup({ id, name: String(name).trim() || '新分组', market, sourceListId, ...defaultMarketGroupState() });
  return saveMarketGroups({ groups: [...current.groups, group], activeGroupId: id });
}

export function deleteMarketGroup(groupId) {
  const current = loadMarketGroups();
  const target = current.groups.find((group) => group.id === groupId);
  if (!target || target.isSystem) return current;
  return saveMarketGroups({ groups: current.groups.filter((group) => group.id !== groupId), activeGroupId: current.activeGroupId === groupId ? current.groups[0]?.id : current.activeGroupId });
}

export function renameMarketGroup(groupId, name) {
  const current = loadMarketGroups();
  const nextName = String(name || '').trim();
  if (!nextName) return current;
  const groups = current.groups.map((group) => group.id === groupId && !group.isSystem
    ? normalizeMarketGroup({ ...group, name: nextName, updatedAt: now() })
    : group);
  return saveMarketGroups({ ...current, groups });
}

export const MARKET_COLUMN_DEFINITIONS = {
  kind: { id: 'kind', label: '基金类型', base: true },
  symbol: { id: 'symbol', label: '代码', base: true },
  name: { id: 'name', label: '名称', base: true },
  price: { id: 'price', label: '最新价 / 净值', base: true },
  changePercent: { id: 'changePercent', label: '今日涨跌幅', base: true },
  change: { id: 'change', label: '今日涨跌额', base: true },
  updatedAt: { id: 'updatedAt', label: '更新时间', base: true },
  isHeld: { id: 'isHeld', label: '持仓状态', optional: true },
  isFavorite: { id: 'isFavorite', label: '自选状态', optional: true },
  alert: { id: 'alert', label: '提醒', optional: true },
  premium: { id: 'premium', label: '溢价率', dynamic: true },
  limit: { id: 'limit', label: '申购限额', dynamic: true },
};

export const BASE_COLUMNS = Object.values(MARKET_COLUMN_DEFINITIONS).filter((item) => item.base);
export const OPTIONAL_COLUMNS = Object.values(MARKET_COLUMN_DEFINITIONS).filter((item) => item.optional);
export const DYNAMIC_COLUMNS = Object.values(MARKET_COLUMN_DEFINITIONS).filter((item) => item.dynamic);
