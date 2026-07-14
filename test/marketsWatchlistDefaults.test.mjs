import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CN_ETF_WATCHLIST_PRESETS,
  normalizeWatchlist,
} from '../src/app/marketsWatchlistStorage.js';

const ETF_SYMBOLS = CN_ETF_WATCHLIST_PRESETS.map((item) => item.symbol);
const EXPECTED_CN_ETF_NAMES = {
  513870: '纳指ETF 富国',
  513390: '纳指100ETF 博时',
  513300: '纳斯达克ETF 华夏',
  513110: '纳指ETF 华泰柏瑞',
  513100: '纳指ETF 国泰',
  159941: '纳指ETF 广发',
  159696: '纳指ETF 易方达',
  159660: '纳指ETF 汇添富',
  159659: '纳斯达克100ETF 招商',
  159632: '纳斯达克ETF 华安',
  159513: '纳斯达克100ETF 大成',
  159509: '纳指科技ETF 景顺',
  159501: '纳指ETF 嘉实',
  159577: '美国50ETF 汇添富',
  161128: '标普信息科技LOF',
  161130: '纳斯达克100LOF',
  513500: '标普500ETF 博时',
  513650: '标普500ETF 南方',
  159612: '标普500ETF 国泰',
};

function byName(watchlist, name) {
  return (watchlist.lists || []).find((item) => item.name === name);
}

function normalizeName(name) {
  return String(name || '').replace(/\s+/g, '').trim();
}

test('new markets watchlist omits common indicator defaults', () => {
  const watchlist = normalizeWatchlist({});

  assert.ok(byName(watchlist, '场内基金'));
  assert.ok(byName(watchlist, '场外基金'));
  assert.equal(byName(watchlist, '默认-常用指标'), undefined);
  assert.equal((watchlist.lists || []).some((item) => item.id === 'default-indicators'), false);
  assert.equal(watchlist.defaultsVersion, 9);
  assert.ok(byName(watchlist, '场内基金').cn.includes('161130'));
});

test('CN ETF default names match verified market API names', () => {
  assert.deepEqual(new Set(ETF_SYMBOLS), new Set(Object.keys(EXPECTED_CN_ETF_NAMES)));
  for (const preset of CN_ETF_WATCHLIST_PRESETS) {
    assert.equal(
      normalizeName(preset.name),
      normalizeName(EXPECTED_CN_ETF_NAMES[preset.symbol]),
      `${preset.symbol} default name should match verified market API name`
    );
  }
});

test('v5 markets watchlist migrates to current default lists', () => {
  const watchlist = normalizeWatchlist({
    lists: [
      { id: 'default', name: '默认-场内基金', type: 'cn_etf', us: [], cn: ['513100'] },
      { id: 'default-otc', name: '默认-场外基金', type: 'cn_otc', us: [], cn: ['000834'] },
    ],
    activeListId: 'default',
    defaultsVersion: 5,
  });

  const cnEtfs = byName(watchlist, '场内基金');
  assert.equal(byName(watchlist, '默认-常用指标'), undefined);
  for (const symbol of ETF_SYMBOLS) {
    assert.ok(cnEtfs.cn.includes(symbol), `missing ${symbol}`);
  }
});

test('legacy default indicator list is removed and active list falls back', () => {
  const watchlist = normalizeWatchlist({
    lists: [
      { id: 'default', name: '默认-场内基金', type: 'cn_etf', us: [], cn: ['513100'] },
      { id: 'default-indicators', name: '自定义指标', type: 'custom', us: ['CUSTOM_MACRO'], cn: [] },
    ],
    activeListId: 'default-indicators',
    defaultsVersion: 5,
  });

  assert.equal(byName(watchlist, '默认-常用指标'), undefined);
  assert.equal((watchlist.lists || []).some((item) => item.id === 'default-indicators'), false);
  assert.equal(watchlist.activeListId, 'default');
  assert.deepEqual(watchlist.us, []);
});

test('current default indicator list is removed during normalization', () => {
  const watchlist = normalizeWatchlist({
    lists: [
      { id: 'default', name: '默认-场内基金', type: 'cn_etf', us: [], cn: ['513100'] },
      {
        id: 'default-indicators',
        name: '默认-常用指标',
        type: 'us_indicator',
        us: ['^VIX', 'NYAD_LINE', 'CUSTOM_MACRO', 'NAAD_LINE', 'NAAD_LINE'],
        cn: [],
      },
    ],
    activeListId: 'default-indicators',
    defaultsVersion: 8,
  });

  assert.equal(byName(watchlist, '默认-常用指标'), undefined);
  assert.equal((watchlist.lists || []).some((item) => item.id === 'default-indicators'), false);
  assert.equal(watchlist.activeListId, 'default');
});
