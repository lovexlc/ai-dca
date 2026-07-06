import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchSymbols } from '../src/app/marketsApi.js';

test('searchSymbols uses Tencent smartbox direct search before Worker fallback', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  let appendedScript = null;
  let fetchCalled = false;

  globalThis.window = { v_hint: '' };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'script');
      return {
        charset: '',
        src: '',
        remove() {}
      };
    },
    body: {
      appendChild(script) {
        appendedScript = script;
        globalThis.window.v_hint = 'sh~513100~\\u7eb3\\u6307ETF\\u56fd\\u6cf0~nzetfgt~QDII-ETF';
        script.onload?.();
      }
    }
  };
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('worker fallback should not be called');
  };

  try {
    const payload = await searchSymbols('cn', '513100', { limit: 8 });

    assert.equal(fetchCalled, false);
    assert.match(appendedScript.src, /smartbox\.gtimg\.cn/);
    assert.equal(payload.source, 'tencent-smartbox-direct');
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].symbol, 'sh513100');
    assert.equal(payload.results[0].name, '纳指ETF国泰');
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  }
});
