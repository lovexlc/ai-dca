import test from 'node:test';
import assert from 'node:assert/strict';
import { createChangeDisplay } from '../src/beta/data/changeDisplayCore.js';
import {
  buildPresetIndex,
  createMarketsViewModel,
  formatPercent,
  formatPrice,
  getListCodes,
  indexSnapshots,
  normalizeRowCode,
  pickField,
  resolveListKind,
  selectActiveList,
  sortRows,
  summarizeRows,
  toFiniteNumber
} from '../src/beta/data/marketsViewModel.js';

// 假日历只在测试里造：2026-09-01 到 09-04 是交易日，09-05 是周六。
const TRADING_DAYS = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];

function createGate(overrides = {}) {
  const { getDisplayChangePercent } = createChangeDisplay({
    isTradingDay: (date) => TRADING_DAYS.includes(date),
    getToday: () => '2026-09-04',
    getExpectedDate: (kind, today) => (kind === 'qdii' ? '2026-09-03' : today),
    normalizeKind: (kind) => {
      const value = String(kind || '').toLowerCase();
      if (value === 'exchange') return 'exchange';
      if (value === 'qdii') return 'qdii';
      return 'otc';
    },
    ...overrides
  });
  return getDisplayChangePercent;
}

function createViewModel(overrides = {}) {
  return createMarketsViewModel({ getDisplayChangePercent: createGate(), ...overrides });
}

const ETF_LIST = { id: 'default', name: '默认-场内基金', type: 'cn_etf', us: [], cn: ['513870', '159941'] };
const OTC_LIST = { id: 'default-otc', name: '默认-场外基金', type: 'cn_otc', us: [], cn: ['000834'] };
const PRESETS = buildPresetIndex(
  [{ symbol: '513870', name: '纳指ETF 富国', exchange: '上交所' }],
  [{ symbol: '000834', name: '大成纳斯达克100ETF联接(QDII)A' }]
);

test('toFiniteNumber accepts the shapes snapshots actually carry', () => {
  assert.equal(toFiniteNumber(1.23), 1.23);
  assert.equal(toFiniteNumber('1.23'), 1.23);
  assert.equal(toFiniteNumber('+1.23%'), 1.23);
  assert.equal(toFiniteNumber('-0.45%'), -0.45);
  assert.equal(toFiniteNumber('1,234.5'), 1234.5);
  assert.equal(toFiniteNumber(''), null);
  assert.equal(toFiniteNumber(null), null);
  assert.equal(toFiniteNumber('停牌'), null);
  assert.equal(toFiniteNumber(Number.NaN), null);
  assert.equal(toFiniteNumber(true), null);
});

test('pickField walks aliases and treats empty strings as absent', () => {
  assert.equal(pickField({ code: '', symbol: '513870' }, ['code', 'symbol']), '513870');
  assert.equal(pickField({ code: null }, ['code']), undefined);
  assert.equal(pickField(null, ['code']), undefined);
});

test('normalizeRowCode trims and upper-cases so lookups line up', () => {
  assert.equal(normalizeRowCode(' 513870 '), '513870');
  assert.equal(normalizeRowCode('sh513870'), 'SH513870');
  assert.equal(normalizeRowCode(null), '');
});

test('resolveListKind maps the watchlist type onto a fund kind', () => {
  assert.equal(resolveListKind(ETF_LIST), 'exchange');
  assert.equal(resolveListKind(OTC_LIST), 'otc');
  assert.equal(resolveListKind({ id: 'legacy' }), 'otc');
  assert.equal(resolveListKind({ id: 'legacy' }, 'exchange'), 'exchange');
  assert.equal(resolveListKind(null), 'otc');
});

test('getListCodes dedupes, keeps order and tolerates object entries', () => {
  const codes = getListCodes({ cn: ['513870', ' 513870 ', '', null, { code: '159941' }] });
  assert.deepEqual(codes, ['513870', '159941']);
  assert.deepEqual(getListCodes({ cn: ['513870'] }, 'us'), []);
  assert.deepEqual(getListCodes(null), []);
});

test('selectActiveList honours activeListId and degrades gracefully', () => {
  assert.equal(selectActiveList({ lists: [ETF_LIST, OTC_LIST], activeListId: 'default-otc' }).id, 'default-otc');
  assert.equal(selectActiveList({ lists: [ETF_LIST, OTC_LIST], activeListId: 'gone' }).id, 'default');
  assert.deepEqual(selectActiveList({ cn: ['513870'] }).cn, ['513870']);
  assert.equal(selectActiveList(null), null);
  assert.equal(selectActiveList({}), null);
});

