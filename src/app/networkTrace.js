import { trackAnalyticsEvent } from './analytics.js';

export const CF_COLO_NAMES = {
  // 中国大陆主要接入点 / 百度CF节点
  SJW: '中国华北·石家庄 (北京接入)',
  PEK: '中国华北·北京',
  PKX: '中国华北·北京大兴',
  TSN: '中国华北·天津',
  TYN: '中国华北·太原',
  HET: '中国华北·呼和浩特',
  SHA: '中国华东·上海',
  PVG: '中国华东·上海浦东',
  HGH: '中国华东·杭州',
  NKG: '中国华东·南京',
  SZV: '中国华东·苏州',
  WNZ: '中国华东·温州',
  NGB: '中国华东·宁波',
  HFE: '中国华东·合肥',
  FOC: '中国华东·福州',
  XMN: '中国华东·厦门',
  TAO: '中国华东·青岛',
  TNA: '中国华东·济南',
  CAN: '中国华南·广州',
  SZX: '中国华南·深圳',
  ZHA: '中国华南·湛江',
  NNG: '中国华南·南宁',
  HAK: '中国华南·海口',
  WUH: '中国华中·武汉',
  CSX: '中国华中·长沙',
  CGO: '中国华中·郑州',
  CTU: '中国西南·成都',
  TFU: '中国西南·成都天府',
  CKG: '中国西南·重庆',
  KMG: '中国西南·昆明',
  KWE: '中国西南·贵阳',
  XIY: '中国西北·西安',
  LHW: '中国西北·兰州',
  XNN: '中国西北·西宁',
  URC: '中国西北·乌鲁木齐',
  SHE: '中国东北·沈阳',
  DLC: '中国东北·大连',
  CGQ: '中国东北·长春',
  HRB: '中国东北·哈尔滨',
  // 中国港澳台
  HKG: '中国香港',
  MFM: '中国澳门',
  TPE: '中国台湾·台北',
  KHH: '中国台湾·高雄',
  // 亚太周边
  NRT: '日本·东京',
  HND: '日本·东京羽田',
  KIX: '日本·大阪',
  ICN: '韩国·仁川/首尔',
  SIN: '新加坡',
  KUL: '马来西亚·吉隆坡',
  BKK: '泰国·曼谷',
  MNL: '菲律宾·马尼拉',
  HAN: '越南·河内',
  SGN: '越南·胡志明',
  // 美洲
  SJC: '美国·圣何塞 (硅谷)',
  LAX: '美国·洛杉矶',
  SFO: '美国·旧金山',
  SEA: '美国·西雅图',
  ORD: '美国·芝加哥',
  DFW: '美国·达拉斯',
  IAD: '美国·华盛顿',
  EWR: '美国·纽瓦克',
  JFK: '美国·纽约',
  // 欧洲与大洋洲
  LHR: '英国·伦敦',
  FRA: '德国·法兰克福',
  CDG: '法国·巴黎',
  AMS: '荷兰·阿姆斯特丹',
  SYD: '澳大利亚·悉尼',
  MEL: '澳大利亚·墨尔本'
};

const TRACE_ENDPOINTS = [
  'https://freebacktrack.tech/cdn-cgi/trace',
  'https://www.cloudflare-cn.com/cdn-cgi/trace',
  'https://cloudflare-dns.com/cdn-cgi/trace',
  'https://one.one.one.one/cdn-cgi/trace'
];

const LOCAL_STORAGE_KEY = 'aiDcaNetworkTraces_v1';
const LAST_TRACE_KEY = 'aiDcaLastNetworkTrace';
const TRACE_SESSION_KEY = 'aiDcaNetworkTraceAt';
const MAX_LOCAL_TRACES = 200;
const THROTTLE_MS = 15 * 60 * 1000; // 15分钟内不重复静默自测

export function parseCfTrace(text = '') {
  const data = {};
  for (const line of String(text || '').split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key) data[key] = val;
    }
  }
  return data;
}

