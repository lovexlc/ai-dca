const CONFIRM_EVENT_NAME = 'aidca:confirm';

function normalizeOptions(options = {}) {
  if (typeof options === 'string') options = { description: options };
  return {
    title: String(options.title || '确认操作').trim() || '确认操作',
    description: String(options.description || '').trim(),
    confirmText: String(options.confirmText || '确认').trim() || '确认',
    cancelText: String(options.cancelText || '取消').trim() || '取消',
    tone: options.tone === 'danger' ? 'danger' : 'default'
  };
}

/**
 * 全项目统一确认弹窗。返回 Promise<boolean>，可在任意业务模块中调用：
 * if (!(await confirmAction({ title, description, tone: 'danger' }))) return;
 */
export function confirmAction(options = {}) {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const detail = normalizeOptions(options);
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(CONFIRM_EVENT_NAME, {
      detail: { ...detail, resolve }
    }));
  });
}

export function subscribeToConfirmActions(listener) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => listener(event?.detail || {});
  window.addEventListener(CONFIRM_EVENT_NAME, handler);
  return () => window.removeEventListener(CONFIRM_EVENT_NAME, handler);
}
