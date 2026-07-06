import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldFetchCnEtfPremiumSnapshot, shouldFetchDetailNavHistory, shouldFetchFundFeesForVisibility, shouldFetchMarketNews, shouldFetchXueqiuFundDetail, shouldRenderMarketsSidebar } from '../src/pages/markets/marketDetailDataPolicy.js';

test('CN fund detail does not prefetch Xueqiu raw data on overview tab', () => {
  let nasdaqOtcChecked = false;
  const shouldFetch = shouldFetchXueqiuFundDetail({
    market: 'cn',
    symbol: '513100',
    activeTab: 'overview',
    hasNasdaqOtcFund: () => {
      nasdaqOtcChecked = true;
      return false;
    },
  });

  assert.equal(shouldFetch, false);
  assert.equal(nasdaqOtcChecked, false);
});

test('CN fund detail fetches Xueqiu raw data only for fund flow/report tabs', () => {
  assert.equal(shouldFetchXueqiuFundDetail({ market: 'cn', symbol: 'SH513100', activeTab: 'fundFlow', hasNasdaqOtcFund: () => false }), true);
  assert.equal(shouldFetchXueqiuFundDetail({ market: 'cn', symbol: '513100', activeTab: 'fundReport', hasNasdaqOtcFund: () => false }), true);
  assert.equal(shouldFetchXueqiuFundDetail({ market: 'us', symbol: 'QQQ', activeTab: 'fundFlow', hasNasdaqOtcFund: () => false }), false);
  assert.equal(shouldFetchXueqiuFundDetail({ market: 'cn', symbol: '022951', activeTab: 'fundFlow', hasNasdaqOtcFund: () => true }), false);
});

test('market news is fetched only when the current market has a rendered news source', () => {
  assert.equal(shouldFetchMarketNews({ market: 'us' }), true);
  assert.equal(shouldFetchMarketNews({ market: 'cn' }), false);
});

test('fund fee requests follow fee column visibility', () => {
  assert.equal(shouldFetchFundFeesForVisibility({ feeRate: false, redeemFeeRate: false }), false);
  assert.equal(shouldFetchFundFeesForVisibility({ feeRate: true, redeemFeeRate: false }), true);
  assert.equal(shouldFetchFundFeesForVisibility({ feeRate: false, redeemFeeRate: true }), true);
  assert.equal(shouldFetchFundFeesForVisibility({}), true);
});

test('markets sidebar is not rendered when all responsive variants are hidden', () => {
  assert.equal(shouldRenderMarketsSidebar({ mobileHidden: true, desktopHidden: true }), false);
  assert.equal(shouldRenderMarketsSidebar({ mobileHidden: true, desktopHidden: false }), true);
  assert.equal(shouldRenderMarketsSidebar({ mobileHidden: false, desktopHidden: true }), true);
});

test('detail NAV history is fetched only for CN fund views that need NAV series', () => {
  assert.equal(shouldFetchDetailNavHistory({ market: 'cn', symbol: '513100', cnFundParam: 'price', isCnOtcFund: false }), false);
  assert.equal(shouldFetchDetailNavHistory({ market: 'cn', symbol: '513100', cnFundParam: 'nav', isCnOtcFund: false }), true);
  assert.equal(shouldFetchDetailNavHistory({ market: 'cn', symbol: '513100', cnFundParam: 'premium', isCnOtcFund: false }), true);
  assert.equal(shouldFetchDetailNavHistory({ market: 'cn', symbol: '021000', cnFundParam: 'price', isCnOtcFund: true }), true);
  assert.equal(shouldFetchDetailNavHistory({ market: 'us', symbol: 'QQQ', cnFundParam: 'nav', isCnOtcFund: false }), false);
});

test('CN ETF premium snapshot is fetched only for premium chart views', () => {
  assert.equal(shouldFetchCnEtfPremiumSnapshot({ market: 'cn', symbol: '513100', cnFundParam: 'price', isCnOtcFund: false }), false);
  assert.equal(shouldFetchCnEtfPremiumSnapshot({ market: 'cn', symbol: '513100', cnFundParam: 'nav', isCnOtcFund: false }), false);
  assert.equal(shouldFetchCnEtfPremiumSnapshot({ market: 'cn', symbol: '513100', cnFundParam: 'premium', isCnOtcFund: false }), true);
  assert.equal(shouldFetchCnEtfPremiumSnapshot({ market: 'cn', symbol: '021000', cnFundParam: 'premium', isCnOtcFund: true }), false);
  assert.equal(shouldFetchCnEtfPremiumSnapshot({ market: 'us', symbol: 'QQQ', cnFundParam: 'premium', isCnOtcFund: false }), false);
});
