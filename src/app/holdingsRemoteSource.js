// 持仓页远端数据源协调器：交易行 hydrate 与 allocation/trades 读取统一入口。
//
// 三重时序保护：
// - 代次（generation）：每次刷新递增，只有最新代次的结果可以写入 UI/runtime，
//   乱序返回的旧响应（包括保存前发出的空 GET 晚到）一律丢弃；
// - 会话身份（identity）：应用前复核当前登录会话，A→B 切换后旧会话结果丢弃；
// - AbortController：新刷新/组件卸载时取消在途请求。
//
// 交易行读取走 holdingTransactionsSync.pullHoldingTransactions：
// 远端行按 id/revision 与当前 runtime 合并，pending 新增/编辑和删除 tombstone
// 不会被远端结果覆盖，并与自动 pull / 手动恢复共享同一串行队列。
// mutation epoch 用于「拉取期间发生过本地保存」时以 runtime 最新账本为准。

import { normalizeAccountAllocationSettings, readAccountAllocationSettings } from './accountManager.js';
import { fetchAccountResource } from './accountApi.js';
import { loadCloudSession } from './authSession.js';
import { areHoldingTransactionsEqual } from './holdingTransactionEventState.js';
import { holdingTransactionMutationEpoch, pullHoldingTransactions } from './holdingTransactionsSync.js';
import { normalizeLedgerState, readLedgerState } from './holdingsLedger.js';
import { setAccountRuntimeStorageRaw } from './accountRuntimeStore.js';
import { readTradeLedger } from './tradeLedger.js';
import { HOLDINGS_SYNC_KEYS } from './syncRegistry.js';

const LEDGER_STORAGE_KEY = 'aiDcaFundHoldingsLedger';
const ACCOUNT_STORAGE_KEY = 'aiDcaAccountAllocationSettings';
const TRADE_LEDGER_STORAGE_KEY = 'aiDcaTradeLedger';

export function holdingsRemoteSessionIdentity(session = loadCloudSession()) {
  return `${String(session?.userId || '')}:${String(session?.accessToken || '')}`;
}

async function fetchOptionalResourceData(resource, fallback, session, signal) {
  try {
    const payload = await fetchAccountResource(resource, session, { signal });
    return payload?.data === null || payload?.data === undefined ? fallback : payload.data;
  } catch (error) {
    if (Number(error?.status) === 404) return fallback;
    throw error;
  }
}

/**
 * 创建一个持仓远端数据源。
 * @param {{ setLedger: Function, setAccountSettings: Function, setTradeLedgerEntries: Function }} handlers React 状态更新回调
 */
export function createHoldingsRemoteSource({ setLedger, setAccountSettings, setTradeLedgerEntries }) {
  let generation = 0;
  let activeController = null;
  let activeIdentity = '';

  function abort() {
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
  }

  function currentGeneration() {
    return generation;
  }

  function applyLedgerTransactions(transactions) {
    setLedger((previous) => {
      if (areHoldingTransactionsEqual(previous?.transactions, transactions)) return previous;
      return normalizeLedgerState({
        ...previous,
        remoteLoading: false,
        transactions,
        snapshotsByCode: previous?.snapshotsByCode || {}
      });
    });
  }

  /**
   * 刷新当前数据源。
   * 同一会话内的新刷新不取消在途请求（去重共享的 pull 不能被后到的刷新杀掉），
   * 只靠代次丢弃过期结果；账号切换时才取消在途请求。
   * @returns {'local'|'remote'|'skipped'|'stale'} 结果形态；真实错误向上抛出。
   */
  async function refresh(event = null) {
    const session = loadCloudSession();
    if (!session?.accessToken) {
      const keys = Array.isArray(event?.detail?.keys) ? event.detail.keys : [];
      if (keys.length && !keys.some((key) => HOLDINGS_SYNC_KEYS.has(String(key || '')))) return 'skipped';
      setLedger({ ...readLedgerState(), remoteLoading: false });
      setAccountSettings(readAccountAllocationSettings());
      setTradeLedgerEntries(readTradeLedger());
      return 'local';
    }

    const identity = holdingsRemoteSessionIdentity(session);
    const identityChanged = activeIdentity !== identity;
    const epochAtStart = holdingTransactionMutationEpoch();
    const myGeneration = ++generation;
    if (identityChanged && activeController) activeController.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    activeController = controller;
    activeIdentity = identity;

    try {
      const [transactionResult, rawAccountSettings, rawTradeLedger] = await Promise.all([
        pullHoldingTransactions({ session, signal: controller?.signal }),
        fetchOptionalResourceData('holdings/allocation', {}, session, controller?.signal),
        fetchOptionalResourceData('trades/ledger', [], session, controller?.signal)
      ]);
      if (
        controller?.signal?.aborted
        || generation !== myGeneration
        || holdingsRemoteSessionIdentity() !== identity
      ) {
        return 'stale';
      }
      const accountSettings = normalizeAccountAllocationSettings(rawAccountSettings);
      const tradeLedgerEntries = Array.isArray(rawTradeLedger) ? rawTradeLedger : [];
      setAccountRuntimeStorageRaw(ACCOUNT_STORAGE_KEY, JSON.stringify(accountSettings));
      setAccountRuntimeStorageRaw(TRADE_LEDGER_STORAGE_KEY, JSON.stringify(tradeLedgerEntries));
      let transactions = Array.isArray(transactionResult?.transactions)
        ? transactionResult.transactions
        : readLedgerState().transactions;
      if (holdingTransactionMutationEpoch() !== epochAtStart) {
        // 拉取期间发生过本地保存：pull 已把远端合并进 runtime，以 runtime 最新账本为准。
        transactions = readLedgerState().transactions;
      }
      applyLedgerTransactions(transactions);
      setAccountSettings(accountSettings);
      setTradeLedgerEntries(tradeLedgerEntries);
      return 'remote';
    } catch (error) {
      if (
        controller?.signal?.aborted
        || generation !== myGeneration
        || holdingsRemoteSessionIdentity() !== identity
      ) {
        return 'stale';
      }
      throw error;
    } finally {
      if (activeController === controller) activeController = null;
    }
  }

  return { refresh, abort, currentGeneration };
}
