export function assertNotifyTestDelivered(payload = {}, fallbackMessage = '测试通知发送失败') {
  const events = Array.isArray(payload?.summary?.events) ? payload.summary.events : [];
  const event = events[0] || null;
  const eventStatus = String(event?.status || '').trim();
  const failedChannel = Array.isArray(event?.channels)
    ? event.channels.find((channel) => String(channel?.status || '').trim() !== 'delivered')
    : null;
  const deliveredCount = Number(payload?.summary?.deliveredCount) || 0;

  if (eventStatus && eventStatus !== 'delivered') {
    throw new Error(String(failedChannel?.detail || fallbackMessage).trim() || fallbackMessage);
  }

  if (deliveredCount <= 0) {
    throw new Error(String(failedChannel?.detail || fallbackMessage).trim() || fallbackMessage);
  }
}

export function detectNotifySurface() {
  if (typeof window === 'undefined') {
    return { isNativeAndroid: false, isMobileWeb: false };
  }

  const capacitorPlatform = String(window.Capacitor?.getPlatform?.() || '').toLowerCase();
  const userAgent = String(window.navigator?.userAgent || '').toLowerCase();
  const isNativeAndroid = capacitorPlatform === 'android';
  const isMobileWeb = !isNativeAndroid && (
    /android|iphone|ipad|ipod|mobile/.test(userAgent)
    || (window.matchMedia?.('(pointer: coarse)')?.matches && window.matchMedia?.('(max-width: 900px)')?.matches)
  );

  return { isNativeAndroid, isMobileWeb };
}

export function getAvailableNotifyPlatforms(surface = {}) {
  if (surface.isNativeAndroid) return [['serverchan3', 'Andriod']];
  if (surface.isMobileWeb) {
    return [
      ['ios', 'iOS'],
      ['serverchan3', 'Andriod']
    ];
  }
  return [
    ['ios', 'iOS'],
    ['serverchan3', 'Andriod'],
    ['pc', 'PC 浏览器']
  ];
}
