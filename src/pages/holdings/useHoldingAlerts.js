import { useState, useCallback } from 'react';
import { readHoldingAlerts, persistHoldingAlerts } from '../../app/alertRules.js';
import { syncTradePlanRules, buildNotifySyncPayload } from '../../app/notifySync.js';
import { showActionToast } from '../../app/toast.js';

export function useHoldingAlerts() {
  const [holdingAlerts, setHoldingAlerts] = useState(() => readHoldingAlerts());
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState(null);

  const handleOpenAlertDialog = useCallback((holding) => {
    setSelectedHolding({
      symbol: holding.code || holding.symbol,
      name: holding.name || holding.code || holding.symbol,
      holdingCost: holding.avgCost || holding.costBasis || 0
    });
    setAlertDialogOpen(true);
  }, []);

  const handleSaveAlert = useCallback(async (alertConfig) => {
    if (!selectedHolding) return;

    const newAlert = {
      id: `holding-alert:${selectedHolding.symbol}:${alertConfig.alertType}:${Date.now()}`,
      type: 'holding-alert',
      symbol: selectedHolding.symbol,
      name: selectedHolding.name,
      holdingCost: selectedHolding.holdingCost,
      ...alertConfig,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const updated = [...holdingAlerts, newAlert];
    setHoldingAlerts(updated);
    persistHoldingAlerts(updated);

    try {
      await syncTradePlanRules({
        ...buildNotifySyncPayload(),
        holdingAlerts: updated
      });
      showActionToast('预警规则已保存');
    } catch (error) {
      console.error('Failed to sync holding alert:', error);
      showActionToast('预警规则保存失败');
    }

    setAlertDialogOpen(false);
    setSelectedHolding(null);
  }, [selectedHolding, holdingAlerts]);

  const handleCloseAlertDialog = useCallback(() => {
    setAlertDialogOpen(false);
    setSelectedHolding(null);
  }, []);

  return {
    holdingAlerts,
    alertDialogOpen,
    selectedHolding,
    handleOpenAlertDialog,
    handleSaveAlert,
    handleCloseAlertDialog
  };
}
