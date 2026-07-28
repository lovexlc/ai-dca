import { QDII_FUND_NAMES_BY_CODE } from './qdiiFundCodes.js';

export const QDII_REGION_LABELS = {
  us: '美股',
  hk: '港股',
  japan: '日本',
  europe: '欧洲',
  global: '全球',
  commodity: '商品',
  bond: '债券',
  asia_pacific: '亚太',
};

export const QDII_INDEX_LABELS = {
  nasdaq100: '纳斯达克100',
  sp500: '标普500',
  us50: '美股50',
  hsi: '恒生指数',
  hstech: '恒生科技',
  china_internet: '中概互联',
  nikkei225: '日经225',
  gold: '黄金',
  oil: '原油',
  bond_global: '全球债券',
  bond_us: '美债',
  diversified: '广基/混合',
};

/**
 * Derive region and indexKey from a QDII fund name using regex patterns.
 * Precedence: commodity > bond > japan > europe > hk > us > asia_pacific > global
 */
function deriveQdiiFundMeta(name) {
  if (!name) return null;

  let region = 'global';
  let indexKey = 'diversified';

  // --- Commodity (highest priority for thematic classification) ---
  if (/黄金|贵金属/.test(name)) {
    region = 'commodity';
    indexKey = 'gold';
  } else if (/原油|石油|油气|大宗商品|抗通胀/.test(name)) {
    region = 'commodity';
    indexKey = /原油|石油|油气/.test(name) ? 'oil' : 'diversified';
  }
  // --- Bond ---
  else if (/债券|债\b|票息/.test(name)) {
    region = 'bond';
    if (/美元|美债/.test(name)) indexKey = 'bond_us';
    else indexKey = 'bond_global';
  }
  // --- Japan ---
  else if (/日经|日本|东证/.test(name)) {
    region = 'japan';
    indexKey = 'nikkei225';
  }
  // --- Europe ---
  else if (/德国|法国|欧洲|富时100|DAX|CAC/.test(name)) {
    region = 'europe';
    indexKey = 'diversified';
  }
  // --- HK ---
  else if (/恒生|港股|香港|H股|港美互联/.test(name)) {
    region = 'hk';
    if (/恒生科技|恒生互联网|香港科技|港股科技/.test(name)) indexKey = 'hstech';
    else if (/恒生|港股|香港|H股/.test(name)) indexKey = 'hsi';
    else indexKey = 'hsi';
  }
  // --- China Internet (may overlap with HK but check separately) ---
  else if (/中概互联|中证海外互联网|中国互联网|中美互联网|海外中国互联网/.test(name)) {
    region = 'hk';
    indexKey = 'china_internet';
  }
  // --- US ---
  else if (/纳斯达克|纳指|标普|道琼斯|美国50|美股50|美国成长|美国消费|美国房地产|标普500/.test(name)) {
    region = 'us';
    if (/纳斯达克100|纳指100|纳指ETF|纳斯达克ETF|纳斯达克100ETF/.test(name)) indexKey = 'nasdaq100';
    else if (/标普500/.test(name)) indexKey = 'sp500';
    else if (/美国50|美股50/.test(name)) indexKey = 'us50';
    else indexKey = 'diversified';
  }
  // --- Asia Pacific ---
  else if (/亚太|亚洲|印度|越南|东南亚|大中华|新兴市场|亚洲精选/.test(name)) {
    region = 'asia_pacific';
    indexKey = 'diversified';
  }

  return { region, indexKey };
}

// Pre-compute meta for all known QDII funds
export const QDII_FUND_META_BY_CODE = Object.fromEntries(
  Object.entries(QDII_FUND_NAMES_BY_CODE)
    .map(([code, name]) => {
      const meta = deriveQdiiFundMeta(name);
      return meta ? [code, meta] : null;
    })
    .filter(Boolean)
);

export function getQdiiFundMeta(code = '') {
  const key = String(code || '').trim();
  return QDII_FUND_META_BY_CODE[key] || null;
}
