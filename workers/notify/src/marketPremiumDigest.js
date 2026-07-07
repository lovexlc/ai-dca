import { readSettings, writeSettings } from './notifyStorage.js';
import { getClientRecord, normalizeClientId } from './clientSettings.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import { requireAdminToken } from './security.js';
import { fetchFundMetricsPayload } from './getNav.js';

const DETAIL_URL = 'https://freebacktrack.tech/?tab=fundSwitch&utm_source=serverchan3&utm_campaign=market_premium_digest';

const NASDAQ_ETFS = Object.freeze([
  { code: '159513', name: '大成纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '159509', name: '景顺长城纳斯达克科技ETF(QDII)', index_key: 'nasdaq100', segment: 'nasdaq_tech' },
  { code: '159941', name: '广发纳斯达克100ETF', index_key: 'nasdaq100' },
  { code: '513100', name: '国泰纳斯达克100ETF', index_key: 'nasdaq100' },
  { code: '159696', name: '易方达纳斯达克100ETF(QDI)', index_key: 'nasdaq100' },
  { code: '159632', name: '华安纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '513390', name: '博时纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '513300', name: '华夏纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '159501', name: '嘉实纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '513870', name: '富国纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '159660', name: '汇添富纳斯达克100ETF', index_key: 'nasdaq100' },
  { code: '513110', name: '华泰柏瑞纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '159659', name: '招商纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '161128', name: '易方达标普信息科技指数(QDII-LOF)A', index_key: 'nasdaq100', segment: 'tech_alt' }
]);

const SP500_ETFS = Object.freeze([
  { code: '513500', name: '博时标普500ETF(QDII)', index_key: 'sp500' },
  { code: '513650', name: '南方标普500ETF(QDII)', index_key: 'sp500' },
  { code: '159612', name: '国泰标普500ETF(QDII)', index_key: 'sp500' },
  { code: '159655', name: '华夏标普500ETF(QDII)', index_key: 'sp500' }
]);

const US50_ETFS = Object.freeze([
  { code: '159577', name: '汇添富美国50ETF(QDII)', index_key: 'us50' },
  { code: '513850', name: '易方达美国50ETF(QDII)', index_key: 'us50' }
]);

const CATALOG = Object.freeze([...NASDAQ_ETFS, ...SP500_ETFS, ...US50_ETFS]);
const CATALOG_BY_CODE = Object.freeze(Object.fromEntries(CATALOG.map((item) => [item.code, item])));
const TECH_CODES = new Set(NASDAQ_ETFS.filter((item) => item.segment === 'nasdaq_tech').map((item) => item.code));
const ALT_CODES = new Set(NASDAQ_ETFS.filter((item) => item.segment === 'tech_alt').map((item) => item.code));
const STANDARD_NASDAQ_CODES = NASDAQ_ETFS
  .map((item) => item.code)
  .filter((code) => !TECH_CODES.has(code) && !ALT_CODES.has(code));

export const MARKET_PREMIUM_DIGEST_CODES = Object.freeze(CATALOG.map((item) => item.code));

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstPositive(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function signedPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function pct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function formatCnTime(value) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return String(value || '');
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date).replaceAll('/', '-');
}

function normalizeName(value = '') {
  return String(value || '')
    .replace(/ETF|纳指|纳斯达克100|标普500|美国50|\(QDII\)|\(QDI\)|LOF|指数|发起式|联接|人民币|A|C/g, '')
    .replace(/[（）()]/g, '')
    .trim();
}

function shortName(item = null) {
  if (!item) return '—';
  return `${item.code} ${normalizeName(item.name) || item.code}`;
}

function rankList(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => Number.isFinite(item?.premiumPct))
    .sort((left, right) => right.premiumPct - left.premiumPct);
}

function bestSpread(items = []) {
  const ranked = rankList(items);
  if (ranked.length < 2) return null;
  const high = ranked[0];
  const low = ranked[ranked.length - 1];
  return { high, low, gap: high.premiumPct - low.premiumPct };
}

