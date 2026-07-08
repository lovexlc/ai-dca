import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openAccountAuth, consumeAccountAuthIntent, ACCOUNT_AUTH_OPEN_EVENT } from '../src/app/accountAuthEvents.js';
import {
  CONVERSION_LAST_ACCEPTED_KEY,
  CONVERSION_PROMPT_EVENT,
  CONVERSION_PROMPT_STATE_KEY,
  acceptConversionPrompt,
  consumeAcceptedConversionPrompt,
  dismissConversionPrompt,
  triggerConversionPrompt
} from '../src/app/conversionPrompts.js';

function createStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); }
  };
}

function installBrowserMock() {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const events = [];
  const timers = [];
  const navigator = {
    doNotTrack: '0',
    language: 'zh-CN',
    languages: ['zh-CN'],
    maxTouchPoints: 0,
    onLine: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36'
  };
  const windowMock = {
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
    innerWidth: 1280,
    localStorage,
    location: { pathname: '/index.html', search: '?tab=markets', hash: '' },
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
  Object.defineProperty(globalThis, 'document', { value: { referrer: '' }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true });
  Object.defineProperty(globalThis, 'CustomEvent', {
    value: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    configurable: true
  });
  return { events, localStorage, sessionStorage };
}

function conversionEvents(events) {
  return events.filter((event) => event.type === CONVERSION_PROMPT_EVENT);
}

test('conversion prompt waits for the second market detail selection', () => {
  const env = installBrowserMock();

  assert.equal(triggerConversionPrompt('markets_symbol_select', { symbol: '513100', market: 'cn' }), false);
  assert.equal(conversionEvents(env.events).length, 0);

  assert.equal(triggerConversionPrompt('markets_symbol_select', { symbol: '159501', market: 'cn' }), true);
  const prompts = conversionEvents(env.events);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].detail.trigger, 'markets_symbol_select');
  assert.equal(prompts[0].detail.meta.symbol, '159501');

  const state = JSON.parse(env.localStorage.getItem(CONVERSION_PROMPT_STATE_KEY));
  assert.equal(state.counts.markets_symbol_select, 2);
});

test('conversion prompt does not show for logged in users', () => {
  const env = installBrowserMock();
  env.localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify({
    accessToken: 'token',
    username: 'lovexl'
  }));

  assert.equal(triggerConversionPrompt('notify_config_success', { source: 'config_save' }), false);
  assert.equal(conversionEvents(env.events).length, 0);
});

test('dismissed conversion prompt is cooled down', () => {
  const env = installBrowserMock();
  dismissConversionPrompt({ trigger: 'notify_config_success', meta: { source: 'config_save' } });

  assert.equal(triggerConversionPrompt('notify_config_success', { source: 'config_save' }), false);
  assert.equal(conversionEvents(env.events).length, 0);
});

test('accepted conversion prompt can be attributed once', () => {
  const env = installBrowserMock();
  acceptConversionPrompt({ trigger: 'holdings_transaction_save', meta: { type: 'BUY' } });

  assert.ok(env.localStorage.getItem(CONVERSION_LAST_ACCEPTED_KEY));
  const attribution = consumeAcceptedConversionPrompt();
  assert.equal(attribution.trigger, 'holdings_transaction_save');
  assert.equal(attribution.meta.type, 'BUY');
  assert.equal(consumeAcceptedConversionPrompt(), null);
});

test('account auth open event stores a register intent for lazy account menu mount', () => {
  const env = installBrowserMock();

  openAccountAuth({ mode: 'register', source: 'conversion_prompt', trigger: 'markets_symbol_select' });

  assert.equal(env.events.at(-1).type, ACCOUNT_AUTH_OPEN_EVENT);
  const intent = consumeAccountAuthIntent();
  assert.equal(intent.mode, 'register');
  assert.equal(intent.source, 'conversion_prompt');
  assert.equal(intent.trigger, 'markets_symbol_select');
  assert.equal(consumeAccountAuthIntent(), null);
});
