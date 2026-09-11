// PostHog 已移除。保留兼容导出，避免旧调用方在逐步清理期间报错。
export function initPostHog() {}
export function identifyUser() {}
export function trackEvent() {}
export function trackPageView() {}
export function setUserProperties() {}
export function resetUser() {}
export function getPostHog() { return null; }
