import { useState, useCallback } from 'react';
import { readHoldingAlerts, persistHoldingAlerts } from '../../app/alertRules.js';
import { syncTradePlanRules, buildNotifySyncPayload } from '../../app/notifySync.js';
import { showActionToast } from '../../app/toast.js';

export function useHoldingAlerts(onCloseSidePanel) {
  const [holdingAlerts, setHoldingAlerts] = useState(() => readHoldingAlerts());
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState(null);

  const handleOpenAlertDialog = useCallback((holding) => {
    setSelectedHolding({
      symbol: holding.code || holding.symbol,
      name: holding.name || holding.code || holding.symbol,
      holdingCost: holding.avgCost || holding.costBasis || 0
    });
    if (onCloseSidePanel) {
      onCloseSidePanel();
    }
    setAlertDialogOpen(true);
  }, [onCloseSidePanel]);

  const handleSaveAlert = useCallback(async (alertConfig, isFirstAlert) => {
    if (!selectedHolding) return;

    const isEdit = selectedHolding.id;
    const alert = isEdit
      ? {
          ...selectedHolding,
          ...alertConfig,
          updatedAt: new Date().toISOString()
        }
      : {
          id: `holding-alert:${selectedHolding.symbol}:${alertConfig.alertType}:${Date.now()}`,
          type: 'holding-alert',
          symbol: selectedHolding.symbol,
          name: selectedHolding.name,
          holdingCost: selectedHolding.holdingCost,
          ...alertConfig,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

    const updated = isEdit
      ? holdingAlerts.map(a => a.id === alert.id ? alert : a)
      : [...holdingAlerts, alert];

    setHoldingAlerts(updated);
    persistHoldingAlerts(updated);

    try {
      await syncTradePlanRules({
        ...buildNotifySyncPayload(),
        holdingAlerts: updated
      });
      showActionToast(isEdit ? '预警规则已更新' : '预警规则已保存，可在"通知管理"页面查看和编辑');

      // 首次创建预警时，跳转到通知管理页面
      if (!isEdit && isFirstAlert && typeof window !== 'undefined') {
        setTimeout(() => {
          window.location.hash = '#notify';
        }, 1500);
      }
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
