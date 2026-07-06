export function scheduleMobileIdleTask(isMobile, task, { timeout = 3500, fallbackDelay = 2600 } = {}) {
  if (!isMobile || typeof window === 'undefined') {
    task();
    return () => {};
  }
  let cancelled = false;
  const run = () => {
    if (!cancelled) task();
  };
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout });
    return () => {
      cancelled = true;
      window.cancelIdleCallback?.(id);
    };
  }
  const id = window.setTimeout(run, fallbackDelay);
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}
