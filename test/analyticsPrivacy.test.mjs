import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  flushAnalyticsEvents,
  getAnalyticsVisitorId,
  isAnalyticsCollectionDisabled,
  setAnalyticsOptOut,
  trackAnalyticsEvent
} from '../src/app/analytics.js';

function createStorage({ throwOnSetKeys = new Set() } = {}) {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (throwOnSetKeys.has(key)) {
        const error = new Error('Storage quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

function installBrowserMock({ dnt = '0', localStorageOptions = {}, sessionStorageOptions = {} } = {}) {
  const localStorage = createStorage(localStorageOptions);
  const sessionStorage = createStorage(sessionStorageOptions);
  const beacons = [];
  const events = [];
  const timers = [];
  const fetchCalls = [];
  const navigator = {
    doNotTrack: dnt,
    language: 'zh-CN',
    languages: ['zh-CN', 'en-US'],
    maxTouchPoints: 0,
    onLine: true,
    platform: 'Win32',
    sendBeacon(endpoint, body) {
      beacons.push({ endpoint, body });
      return true;
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36'
  };

  const windowMock = {
    __AI_DCA_ANALYTICS_ENDPOINT__: 'https://example.test/analytics',
    __AI_DCA_ANALYTICS_FLUSH_MS__: 60_000,
    addEventListener() {},
    clearTimeout(id) {
      const timer = timers.find((entry) => entry.id === id);
      if (timer) timer.cleared = true;
    },
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
    doNotTrack: dnt,
    innerWidth: 1280,
    localStorage,
    location: { pathname: '/index.html', search: '?tab=strategy', hash: '#home' },
    matchMedia: () => ({ matches: false }),
    navigator,
    setTimeout(fn, delay) {
      const id = timers.length + 1;
      timers.push({ id, fn, delay, cleared: false });
      return id;
    },
    sessionStorage
  };

  Object.defineProperty(globalThis, 'window', { value: windowMock, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: { referrer: 'https://referrer.test/' }, configurable: true });
  Object.defineProperty(globalThis, 'fetch', {
    value: async (endpoint, init = {}) => {
      fetchCalls.push({ endpoint, init });
      return { ok: true };
    },
    configurable: true
  });
  Object.defineProperty(globalThis, 'CustomEvent', {
    value: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    configurable: true
  });

  return { beacons, events, fetchCalls, localStorage, sessionStorage, timers };
}

test('analytics privacy hardening coarse-grains UA and device context', () => {
  const env = installBrowserMock();
  const event = trackAnalyticsEvent('page_view', {
    context: {
      custom: 'kept',
      devicePixelRatio: 2,
      platform: 'Win32',
      screenWidth: 1920,
      viewportWidth: 1280
    }
  });

  assert.equal(event.userAgent, 'Chrome / Windows');
  assert.equal(event.meta.context.deviceClass, 'desktop');
  assert.equal(event.meta.context.custom, 'kept');
  assert.equal('devicePixelRatio' in event.meta.context, false);
  assert.equal('platform' in event.meta.context, false);
  assert.equal('screenWidth' in event.meta.context, false);
  assert.equal('viewportWidth' in event.meta.context, false);
  assert.equal(env.beacons.length, 0);
  const pending = JSON.parse(env.localStorage.getItem('aiDcaAnalyticsPendingEvents_v1') || '[]');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].type, 'page_view');
  assert.equal(env.timers.length, 1);
});

test('analytics flush sends queued events as one batch request', async () => {
  const env = installBrowserMock();
  trackAnalyticsEvent('page_view', { tab: 'home' });
  trackAnalyticsEvent('notify_used', { notifyPlatform: 'pc' });

  assert.equal(env.fetchCalls.length, 0);
  const result = await flushAnalyticsEvents();

  assert.deepEqual(result, { ok: true, sent: 2 });
  assert.equal(env.fetchCalls.length, 1);
  assert.equal(env.fetchCalls[0].endpoint, 'https://example.test/analytics');
  const payload = JSON.parse(env.fetchCalls[0].init.body);
  assert.deepEqual(payload.events.map((event) => event.type), ['page_view', 'notify_used']);
  assert.equal(env.localStorage.getItem('aiDcaAnalyticsPendingEvents_v1'), null);
});

test('analytics local history quota failure does not break event tracking', () => {
  const env = installBrowserMock({
    localStorageOptions: { throwOnSetKeys: new Set(['aiDcaAnalyticsEvents_v1']) }
  });

  let event = null;
  assert.doesNotThrow(() => {
    event = trackAnalyticsEvent('page_view', { tab: 'markets' });
  });

  assert.equal(event.type, 'page_view');
  assert.equal(env.localStorage.getItem('aiDcaAnalyticsEvents_v1'), null);
  const pending = JSON.parse(env.localStorage.getItem('aiDcaAnalyticsPendingEvents_v1') || '[]');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].type, 'page_view');
});

