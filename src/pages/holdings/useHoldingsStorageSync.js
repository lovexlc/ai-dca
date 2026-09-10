import { useCallback, useEffect, useState } from 'react';
import { normalizeAccountAllocationSettings, readAccountAllocationSettings } from '../../app/accountManager.js';
import { fetchAccountResource } from '../../app/accountApi.js';
import { CLOUD_SYNC_SESSION_EVENT, loadCloudSession } from '../../app/authSession.js';
import { BACKUP_APPLIED_EVENT } from '../../app/backupEvents.js';
import { fetchHoldingTransactionRows } from '../../app/holdingTransactionsApi.js';
import { normalizeLedgerState, readLedgerState } from '../../app/holdingsLedger.js';
import { setAccountRuntimeStorageRaw } from '../../app/accountRuntimeStore.js';
import { HOLDINGS_SYNC_KEYS } from '../../app/syncRegistry.js';
import { readTradeLedger } from '../../app/tradeLedger.js';

const LEDGER_STORAGE_KEY = 'aiDcaFundHoldingsLedger';
const ACCOUNT_STORAGE_KEY = 'aiDcaAccountAllocationSettings';
const TRADE_LEDGER_STORAGE_KEY = 'aiDcaTradeLedger';

async function fetchAllHoldingTransactions(session) {
  const transactions = [];
  let cursor = '';
  do {
    const payload = await fetchHoldingTransactionRows({ cursor, limit: 1000 }, session);
    for (const row of Array.isArray(payload?.rows) ? payload.rows : []) {
      const transaction = row?.data || row;
      if (transaction && typeof transaction === 'object') transactions.push(transaction);
    }
    cursor = String(payload?.nextCursor || '');
  } while (cursor);
  return transactions;
}

async function fetchOptionalResourceData(resource, fallback, session) {
  try {
    const payload = await fetchAccountResource(resource, session);
    return payload?.data === null || payload?.data === undefined ? fallback : payload.data;
  } catch (error) {
    if (Number(error?.status) === 404) return fallback;
    throw error;
  }
}

function writeRemoteRuntimeSnapshot({ transactions, accountSettings, tradeLedgerEntries }) {
  setAccountRuntimeStorageRaw(LEDGER_STORAGE_KEY, JSON.stringify({ transactions }));
  setAccountRuntimeStorageRaw(ACCOUNT_STORAGE_KEY, JSON.stringify(accountSettings));
  setAccountRuntimeStorageRaw(TRADE_LEDGER_STORAGE_KEY, JSON.stringify(tradeLedgerEntries));
}

export function useHoldingsStorageSync({
  setLedger,
  setAccountSettings,
  setTradeLedgerEntries
}) {
  const [remoteMode, setRemoteMode] = useState(() => Boolean(loadCloudSession()?.accessToken));
  const [remoteReady, setRemoteReady] = useState(() => !loadCloudSession()?.accessToken);

  const refreshFromCurrentSource = useCallback(async (event = null) => {
    const session = loadCloudSession();
    if (!session?.accessToken) {
      const keys = Array.isArray(event?.detail?.keys) ? event.detail.keys : [];
      if (keys.length && !keys.some((key) => HOLDINGS_SYNC_KEYS.has(String(key || '')))) return;
      setRemoteMode(false);
      setRemoteReady(true);
      setLedger(readLedgerState());
      setAccountSettings(readAccountAllocationSettings());
      setTradeLedgerEntries(readTradeLedger());
      return;
    }

    setRemoteMode(true);
    setRemoteReady(false);
    const [transactions, rawAccountSettings, rawTradeLedger] = await Promise.all([
      fetchAllHoldingTransactions(session),
      fetchOptionalResourceData('holdings/allocation', {}, session),
      fetchOptionalResourceData('trades/ledger', [], session)
    ]);
    const accountSettings = normalizeAccountAllocationSettings(rawAccountSettings);
    const tradeLedgerEntries = Array.isArray(rawTradeLedger) ? rawTradeLedger : [];

    writeRemoteRuntimeSnapshot({ transactions, accountSettings, tradeLedgerEntries });
    setLedger((previous) => normalizeLedgerState({
      ...previous,
      transactions,
      snapshotsByCode: previous?.snapshotsByCode || {}
    }));
    setAccountSettings(accountSettings);
    setTradeLedgerEntries(tradeLedgerEntries);
    setRemoteReady(true);
  }, [setAccountSettings, setLedger, setTradeLedgerEntries]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    function refresh(event) {
      void refreshFromCurrentSource(event).catch((error) => {
        setRemoteReady(false);
        window.dispatchEvent(new CustomEvent('holdings:remote-source-error', {
          detail: { message: error?.message || String(error) }
        }));
      });
    }

    function onLedgerUpdated(event) {
      if (event?.detail?.source !== 'cloud-transactions') return;
      const transactions = Array.isArray(event?.detail?.state?.transactions)
        ? event.detail.state.transactions
        : null;
      if (loadCloudSession()?.accessToken && transactions) {
        setAccountRuntimeStorageRaw(LEDGER_STORAGE_KEY, JSON.stringify({ transactions }));
        setLedger((previous) => normalizeLedgerState({
          ...previous,
          transactions,
          snapshotsByCode: previous?.snapshotsByCode || {}
        }));
        setRemoteMode(true);
        setRemoteReady(true);
        return;
      }
      refresh(event);
    }

    function onStorage(event) {
      // 登录态业务数据完全忽略 localStorage storage 事件；远端事件或显式远端拉取才更新 React。
      if (loadCloudSession()?.accessToken) return;
      if (!event || event.key === null || HOLDINGS_SYNC_KEYS.has(String(event.key || ''))) refresh(event);
    }

    function onSessionChanged() {
      refresh();
    }

    refresh();
    window.addEventListener(BACKUP_APPLIED_EVENT, refresh);
    window.addEventListener('cloud-sync:auto-restored', refresh);
    window.addEventListener('holdings:ledger-updated', onLedgerUpdated);
    window.addEventListener(CLOUD_SYNC_SESSION_EVENT, onSessionChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(BACKUP_APPLIED_EVENT, refresh);
      window.removeEventListener('cloud-sync:auto-restored', refresh);
      window.removeEventListener('holdings:ledger-updated', onLedgerUpdated);
      window.removeEventListener(CLOUD_SYNC_SESSION_EVENT, onSessionChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, [refreshFromCurrentSource, setLedger]);

  return { remoteMode, remoteReady, refreshFromCurrentSource };
}
