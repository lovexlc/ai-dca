/**
 * Cron hooks for OTC batch writes (NAV + limit). Read paths live elsewhere.
 */
import { OTC_ALL_FUNDS } from './otcFundList.js';
import { syncOtcFundsTask } from './otcFundSync.js';
import { syncOtcFundLimitsFromCacheTask } from './otcFundLimitSync.js';

/**
 * Push OTC write tasks for the given UTC clock (scheduledTime).
 * @param {object} env
 * @param {Date} now
 * @param {Array<Promise<unknown>>} tasks
 */
export function enqueueOtcScheduledWrites(env, now, tasks) {
  const hourUtc = now.getUTCHours();
  const minute = now.getUTCMinutes();
  // 北京 19:30 / 20:30 / 21:30 → 净值 KV + D1
  if (minute === 30 && (hourUtc === 11 || hourUtc === 12 || hourUtc === 13)) {
    console.log('[scheduled] OTC fund NAV batch write (KV+D1) at UTC ' + hourUtc + ':30');
    tasks.push(syncOtcFundsTask(env, OTC_ALL_FUNDS));
  }
  // 北京 20:30：ocr 20:00 已暖限额 KV → 灌 D1（无需 admin secret）
  if (minute === 30 && hourUtc === 12) {
    console.log('[scheduled] OTC fund LIMIT batch write (cache→D1) at UTC 12:30');
    tasks.push(syncOtcFundLimitsFromCacheTask(env, OTC_ALL_FUNDS));
  }
}
