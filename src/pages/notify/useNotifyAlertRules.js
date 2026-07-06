import { useEffect, useState } from 'react';
import { readMarketAlerts, persistMarketAlerts, readHoldingAlerts, persistHoldingAlerts, deleteMarketAlert, deleteHoldingAlert } from '../../app/alertRules.js';
import { syncTradePlanRules, buildNotifySyncPayload } from '../../app/notifySync.js';
import { showActionToast } from '../../app/toast.js';
import { BACKUP_APPLIED_EVENT } from '../../app/backupEvents.js';

export function useNotifyAlertRules() {
  const [marketAlerts, setMarketAlerts] = useState(() => readMarketAlerts());
  const [holdingAlerts, setHoldingAlerts] = useState(() => readHoldingAlerts());
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState(null);
  const [alertDialogMode, setAlertDialogMode] = useState('market');

  useEffect(() => {
    function refreshAlerts() {
      setMarketAlerts(readMarketAlerts());
      setHoldingAlerts(readHoldingAlerts());
    }
    window.addEventListener(BACKUP_APPLIED_EVENT, refreshAlerts);
    window.addEventListener('storage', refreshAlerts);
    return () => {
      window.removeEventListener(BACKUP_APPLIED_EVENT, refreshAlerts);
      window.removeEventListener('storage', refreshAlerts);
    };
  }, []);

  function handleEditMarketAlert(alert) {
    setEditingAlert(alert);
    setAlertDialogMode('market');
    setAlertDialogOpen(true);
  }

  async function handleSaveMarketAlert(alertConfig) {
    const isEdit = Boolean(editingAlert);
    const alert = isEdit
      ? {
          ...editingAlert,
          ...alertConfig,
          updatedAt: new Date().toISOString()
        }
      : {
          id: `market-alert:${editingAlert.symbol}:${alertConfig.alertType}:${Date.now()}`,
          type: 'market-alert',
          symbol: editingAlert.symbol,
          name: editingAlert.name,
          ...alertConfig,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

    const updated = isEdit
      ? marketAlerts.map(a => a.id === alert.id ? alert : a)
      : [...marketAlerts, alert];

    setMarketAlerts(updated);
    persistMarketAlerts(updated);

    try {
      await syncTradePlanRules({
        ...buildNotifySyncPayload(),
        marketAlerts: updated
      });
      showActionToast(isEdit ? '预警规则已更新' : '预警规则已保存');
    } catch (error) {
      console.error('Failed to sync market alert:', error);
      showActionToast('预警规则保存失败');
    }

    setAlertDialogOpen(false);
    setEditingAlert(null);
  }

  async function handleDeleteMarketAlert(alertId) {
    if (!confirm('确认删除此预警规则？')) return;

    const updated = deleteMarketAlert(alertId);
    setMarketAlerts(updated);

    try {
      await syncTradePlanRules({
        ...buildNotifySyncPayload(),
        marketAlerts: updated
      });
      showActionToast('预警规则已删除');
    } catch (error) {
      console.error('Failed to sync after delete:', error);
      showActionToast('规则删除成功，但同步失败');
    }
  }

  function handleEditHoldingAlert(alert) {
    setEditingAlert(alert);
    setAlertDialogMode('holding');
    setAlertDialogOpen(true);
  }

  async function handleSaveHoldingAlert(alertConfig) {
    const isEdit = Boolean(editingAlert);
    const alert = isEdit
      ? {
          ...editingAlert,
          ...alertConfig,
          updatedAt: new Date().toISOString()
        }
      : {
          id: `holding-alert:${editingAlert.symbol}:${alertConfig.alertType}:${Date.now()}`,
          type: 'holding-alert',
          symbol: editingAlert.symbol,
          name: editingAlert.name,
          holdingCost: editingAlert.holdingCost,
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
      showActionToast(isEdit ? '预警规则已更新' : '预警规则已保存');
    } catch (error) {
      console.error('Failed to sync holding alert:', error);
      showActionToast('预警规则保存失败');
    }

    setAlertDialogOpen(false);
    setEditingAlert(null);
  }

  async function handleDeleteHoldingAlert(alertId) {
    if (!confirm('确认删除此预警规则？')) return;

    const updated = deleteHoldingAlert(alertId);
    setHoldingAlerts(updated);

    try {
      await syncTradePlanRules({
        ...buildNotifySyncPayload(),
        holdingAlerts: updated
      });
      showActionToast('预警规则已删除');
    } catch (error) {
      console.error('Failed to sync after delete:', error);
      showActionToast('规则删除成功，但同步失败');
    }
  }

  function handleCloseAlertDialog() {
    setAlertDialogOpen(false);
    setEditingAlert(null);
  }

  return {
    marketAlerts,
    holdingAlerts,
    alertDialogOpen,
    editingAlert,
    alertDialogMode,
    handleEditMarketAlert,
    handleSaveMarketAlert,
    handleDeleteMarketAlert,
    handleEditHoldingAlert,
    handleSaveHoldingAlert,
    handleDeleteHoldingAlert,
    handleCloseAlertDialog
  };
}
