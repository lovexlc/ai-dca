import { DEFAULT_MARKET_SORTING } from './marketListSorting.js';
import {
  ANALYSIS_COLUMNS,
  BASE_COLUMNS,
  DEFAULT_CARD_ANALYSIS_COLUMNS,
  DEFAULT_MARKET_COLUMNS,
  DYNAMIC_COLUMNS,
  MARKET_COLUMN_DEFINITIONS,
  OPTIONAL_COLUMNS,
  normalizeCardAnalysisColumns,
  normalizeMarketColumns,
  normalizeColumnOrder,
} from './marketColumns.js';

const STORAGE_KEY = 'markets:groups:v1';
const DEFAULT_GROUPS = [
  { id: 'cn-etf', name: '场内基金', market: 'cn', sourceListId: 'default', isSystem: true },
  { id: 'cn-otc', name: '场外基金', market: 'cn', sourceListId: 'default-otc', isSystem: true },
  { id: 'us-default', name: '美股指标', market: 'us', sourceListId: 'default', isSystem: true },
];

export { ANALYSIS_COLUMNS, BASE_COLUMNS, DYNAMIC_COLUMNS, MARKET_COLUMN_DEFINITIONS, OPTIONAL_COLUMNS };

function now() { return new Date().toISOString(); }

export function defaultMarketGroupState() {
  return {
    view: 'cards',
    desktopView: 'table',
    filters: [],
    sorting: DEFAULT_MARKET_SORTING.map((item) => ({ ...item })),
    columns: [...DEFAULT_MARKET_COLUMNS],
    columnOrder: [...DEFAULT_MARKET_COLUMNS],
    columnSizing: {},
    columnPinning: { left: [] },
    cardAnalysisColumns: [...DEFAULT_CARD_ANALYSIS_COLUMNS],
    showTrend: true,
  };
}

export function normalizeMarketGroup(group = {}, index = 0) {
  const base = defaultMarketGroupState();
  const legacyCardMetrics = JSON.stringify(group.cardAnalysisColumns || []);
  const migratedCardMetrics = legacyCardMetrics === JSON.stringify(['highDrawdown', 'closeHighDrawdown', 'currentYearPercent', 'premium', 'return1w', 'return1m']) || legacyCardMetrics === JSON.stringify(['changePercent', 'change']) ? [...DEFAULT_CARD_ANALYSIS_COLUMNS] : group.cardAnalysisColumns;
  return {
    id: String(group.id || ('group-' + (index + 1))),
    name: String(group.name || ('分组 ' + (index + 1))),
    market: group.market === 'us' ? 'us' : 'cn',
    sourceListId: String(group.sourceListId || ''),
    isSystem: Boolean(group.isSystem),
    view: group.view === 'table' ? 'table' : base.view,
    desktopView: group.desktopView === 'cards' ? 'cards' : base.desktopView,
    filters: Array.isArray(group.filters) ? group.filters : base.filters,
    sorting: Array.isArray(group.sorting) && group.sorting.length ? group.sorting : base.sorting,
    columns: normalizeMarketColumns(group.columns?.length ? group.columns : base.columns),
    columnOrder: normalizeColumnOrder(group.columnOrder?.length ? group.columnOrder : base.columnOrder),
    columnSizing: group.columnSizing && typeof group.columnSizing === 'object' ? group.columnSizing : base.columnSizing,
    columnPinning: group.columnPinning && typeof group.columnPinning === 'object' ? group.columnPinning : base.columnPinning,
    cardAnalysisColumns: normalizeCardAnalysisColumns(migratedCardMetrics?.length ? migratedCardMetrics : base.cardAnalysisColumns),
    showTrend: group.showTrend !== false,
    createdAt: group.createdAt || now(),
    updatedAt: group.updatedAt || now(),
  };
}

export function loadMarketGroups() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const rawGroups = Array.isArray(raw?.groups) ? raw.groups : [];
    const storedGroups = rawGroups.map(normalizeMarketGroup);
    if (rawGroups.length && JSON.stringify(rawGroups) !== JSON.stringify(storedGroups)) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...raw, groups: storedGroups })); } catch { /* ignore quota errors */ }
    }
    const missingDefaults = DEFAULT_GROUPS
      .filter((defaultGroup) => !storedGroups.some((group) => group.id === defaultGroup.id))
      .map(normalizeMarketGroup);
    const groups = [...missingDefaults, ...storedGroups];
    return { groups: groups.length ? groups : DEFAULT_GROUPS.map(normalizeMarketGroup), activeGroupId: raw?.activeGroupId || groups[0]?.id || 'cn-etf' };
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