export function getColoRegion(colo = '', loc = '') {
  const code = String(colo || '').trim().toUpperCase();
  if (code && CF_COLO_NAMES[code]) {
    return CF_COLO_NAMES[code];
  }
  if (loc === 'CN') {
    return code ? `中国·节点 (${code})` : '中国大陆';
  }
  return code ? `${loc || '海外'}·${code}` : loc || '未知地区';
}

export async function fetchCfTrace({ timeoutMs = 4000 } = {}) {
  for (const endpoint of TRACE_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.ok) {
        const text = await response.text();
        const parsed = parseCfTrace(text);
        if (parsed.ip || parsed.colo || parsed.loc) {
          return {
            endpoint,
            ip: parsed.ip || '',
            loc: parsed.loc || '',
            colo: parsed.colo || '',
            coloRegion: getColoRegion(parsed.colo, parsed.loc),
            http: parsed.http || '',
            tls: parsed.tls || '',
            warp: parsed.warp || 'off',
            raw: text
          };
        }
      }
    } catch {
      // 尝试下一个备选 trace 节点
    }
  }
  return {
    endpoint: 'none',
    ip: '',
    loc: 'unknown',
    colo: 'unknown',
    coloRegion: '未知地区',
    http: '',
    tls: '',
    warp: 'off',
    raw: ''
  };
}

export async function probeCnConnectivity({ timeoutMs = 5000 } = {}) {
  const currentHost = typeof window !== 'undefined' ? window.location.host : '';
  const isCnHost = currentHost.includes('cn.freebacktrack.tech');
  const probeUrl = isCnHost
    ? `/api/market-collector/health?probe=${Date.now()}`
    : `https://cn.freebacktrack.tech:5000/api/market-collector/health?probe=${Date.now()}`;

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    await fetch(probeUrl, {
      method: 'GET',
      mode: isCnHost ? 'cors' : 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs)
    });
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
      currentHost,
      cnStatus: 'ok',
      cnReachable: true,
      cnLatency: Math.max(1, Math.round(t1 - t0)),
      direct: isCnHost,
      error: ''
    };
  } catch (err) {
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      currentHost,
      cnStatus: 'failed',
      cnReachable: false,
      cnLatency: Math.max(1, Math.round(t1 - t0)),
      direct: isCnHost,
      error: isTimeout ? `连接超时 (>${Math.round(timeoutMs / 1000)}s)` : (err?.message || '网络连接失败 (5000端口可能受阻)')
    };
  }
}

export function readLocalNetworkTraces() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function readLastNetworkTrace() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_TRACE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocalNetworkTrace(trace) {
  if (typeof window === 'undefined' || !trace) return;
  try {
    window.localStorage.setItem(LAST_TRACE_KEY, JSON.stringify(trace));
    const list = readLocalNetworkTraces();
    const nextList = [trace, ...list.filter((t) => t.id !== trace.id)].slice(0, MAX_LOCAL_TRACES);
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextList));
  } catch {
    // 忽略存储配额错误
  }
}

