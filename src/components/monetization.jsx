import { useEffect, useState } from 'react';
import { clearPremiumState, readPremiumState, writePremiumState } from '../app/monetization.js';

export function usePremiumState() {
  const [premium, setPremium] = useState(() => readPremiumState());
  useEffect(() => {
    function handleChanged(event) { setPremium(event?.detail || readPremiumState()); }
    window.addEventListener('aidca:premium-changed', handleChanged);
    window.addEventListener('storage', handleChanged);
    return () => {
      window.removeEventListener('aidca:premium-changed', handleChanged);
      window.removeEventListener('storage', handleChanged);
    };
  }, []);
  return premium;
}

export function unlockPremiumForPreview() {
  return writePremiumState({ unlocked: true, plan: 'preview', source: 'local-preview' });
}

export function resetPremiumForPreview() {
  return clearPremiumState();
}

export function AppEntryAdGate({ children }) {
  return children;
}