test('buildPresetIndex flattens groups and keeps the first match', () => {
  const index = buildPresetIndex(
    [{ symbol: '513870', name: 'A' }],
    [[{ symbol: '513870', name: 'B' }, { code: '159941', name: 'C' }]]
  );
  assert.equal(index.get('513870').name, 'A');
  assert.equal(index.get('159941').name, 'C');
  assert.equal(index.size, 2);
});

test('indexSnapshots eats arrays, payload wrappers and keyed maps', () => {
  assert.equal(indexSnapshots([{ code: '513870' }]).get('513870').code, '513870');
  assert.equal(indexSnapshots({ items: [{ symbol: '513870' }] }).size, 1);
  assert.equal(indexSnapshots({ rows: [{ symbol: '513870' }] }).size, 1);
  assert.equal(indexSnapshots({ 513870: { price: 1.5 } }).get('513870').price, 1.5);
  assert.equal(indexSnapshots(null).size, 0);
});

test('indexSnapshots lets a later entry win so refreshed quotes replace cached ones', () => {
  const index = indexSnapshots([{ code: '513870', price: 1 }, { code: '513870', price: 2 }]);
  assert.equal(index.get('513870').price, 2);
});

test('formatPercent always shows a sign and blanks out missing values', () => {
  assert.equal(formatPercent(1.234), '+1.23%');
  assert.equal(formatPercent(-0.4), '-0.40%');
  assert.equal(formatPercent(0), '0.00%');
  assert.equal(formatPercent(null), '—');
  assert.equal(formatPercent(null, { blank: '停牌' }), '停牌');
});

test('formatPrice defaults to three digits and takes four for nav', () => {
  assert.equal(formatPrice(1.5), '1.500');
  assert.equal(formatPrice(1.23456, { digits: 4 }), '1.2346');
  assert.equal(formatPrice(null), '—');
});

test('createMarketsViewModel refuses to run without the change gate', () => {
  assert.throws(() => createMarketsViewModel({}), /requires a getDisplayChangePercent function/);
});

test('a same-day exchange quote renders the real change', () => {
  const rows = createViewModel().buildRows({
    list: ETF_LIST,
    presets: PRESETS,
    quotes: [{ code: '513870', price: 1.523, changePercent: 1.24, quoteDate: '2026-09-04' }],
    todayDate: '2026-09-04'
  });
  const row = rows[0];
  assert.equal(rows.length, 2);
  assert.equal(row.code, '513870');
  assert.equal(row.name, '纳指ETF 富国');
  assert.equal(row.kind, 'exchange');
  assert.equal(row.fresh, true);
  assert.equal(row.reason, 'fresh');
  assert.equal(row.changeText, '+1.24%');
  assert.equal(row.priceText, '1.523');
  assert.equal(row.direction, 'up');
  assert.equal(row.exchange, '上交所');
});

test('a trading day holding yesterday quote is zeroed instead of misread as today', () => {
  const rows = createViewModel().buildRows({
    list: ETF_LIST,
    presets: PRESETS,
    quotes: [{ code: '513870', price: 1.5, changePercent: 1.24, quoteDate: '2026-09-03' }],
    todayDate: '2026-09-04'
  });
  assert.equal(rows[0].changePercent, 0);
  assert.equal(rows[0].changeText, '0.00%');
  assert.equal(rows[0].fresh, false);
  assert.equal(rows[0].reason, 'stale');
  assert.equal(rows[0].direction, 'flat');
});

test('codes without a snapshot report no-data rather than a flat zero', () => {
  const rows = createViewModel().buildRows({
    list: ETF_LIST,
    presets: PRESETS,
    quotes: [{ code: '513870', changePercent: 1.24, quoteDate: '2026-09-04' }],
    todayDate: '2026-09-04'
  });
  const row = rows[1];
  assert.equal(row.code, '159941');
  assert.equal(row.missing, true);
  assert.equal(row.reason, 'no-data');
  assert.equal(row.changePercent, null);
  assert.equal(row.changeText, '—');
  assert.equal(row.priceText, '—');
  assert.equal(row.name, '159941');
});

test('suspended funds render as a label rather than a number', () => {
  const rows = createViewModel().buildRows({
    list: ETF_LIST,
    presets: PRESETS,
    quotes: [{ code: '513870', suspended: true, price: 1.5, changePercent: 2, quoteDate: '2026-09-04' }],
    todayDate: '2026-09-04'
  });
  assert.equal(rows[0].suspended, true);
  assert.equal(rows[0].reason, 'suspended');
  assert.equal(rows[0].changePercent, null);
  assert.equal(rows[0].changeText, '停牌');
  assert.equal(rows[0].direction, 'flat');
  assert.equal(rows[0].missing, false);
});