export async function triggerNetworkTrace({ force = false } = {}) {
  if (typeof window === 'undefined') return null;

  if (!force) {
    try {
      const lastTraceTime = Number(window.sessionStorage.getItem(TRACE_SESSION_KEY) || 0);
      if (Date.now() - lastTraceTime < THROTTLE_MS) {
        return readLastNetworkTrace();
      }
    } catch {
      // ignore
    }
  }

  try {
    window.sessionStorage.setItem(TRACE_SESSION_KEY, String(Date.now()));
  } catch {
    // ignore
  }

  const [cf, probe] = await Promise.all([
    fetchCfTrace(),
    probeCnConnectivity()
  ]);

  const traceResult = {
    id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ip: cf.ip || '',
    loc: cf.loc || 'unknown',
    colo: cf.colo || 'unknown',
    coloRegion: cf.coloRegion || getColoRegion(cf.colo, cf.loc),
    cnStatus: probe.cnStatus,
    cnReachable: probe.cnReachable,
    cnLatency: probe.cnLatency,
    cnError: probe.error || '',
    currentHost: probe.currentHost || '',
    http: cf.http || '',
    tls: cf.tls || '',
    endpoint: cf.endpoint || ''
  };

  saveLocalNetworkTrace(traceResult);

  // 上报至全局统一统计分析流
  try {
    trackAnalyticsEvent('network_trace', {
      ip: traceResult.ip,
      loc: traceResult.loc,
      colo: traceResult.colo,
      coloRegion: traceResult.coloRegion,
      cnStatus: traceResult.cnStatus,
      cnReachable: traceResult.cnReachable,
      cnLatency: traceResult.cnLatency,
      cnError: traceResult.cnError,
      currentHost: traceResult.currentHost,
      http: traceResult.http,
      tls: traceResult.tls
    });
  } catch {
    // 埋点异常不阻断业务
  }

  try {
    window.dispatchEvent(new CustomEvent('network-trace:completed', { detail: traceResult }));
  } catch {
    // ignore
  }

  return traceResult;
}

export function summarizeNetworkTraces(traces = []) {
  const list = Array.isArray(traces) ? traces : [];
  let total = list.length;
  let successful = 0;
  let failed = 0;
  let totalLatency = 0;
  let latencySamples = 0;

  const regionMap = new Map();

  for (const item of list) {
    const reachable = item.cnReachable === true || item.cnStatus === 'ok';
    if (reachable) {
      successful += 1;
      if (typeof item.cnLatency === 'number' && item.cnLatency > 0) {
        totalLatency += item.cnLatency;
        latencySamples += 1;
      }
    } else {
      failed += 1;
    }

    const colo = String(item.colo || 'unknown').toUpperCase();
    const loc = String(item.loc || 'unknown').toUpperCase();
    const key = `${colo}_${loc}`;
    const row = regionMap.get(key) || {
      colo,
      loc,
      name: item.coloRegion || getColoRegion(colo, loc),
      total: 0,
      successful: 0,
      failed: 0,
      latencyTotal: 0,
      latencySamples: 0,
      ipSet: new Set(),
      errors: {}
    };

    row.total += 1;
    if (reachable) {
      row.successful += 1;
      if (typeof item.cnLatency === 'number' && item.cnLatency > 0) {
        row.latencyTotal += item.cnLatency;
        row.latencySamples += 1;
      }
    } else {
      row.failed += 1;
      const err = item.cnError || '网络受阻/超时';
      row.errors[err] = (row.errors[err] || 0) + 1;
    }

    if (item.ip) row.ipSet.add(item.ip);
    regionMap.set(key, row);
  }

  const regions = Array.from(regionMap.values()).map((row) => {
    const successRate = row.total > 0 ? (row.successful / row.total) : 0;
    const avgLatency = row.latencySamples > 0 ? Math.round(row.latencyTotal / row.latencySamples) : (row.successful ? 0 : null);
    const topError = Object.entries(row.errors).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return {
      colo: row.colo,
      loc: row.loc,
      name: row.name,
      total: row.total,
      successful: row.successful,
      failed: row.failed,
      uniqueIps: row.ipSet.size,
      successRate,
      avgLatency,
      topError
    };
  }).sort((a, b) => {
    // 优先排有失败的地区，其次按总数排
    if (a.failed !== b.failed) return b.failed - a.failed;
    return b.total - a.total;
  });

  const successRate = total > 0 ? (successful / total) : 1;
  const avgLatency = latencySamples > 0 ? Math.round(totalLatency / latencySamples) : 0;

  return {
    total,
    successful,
    failed,
    successRate,
    avgLatency,
    regions,
    recent: list.slice(0, 50)
  };
}
