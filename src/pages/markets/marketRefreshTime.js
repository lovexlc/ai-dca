const MARKET_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const MARKET_CLOCK_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function parseMarketRefreshTimestamp(timestamp = '') {
  const value = String(timestamp || '').trim();
  if (!value) return null;
  const shanghaiValue = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00+08:00`
    : (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)
      ? `${value.replace(' ', 'T')}+08:00`
      : value);
  const date = new Date(shanghaiValue);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatMarketRefreshTime(timestamp = '') {
  const date = parseMarketRefreshTimestamp(timestamp);
  if (!date) return '';
  return MARKET_TIME_FORMATTER.format(date).replace(/\//g, '-');
}

export function formatMarketRefreshClockTime(timestamp = '') {
  const date = parseMarketRefreshTimestamp(timestamp);
  if (!date) return '';
  return MARKET_CLOCK_FORMATTER.format(date);
}