function bestCross(leftItems = [], rightItems = []) {
  const pairs = [];
  for (const left of rankList(leftItems)) {
    for (const right of rankList(rightItems)) {
      if (left.code === right.code) continue;
      const [high, low] = left.premiumPct >= right.premiumPct ? [left, right] : [right, left];
      pairs.push({ high, low, gap: high.premiumPct - low.premiumPct });
    }
  }
  return pairs.sort((a, b) => b.gap - a.gap)[0] || null;
}

function movementSentence(item = null) {
  if (!Number.isFinite(item?.premiumDeltaApproxPct)) return '溢价变化暂无可比基准';
  if (Math.abs(item.premiumDeltaApproxPct) < 0.05) return '溢价基本持平';
  return item.premiumDeltaApproxPct > 0
    ? `溢价较昨收近似扩张 ${signedPct(item.premiumDeltaApproxPct)}`
    : `溢价较昨收近似收窄 ${signedPct(item.premiumDeltaApproxPct)}`;
}

export function normalizeMarketPremiumMetric(raw = {}) {
  const code = String(raw?.code || '').trim();
  const catalogItem = CATALOG_BY_CODE[code] || {};
  const price = firstPositive(raw?.price, raw?.currentPrice, raw?.close);
  const previousClose = firstPositive(raw?.previousClose);
  const base = firstPositive(raw?.navBase, raw?.iopv, raw?.latestNav);
  const premiumPct = finiteNumber(raw?.premiumPercent) ?? (price && base ? ((price - base) / base) * 100 : null);
  const previousPremiumApproxPct = previousClose && base ? ((previousClose - base) / base) * 100 : null;
  return {
    code,
    name: String(raw?.name || catalogItem.name || code).trim(),
    indexKey: String(catalogItem.index_key || '').trim(),
    price,
    previousClose,
    changePercent: finiteNumber(raw?.changePercent),
    base,
    premiumPct,
    previousPremiumApproxPct,
    premiumDeltaApproxPct: Number.isFinite(premiumPct) && Number.isFinite(previousPremiumApproxPct)
      ? premiumPct - previousPremiumApproxPct
      : null,
    asOf: String(raw?.asOf || raw?.updatedAt || '').trim(),
    ok: raw?.ok !== false,
    error: String(raw?.error || raw?.primaryError || '').trim()
  };
}

function getItemsByCode(items = [], codes = []) {
  const byCode = new Map((Array.isArray(items) ? items : []).map((item) => [item.code, item]));
  return codes.map((code) => byCode.get(code)).filter(Boolean);
}

