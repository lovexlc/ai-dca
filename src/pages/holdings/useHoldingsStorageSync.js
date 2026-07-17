import { useEffect } from 'react';
import { readAccountAllocationSettings } from '../../app/accountManager.js';
import { createDefaultLedgerState, readLedgerState } from '../../app/holdingsLedger.js';
import { BACKUP_APPLIED_EVENT } from '../../app/backupEvents.js';
import { HOLDINGS_SYNC_KEYS } from '../../app/syncRegistry.js';
import { USER_DATA_CHANGED_EVENT, USER_DATA_HYDRATION_EVENT, USER_DATA_MODE_EVENT, getUserDataStorage } from '../../app/userDataStore.js';

export function useHoldingsStorageSync({
  setLedger,
  setAccountSettings,
  setLedgerHydrating
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
    }

    function onUserDataChanged(event) {
      // startSession 已经把云端账本放入内存仓库；这里仅响应后续真实交易
      // 资源变化，不能因为派生净值变化又把表格重置成一次新的读取。
      if (event?.detail?.derivedOnly) return;
      if (event?.detail?.remote && event?.detail?.key === 'aiDcaFundHoldingsLedger') {
        refreshHoldingsFromStorage({ detail: { keys: ['aiDcaFundHoldingsLedger'] } });
      }
    }

    function onUserDataHydration(event) {
      const detail = event?.detail || {};
      if (detail.complete === true) {
        setLedgerHydrating?.(false);
        refreshHoldingsFromStorage({ detail: { keys: ['aiDcaFundHoldingsLedger'] } });
        return;
      }
      if (detail.complete === false) {
        const background = Boolean(getUserDataStorage().backgroundHydrating);
        setLedgerHydrating?.(background);
        if (background) return;
        // 恢复接口返回前不允许继续展示匿名态/旧账本，避免用户看到过期金额。
        // 恢复完成后由 USER_DATA_MODE_EVENT 从内存仓库一次性挂载新账本。
        setLedgerHydrating?.(true);
        setLedger(createDefaultLedgerState());
      }
    }

    function onUserDataMode(event) {
      // 水合门禁完成前不会挂载业务页；切换到 remote 时内存仓库已经
      // 包含 startSession 拉取的账本，直接读取即可，禁止再次请求资源接口。
      setLedgerHydrating?.(false);
      refreshHoldingsFromStorage(event);
    }

    function onStorage(event) {
      if (!event || event.key === null || HOLDINGS_SYNC_KEYS.has(String(event.key || ''))) {
        refreshHoldingsFromStorage(event);
      }
    }

    window.addEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsFromStorage);
    window.addEventListener('cloud-sync:auto-restored', refreshHoldingsFromStorage);
    window.addEventListener(USER_DATA_CHANGED_EVENT, onUserDataChanged);
    window.addEventListener(USER_DATA_HYDRATION_EVENT, onUserDataHydration);
    // 页面可能先以匿名态挂载，登录后 userDataStore 才切换到云端内存仓库。
    // startSession 已完成云端交易记录水合，这里只从内存仓库切换来源。
    window.addEventListener(USER_DATA_MODE_EVENT, onUserDataMode);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener(BACKUP_APPLIED_EVENT, refreshHoldingsFromStorage);
      window.removeEventListener('cloud-sync:auto-restored', refreshHoldingsFromStorage);
      window.removeEventListener(USER_DATA_CHANGED_EVENT, onUserDataChanged);
      window.removeEventListener(USER_DATA_HYDRATION_EVENT, onUserDataHydration);
      window.removeEventListener(USER_DATA_MODE_EVENT, onUserDataMode);
      window.removeEventListener('storage', onStorage);
    };
  }, [setAccountSettings, setLedger, setLedgerHydrating]);
}
