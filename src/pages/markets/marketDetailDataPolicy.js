import { normalizeCnFundCode } from './marketDisplayUtils.js';

export function shouldFetchXueqiuFundDetail({ market, symbol, activeTab, hasNasdaqOtcFund }) {
  if (market !== 'cn') return false;
  if (activeTab !== 'fundFlow' && activeTab !== 'fundReport') return false;
  const code = normalizeCnFundCode(symbol);
  if (!/^\d{6}$/.test(code)) return false;
  if (typeof hasNasdaqOtcFund === 'function' && hasNasdaqOtcFund(code)) return false;
  return true;
}

export function shouldFetchMarketNews({ market }) {
  return market === 'us';
}

export function shouldFetchFundFeesForVisibility(visibility = {}) {
  return visibility?.feeRate !== false || visibility?.redeemFeeRate !== false;
}

export function shouldRenderMarketsSidebar({ mobileHidden = false, desktopHidden = false } = {}) {
  return !(mobileHidden && desktopHidden);
}

export function shouldFetchDetailNavHistory({ market, symbol, cnFundParam = 'price', isCnOtcFund = false } = {}) {
  if (market !== 'cn') return false;
  if (!symbol) return false;
  return Boolean(isCnOtcFund || cnFundParam !== 'price');
}

export function shouldFetchCnEtfPremiumSnapshot({ market, symbol, cnFundParam = 'price', isCnOtcFund = false } = {}) {
  if (market !== 'cn') return false;
  if (!symbol) return false;
  if (isCnOtcFund) return false;
  return cnFundParam === 'premium';
}
