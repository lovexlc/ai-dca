function shanghaiMinuteLabelFromMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(new Date(n)).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    if (parts.year && parts.month && parts.day && parts.hour && parts.minute) {
      return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    }
  } catch {
    // Fall through to deterministic UTC+8 fallback.
  }
  return new Date(n + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export function formatTradeDateTime(trade = {}) {
  const direct = String(trade.datetime || trade.dateTime || trade.executedAt || '').trim();
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(direct)) return direct.slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2}T/.test(direct)) {
    const parsed = Date.parse(direct);
    if (Number.isFinite(parsed)) return shanghaiMinuteLabelFromMs(parsed);
  }

  const ts = Number(trade.ts ?? trade.timestamp);
  if (Number.isFinite(ts) && ts > 0) {
    return shanghaiMinuteLabelFromMs(ts < 10000000000 ? ts * 1000 : ts);
  }

  return String(trade.date || '').trim() || '--';
}
