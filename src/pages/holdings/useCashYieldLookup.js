import { useEffect, useState } from 'react';
import { getNavSnapshot } from '../../app/navService.js';
import { readAccountAllocationSettings, updateAccountAllocationSettings } from '../../app/accountManager.js';
import { syncTradePlanRules } from '../../app/notifySync.js';

export function useCashYieldLookup(accountSettings, setAccountSettings) {
  const [lookup, setLookup] = useState({ code: '', status: 'idle' });
  useEffect(() => {
    const mode = accountSettings.cashYieldMode;
    const code = String(accountSettings.cashYieldCode || '').trim();
    if (mode !== 'code' || !/^\d{6}$/.test(code)) {
      setLookup({ code, status: mode === 'code' ? 'invalid' : 'idle' });
      return undefined;
    }
    let cancelled = false;
    setLookup({ code, status: 'loading' });
    const timer = window.setTimeout(async () => {
      try {
        const snapshot = await getNavSnapshot(code);
        if (cancelled) return;
        const rate = Number(snapshot?.return1y);
        if (!Number.isFinite(rate)) {
          setLookup({ code, status: 'unavailable' });
          return;
        }
        const next = updateAccountAllocationSettings({
          cashYieldResolvedRate: rate,
          cashYieldResolvedAt: snapshot?.asOf || snapshot?.updatedAt || new Date().toISOString(),
          cashYieldName: snapshot?.name || code
        }, readAccountAllocationSettings());
        setAccountSettings(next);
        syncTradePlanRules().catch(() => {});
        setLookup({ code, status: 'ready' });
      } catch {
        if (!cancelled) setLookup({ code, status: 'error' });
      }
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accountSettings.cashYieldCode, accountSettings.cashYieldMode, setAccountSettings]);
  return lookup;
}
