const TOAST_EVENT_NAME = 'aidca:toast';
const PENDING_TOASTS_KEY = 'aiDcaPendingToasts';
const DEFAULT_DURATION_MS = 3200;
const MAX_TOASTS = 4;

function buildToastId() {
  return `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeToast(input = {}) {
  return {
    id: String(input.id || '').trim() || buildToastId(),
    title: String(input.title || '操作完成').trim() || '操作完成',
    description: String(input.description || '').trim(),
    tone: String(input.tone || 'emerald').trim() || 'emerald',
    durationMs: Math.max(Number(input.durationMs) || DEFAULT_DURATION_MS, 1200)
  };
}

function readPendingToasts() {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = JSON.parse(window.sessionStorage.getItem(PENDING_TOASTS_KEY) || '[]');
    return Array.isArray(raw) ? raw.map((item) => normalizeToast(item)).slice(-MAX_TOASTS) : [];
  } catch (_error) {
    return [];
  }
}

function writePendingToasts(toasts = []) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(PENDING_TOASTS_KEY, JSON.stringify(toasts.slice(-MAX_TOASTS)));
}

export function showToast(input = {}) {
  if (typeof window === 'undefined') {
    return null;
  }

  const toast = normalizeToast(input);

  if (input.persist) {
    const pending = readPendingToasts();
    pending.push(toast);
    writePendingToasts(pending);
    return toast;
  }

  window.dispatchEvent(new CustomEvent(TOAST_EVENT_NAME, {
    detail: toast
  }));
  return toast;
}

export function showActionToast(actionLabel = '', status = 'success', options = {}) {
  const normalizedActionLabel = String(actionLabel || '操作').trim() || '操作';
  const normalizedStatus = String(status || 'success').trim();
  const suffix = normalizedStatus === 'error'
    ? '失败'
    : normalizedStatus === 'warning'
      ? '提醒'
      : '成功';

  return showToast({
    title: `${normalizedActionLabel}${suffix}`,
    description: String(options.description || '').trim(),
    tone: options.tone || (
      normalizedStatus === 'error'
        ? 'red'
        : normalizedStatus === 'warning'
          ? 'amber'
          : 'emerald'
    ),
    durationMs: options.durationMs,
    persist: Boolean(options.persist)
  });
}

export function consumePendingToasts() {
  if (typeof window === 'undefined') {
    return [];
  }

  const pending = readPendingToasts();
  window.sessionStorage.removeItem(PENDING_TOASTS_KEY);
  return pending;
}

export function subscribeToToasts(listener) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  function handleToast(event) {
    listener(normalizeToast(event?.detail || {}));
  }

  window.addEventListener(TOAST_EVENT_NAME, handleToast);
  return () => window.removeEventListener(TOAST_EVENT_NAME, handleToast);
}
