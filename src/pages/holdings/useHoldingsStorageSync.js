import { useEffect } from 'react';
import { readAccountAssignments } from '../../app/accountManager.js';
import { readLedgerState } from '../../app/holdingsLedger.js';
import { readTradeLedger } from '../../app/tradeLedger.js';
import { BACKUP_APPLIED_EVENT } from '../../app/webdavBackup.js';

const HOLDINGS_SYNC_KEYS = new Set([
  'aiDcaFundHoldingsLedger',
  'aiDcaFundHoldingsState',
  'aiDcaAccountAssignments',
  'aiDcaTradeLedger'
]);

export function useHoldingsStorageSync({
  setLedger,
  setAccountAssignments,
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
      setAccountAssignments(readAccountAssignments());
      setTradeLedgerEntries(readTradeLedger());
    }

    function onStorage(event) {
      if (!event || event.key === null || HOLDINGS_SYNC_KEYS.has(String(event.key || ''))) {
        refreshHoldingsFromStorage(event);
      }
    }

    window.addEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsFromStorage);
    window.addEventListener('cloud-sync:auto-restored', refreshHoldingsFromStorage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsFromStorage);
      window.removeEventListener('cloud-sync:auto-restored', refreshHoldingsFromStorage);
      window.removeEventListener('storage', onStorage);
    };
  }, [setAccountAssignments, setLedger, setTradeLedgerEntries]);
}
