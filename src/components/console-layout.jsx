import { useEffect, useState } from 'react';
import { consumePendingToasts, subscribeToToasts } from '../app/toast.js';

function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

const toastToneClasses = {
  slate: 'border-[var(--a-200)] bg-[var(--bg-100)] text-[var(--fg-900)]',
  indigo: 'border-[var(--blue-text)]/20 bg-[var(--blue-tint)] text-[var(--blue-text)]',
  emerald: 'border-[var(--green-text)]/20 bg-[var(--green-tint)] text-[var(--green-text)]',
  red: 'border-[var(--red-text)]/20 bg-[var(--red-tint)] text-[var(--red-text)]',
  amber: 'border-[var(--amber-text)]/20 bg-[var(--amber-tint)] text-[var(--amber-text)]'
};

function ConsoleToastViewport() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    function appendToast(toast) {
      setToasts((current) => [...current.filter((item) => item.id !== toast.id), toast].slice(-4));
    }
    consumePendingToasts().forEach(appendToast);
    return subscribeToToasts(appendToast);
  }, []);

  useEffect(() => {
    const timers = toasts.map((toast) => window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== toast.id));
    }, toast.durationMs || 3200));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [toasts]);

  useEffect(() => {
    if (!toasts.some((toast) => toast.dismissOnInteraction)) return undefined;
    function dismissInteractiveToasts() {
      setToasts((current) => current.filter((toast) => !toast.dismissOnInteraction));
    }
    window.addEventListener('pointerdown', dismissInteractiveToasts, { capture: true });
    return () => window.removeEventListener('pointerdown', dismissInteractiveToasts, { capture: true });
  }, [toasts]);

  if (!toasts.length) return null;

  return (
    <div className="console-toast-viewport" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={cx('console-toast', toastToneClasses[toast.tone] || toastToneClasses.slate)}>
          <div className="console-toast__title">{toast.title}</div>
          {toast.description ? <div className="console-toast__description">{toast.description}</div> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The application shell intentionally only owns page width and toast mounting.
 * Navigation belongs to AppHeader, keeping the content area single-column on
 * desktop and mobile alike.
 */
export function ConsoleLayout({ children }) {
  return (
    <div className="console-root">
      <ConsoleToastViewport />
      <main className="console-main">
        <div className="console-main__body">{children}</div>
      </main>
    </div>
  );
}
