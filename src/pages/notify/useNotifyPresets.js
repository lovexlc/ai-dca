import { useEffect, useMemo, useRef, useState } from 'react';
import { aggregateByCode } from '../../app/holdingsLedgerCore.js';
import { readLedgerState } from '../../app/holdingsLedger.js';
import { readHoldingAlerts, readMarketAlerts } from '../../app/alertRules.js';
import { buildNotifySyncPayload, syncTradePlanRules } from '../../app/notifySync.js';
import { setAllPlansNotifyEnabled } from '../../app/plan.js';
import { setAllDcaNotifyEnabled } from '../../app/dca.js';
import { showActionToast } from '../../app/toast.js';
import { trackActionResult, trackFeatureEvent } from '../../app/analytics.js';
import {
  buildPresetAlerts,
  collectManualAlertTypes,
  isPresetAlertId,
  normalizePresetThreshold,
  persistNotifyPresets,
  readNotifyPresets,
  PRESET_NAMES,
} from './notifyPresets.js';

// 通知 Tab「预设开关模式」的状态与开关逻辑。
// 预设是面向用户的"一键开关"，底层复用现有规则存储：
// - daily → 服务端持仓规则（走 handleToggleHoldingsRule）
// - gain/loss/premium → 展开成带 presetId 的 alert 规则并同步
// - dca/plan → 批量开关全部计划的 notify.enabled 并同步
export function useNotifyPresets({
  holdingsRule,
  holdingAlerts,
  marketAlerts,
  handleApplyPresetAlerts,
  handleToggleHoldingsRule,
  setTradePlans,
  setDcaPlans,
  notifyMeta,
  setNotifyError,
  isLoggedIn,
}) {
  const [notifyPresets, setNotifyPresets] = useState(() => readNotifyPresets());
  const [isApplyingPreset, setIsApplyingPreset] = useState(false);

  // 取当前有持仓的标的（带平均成本），用于展开涨跌/溢价预设规则。
  function getPresetHoldings() {
    try {
      const ledger = readLedgerState();
      const aggregates = aggregateByCode(ledger?.transactions || [], ledger?.snapshotsByCode || {});
      return (Array.isArray(aggregates) ? aggregates : [])
        .filter((item) => item?.hasPosition)
        .map((item) => ({
          symbol: String(item.code || '').trim(),
          name: item.name || String(item.code || '').trim(),
          holdingCost: Number(item.avgCost) || 0,
        }))
        .filter((item) => item.symbol);
    } catch {
      return [];
    }
  }

  function updatePresetState(presetId, patch) {
    setNotifyPresets((prev) => {
      const next = { ...prev, [presetId]: { ...prev[presetId], ...patch } };
      persistNotifyPresets(next);
      return next;
    });
  }

  async function applyAlertPreset(presetId, nextEnabled, thresholdOverride) {
    const threshold = normalizePresetThreshold(presetId, thresholdOverride ?? notifyPresets[presetId]?.threshold);
    const holdings = getPresetHoldings();
    const manualBySymbol = collectManualAlertTypes([...holdingAlerts, ...marketAlerts]);
    const presetAlerts = nextEnabled ? buildPresetAlerts(presetId, threshold, holdings, manualBySymbol) : [];
    const result = await handleApplyPresetAlerts(presetId, presetAlerts);
    if (!result?.ok) {
      throw result?.error || new Error('同步预设规则失败');
    }
    return { presetAlerts, threshold };
  }

  async function handleTogglePreset(presetId, nextEnabled) {
    const presetName = PRESET_NAMES[presetId] || presetId;
    trackFeatureEvent('notify', 'preset_toggle_start', { ...notifyMeta(), presetId, nextEnabled });
    setIsApplyingPreset(true);
    try {
      if (presetId === 'daily') {
        // 每日收盘汇总以服务端 holdingsRule 为准，渲染时合并状态
        await handleToggleHoldingsRule(nextEnabled);
        updatePresetState('daily', { enabled: nextEnabled });
        trackActionResult('notify', 'preset_toggle', 'success', { ...notifyMeta(), presetId, nextEnabled });
        return;
      }
      if (isPresetAlertId(presetId)) {
        const { presetAlerts, threshold } = await applyAlertPreset(presetId, nextEnabled);
        updatePresetState(presetId, { enabled: nextEnabled, threshold });
        showActionToast(nextEnabled ? `已开启「${presetName}」` : `已关闭「${presetName}」`, 'success');
        if (nextEnabled && !presetAlerts.length) {
          showActionToast('没有符合条件的持仓标的', 'info', { description: '预设已开启，有持仓后会自动纳入。' });
        }
        trackActionResult('notify', 'preset_toggle', 'success', { ...notifyMeta(), presetId, nextEnabled, alertCount: presetAlerts.length });
        return;
      }
      if (presetId === 'dca' || presetId === 'plan') {
        const updated = presetId === 'dca' ? setAllDcaNotifyEnabled(nextEnabled) : setAllPlansNotifyEnabled(nextEnabled);
        if (presetId === 'dca') {
          setDcaPlans(updated);
        } else {
          setTradePlans(updated);
        }
        await syncTradePlanRules(buildNotifySyncPayload());
        updatePresetState(presetId, { enabled: nextEnabled });
        showActionToast(nextEnabled ? `已开启「${presetName}」` : `已关闭「${presetName}」`, 'success');
        trackActionResult('notify', 'preset_toggle', 'success', { ...notifyMeta(), presetId, nextEnabled, planCount: updated.length });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '预设开关失败';
      setNotifyError(message);
      showActionToast('预设开关失败', 'error', { description: message });
      trackActionResult('notify', 'preset_toggle', 'error', { ...notifyMeta(), presetId, nextEnabled, errorMessage: message });
    } finally {
      setIsApplyingPreset(false);
    }
  }

  async function handlePresetThreshold(presetId, threshold) {
    const safe = normalizePresetThreshold(presetId, threshold);
    updatePresetState(presetId, { threshold: safe });
    trackFeatureEvent('notify', 'preset_threshold_change', { ...notifyMeta(), presetId, threshold: safe });
    if (isPresetAlertId(presetId) && notifyPresets[presetId]?.enabled) {
      setIsApplyingPreset(true);
      try {
        await applyAlertPreset(presetId, true, safe);
        showActionToast('阈值已更新', 'success');
      } catch (error) {
        showActionToast('阈值更新失败', 'error', { description: error instanceof Error ? error.message : '同步失败' });
      } finally {
        setIsApplyingPreset(false);
      }
    }
  }

  // 预设与持仓自动对齐：已开启的涨跌/溢价预设，在持仓变化后重新展开（幂等）。
  const presetResyncRef = useRef(false);
  useEffect(() => {
    if (!isLoggedIn || presetResyncRef.current) return;
    presetResyncRef.current = true;
    (async () => {
      const holdings = getPresetHoldings();
      const storedAlerts = [...readHoldingAlerts(), ...readMarketAlerts()];
      const manualBySymbol = collectManualAlertTypes(storedAlerts);
      const signature = (list) =>
        list
          .map((alert) => `${alert.symbol}:${alert.alertType}:${alert.threshold}`)
          .sort()
          .join('|');
      for (const presetId of ['gain', 'loss', 'premium']) {
        const preset = readNotifyPresets()[presetId];
        if (!preset?.enabled) continue;
        const threshold = normalizePresetThreshold(presetId, preset.threshold);
        const built = buildPresetAlerts(presetId, threshold, holdings, manualBySymbol);
        const existing = storedAlerts.filter((alert) => alert?.presetId === presetId);
        if (signature(built) !== signature(existing)) {
          await handleApplyPresetAlerts(presetId, built);
        }
      }
    })().catch((error) => console.error('Failed to resync preset alerts:', error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // 每日收盘汇总以服务端 holdingsRule 为准
  const presetViewState = {
    ...notifyPresets,
    daily: { ...notifyPresets.daily, enabled: Boolean(holdingsRule?.enabled) },
  };

  const presetHoldingsCount = useMemo(() => {
    try {
      const ledger = readLedgerState();
      const aggregates = aggregateByCode(ledger?.transactions || [], ledger?.snapshotsByCode || {});
      return (Array.isArray(aggregates) ? aggregates : []).filter((item) => item?.hasPosition).length;
    } catch {
      return 0;
    }
    // 挂载时计算一次：持仓变化时本页会重新挂载（与 tradePlans/dcaPlans 的读取策略一致）
  }, []);

  return {
    notifyPresets: presetViewState,
    presetHoldingsCount,
    isApplyingPreset,
    handleTogglePreset,
    handlePresetThreshold,
  };
}

export default useNotifyPresets;
