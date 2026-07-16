import { useEffect } from 'react';
import { readAccountAllocationSettings } from '../../app/accountManager.js';
import { readLedgerState } from '../../app/holdingsLedger.js';
import { readTradeLedger } from '../../app/tradeLedger.js';
import { BACKUP_APPLIED_EVENT } from '../../app/backupEvents.js';
import { HOLDINGS_SYNC_KEYS } from '../../app/syncRegistry.js';
import { USER_DATA_MODE_EVENT } from '../../app/userDataStore.js';

export function useHoldingsStorageSync({
  setLedger,
  setAccountSettings,
  setTradeLedgerEntries
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    function shouldRefreshFromEvent(event) {
      const keys = Array.isArray(event?.detail?.keys) ? event.detail.keys : [];
      if (!keys.length) return true;
      return keys.some((key) => HOLDINGS_SYNC_KEYS.has(String(key || '')));
    }

    function refreshHoldingsFromStorage(event) {
      if (!shouldRefreshFromEvent(event)) return;
      setLedger(readLedgerState());
      setAccountSettings(readAccountAllocationSettings());
      setTradeLedgerEntries(readTradeLedger());
    }

    function onStorage(event) {
      if (!event || event.key === null || HOLDINGS_SYNC_KEYS.has(String(event.key || ''))) {
        refreshHoldingsFromStorage(event);
      }
    }

    window.addEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsFromStorage);
    window.addEventListener('cloud-sync:auto-restored', refreshHoldingsFromStorage);
    // 页面可能先以匿名态挂载，登录后 userDataStore 才切换到云端内存仓库。
    // 此时不能继续沿用首次挂载时从原生 LocalStorage 读到的旧 ledger。
    window.addEventListener(USER_DATA_MODE_EVENT, refreshHoldingsFromStorage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsFromStorage);
      window.removeEventListener('cloud-sync:auto-restored', refreshHoldingsFromStorage);
      window.removeEventListener(USER_DATA_MODE_EVENT, refreshHoldingsFromStorage);
      window.removeEventListener('storage', onStorage);
    };
  }, [setAccountSettings, setLedger, setTradeLedgerEntries]);
}
