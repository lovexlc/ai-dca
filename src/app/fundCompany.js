import { getKnownQdiiFundName } from './qdiiFundCodes.js';

const COMPANY_NAMES = [
  '华夏基金',
  '易方达基金',
  '广发基金',
  '南方基金',
  '嘉实基金',
  '博时基金',
  '汇添富基金',
  '富国基金',
  '招商基金',
  '鹏华基金',
  '华安基金',
  '华泰柏瑞基金',
  '天弘基金',
  '工银瑞信基金',
  '中欧基金',
  '景顺长城基金',
  '国泰基金',
  '银华基金',
  '交银施罗德基金',
  '兴证全球基金',
  '建信基金',
  '平安基金',
  '永赢基金',
  '万家基金',
  '国投瑞银基金',
  '摩根基金(中国)',
  '华宝基金',
  '大成基金',
  '长城基金',
  '融通基金',
];

const COMPANY_ALIASES = {
  '华泰柏瑞': '华泰柏瑞基金',
  '兴证全球': '兴证全球基金',
  '兴全基金': '兴证全球基金',
  '工银瑞信': '工银瑞信基金',
  '景顺长城': '景顺长城基金',
  '国投瑞银': '国投瑞银基金',
  '交银施罗德': '交银施罗德基金',
  '摩根基金': '摩根基金(中国)',
  '摩根资产管理': '摩根基金(中国)',
  '平安基金管理有限公司': '平安基金',
};

const COLOR_PALETTE = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f39c12',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
  '#34495e',
  '#e91e63',
  '#00bcd4',
  '#ff5722',
  '#607d8b',
  '#795548',
  '#4caf50',
  '#ff9800',
  '#673ab7',
  '#3f51b5',
  '#009688',
  '#cddc39',
  '#ffc107',
];

function computeShortName(fullName = '') {
  return String(fullName || '')
    .replace(/\(.*?\)$/, '')
    .replace(/基金$/, '')
    .trim();
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, '').trim();
}

function colorForCompany(companyName) {
  let hash = 0;
  for (const char of String(companyName || '')) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

const prefixEntries = [];
for (const companyName of COMPANY_NAMES) {
  prefixEntries.push({ prefix: companyName, companyName });
  prefixEntries.push({ prefix: computeShortName(companyName), companyName });
}
for (const [prefix, companyName] of Object.entries(COMPANY_ALIASES)) {
  prefixEntries.push({ prefix, companyName });
  prefixEntries.push({ prefix: computeShortName(prefix), companyName });
}

const PREFIX_ENTRIES = prefixEntries
  .map((entry) => ({ ...entry, normalizedPrefix: normalizeText(entry.prefix) }))
  .filter((entry) => entry.normalizedPrefix)
  .sort((a, b) => b.normalizedPrefix.length - a.normalizedPrefix.length)
  .filter((entry, index, entries) => (
    entries.findIndex((candidate) => (
      candidate.normalizedPrefix === entry.normalizedPrefix
      && candidate.companyName === entry.companyName
    )) === index
  ));

const UNKNOWN_COMPANY = Object.freeze({
  name: '未识别基金公司',
  short: '其他',
  color: '#94a3b8',
});

export function resolveFundCompany(nameOrCode = '') {
  const raw = String(nameOrCode || '').trim();
  if (!raw) return UNKNOWN_COMPANY;

  const knownName = /^\d{5,6}$/.test(raw) ? getKnownQdiiFundName(raw) : '';
  const target = normalizeText(knownName || raw);
  const matched = PREFIX_ENTRIES.find((entry) => target.includes(entry.normalizedPrefix));
  if (!matched) return UNKNOWN_COMPANY;

  return {
    name: matched.companyName,
    short: computeShortName(matched.companyName),
    color: colorForCompany(matched.companyName),
  };
}
