const SWITCH_CODE_PATTERN = /^\d{6}$/;

function toAsciiDigits(value) {
  return String(value ?? '').replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

export function normalizeManualSwitchCodeInput(value) {
  return toAsciiDigits(value).replace(/\D/g, '').slice(0, 6);
}

export function normalizeManualSwitchCode(value) {
  const code = normalizeManualSwitchCodeInput(value);
  return SWITCH_CODE_PATTERN.test(code) ? code : '';
}

export function filterExchangeSwitchHoldings(holdings = []) {
  if (!Array.isArray(holdings)) return [];
  return holdings.filter((holding) => holding?.kind === 'exchange');
}
