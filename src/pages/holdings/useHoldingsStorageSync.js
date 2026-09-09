import { useEffect } from 'react';
import { readAccountAllocationSettings } from '../../app/accountManager.js';
import { readLedgerState } from '../../app/holdingsLedger.js';
import { readTradeLedger } from '../../app/tradeLedger.js';
import { BACKUP_APPLIED_EVENT } from '../../app/backupEvents.js';
import { HOLDINGS_SYNC_KEYS } from '../../app/syncRegistry.js';

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

    function onLedgerUpdated(event) {
      // persistLedgerState 在本页每次 setState 后都会广播；只有云端拉取的写入需要反映到 React。
      if (event?.detail?.source === 'cloud-transactions') refreshHoldingsFromStorage(event);
    }

    function onStorage(event) {
      if (!event || event.key === null || HOLDINGS_SYNC_KEYS.has(String(event.key || ''))) {
        refreshHoldingsFromStorage(event);
      }
    }

    window.addEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsFromStorage);
    window.addEventListener('cloud-sync:auto-restored', refreshHoldingsFromStorage);
    window.addEventListener('holdings:ledger-updated', onLedgerUpdated);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsFromStorage);
      window.removeEventListener('cloud-sync:auto-restored', refreshHoldingsFromStorage);
      window.removeEventListener('holdings:ledger-updated', onLedgerUpdated);
      window.removeEventListener('storage', onStorage);
    };
  }, [setAccountSettings, setLedger, setTradeLedgerEntries]);
}
