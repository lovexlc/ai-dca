import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCloudSession } from '../../app/authSession.js';
import { fetchHoldingTransactionRows } from '../../app/holdingTransactionsApi.js';
import { readLedgerState } from '../../app/holdingsLedgerStorage.js';
import { aggregateByCode } from '../../app/holdingsLedgerCore.js';
import {
  loadSwitchConfigFromWorker,
  readSwitchConfigCache,
  normalizeSwitchConfigShape,
  getActiveSwitchRule,
} from '../../app/switchStrategySync.js';
import { BACKUP_APPLIED_EVENT } from '../../app/backupEvents.js';

// 纳指 100 14 只标的代码集合
const NASDAQ_CODE_SET = new Set([
  '159509', '513100', '159941', '159632', '513300', '159660', '159696',
  '159513', '513110', '159659', '513870', '159501', '513000', '161130'
]);

function cleanCode(raw) {
  return String(raw || '').replace(/\D/g, '');
}

export function useMarketsBetaSync() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [holdingsLedger, setHoldingsLedger] = useState(() => readLedgerState());
  const [switchConfig, setSwitchConfig] = useState(() => normalizeSwitchConfigShape(readSwitchConfigCache()));
  const inFlightRef = useRef(false);

  // 1. 同步持仓记录与切换方案配置
  const refreshSync = useCallback(async ({ silent = false } = {}) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) setSyncing(true);

    const session = loadCloudSession();

    // 并行拉取：持仓记录接口 + 基金切换方案接口
    const fetchHoldingsTask = (async () => {
      let transactions = [];
      let snapshotsByCode = {};
      if (session?.accessToken) {
        try {
          let cursor = '';
          do {
            const payload = await fetchHoldingTransactionRows({ cursor, limit: 1000 }, session);
            for (const row of Array.isArray(payload?.rows) ? payload.rows : []) {
              const tx = row?.data || row;
              if (tx && typeof tx === 'object') transactions.push(tx);
            }
            cursor = String(payload?.nextCursor || '');
          } while (cursor);
        } catch (_err) {
          // 远程拉取失败时平滑降级到本地缓存
        }
      }
      const localLedger = readLedgerState();
      if (!transactions.length && Array.isArray(localLedger?.transactions)) {
        transactions = localLedger.transactions;
      }
      snapshotsByCode = localLedger?.snapshotsByCode || {};
      return { transactions, snapshotsByCode };
    })();

    const fetchSwitchTask = (async () => {
      try {
        if (session?.accessToken) {
          const cfg = await loadSwitchConfigFromWorker();
          if (cfg) return cfg;
        }
      } catch (_err) {
        // 降级本地换基配置
      }
      return normalizeSwitchConfigShape(readSwitchConfigCache());
    })();

    try {
      const [remoteHoldings, remoteSwitchConfig] = await Promise.all([
        fetchHoldingsTask.catch(() => ({ transactions: [], snapshotsByCode: {} })),
        fetchSwitchTask.catch(() => normalizeSwitchConfigShape(readSwitchConfigCache()))
      ]);

      if (remoteHoldings?.transactions?.length) {
        setHoldingsLedger(remoteHoldings);
      } else {
        setHoldingsLedger(readLedgerState());
      }

      if (remoteSwitchConfig) {
        setSwitchConfig(remoteSwitchConfig);
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  // 组件挂载时拉取最新数据
  useEffect(() => {
    refreshSync();
  }, [refreshSync]);

  // 监听持仓变更、云备份恢复与跨标签页 focus
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const onHoldingsUpdated = () => refreshSync({ silent: true });
    const onStorageChange = (e) => {
      if (e?.key === 'aiDcaSwitchStrategyWorkerConfig' || e?.key === 'aiDcaFundHoldingsLedger') {
        refreshSync({ silent: true });
      }
    };
    const onFocus = () => refreshSync({ silent: true });

    window.addEventListener('holdings:ledger-updated', onHoldingsUpdated);
    window.addEventListener(BACKUP_APPLIED_EVENT, onHoldingsUpdated);
    window.addEventListener('cloud-sync:auto-restored', onHoldingsUpdated);
    window.addEventListener('storage', onStorageChange);
    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('holdings:ledger-updated', onHoldingsUpdated);
      window.removeEventListener(BACKUP_APPLIED_EVENT, onHoldingsUpdated);
      window.removeEventListener('cloud-sync:auto-restored', onHoldingsUpdated);
      window.removeEventListener('storage', onStorageChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshSync]);

  // 2. 计算纳指持仓明细
  const nasdaqHoldings = useMemo(() => {
    try {
      const aggregates = aggregateByCode(
        holdingsLedger.transactions || [],
        holdingsLedger.snapshotsByCode || {}
      );
      return aggregates
        .filter((item) => {
          const c = cleanCode(item.code);
          const hasShares = (Number(item.totalShares) || Number(item.movingTotalShares) || 0) > 0;
          return NASDAQ_CODE_SET.has(c) && hasShares;
        })
        .map((item) => ({
          code: cleanCode(item.code),
          name: item.name || '',
          totalShares: Number(item.totalShares) || Number(item.movingTotalShares) || 0,
          avgCost: Number(item.avgCost) || 0,
          totalCost: Number(item.totalCost) || Number(item.confirmedTotalCost) || 0,
          currentPrice: Number(item.currentPrice) || 0,
          marketValue: Number(item.marketValue) || 0,
          unrealizedProfit: Number(item.unrealizedProfit) || 0,
          unrealizedReturnRate: Number(item.unrealizedReturnRate) || 0,
        }));
    } catch (_err) {
      return [];
    }
  }, [holdingsLedger]);

  const hasRealHoldings = nasdaqHoldings.length > 0;

  // 3. 解析当前生效的切换策略规则与门槛
  const activeRule = useMemo(() => {
    return getActiveSwitchRule(switchConfig) || null;
  }, [switchConfig]);

  const ruleThreshold = useMemo(() => {
    const val = Number(activeRule?.intraBuyOtherPct);
    return Number.isFinite(val) && val > 0 ? val : 3.0;
  }, [activeRule]);

  const ruleName = useMemo(() => {
    return String(activeRule?.name || '').trim() || '默认切换方案';
  }, [activeRule]);

  // 4. 判定与跑道优先绑定的持仓基金
  const boundHoldingFund = useMemo(() => {
    if (!nasdaqHoldings.length) return null;
    // 若策略规则中显式配置了持仓代码且用户持有该标的，优先使用该标的
    const ruleHoldingCode = cleanCode(activeRule?.holdingFundCode);
    if (ruleHoldingCode) {
      const match = nasdaqHoldings.find((h) => h.code === ruleHoldingCode);
      if (match) return match;
    }
    // 否则选择持仓市值最高或份额最大的标的
    return [...nasdaqHoldings].sort((a, b) => b.marketValue - a.marketValue)[0];
  }, [nasdaqHoldings, activeRule]);

  return {
    loading,
    syncing,
    hasRealHoldings,
    nasdaqHoldings,
    boundHoldingFund,
    switchConfig,
    activeRule,
    ruleThreshold,
    ruleName,
    refreshSync,
  };
}
