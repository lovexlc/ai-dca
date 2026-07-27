export const FUND_ADMIN_RATE_FIELDS = Object.freeze([
  'annualFeeRate',
  'managementFeeRate',
  'custodyFeeRate',
  'salesServiceFeeRate',
  'redeemFeeRate'
]);

export const FUND_ADMIN_RULE_FIELDS = Object.freeze([
  'purchaseRules',
  'redeemRules',
  'operationFees'
]);

const MAX_RATE = 100;

export function normalizeFundCode(raw) {
  const code = String(raw || '').trim();
  return /^\d{6}$/.test(code) ? code : '';
}

export function normalizeFundRate(value, field = 'rate') {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_RATE) {
    throw new Error(`${field} 必须是 0 到 100 之间的数字`);
  }
  return Math.round(number * 10000) / 10000;
}

export function normalizeFundRules(value, field = 'rules') {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) return value.slice(0, 100);
  if (typeof value !== 'string') throw new Error(`${field} 必须是 JSON 数组`);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${field} 必须是合法 JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${field} 必须是 JSON 数组`);
  return parsed.slice(0, 100);
}

export function normalizeFundAdminPatch(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('补录数据格式不合法');
  }
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(input, 'name')) {
    const name = String(input.name || '').trim().slice(0, 128);
    if (name) patch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'fundType')) {
    const fundType = String(input.fundType || '').trim().toLowerCase();
    if (fundType && !['otc', 'exchange', 'unknown'].includes(fundType)) {
      throw new Error('fundType 只能是 otc、exchange 或 unknown');
    }
    patch.fundType = fundType || null;
  }
  for (const field of FUND_ADMIN_RATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) patch[field] = normalizeFundRate(input[field], field);
  }
  for (const field of FUND_ADMIN_RULE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) patch[field] = normalizeFundRules(input[field], field);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'notice')) {
    patch.notice = String(input.notice || '').trim().slice(0, 1000) || null;
  }
  return patch;
}

export function parseFeeJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function buildMissingFeeClause(filter = 'all') {
  const clauses = {
    any: '(annual_fee_rate IS NULL OR redeem_fee_rate IS NULL OR management_fee_rate IS NULL OR custody_fee_rate IS NULL OR sales_service_fee_rate IS NULL)',
    annualFeeRate: 'annual_fee_rate IS NULL',
    redeemFeeRate: 'redeem_fee_rate IS NULL',
    managementFeeRate: 'management_fee_rate IS NULL',
    custodyFeeRate: 'custody_fee_rate IS NULL',
    salesServiceFeeRate: 'sales_service_fee_rate IS NULL',
    feeJson: '(fee_json IS NULL OR fee_json = \'\')'
  };
  return clauses[String(filter || '').trim()] || '';
}

export function feeRowToAdminItem(row = {}) {
  const fee = parseFeeJson(row.fee_json);
  return {
    code: String(row.code || ''),
    name: String(row.name || row.code || ''),
    fundType: row.fee_fund_type || fee.fundType || 'unknown',
    annualFeeRate: row.annual_fee_rate ?? fee.annualFeeRate ?? null,
    managementFeeRate: row.management_fee_rate ?? fee.managementFeeRate ?? null,
    custodyFeeRate: row.custody_fee_rate ?? fee.custodyFeeRate ?? null,
    salesServiceFeeRate: row.sales_service_fee_rate ?? fee.salesServiceFeeRate ?? null,
    redeemFeeRate: row.redeem_fee_rate ?? fee.redeemFeeRate ?? null,
    purchaseRules: fee.purchaseRules || null,
    redeemRules: fee.redeemRules || null,
    operationFees: fee.operationFees || null,
    notice: row.fee_notice || fee.notice || '',
    source: row.fee_source || fee.source || '',
    syncedAt: row.fee_synced_at || '',
    latestNav: row.latest_nav ?? null,
    latestNavDate: row.latest_nav_date || '',
    quoteSyncedAt: row.quote_synced_at || '',
    limitSyncedAt: row.limit_synced_at || ''
  };
}
