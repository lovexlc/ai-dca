import { useEffect } from 'react';
import { readAccountAllocationSettings } from '../../app/accountManager.js';
import { readLedgerState } from '../../app/holdingsLedger.js';
import { readTradeLedger } from '../../app/tradeLedger.js';
import { BACKUP_APPLIED_EVENT } from '../../app/backupEvents.js';
import { HOLDINGS_SYNC_KEYS } from '../../app/syncRegistry.js';
import { userDataStore, USER_DATA_MODE_EVENT } from '../../app/userDataStore.js';

const HOLDINGS_LEDGER_RESOURCE_KEY = 'aiDcaFundHoldingsLedger';

export function useHoldingsStorageSync({
  setLedger,
  setAccountSettings,
  setTradeLedgerEntries
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let cancelled = false;

    function shouldRefreshFromEvent(event) {
      const keys = Array.isArray(event?.detail?.keys) ? event.detail.keys : [];
      if (!keys.length) return true;
      return keys.some((key) => HOLDINGS_SYNC_KEYS.has(String(key || '')));
    }

    function refreshHoldingsFromStorage(event) {
      if (cancelled || !shouldRefreshFromEvent(event)) return;
      setLedger(readLedgerState());
      setAccountSettings(readAccountAllocationSettings());
      setTradeLedgerEntries(readTradeLedger());
    }

    async function refreshRemoteLedger() {
      if (cancelled || !userDataStore.isAuthenticated()) return;
      const session = userDataStore.session;
      // The registered ledger key is memory-only in remote mode, so this
      // initial read cannot fall back to a browser-local aggregate.
      refreshHoldingsFromStorage({ detail: { keys: [HOLDINGS_LEDGER_RESOURCE_KEY] } });
      try {
        await userDataStore.refreshResource(HOLDINGS_LEDGER_RESOURCE_KEY);
        if (cancelled || !userDataStore.isAuthenticated() || userDataStore.session !== session) return;
        refreshHoldingsFromStorage({ detail: { keys: [HOLDINGS_LEDGER_RESOURCE_KEY] } });
      } catch (error) {
        // Keep the already-rendered remote memory state if the refresh fails;
        // a transient API error must not blank the business page.
        if (!cancelled && userDataStore.isAuthenticated() && userDataStore.session === session) {
          console.warn('[holdings] transaction ledger refresh failed', error);
          refreshHoldingsFromStorage({ detail: { keys: [HOLDINGS_LEDGER_RESOURCE_KEY] } });
        }
      }
    }

    function onUserDataMode(event) {
      if (event?.detail?.mode === 'remote') {
        void refreshRemoteLedger();
        return;
      }
      refreshHoldingsFromStorage(event);
    }

    function onStorage(event) {
      if (!event || event.key === null || HOLDINGS_SYNC_KEYS.has(String(event.key || ''))) {
        refreshHoldingsFromStorage(event);
      }
    }

    window.addEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsFromStorage);
    window.addEventListener('cloud-sync:auto-restored', refreshHoldingsFromStorage);
    // 页面可能先以匿名态挂载，登录后 userDataStore 才切换到云端内存仓库。
    // 登录态每次挂载/切换都直接读取云端交易记录，避免旧缓存污染纵览。
    window.addEventListener(USER_DATA_MODE_EVENT, onUserDataMode);
    window.addEventListener('storage', onStorage);
    if (userDataStore.isAuthenticated()) void refreshRemoteLedger();
    return () => {
      cancelled = true;
      window.removeEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsFromStorage);
      window.removeEventListener('cloud-sync:auto-restored', refreshHoldingsFromStorage);
      window.removeEventListener(USER_DATA_MODE_EVENT, onUserDataMode);
      window.removeEventListener('storage', onStorage);
    };
  }, [setAccountSettings, setLedger, setTradeLedgerEntries]);
}
