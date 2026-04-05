export const BENCHMARK_MARKET_CODE = 'nas-daq100';
export const BENCHMARK_DISPLAY_CODE = '纳指100指数';
export const BENCHMARK_DISPLAY_NAME = '纳斯达克100指数（美元）';

export function formatMarketCode(code = '') {
  const normalized = String(code || '').trim();
  if (!normalized) {
    return '';
  }

  return normalized === BENCHMARK_MARKET_CODE ? BENCHMARK_DISPLAY_CODE : normalized;
}

export function formatMarketName(entry = null) {
  const code = String(entry?.code || '').trim();
  if (code === BENCHMARK_MARKET_CODE) {
    return BENCHMARK_DISPLAY_NAME;
  }

  const name = String(entry?.name || '').trim();
  return name || formatMarketCode(code);
}

export function formatMarketLabel(entry = null) {
  const codeLabel = formatMarketCode(entry?.code);
  const nameLabel = formatMarketName(entry);

  if (!codeLabel && !nameLabel) {
    return '--';
  }

  if (!nameLabel || nameLabel === codeLabel) {
    return codeLabel;
  }

  if (codeLabel === BENCHMARK_DISPLAY_CODE) {
    return nameLabel;
  }

  return `${codeLabel} ${nameLabel}`;
}
