import { useEffect } from 'react';
import { BACKUP_APPLIED_EVENT } from '../../app/webdavBackup.js';
import { loadWatchlist } from '../../app/marketsApi.js';
import { readLedgerState } from '../../app/holdingsLedger.js';
import { readTradeLedger } from '../../app/tradeLedger.js';
import { HOLDINGS_SYNC_KEYS } from '../../app/syncRegistry.js';

// Markets 页的环境 / 同步监听副作用：移动端断点 + 账号云同步恢复后重读自选清单。
// 抽到独立 hook 以控制 MarketsExperience 编排文件体量（见 scripts/check_refactor_guard.mjs 预算）。
export function shouldRefreshMarketsHoldingsFromSyncEvent(event) {
  const keys = Array.isArray(event?.detail?.keys) ? event.detail.keys : [];
  if (!keys.length) return true;
  return keys.some((key) => HOLDINGS_SYNC_KEYS.has(String(key || '')));
}

export function useMarketsPageSync({ setIsMobile, setWatch, setHoldingsLedger, setTradeLedgerEntries }) {
  // 响应式：监听移动端断点。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 1023px)');
    const h = () => setIsMobile(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', h) : mq.removeListener(h); };
  }, [setIsMobile]);

  // 账号云同步恢复后重新读取自选清单（restore/merge 直接写 localStorage，不会触发本页 state 更新）。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onBackupApplied(event) {
      const keys = Array.isArray(event?.detail?.keys) ? event.detail.keys : [];
      if (keys.length && !keys.includes('markets:watchlist:v1')) return;
      setWatch(loadWatchlist());
    }
    window.addEventListener(BACKUP_APPLIED_EVENT, onBackupApplied);
    return () => window.removeEventListener(BACKUP_APPLIED_EVENT, onBackupApplied);
  }, [setWatch]);

  // 账号云同步恢复持仓/交易流水后，Markets 页详情图表也要重读本地数据，
  // 否则同窗口登录恢复不会触发 storage 事件，买卖点仍使用旧 state。
  useEffect(() => {
    if (typeof window === 'undefined' || !setHoldingsLedger || !setTradeLedgerEntries) return undefined;
    function refreshHoldingsForMarkets(event) {
      if (!shouldRefreshMarketsHoldingsFromSyncEvent(event)) return;
      setHoldingsLedger(readLedgerState());
      setTradeLedgerEntries(readTradeLedger());
    }
    window.addEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsForMarkets);
    window.addEventListener('cloud-sync:auto-restored', refreshHoldingsForMarkets);
    return () => {
      window.removeEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsForMarkets);
      window.removeEventListener('cloud-sync:auto-restored', refreshHoldingsForMarkets);
    };
  }, [setHoldingsLedger, setTradeLedgerEntries]);
}
