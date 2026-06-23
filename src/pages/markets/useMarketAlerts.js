import { useState, useCallback } from 'react';
import { readMarketAlerts, persistMarketAlerts } from '../../app/alertRules.js';
import { syncTradePlanRules, buildNotifySyncPayload } from '../../app/notifySync.js';
import { showActionToast } from '../../app/toast.js';

export function useMarketAlerts() {
  const [marketAlerts, setMarketAlerts] = useState(() => readMarketAlerts());
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [selectedAlertSymbol, setSelectedAlertSymbol] = useState(null);

  const handleOpenAlertDialog = useCallback((quote) => {
    setSelectedAlertSymbol({
      symbol: quote.symbol,
      name: quote.name || quote.symbol
    });
    setAlertDialogOpen(true);
  }, []);

  const handleSaveAlert = useCallback(async (alertConfig, isFirstAlert) => {
    if (!selectedAlertSymbol) return;

    const isEdit = selectedAlertSymbol.id;
    const alert = isEdit
      ? {
          ...selectedAlertSymbol,
          ...alertConfig,
          updatedAt: new Date().toISOString()
        }
      : {
          id: `market-alert:${selectedAlertSymbol.symbol}:${alertConfig.alertType}:${Date.now()}`,
          type: 'market-alert',
          symbol: selectedAlertSymbol.symbol,
          name: selectedAlertSymbol.name,
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
      showActionToast(isEdit ? '预警规则已更新' : '预警规则已保存，可在"通知管理"页面查看和编辑');

      // 首次创建预警时，跳转到通知管理页面
      if (!isEdit && isFirstAlert && typeof window !== 'undefined') {
        setTimeout(() => {
          window.location.hash = '#notify';
        }, 1500);
      }
    } catch (error) {
      console.error('Failed to sync market alert:', error);
      showActionToast('预警规则保存失败');
    }

    setAlertDialogOpen(false);
    setSelectedAlertSymbol(null);
  }, [selectedAlertSymbol, marketAlerts]);

  const handleCloseAlertDialog = useCallback(() => {
    setAlertDialogOpen(false);
    setSelectedAlertSymbol(null);
  }, []);

  return {
    marketAlerts,
    alertDialogOpen,
    selectedAlertSymbol,
    handleOpenAlertDialog,
    handleSaveAlert,
    handleCloseAlertDialog
  };
}
