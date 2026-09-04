import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_ALIASES,
  EXCHANGE_CODES,
  MARKET_ACTIONS,
  QUOTE_STALE_MS,
  actionFailure,
  actionSuccess,
  isExchangeCode,
  isMarketAction,
  isQuoteFresh,
  normalizeAction,
  normalizeFundCode,
  normalizeFundCodes,
  resolveQuoteTier
} from '../src/beta/data/marketActions.js';

import { createMarketsGateway } from '../src/beta/data/marketsGateway.js';

function createStubClient() {
  const calls = [];
  return {
    calls,
    async fetchQuotes(symbols) {
      calls.push(['fetchQuotes', symbols]);
      const quotes = {};
      for (const symbol of symbols) {
        quotes[symbol] = { code: symbol, price: 1.234, changePct: 0.56, ts: 1, source: 'stub' };
      }
      return { quotes };
    },
    async fetchExchangeFundList(options) {
      calls.push(['fetchExchangeFundList', options]);
      return { rows: [{ code: '513500' }], total: 1 };
    },
    async fetchFundMetrics(codes, options) {
      calls.push(['fetchFundMetrics', codes, options]);
      return { items: [{ code: codes[0], nav: 1.5 }] };
    },
    async fetchKline(symbol, options) {
      calls.push(['fetchKline', symbol, options]);
      return { candles: [{ t: 1, c: 2 }] };
    },
    async fetchMarketSummary(region, options) {
      calls.push(['fetchMarketSummary', region, options]);
      return { region, indices: [] };
    }
  };
}

function createClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    }
  };
}

test('action contract mirrors the tidbMarket cloud function', () => {
  assert.equal(MARKET_ACTIONS.length, 10);
  for (const action of ['ping', 'fund-list', 'fund-detail', 'fund-history', 'fund-intraday', 'fund-quote', 'home-overview']) {
    assert.equal(isMarketAction(action), true, action);
  }
  assert.deepEqual(Object.keys(ACTION_ALIASES).sort(), ['detail', 'history', 'list']);
});

test('normalizeAction resolves aliases, casing and rejects unknowns', () => {
  assert.equal(normalizeAction('list'), 'fund-list');
  assert.equal(normalizeAction('DETAIL'), 'fund-detail');
  assert.equal(normalizeAction(' history '), 'fund-history');
  assert.equal(normalizeAction('fund-quote'), 'fund-quote');
  assert.equal(normalizeAction('nope'), null);
  assert.equal(normalizeAction(''), null);
  assert.equal(normalizeAction(null), null);
});

test('normalizeFundCode strips venue prefixes and demands six digits', () => {
  assert.equal(normalizeFundCode('sh513500'), '513500');
  assert.equal(normalizeFundCode('SZ159941'), '159941');
  assert.equal(normalizeFundCode('bj430047'), '430047');
  assert.equal(normalizeFundCode(' 513500 '), '513500');
  assert.equal(normalizeFundCode('AAPL'), null);
  assert.equal(normalizeFundCode('51350'), null);
  assert.equal(normalizeFundCode('5135001'), null);
  assert.equal(normalizeFundCode(''), null);
});

test('normalizeFundCodes dedupes and drops invalid entries', () => {
  assert.deepEqual(
    normalizeFundCodes(['sh513500', '513500', 'AAPL', '', '159941']),
    ['513500', '159941']
  );
  assert.deepEqual(normalizeFundCodes('sh513500'), ['513500']);
  assert.deepEqual(normalizeFundCodes([]), []);
});

test('exchange ETF whitelist stays in sync with the cloud cache', () => {
  assert.equal(EXCHANGE_CODES.length, 21);
  assert.equal(new Set(EXCHANGE_CODES).size, 21);
  assert.equal(isExchangeCode('513500'), true);
  assert.equal(isExchangeCode('sh513500'), true);
  assert.equal(isExchangeCode('000001'), false);
  assert.equal(isExchangeCode('AAPL'), false);
});

test('quote freshness uses the 90s threshold inclusively', () => {
  assert.equal(QUOTE_STALE_MS, 90000);
  const now = 1_000_000;
  assert.equal(isQuoteFresh(now, now), true);
  assert.equal(isQuoteFresh(now - QUOTE_STALE_MS, now), true);
  assert.equal(isQuoteFresh(now - QUOTE_STALE_MS - 1, now), false);
  assert.equal(isQuoteFresh(0, now), false);
  assert.equal(isQuoteFresh(null, now), false);
  assert.equal(isQuoteFresh(now + 5000, now), false);
});

test('resolveQuoteTier classifies empty, stale, partial and fresh reads', () => {
  const now = 1_000_000;
  assert.equal(resolveQuoteTier({ requestedCodes: [], now }).tier, 'empty');
  assert.equal(
    resolveQuoteTier({ updateTime: now - 200000, requestedCodes: ['513500'], now }).tier,
    'stale'
  );
  const partial = resolveQuoteTier({
    updateTime: now,
    cachedCodes: ['513500'],
    requestedCodes: ['513500', '159941'],
    now
  });
  assert.equal(partial.tier, 'partial');
  assert.deepEqual(partial.missing, ['159941']);
  assert.equal(partial.useCache, true);
  const fresh = resolveQuoteTier({
    updateTime: now,
    cachedCodes: ['sh513500', '159941'],
    requestedCodes: ['513500'],
    now
  });
  assert.equal(fresh.tier, 'fresh');
  assert.deepEqual(fresh.missing, []);
});

test('action result helpers mirror the cloud function shape', () => {
  assert.deepEqual(actionSuccess({ quotes: {} }), { ok: true, quotes: {} });
  const failure = actionFailure('boom', { action: 'fund-list' });
  assert.equal(failure.ok, false);
  assert.equal(failure.error, 'boom');
  assert.equal(failure.action, 'fund-list');
  assert.equal(actionFailure('').error, 'unknown error');
});