export function buildMarketPremiumDigestPayload({
  items = [],
  generatedAt = '',
  tradingSession = false,
  detailUrl = DETAIL_URL
} = {}) {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map(normalizeMarketPremiumMetric)
    .filter((item) => item.code);
  const asOf = normalizedItems.map((item) => item.asOf).filter(Boolean).sort().at(-1)
    || generatedAt
    || new Date().toISOString();
  const techItems = getItemsByCode(normalizedItems, Array.from(TECH_CODES));
  const nasdaqItems = getItemsByCode(normalizedItems, STANDARD_NASDAQ_CODES);
  const sp500Items = getItemsByCode(normalizedItems, SP500_ETFS.map((item) => item.code));
  const us50Items = getItemsByCode(normalizedItems, US50_ETFS.map((item) => item.code));
  const techVsNasdaq = bestCross(techItems, nasdaqItems);
  const nasdaqSpread = bestSpread(nasdaqItems);
  const spSpread = bestSpread(sp500Items);
  const usSpread = bestSpread(us50Items);
  const nasdaqRank = rankList(nasdaqItems);
  const spRank = rankList(sp500Items);
  const usRank = rankList(us50Items);
  const spMover = sp500Items
    .filter((item) => Number.isFinite(item.premiumDeltaApproxPct))
    .sort((a, b) => b.premiumDeltaApproxPct - a.premiumDeltaApproxPct)[0] || null;
  const usMover = us50Items
    .filter((item) => Number.isFinite(item.premiumDeltaApproxPct))
    .sort((a, b) => b.premiumDeltaApproxPct - a.premiumDeltaApproxPct)[0] || null;
  const topNasdaq = nasdaqRank[0] || null;
  const secondNasdaq = nasdaqRank[1] || null;
  const thirdNasdaq = nasdaqRank[2] || null;
  const title = '今日QDII溢价市场速读';
  const summary = `纳指100池内 ${shortName(topNasdaq)} 溢价最高，${secondNasdaq?.code || '—'} 位列第二；纳指科技对标准纳指最大差 ${signedPct(techVsNasdaq?.gap)}。`;
  const cnTime = formatCnTime(asOf);
  const sessionText = tradingSession ? '盘中' : '最近快照/非盘中';
  const bodyLines = [
    `截至 ${cnTime}（${sessionText}），QDII 场内溢价仍集中在纳指方向。`,
    '',
    '今日结论',
    `- 标准纳指100：${shortName(topNasdaq)} 仍是最高溢价 ${pct(topNasdaq?.premiumPct)}；${shortName(secondNasdaq)} 第二 ${pct(secondNasdaq?.premiumPct)}，${shortName(thirdNasdaq)} 第三 ${pct(thirdNasdaq?.premiumPct)}。`,
    `- 纳指科技：${shortName(techVsNasdaq?.high)} 对标准纳指低溢价 ${shortName(techVsNasdaq?.low)} 拉开 ${signedPct(techVsNasdaq?.gap)}，是当前最明显的横向价差。`,
    `- 标普500：最高 ${shortName(spRank[0])} ${pct(spRank[0]?.premiumPct)}，最低 ${shortName(spRank.at(-1))} ${pct(spRank.at(-1)?.premiumPct)}，最大差 ${signedPct(spSpread?.gap)}；${shortName(spMover)} ${movementSentence(spMover)}。`,
    `- 美国50：${shortName(usRank[0])} 高于 ${shortName(usRank.at(-1))}，最大差 ${signedPct(usSpread?.gap)}；${shortName(usMover)} ${movementSentence(usMover)}。`,
    '',
    '当前最大价差',
    `1. 纳指科技 ↔ 纳指100：卖 ${shortName(techVsNasdaq?.high)} → 买 ${shortName(techVsNasdaq?.low)}，差 ${signedPct(techVsNasdaq?.gap)}。`,
    `2. 纳指100 ↔ 纳指100：卖 ${shortName(nasdaqSpread?.high)} → 买 ${shortName(nasdaqSpread?.low)}，差 ${signedPct(nasdaqSpread?.gap)}。`,
    `3. 标普500 ↔ 标普500：卖 ${shortName(spSpread?.high)} → 买 ${shortName(spSpread?.low)}，差 ${signedPct(spSpread?.gap)}。`,
    `4. 美国50 ↔ 美国50：卖 ${shortName(usSpread?.high)} → 买 ${shortName(usSpread?.low)}，差 ${signedPct(usSpread?.gap)}。`,
    '',
    '想要变成自己的实时提醒：打开 AI-DCA → 增加持仓 → 基金切换里配置 H/L → 开启 Server酱³/浏览器通知。以后你的持仓达到切换条件时会单独推送。',
    '',
    '注：溢价变化为按昨收价与当前 IOPV/净值基准的近似估算，执行前请回网站确认盘口、成交额和替代性。'
  ];
  const bodyMdLines = [
    `截至 ${cnTime}（${sessionText}），QDII 场内溢价仍集中在纳指方向。`,
    '',
    '## 今日结论',
    `- **标准纳指100**：${shortName(topNasdaq)} 仍是最高溢价 **${pct(topNasdaq?.premiumPct)}**；${shortName(secondNasdaq)} 第二 **${pct(secondNasdaq?.premiumPct)}**，${shortName(thirdNasdaq)} 第三 **${pct(thirdNasdaq?.premiumPct)}**。`,
    `- **纳指科技**：${shortName(techVsNasdaq?.high)} 对标准纳指低溢价 ${shortName(techVsNasdaq?.low)} 拉开 **${signedPct(techVsNasdaq?.gap)}**。`,
    `- **标普500**：最高 ${shortName(spRank[0])} ${pct(spRank[0]?.premiumPct)}，最低 ${shortName(spRank.at(-1))} ${pct(spRank.at(-1)?.premiumPct)}，最大差 **${signedPct(spSpread?.gap)}**；${shortName(spMover)} ${movementSentence(spMover)}。`,
    `- **美国50**：${shortName(usRank[0])} 高于 ${shortName(usRank.at(-1))}，最大差 **${signedPct(usSpread?.gap)}**；${shortName(usMover)} ${movementSentence(usMover)}。`,
    '',
    '## 当前最大价差',
    `1. 纳指科技 ↔ 纳指100：卖 **${shortName(techVsNasdaq?.high)}** → 买 **${shortName(techVsNasdaq?.low)}**，差 **${signedPct(techVsNasdaq?.gap)}**。`,
    `2. 纳指100 ↔ 纳指100：卖 **${shortName(nasdaqSpread?.high)}** → 买 **${shortName(nasdaqSpread?.low)}**，差 **${signedPct(nasdaqSpread?.gap)}**。`,
    `3. 标普500 ↔ 标普500：卖 **${shortName(spSpread?.high)}** → 买 **${shortName(spSpread?.low)}**，差 **${signedPct(spSpread?.gap)}**。`,
    `4. 美国50 ↔ 美国50：卖 **${shortName(usSpread?.high)}** → 买 **${shortName(usSpread?.low)}**，差 **${signedPct(usSpread?.gap)}**。`,
    '',
    '## 获得专属提醒',
    '打开 AI-DCA → 增加持仓 → 基金切换里配置 H/L → 开启 Server酱³/浏览器通知。以后你的持仓达到切换条件时会单独推送。',
    '',
    '> 注：溢价变化为按昨收价与当前 IOPV/净值基准的近似估算，执行前请回网站确认盘口、成交额和替代性。'
  ];
  return {
    notification: {
      eventId: `market-premium-digest-${Date.now()}`,
      eventType: 'switch-strategy-trigger',
      ruleId: 'market-premium-digest',
      title,
      summary,
      body: bodyLines.join('\n'),
      body_md: bodyMdLines.join('\n'),
      symbol: '全市场',
      strategyName: '场内切换策略/市场速读',
      triggerCondition: '全市场溢价结构 + 最大价差 + 专属提醒入口',
      purchaseAmount: '',
      detailUrl,
      url: detailUrl,
      tags: ['市场速读', '基金切换']
    },
    meta: {
      asOf,
      asOfText: cnTime,
      tradingSession,
      itemCount: normalizedItems.length,
      usableCount: normalizedItems.filter((item) => item.ok && Number.isFinite(item.premiumPct)).length,
      failures: normalizedItems.filter((item) => !item.ok || !Number.isFinite(item.premiumPct)).map((item) => ({
        code: item.code,
        error: item.error || 'premium-unavailable'
      })),
      rows: [
        { label: '纳指科技 ↔ 纳指100', pair: techVsNasdaq },
        { label: '纳指100 ↔ 纳指100', pair: nasdaqSpread },
        { label: '标普500 ↔ 标普500', pair: spSpread },
        { label: '美国50 ↔ 美国50', pair: usSpread }
      ].map((row) => ({
        label: row.label,
        from: row.pair?.high?.code || '',
        fromPremiumPct: Number.isFinite(row.pair?.high?.premiumPct) ? Number(row.pair.high.premiumPct.toFixed(2)) : null,
        to: row.pair?.low?.code || '',
        toPremiumPct: Number.isFinite(row.pair?.low?.premiumPct) ? Number(row.pair.low.premiumPct.toFixed(2)) : null,
        gapPct: Number.isFinite(row.pair?.gap) ? Number(row.pair.gap.toFixed(2)) : null
      })),
      nasdaqTop3: nasdaqRank.slice(0, 3).map((item) => ({
        code: item.code,
        name: item.name,
        premiumPct: Number(item.premiumPct.toFixed(2)),
        premiumDeltaApproxPct: Number.isFinite(item.premiumDeltaApproxPct) ? Number(item.premiumDeltaApproxPct.toFixed(2)) : null
      }))
    }
  };
}

