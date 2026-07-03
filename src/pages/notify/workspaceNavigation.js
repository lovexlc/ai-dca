export function navigateWorkspace(tab, { hash = '' } = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('workspace:navigate', {
    detail: {
      tab,
      hash
    }
  }));

  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') !== tab) {
    params.set('tab', tab);
    window.history.pushState({ tab, source: 'notify-rules' }, '', `${window.location.pathname}?${params.toString()}${hash}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}
