// A 股交易时段判定。前端 webNotifyClient 用来在非交易时段跳过 `/api/notify/events` 轮询。
//
// 逻辑与 workers/notify/src/switchStrategy.js:160 `isInTradingSession` 完全一致：
//   周一至周五（Asia/Shanghai） 09:30-11:30 和 13:00-15:00。
//
// 没有单独处理 A 股节假日。需要更精细的节假日表时再扩展。

export function getShanghaiHourMinute(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  const hourRaw = parts.hour === '24' ? '00' : parts.hour;
  return {
    weekday: String(parts.weekday || ''),
    hour: Number(hourRaw),
    minute: Number(parts.minute || '0')
  };
}

export function isInTradingSession(date = new Date()) {
  const { weekday, hour, minute } = getShanghaiHourMinute(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const m = hour * 60 + minute;
  if (m >= 570 && m <= 690) return true; // 09:30-11:30
  if (m >= 780 && m <= 900) return true; // 13:00-15:00
  return false;
}