test('gateway rejects unknown actions without touching the client', async () => {
  const client = createStubClient();
  const gateway = createMarketsGateway({ client });
  const result = await gateway.callAction('does-not-exist');
  assert.equal(result.ok, false);
  assert.match(result.error, /does-not-exist/);
  assert.equal(client.calls.length, 0);
});

test('gateway reports web-side gaps as unsupported instead of guessing', async () => {
  const client = createStubClient();
  const gateway = createMarketsGateway({ client });
  for (const action of ['home-series', 'premium-history', 'fund-limit-overview']) {
    const result = await gateway.callAction(action);
    assert.equal(result.ok, false, action);
    assert.equal(result.unsupported, true, action);
    assert.equal(result.action, action, action);
  }
  assert.equal(client.calls.length, 0);
});

test('gateway answers ping locally', async () => {
  const client = createStubClient();
  const gateway = createMarketsGateway({ client });
  const result = await gateway.callAction('ping');
  assert.equal(result.ok, true);
  assert.equal(result.pong, true);
  assert.equal(client.calls.length, 0);
});

test('fund-quote serves repeat reads from the 90s cache tier', async () => {
  const client = createStubClient();
  const clock = createClock();
  const gateway = createMarketsGateway({ client, now: clock.now });

  const first = await gateway.callAction('fund-quote', { codes: ['sh513500', '159941'] });
  assert.equal(first.ok, true);
  assert.equal(first.cacheFresh, false);
  assert.deepEqual(Object.keys(first.quotes).sort(), ['159941', '513500']);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0][1], ['513500', '159941']);

  clock.advance(30000);
  const second = await gateway.callAction('fund-quote', { codes: ['513500', '159941'] });
  assert.equal(second.ok, true);
  assert.equal(second.cacheHit, true);
  assert.equal(second.cacheFresh, true);
  assert.equal(client.calls.length, 1, 'cache hit must not refetch');

  clock.advance(QUOTE_STALE_MS + 1);
  const third = await gateway.callAction('fund-quote', { codes: ['513500'] });
  assert.equal(third.ok, true);
  assert.equal(third.cacheFresh, false);
  assert.equal(client.calls.length, 2, 'stale cache must refetch');
});

test('fund-quote only refetches the codes missing from a fresh cache', async () => {
  const client = createStubClient();
  const clock = createClock();
  const gateway = createMarketsGateway({ client, now: clock.now });

  await gateway.callAction('fund-quote', { codes: ['513500'] });
  const merged = await gateway.callAction('fund-quote', { codes: ['513500', '159941'] });

  assert.equal(client.calls.length, 2);
  assert.deepEqual(client.calls[1][1], ['159941'], 'must not refetch the cached code');
  assert.deepEqual(Object.keys(merged.quotes).sort(), ['159941', '513500']);
  assert.equal(merged.cacheHit, true);
});

test('fund-quote rejects requests without a usable fund code', async () => {
  const client = createStubClient();
  const gateway = createMarketsGateway({ client });
  const result = await gateway.callAction('fund-quote', { codes: ['AAPL', ''] });
  assert.equal(result.ok, false);
  assert.equal(client.calls.length, 0);
});

test('gateway maps list, detail, history and intraday onto the web client', async () => {
  const client = createStubClient();
  const gateway = createMarketsGateway({ client });

  const list = await gateway.callAction('list', { codes: ['sh513500'], limit: 20 });
  assert.equal(list.ok, true);
  assert.equal(list.action, 'fund-list');
  assert.equal(client.calls[0][0], 'fetchExchangeFundList');
  assert.deepEqual(client.calls[0][1].symbols, ['513500']);
  assert.equal(client.calls[0][1].limit, 20);

  const detail = await gateway.callAction('detail', { code: 'sz159941' });
  assert.equal(detail.ok, true);
  assert.equal(detail.code, '159941');
  assert.deepEqual(client.calls[1][1], ['159941']);
  assert.equal(detail.item.nav, 1.5);

  const history = await gateway.callAction('history', { code: '513500', timeframe: '1w' });
  assert.equal(history.ok, true);
  assert.equal(client.calls[2][2].timeframe, '1w');
  assert.equal(history.candles.length, 1);

  const intraday = await gateway.callAction('fund-intraday', { code: '513500' });
  assert.equal(intraday.ok, true);
  assert.equal(client.calls[3][2].timeframe, '1m');
});

test('gateway defaults home-overview to the CN region', async () => {
  const client = createStubClient();
  const gateway = createMarketsGateway({ client });
  const result = await gateway.callAction('home-overview');
  assert.equal(result.ok, true);
  assert.equal(client.calls[0][1], 'CN');
});

test('detail and history reject codes that are not six digits', async () => {
  const client = createStubClient();
  const gateway = createMarketsGateway({ client });
  assert.equal((await gateway.callAction('fund-detail', { code: 'AAPL' })).ok, false);
  assert.equal((await gateway.callAction('fund-history', { code: '' })).ok, false);
  assert.equal((await gateway.callAction('fund-intraday', {})).ok, false);
  assert.equal(client.calls.length, 0);
});

test('quote cache state is inspectable and clearable', async () => {
  const client = createStubClient();
  const clock = createClock();
  const gateway = createMarketsGateway({ client, now: clock.now });

  await gateway.callAction('fund-quote', { codes: ['513500'] });
  const state = gateway.getQuoteCacheState();
  assert.deepEqual(state.codes, ['513500']);
  assert.equal(state.updateTime, clock.now());

  gateway.clearQuoteCache();
  assert.deepEqual(gateway.getQuoteCacheState(), { updateTime: 0, codes: [] });
});
