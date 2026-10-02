import {
  calendarDaysBetween,
  countHolidayWorkdaysBetween,
  getPreviousTradingDayShanghai,
} from './holidaysCN.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
  return ISO_DATE_RE.test(String(value || ''));
}

export function shiftIsoDate(isoDate, deltaDays) {
  if (!isIsoDate(isoDate)) return '';
  const [year, month, day] = String(isoDate).split('-').map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));
  return date.toISOString().slice(0, 10);
}

export function previousIsoDate(isoDate) {
  return shiftIsoDate(isoDate, -1);
}

export function normalizeNavHistoryItems(navItems = []) {
  return (Array.isArray(navItems) ? navItems : [])
    .map((item) => {
      const date = String(item?.date || '').slice(0, 10);
      const nav = Number(item?.nav);
      return isIsoDate(date) && Number.isFinite(nav) && nav > 0
        ? { ...item, date, nav }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function findNavOnDate(navItems, date) {
  if (!isIsoDate(date)) return null;
  return (Array.isArray(navItems) ? navItems : []).find((item) => item?.date === date) || null;
}

export function findNavOnOrBefore(navItems, date) {
  if (!isIsoDate(date)) return null;
  let found = null;
  for (const item of Array.isArray(navItems) ? navItems : []) {
    if (!item || !isIsoDate(item.date)) continue;
    if (item.date <= date && (!found || item.date > found.date)) found = item;
  }
  return found;
}

export function historicalPremiumNavLookupDate(priceDate, isCrossBorder = false) {
  if (!isIsoDate(priceDate)) return '';
  return isCrossBorder ? previousIsoDate(priceDate) : priceDate;
}

export function resolveHistoricalPremiumNavItem(navItems, priceDate, {
  isCrossBorder = false,
  allowPreviousForNonCrossBorder = false,
  skipChinaHolidayGap = false,
} = {}) {
  const lookupDate = historicalPremiumNavLookupDate(priceDate, isCrossBorder);
  if (!lookupDate) return null;
  if (isCrossBorder || allowPreviousForNonCrossBorder) {
    const previous = findNavOnOrBefore(navItems, lookupDate);
    const sameDay = findNavOnDate(navItems, priceDate);
    if (isCrossBorder && previous && countHolidayWorkdaysBetween(previous.date, priceDate) > 0) {
      if (skipChinaHolidayGap) return null;
      if (!sameDay) return previous;
      return sameDay;
    }
    return previous;
  }
  return findNavOnDate(navItems, lookupDate);
}

// 历史溢价点的净值口径分类：
// - same-day / holiday-same-day：正常（非 QDII 同日净值；QDII 节假日回退到价格日当日净值）。
// - previous-trading：盘中未公布当日净值 / QDII 使用上一可用净值的正常回退。
// - holiday-gap：长假期间净值缺口（前一可用净值早于上一交易日，且中间跨了法定假期）。
// - nav-lag：净值滞后（如海外休市导致净值晚公布，缺口没有法定假期特征）。
// holiday-gap / nav-lag 视为陈旧数据：曲线仍展示，但点必须带 navDate 供 UI 说明。
function classifyHistoricalPremiumNavReason(navDate, priceDate, { isCrossBorder = false, allowPreviousForNonCrossBorder = false } = {}) {
  if (!isIsoDate(navDate) || !isIsoDate(priceDate)) return 'unknown';
  if (navDate === priceDate) return isCrossBorder ? 'holiday-same-day' : 'same-day';
  const expectsPrevious = isCrossBorder || allowPreviousForNonCrossBorder;
  if (!expectsPrevious) return 'unmatched';
  const expectedDate = getPreviousTradingDayShanghai(priceDate);
  // navDate 不早于"上一交易日"即视为正常的上一可用净值。
  if (calendarDaysBetween(navDate, expectedDate) <= 0) return 'previous-trading';
  return countHolidayWorkdaysBetween(navDate, priceDate) > 0 ? 'holiday-gap' : 'nav-lag';
}

export function resolveHistoricalPremiumNav(navItems, priceDate, {
  isCrossBorder = false,
  allowPreviousForNonCrossBorder = false,
  skipChinaHolidayGap = false,
} = {}) {
  const item = resolveHistoricalPremiumNavItem(navItems, priceDate, {
    isCrossBorder,
    allowPreviousForNonCrossBorder,
    skipChinaHolidayGap,
  });
  if (!item) return null;
  const nav = Number(item.nav);
  if (!isIsoDate(item.date) || !Number.isFinite(nav) || nav <= 0) return null;
  const reason = classifyHistoricalPremiumNavReason(item.date, priceDate, { isCrossBorder, allowPreviousForNonCrossBorder });
  return {
    item,
    nav,
    navDate: item.date,
    stale: reason === 'holiday-gap' || reason === 'nav-lag',
    reason,
  };
}
