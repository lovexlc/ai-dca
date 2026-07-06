import { test } from 'node:test';
import assert from 'node:assert/strict';

function installStorage(seed = {}) {
  const memory = new Map(Object.entries(seed));
  const storage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, String(value)); },
    removeItem(key) { memory.delete(key); },
    clear() { memory.clear(); }
  };
  return { memory, storage };
}

function installBrowserShims({ pcEnabled = false, notificationPermission = 'default' } = {}) {
  const { memory, storage } = installStorage({
    aiDcaWebNotifyConfig: JSON.stringify({ pcEnabled, lastSeenEventId: '' })
  });
  const dispatchedEvents = [];
  globalThis.window = {
    localStorage: storage,
    location: {
      origin: 'https://tools.freebacktrack.tech',
      protocol: 'https:',
      host: 'tools.freebacktrack.tech',
      href: 'https://tools.freebacktrack.tech/pages/markets.html',
      pathname: '/pages/markets.html',
      search: '',
      hash: ''
    },
    navigator: {
      userAgent: 'node-test',
      language: 'zh-CN',
      languages: ['zh-CN'],
      platform: 'linux'
    },
    document: {
      referrer: '',
      addEventListener() {},
      removeEventListener() {}
    },
    Notification: { permission: notificationPermission },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(event) { dispatchedEvents.push(event); }
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: globalThis.window.navigator
  });
  globalThis.location = globalThis.window.location;
  globalThis.document = globalThis.window.document;
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  return { memory, dispatchedEvents };
}

function installFakeFetch() {
  const registerBodies = [];
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/api/notify/ws/register')) {
      registerBodies.push(JSON.parse(String(init.body || '{}')));
      return new Response(JSON.stringify({
        ok: true,
        deviceInstallationId: 'web-ws:web:test-client',
        token: 'ws-token'
      }), { headers: { 'content-type': 'application/json' } });
    }
    if (String(url).includes('/api/notify/ws/unregister')) {
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  };
  return { calls, registerBodies };
}

function installFakeWebSocket() {
  class FakeWebSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      FakeWebSocket.instances.push(this);
      setTimeout(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.({ type: 'open' });
        this.onmessage?.({ data: JSON.stringify({ type: 'hello', connectionId: 'conn-1' }) });
      }, 0);
    }

    send(payload) {
      this.sent.push(String(payload));
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ code: 1000, reason: 'test close' });
    }
  }
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSED = 3;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  return FakeWebSocket;
}

async function freshImport() {
  return await import(`../src/app/notifyWsClient.js?cb=${Date.now()}${Math.random()}`);
}

test('startNotifyRealtime: market data can subscribe when PC notifications are disabled', async (t) => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalLocation = globalThis.location;
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const { memory } = installBrowserShims({ pcEnabled: false, notificationPermission: 'default' });
  const { registerBodies } = installFakeFetch();
  const FakeWebSocket = installFakeWebSocket();

  t.after(() => {
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator
    });
    globalThis.location = originalLocation;
    globalThis.document = originalDocument;
    globalThis.CustomEvent = originalCustomEvent;
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  });

  const { startNotifyRealtime } = await freshImport();
  const client = startNotifyRealtime({
    clientId: 'web:test-client',
    clientSecret: 'client-secret',
    clientLabel: 'Test Client',
    enableMarketData: true
  });

  client.subscribeMarketData(['513100']);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(registerBodies[0].capabilities, ['market']);
  assert.equal(registerBodies[0].clientLabel, 'Test Client');
  assert.equal(FakeWebSocket.instances.length, 1);

  const socket = FakeWebSocket.instances[0];
  const subscribeFrame = socket.sent.map((payload) => JSON.parse(payload)).find((frame) => frame.type === 'subscribe');
  assert.deepEqual(subscribeFrame.symbols, ['513100']);
  assert.deepEqual(subscribeFrame.topics, ['market.price', 'market.premium']);

  socket.onmessage?.({
    data: JSON.stringify({
      type: 'notify',
      messageId: 'event-1',
      data: { title: '通知', body: '不应处理' }
    })
  });

  assert.equal(socket.sent.some((payload) => JSON.parse(payload).type === 'ack'), false);
  assert.equal(JSON.parse(memory.get('aiDcaWebNotifyConfig')).lastSeenEventId, '');

  client.disconnect();
});

test('startNotifyRealtime: notify capability is registered only when PC notifications are ready', async (t) => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalLocation = globalThis.location;
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  installBrowserShims({ pcEnabled: true, notificationPermission: 'granted' });
  const { registerBodies } = installFakeFetch();
  installFakeWebSocket();

  t.after(() => {
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator
    });
    globalThis.location = originalLocation;
    globalThis.document = originalDocument;
    globalThis.CustomEvent = originalCustomEvent;
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  });

  const { startNotifyRealtime } = await freshImport();
  const client = startNotifyRealtime({
    clientId: 'web:test-client',
    clientSecret: 'client-secret',
    enableMarketData: true
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(registerBodies[0].capabilities, ['notify', 'market']);

  client.disconnect();
});

test('startNotifyRealtime: market subscriptions are scoped and unsubscribe stale symbols', async (t) => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalLocation = globalThis.location;
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  installBrowserShims({ pcEnabled: false, notificationPermission: 'default' });
  installFakeFetch();
  const FakeWebSocket = installFakeWebSocket();

  t.after(() => {
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator
    });
    globalThis.location = originalLocation;
    globalThis.document = originalDocument;
    globalThis.CustomEvent = originalCustomEvent;
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  });

  const { startNotifyRealtime } = await freshImport();
  const client = startNotifyRealtime({
    clientId: 'web:test-client',
    clientSecret: 'client-secret',
    enableMarketData: true
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const socket = FakeWebSocket.instances[0];
  client.subscribeMarketData(['513100', '159513'], { scope: 'markets' });
  client.subscribeMarketData(['159513'], { scope: 'holdings' });
  client.subscribeMarketData(['513100'], { scope: 'markets' });
  client.subscribeMarketData([], { scope: 'holdings' });

  const frames = socket.sent.map((payload) => JSON.parse(payload));
  const subscribeFrames = frames.filter((frame) => frame.type === 'subscribe');
  const unsubscribeFrames = frames.filter((frame) => frame.type === 'unsubscribe');

  assert.deepEqual(subscribeFrames.map((frame) => frame.symbols), [['513100', '159513']]);
  assert.deepEqual(unsubscribeFrames.map((frame) => frame.symbols), [['159513']]);

  client.disconnect();
});
