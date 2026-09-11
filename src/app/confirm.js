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

/** 全项目统一确认弹窗。返回 Promise<boolean>。 */
export function confirmAction(options = {}) {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const detail = normalizeOptions(options);
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(CONFIRM_EVENT_NAME, { detail: { ...detail, resolve } }));
  });
}

export function subscribeToConfirmActions(listener) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => listener(event?.detail || {});
  window.addEventListener(CONFIRM_EVENT_NAME, handler);
  return () => window.removeEventListener(CONFIRM_EVENT_NAME, handler);
}

/**
 * 兼容项目中尚未迁移的 window.confirm 调用：点击确认后自动重放原按钮事件。
 * 新代码应直接 await confirmAction(...)。
 */
export function installLegacyConfirmAdapter() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || window.__aiDcaConfirmAdapterInstalled) return;
  window.__aiDcaConfirmAdapterInstalled = true;
  const nativeConfirm = window.confirm.bind(window);
  let activeTrigger = null;
  let approvedMessage = '';

  document.addEventListener('click', (event) => {
    activeTrigger = event.target?.closest?.('button, [role="button"], a') || null;
    window.setTimeout(() => { activeTrigger = null; }, 0);
  }, true);

  window.confirm = (message = '') => {
    const text = String(message || '').trim();
    if (approvedMessage && approvedMessage === text) {
      approvedMessage = '';
      return true;
    }
    const trigger = activeTrigger;
    if (!trigger) return nativeConfirm(text);
    const danger = /删除|清除|移除|覆盖|解绑|回滚|关闭|无法恢复/.test(text);
    confirmAction({
      title: danger ? '确认执行此操作？' : '请确认操作',
      description: text,
      confirmText: danger ? '确认执行' : '确认',
      tone: danger ? 'danger' : 'default'
    }).then((confirmed) => {
      if (!confirmed || !trigger.isConnected) return;
      approvedMessage = text;
      trigger.click();
    });
    return false;
  };
}
