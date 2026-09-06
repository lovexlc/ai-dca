export const MOBILE_BOTTOM_NAV_ITEMS = [
  { key: 'markets', label: '行情' },
  { key: 'holdings', label: '持仓' },
  { key: 'tradePlans', label: '计划' },
  { key: 'fundSwitch', label: '换基' },
  { key: 'notify', label: '通知' },
];

export function resolveMobileBottomNavItems(visibleTabs = null) {
  if (!Array.isArray(visibleTabs)) return MOBILE_BOTTOM_NAV_ITEMS;
  const visibleSet = new Set(visibleTabs);
  return MOBILE_BOTTOM_NAV_ITEMS.filter((item) => visibleSet.has(item.key));
}
