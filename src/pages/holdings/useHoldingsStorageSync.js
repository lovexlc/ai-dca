import { useCallback, useEffect, useRef, useState } from 'react';
import { CLOUD_SYNC_SESSION_EVENT, loadCloudSession } from '../../app/authSession.js';
import { BACKUP_APPLIED_EVENT } from '../../app/backupEvents.js';
import { areHoldingTransactionsEqual } from '../../app/holdingTransactionEventState.js';
import { createHoldingsRemoteSource } from '../../app/holdingsRemoteSource.js';
import { normalizeLedgerState } from '../../app/holdingsLedger.js';
import { HOLDINGS_SYNC_KEYS } from '../../app/syncRegistry.js';

// 持仓页同步 hook：React 状态与事件接线。
// 读取时序保护（代次 / 会话身份 / 取消在途请求 / mutation epoch / 按 id 合并）
// 全部在 holdingsRemoteSource 与 holdingTransactionsSync 中实现，
// 本 hook 只负责把结果映射到 remoteMode / remoteReady / remoteLoading。
export function useHoldingsStorageSync({
  setLedger,
  setAccountSettings,
  setTradeLedgerEntries
}) {
  const initialRemoteMode = Boolean(loadCloudSession()?.accessToken);
  const [remoteMode, setRemoteMode] = useState(initialRemoteMode);
  const [remoteReady, setRemoteReady] = useState(!initialRemoteMode);
  const [remoteLoading, setRemoteLoading] = useState(initialRemoteMode);

  const sourceRef = useRef(null);
  if (!sourceRef.current) {
    sourceRef.current = createHoldingsRemoteSource({ setLedger, setAccountSettings, setTradeLedgerEntries });
  }
  const source = sourceRef.current;

  const refreshFromCurrentSource = useCallback(async (event = null) => {
    const generationAtStart = source.currentGeneration();
    const isRemote = Boolean(loadCloudSession()?.accessToken);
    if (isRemote) {
      setRemoteMode(true);
      setRemoteReady(false);
      setRemoteLoading(true);
      setLedger((previous) => ({ ...previous, remoteLoading: true }));
    }
    try {
      const outcome = await source.refresh(event);
      // 过期结果不作数：新一轮刷新或账号切换已接管状态。
      if (outcome === 'stale' || source.currentGeneration() !== generationAtStart) return;
      if (outcome === 'local') setRemoteMode(false);
      setRemoteReady(true);
      setRemoteLoading(false);
    } catch (error) {
      if (source.currentGeneration() !== generationAtStart) return;
      setRemoteReady(false);
      setRemoteLoading(false);
      setLedger((previous) => ({ ...previous, remoteLoading: false }));
      window.dispatchEvent(new CustomEvent('holdings:remote-source-error', {
        detail: { message: error?.message || String(error) }
      }));
    }
  }, [setLedger, source]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    function refresh(event) {
      void refreshFromCurrentSource(event);
    }

    function onLedgerUpdated(event) {
      const eventSource = String(event?.detail?.source || '');
      if (eventSource !== 'cloud-transactions' && eventSource !== 'local-ledger') return;
      const transactions = Array.isArray(event?.detail?.state?.transactions)
        ? event.detail.state.transactions
        : null;
      if (loadCloudSession()?.accessToken && transactions) {
        // runtime 已由写入方（persist / pull 合并）更新，这里只同步 React 状态；
        // 相同内容必须保持原 state 引用，否则会形成 persist -> event -> persist 循环。
        setLedger((previous) => {
          if (areHoldingTransactionsEqual(previous?.transactions, transactions)) return previous;
          return normalizeLedgerState({
            ...previous,
            remoteLoading: false,
            transactions,
            snapshotsByCode: previous?.snapshotsByCode || {}
          });
        });
        setRemoteMode(true);
        setRemoteReady(true);
        setRemoteLoading(false);
        return;
      }
      refresh(event);
    }

    function onStorage(event) {
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
      // 卸载时取消在途远端请求，防止结果写回已卸载页面。
      source.abort();
    };
  }, [refreshFromCurrentSource, setLedger, source]);

  return { remoteMode, remoteReady, remoteLoading, refreshFromCurrentSource };
}