test('an otc list reads the nav date and the nav field', () => {
  const rows = createViewModel().buildRows({
    list: OTC_LIST,
    presets: PRESETS,
    quotes: [{ fundCode: '000834', latestNav: 3.2145, latestNavDate: '2026-09-04', changePercent: 0.88 }],
    todayDate: '2026-09-04'
  });
  assert.equal(rows[0].kind, 'otc');
  assert.equal(rows[0].fresh, true);
  assert.equal(rows[0].navText, '3.2145');
  assert.equal(rows[0].changeText, '+0.88%');
  assert.equal(rows[0].name, '大成纳斯达克100ETF联接(QDII)A');
});

test('price and premium aliases are picked up whatever the action called them', () => {
  const rows = createViewModel().buildRows({
    list: ETF_LIST,
    presets: PRESETS,
    quotes: [{ symbol: '513870', currentPrice: '1.234', premiumPct: '0.56', changePercent: 0, quoteDate: '2026-09-04' }],
    todayDate: '2026-09-04'
  });
  assert.equal(rows[0].priceText, '1.234');
  assert.equal(rows[0].premiumText, '+0.56%');
});

test('a snapshot kind overrides the list kind so a mixed list still reads right', () => {
  const rows = createViewModel().buildRows({
    list: ETF_LIST,
    presets: PRESETS,
    quotes: [{ code: '513870', kind: 'qdii', latestNavDate: '2026-09-03', changePercent: 0.5 }],
    todayDate: '2026-09-04'
  });
  assert.equal(rows[0].kind, 'qdii');
  assert.equal(rows[0].fresh, true);
  assert.equal(rows[0].changeText, '+0.50%');
});

test('an explicit codes list overrides the watchlist', () => {
  const rows = createViewModel().buildRows({
    list: ETF_LIST,
    codes: ['159941', '159941'],
    presets: PRESETS,
    quotes: [],
    todayDate: '2026-09-04'
  });
  assert.deepEqual(rows.map((row) => row.code), ['159941']);
});

test('buildRows resolves the active list straight from a stored watchlist', () => {
  const rows = createViewModel().buildRows({
    watchlist: { lists: [ETF_LIST, OTC_LIST], activeListId: 'default-otc' },
    presets: PRESETS,
    quotes: [],
    todayDate: '2026-09-04'
  });
  assert.deepEqual(rows.map((row) => row.code), ['000834']);
  assert.equal(rows[0].kind, 'otc');
});

test('an injected code normalizer lines up prefixed watchlist codes with plain quotes', () => {
  const rows = createMarketsViewModel({
    getDisplayChangePercent: createGate(),
    normalizeCode: (value) => String(value == null ? '' : value).trim().toUpperCase().replace(/^(SH|SZ)/, '')
  }).buildRows({
    list: { type: 'cn_etf', cn: ['sh513870'] },
    presets: PRESETS,
    quotes: [{ code: '513870', changePercent: 1.1, quoteDate: '2026-09-04' }],
    todayDate: '2026-09-04'
  });
  assert.equal(rows[0].code, '513870');
  assert.equal(rows[0].missing, false);
  assert.equal(rows[0].name, '纳指ETF 富国');
});

test('on a closed day the last known change is shown as is', () => {
  const rows = createViewModel().buildRows({
    list: ETF_LIST,
    presets: PRESETS,
    quotes: [{ code: '513870', changePercent: -0.62, quoteDate: '2026-09-04' }],
    todayDate: '2026-09-05'
  });
  assert.equal(rows[0].reason, 'market-closed');
  assert.equal(rows[0].changeText, '-0.62%');
  assert.equal(rows[0].fresh, false);
  assert.equal(rows[0].direction, 'down');
});

test('sortRows ranks by change and always sinks the rows without data', () => {
  const rows = [
    { code: 'a', name: 'a', changePercent: -1 },
    { code: 'b', name: 'b', changePercent: null },
    { code: 'c', name: 'c', changePercent: 2 }
  ];
  assert.deepEqual(sortRows(rows).map((row) => row.code), ['c', 'a', 'b']);
  assert.deepEqual(sortRows(rows, { direction: 'asc' }).map((row) => row.code), ['a', 'c', 'b']);
  assert.deepEqual(sortRows(rows, { by: 'code', direction: 'asc' }).map((row) => row.code), ['a', 'b', 'c']);
  assert.deepEqual(rows.map((row) => row.code), ['a', 'b', 'c']);
});

test('summarizeRows counts what the list header needs', () => {
  const summary = summarizeRows([
    { fresh: true, reason: 'fresh' },
    { fresh: false, reason: 'stale' },
    { fresh: false, reason: 'suspended' },
    { missing: true, reason: 'no-data' },
    null
  ]);
  assert.deepEqual(summary, {
    total: 4,
    withData: 3,
    missing: 1,
    fresh: 1,
    stale: 1,
    suspended: 1,
    marketClosed: 0
  });
});
