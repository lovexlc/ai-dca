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

  const handleSaveAlert = useCallback(async (alertConfig) => {
    if (!selectedAlertSymbol) return;

    const newAlert = {
      id: `market-alert:${selectedAlertSymbol.symbol}:${alertConfig.alertType}:${Date.now()}`,
      type: 'market-alert',
      symbol: selectedAlertSymbol.symbol,
      name: selectedAlertSymbol.name,
      ...alertConfig,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const updated = [...marketAlerts, newAlert];
    setMarketAlerts(updated);
    persistMarketAlerts(updated);

    try {
      await syncTradePlanRules({
        ...buildNotifySyncPayload(),
        marketAlerts: updated
      });
      showActionToast('预警规则已保存');
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