async function fetchMarketPremiumDigestPayload(env, { refresh = true } = {}) {
  const fundKinds = Object.fromEntries(MARKET_PREMIUM_DIGEST_CODES.map((code) => [code, 'exchange']));
  const payload = await fetchFundMetricsPayload(env, MARKET_PREMIUM_DIGEST_CODES, { refresh, fundKinds });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return buildMarketPremiumDigestPayload({
    items,
    generatedAt: String(payload?.generatedAt || '') || new Date().toISOString(),
    tradingSession: payload?.tradingSession === true
  });
}

function normalizeTargetChannel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ios' || normalized === 'bark') return 'bark';
  if (normalized === 'android' || normalized === 'andriod' || normalized === 'serverchan' || normalized === 'serverchan3') return 'serverchan3';
  if (normalized === 'pc' || normalized === 'ws') return normalized;
  return '';
}

function resolveMarketDigestClient(settings = {}, env = {}, payload = {}) {
  const explicitClientId = normalizeClientId(payload?.clientId || env?.ADMIN_NOTIFY_CLIENT_ID || env?.ADMIN_CLIENT_ID || '');
  if (explicitClientId) {
    const explicitClient = getClientRecord(settings, explicitClientId);
    if (explicitClient?.clientId) return explicitClient;
  }
  const username = String(payload?.accountUsername || env?.ADMIN_NOTIFY_USERNAME || env?.ADMIN_USERNAME || 'lovexl').trim().toLowerCase();
  const clients = Object.values(settings.clients || {}).filter((client) => normalizeClientId(client?.clientId));
  const byAccount = clients.find((client) => String(client?.accountUsername || '').trim().toLowerCase() === username);
  if (byAccount) return byAccount;
  const byLabel = clients.find((client) => String(client?.clientLabel || '').trim().toLowerCase().includes(username));
  if (byLabel) return byLabel;
  const withServerChan3 = clients.find((client) => client?.serverChan3?.uid && client?.serverChan3?.sendKey);
  return withServerChan3 || clients[0] || null;
}

