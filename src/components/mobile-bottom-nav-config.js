export const MOBILE_BOTTOM_NAV_ITEMS = [
  { key: 'home', label: '首页' },
  { key: 'markets', label: '行情' },
  { key: 'holdings', label: '持仓' },
  { key: 'tradePlans', label: '计划' },
  { key: 'fundSwitch', label: '换基' },
  { key: 'notify', label: '通知' },
];

export const MOBILE_BOTTOM_NAV_MAX_TABS = 5;

export function resolveMobileBottomNavItems(visibleTabs = null) {
  if (!Array.isArray(visibleTabs)) return MOBILE_BOTTOM_NAV_ITEMS;
  const visibleSet = new Set(visibleTabs);
  return MOBILE_BOTTOM_NAV_ITEMS.filter((item) => visibleSet.has(item.key));
}

export function splitMobileBottomNavItems(
  visibleTabs = null,
  maxTabs = MOBILE_BOTTOM_NAV_MAX_TABS,
) {
  const items = resolveMobileBottomNavItems(visibleTabs);
  const safeMaxTabs = Math.max(1, Number(maxTabs) || MOBILE_BOTTOM_NAV_MAX_TABS);
  if (items.length <= safeMaxTabs) {
    return { directItems: items, overflowItems: [] };
  }
  const directCount = Math.max(0, safeMaxTabs - 1);
  return {
    directItems: items.slice(0, directCount),
    overflowItems: items.slice(directCount),
  };
}
