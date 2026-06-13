import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getAnalyticsVisitorId,
  isAnalyticsCollectionDisabled,
  setAnalyticsOptOut,
  trackAnalyticsEvent
} from '../src/app/analytics.js';

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
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

function installBrowserMock({ dnt = '0' } = {}) {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const beacons = [];
  const events = [];
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
    sessionStorage
  };

  Object.defineProperty(globalThis, 'window', { value: windowMock, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: { referrer: 'https://referrer.test/' }, configurable: true });
  Object.defineProperty(globalThis, 'CustomEvent', {
    value: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    configurable: true
  });

  return { beacons, events, localStorage, sessionStorage };
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
  assert.equal(env.beacons.length, 1);
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
