import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SITE_UPDATE_TARGETS,
  buildSiteUpdateUrl,
  isSiteUpdateTarget,
  probeSiteUpdates
} from '../src/app/siteUpdateProbe.js';

test('站点探活按 CN 优先级选择可用站点并记录测速时延', async () => {
  const calls = [];
  const result = await probeSiteUpdates({
    currentHref: 'https://freebacktrack.tech/index.html?tab=markets#top',
    timeoutMs: 100,
    fetchImpl: async (url) => {
      calls.push(url);
      return { status: 204 };
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(result.results.length, 2);
  assert.equal(result.recommended.id, 'cn');
  assert.equal(result.results[0].id, 'cn');
  assert.equal(result.results[1].id, 'fast');
  assert.ok(result.results.every((site) => Number.isFinite(site.latencyMs) && site.latencyMs >= 1));
  assert.ok(result.recommended.latencyMs >= 1);
  assert.equal(
    result.recommended.targetUrl,
    'https://cn.freebacktrack.tech:5000/index.html?tab=markets#top'
  );
});

test('CN 不可达时回退到 Fast 站点', async () => {
  const result = await probeSiteUpdates({
    currentHref: 'https://freebacktrack.tech/',
    timeoutMs: 100,
    fetchImpl: async (url) => {
      if (url.startsWith(SITE_UPDATE_TARGETS[0].url)) {
        throw new Error('cn unavailable');
      }
      return { status: 200 };
    }
  });

  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[1].ok, true);
  assert.ok(result.results[0].latencyMs >= 1);
  assert.ok(result.results[1].latencyMs >= 1);
  assert.equal(result.recommended.id, 'fast');
});

test('当前已在目标站点时可识别，避免提示循环', () => {
  assert.equal(isSiteUpdateTarget('https://cn.freebacktrack.tech:5000/index.html'), true);
  assert.equal(isSiteUpdateTarget('https://fast.freebacktrack.tech/'), true);
  assert.equal(isSiteUpdateTarget('https://freebacktrack.tech/'), false);
});

test('站点 URL 只复制当前页面路径，不携带探活参数', () => {
  assert.equal(
    buildSiteUpdateUrl(
      'https://fast.freebacktrack.tech',
      'https://freebacktrack.tech/holdings?tab=markets#detail'
    ),
    'https://fast.freebacktrack.tech/holdings?tab=markets#detail'
  );
});