test('analytics storage quota failure drops local queues without throwing', () => {
  const env = installBrowserMock({
    localStorageOptions: {
      throwOnSetKeys: new Set([
        'aiDcaAnalyticsEvents_v1',
        'aiDcaAnalyticsPendingEvents_v1',
        'aiDcaAnalyticsVisitorId_v1'
      ])
    },
    sessionStorageOptions: {
      throwOnSetKeys: new Set(['aiDcaAnalyticsSessionId_v1'])
    }
  });

  let event = null;
  assert.doesNotThrow(() => {
    event = trackAnalyticsEvent('notify_used', { notifyPlatform: 'pc' });
  });

  assert.equal(event.type, 'notify_used');
  assert.match(event.visitorId, /^visitor:/);
  assert.match(event.sessionId, /^session:/);
  assert.equal(env.localStorage.getItem('aiDcaAnalyticsEvents_v1'), null);
  assert.equal(env.localStorage.getItem('aiDcaAnalyticsPendingEvents_v1'), null);
  assert.equal(env.timers.length, 0);
});

test('analytics pagehide flush uses sendBeacon batch and keeps local history', async () => {
  const env = installBrowserMock();
  const event = trackAnalyticsEvent('page_view', { tab: 'markets' });
  const result = await flushAnalyticsEvents({ useBeacon: true });

  assert.deepEqual(result, { ok: true, sent: 1 });
  assert.equal(env.beacons.length, 1);
  assert.equal(env.beacons[0].endpoint, 'https://example.test/analytics');
  assert.equal(env.localStorage.getItem('aiDcaAnalyticsPendingEvents_v1'), null);
  const history = JSON.parse(env.localStorage.getItem('aiDcaAnalyticsEvents_v1') || '[]');
  assert.equal(history[0].id, event.id);
});

test('analytics opt-out stops event writes and visitor id generation', () => {
  const env = installBrowserMock();
  setAnalyticsOptOut(true);

  assert.equal(isAnalyticsCollectionDisabled(), true);
  assert.equal(trackAnalyticsEvent('page_view'), null);
  assert.equal(getAnalyticsVisitorId(), 'visitor:disabled');
  assert.equal(env.localStorage.getItem('aiDcaAnalyticsEvents_v1'), null);
  assert.equal(env.localStorage.getItem('aiDcaAnalyticsVisitorId_v1'), null);
  assert.equal(env.beacons.length, 0);
});

test('browser Do Not Track stops analytics collection', () => {
  const env = installBrowserMock({ dnt: '1' });

  assert.equal(isAnalyticsCollectionDisabled(), true);
  assert.equal(trackAnalyticsEvent('page_view'), null);
  assert.equal(getAnalyticsVisitorId(), 'visitor:disabled');
  assert.equal(env.localStorage.getItem('aiDcaAnalyticsVisitorId_v1'), null);
  assert.equal(env.beacons.length, 0);
});
