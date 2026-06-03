import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { clearPremiumState, markAppEntryAdShown, readPremiumState, shouldShowAppEntryAd, writePremiumState } from '../app/monetization.js';

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
  const [visible, setVisible] = useState(() => shouldShowAppEntryAd());
  function close() {
    markAppEntryAdShown();
    setVisible(false);
  }
  return (
    <>
      {children}
      {visible ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-slate-950/40">
            <div className="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-5 py-5 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/80">App placement</div>
                  <h2 className="mt-4 text-2xl font-black leading-tight">App entry placement reserved</h2>
                  <p className="mt-2 text-sm leading-6 text-white/70">Replace this block with mobile SDK or your own promotion later.</p>
                </div>
                <button type="button" className="rounded-full bg-white/10 p-2 text-white/80 active:bg-white/20" aria-label="Close" onClick={close}><X className="h-4 w-4" /></button>
              </div>
              <div className="mt-6 rounded-3xl border border-white/10 bg-white/10 p-5 text-center">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Placement Placeholder</div>
                <div className="mt-2 text-4xl font-black">300 x 250</div>
                <div className="mt-2 text-xs text-white/55">Native, interstitial, or brand promotion area</div>
              </div>
            </div>
            <div className="space-y-3 p-5">
              <button type="button" className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-sm active:bg-slate-800" onClick={close}>Enter app</button>
              <button type="button" className="w-full rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800" onClick={() => { unlockPremiumForPreview(); close(); }}>Preview premium</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