export async function handleAdminMarketPremiumDigest(request, env, options = {}) {
  const origin = readOrigin(request);
  const authError = requireAdminToken(request, env, { origin });
  if (authError) return authError;
  const runClientDetection = options.runClientDetection;
  if (typeof runClientDetection !== 'function') {
    return jsonResponse({ error: 'runClientDetection missing' }, { status: 500, origin });
  }
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const clientRecord = resolveMarketDigestClient(settings, env, payload);
  if (!clientRecord?.clientId) {
    return jsonResponse({ error: 'admin notify client not found in KV settings' }, { status: 404, origin });
  }
  const targetChannel = normalizeTargetChannel(payload?.targetChannel || payload?.channel || 'serverchan3');
  const digest = await fetchMarketPremiumDigestPayload(env, {
    refresh: payload?.refresh !== false
  });
  if (payload?.dryRun === true) {
    return jsonResponse({
      ok: true,
      dryRun: true,
      clientId: clientRecord.clientId,
      notification: digest.notification,
      meta: digest.meta
    }, { origin });
  }
  const result = await runClientDetection(env, settings, clientRecord, {
    reason: 'admin-market-premium-digest',
    testPayload: digest.notification,
    targetChannels: targetChannel ? [targetChannel] : null
  });
  settings = result.settings;
  await writeSettings(env, settings);
  return jsonResponse({
    ok: true,
    clientId: clientRecord.clientId,
    targetChannel: targetChannel || 'all',
    summary: result.summary,
    meta: digest.meta
  }, { origin });
}
