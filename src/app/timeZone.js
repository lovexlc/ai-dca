export const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function toDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 100000000000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return toDate(Number(raw));
  }

  // A timestamp without an explicit zone is treated as a Shanghai wall-clock
  // value, so it does not change meaning when the browser runs in UTC.
  const naiveDateTime = raw.match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/)
    ? `${raw.replace(' ', 'T')}+08:00`
    : raw;
  const date = new Date(naiveDateTime);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatParts(value, options) {
  const date = toDate(value);
  if (!date) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    hourCycle: 'h23',
    ...options
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return { date, parts };
}

export function formatShanghaiDateTime(value, { seconds = false } = {}) {
  const result = formatParts(value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {})
  });
  if (result?.parts.year && result.parts.month && result.parts.day && result.parts.hour && result.parts.minute) {
    const suffix = seconds && result.parts.second ? `:${result.parts.second}` : '';
    return `${result.parts.year}-${result.parts.month}-${result.parts.day} ${result.parts.hour}:${result.parts.minute}${suffix}`;
  }
  if (!result) return '';
  return new Date(result.date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, seconds ? 19 : 16).replace('T', ' ');
}

export function formatShanghaiDate(value) {
  const result = formatParts(value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  if (result?.parts.year && result.parts.month && result.parts.day) {
    return `${result.parts.year}-${result.parts.month}-${result.parts.day}`;
  }
  if (!result) return '';
  return new Date(result.date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function formatShanghaiTime(value, { seconds = false } = {}) {
  const result = formatParts(value, {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {})
  });
  if (result?.parts.hour && result.parts.minute) {
    return `${result.parts.hour}:${result.parts.minute}${seconds && result.parts.second ? `:${result.parts.second}` : ''}`;
  }
  if (!result) return '';
  return formatShanghaiDateTime(value, { seconds }).slice(- (seconds ? 8 : 5));
}

export function isSameShanghaiDate(value, compareValue = Date.now()) {
  const date = formatShanghaiDate(value);
  const compareDate = formatShanghaiDate(compareValue);
  return Boolean(date && compareDate && date === compareDate);
}

export function getShanghaiWeekday(value) {
  const result = formatParts(value, { weekday: 'short' });
  return result?.parts.weekday || '';
}
