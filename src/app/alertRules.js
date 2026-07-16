import { getUserDataStorage } from './userDataStore.js';

const MARKET_ALERTS_KEY = 'aiDcaMarketAlerts';
const HOLDING_ALERTS_KEY = 'aiDcaHoldingAlerts';

export function readMarketAlerts() {
  if (typeof window === 'undefined') return [];
  try {
    const stored = JSON.parse(getUserDataStorage().getItem(MARKET_ALERTS_KEY) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export function persistMarketAlerts(alerts) {
  if (typeof window === 'undefined') return;
  getUserDataStorage().setItem(MARKET_ALERTS_KEY, JSON.stringify(alerts));
}

export function readHoldingAlerts() {
  if (typeof window === 'undefined') return [];
  try {
    const stored = JSON.parse(getUserDataStorage().getItem(HOLDING_ALERTS_KEY) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export function persistHoldingAlerts(alerts) {
  if (typeof window === 'undefined') return;
  getUserDataStorage().setItem(HOLDING_ALERTS_KEY, JSON.stringify(alerts));
}

export function deleteMarketAlert(alertId) {
  const alerts = readMarketAlerts();
  const updated = alerts.filter(alert => alert.id !== alertId);
  persistMarketAlerts(updated);
  return updated;
}

export function deleteHoldingAlert(alertId) {
  const alerts = readHoldingAlerts();
  const updated = alerts.filter(alert => alert.id !== alertId);
  persistHoldingAlerts(updated);
  return updated;
}
