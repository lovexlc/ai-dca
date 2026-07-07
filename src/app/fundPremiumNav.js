import { countHolidayWorkdaysBetween } from './holidaysCN.js';

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
