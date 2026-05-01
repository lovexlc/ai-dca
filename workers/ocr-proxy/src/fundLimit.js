// fund-limit 数据源代理：东方财富三级回退 + KV 缓存。
//
// 调用入口：fetchFundLimit({ code, force, env, ctx })，由 src/index.js 的
// /api/fund-limit 路由分发。
//
// 数据源优先级：
//   1. mobapi（fundmobapi.eastmoney.com/.../FundMNNewBuyInfo）—— JSON、字段最干净。
//      前端直连会被反爬挡（ErrCode 61136403 网络繁忙），必须由 Worker 端
//      带「移动端 UA + Referer: https://fund.eastmoney.com/」转发。
//   2. F10 申赎页 jjfl_<code>.html —— 结构化「购买信息」表，含金额段。
//      天天基金未代销的基金会显示「暂无相关数据」，金额拿不到但状态仍可用。
//   3. 详情页 <code>.html 的「交易状态：限大额 开放赎回」徽章 —— 兜底，没有金额。
//
// 输出 schema（与 README 约定一致）：
//   { code, buyStatus, buyStatusText, minPurchase, maxPurchasePerDay,
//     redeemStatus, fixedInvest, confirmDays, source, fetchedAt,
//     cached?, tried?, notice? }

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FUND_LIMIT_DEFAULT_TTL_SECONDS = 600; // 10 分钟

function isValidFundCode(code) {
  return typeof code === 'string' && /^\d{6}$/.test(code);
}

function nowIso() {
  return new Date().toISOString();
}

// 文本/状态码 → 三态枚举。优先看中文文本，其次回退到 mobapi 的 0/1/2 状态码。
function classifyBuyStatus(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/暂停申购|暂停|停止|关闭/.test(s)) return 'suspended';
  if (/限大额|限额|限购|大额限制/.test(s)) return 'limit_large';
  if (/正常|开放|开通|可申购|不限/.test(s)) return 'open';
  if (s === '0' || s === '001') return 'open';
  if (s === '1' || s === '002') return 'limit_large';
  if (s === '2' || s === '003') return 'suspended';
  return null;
}

function classifyRedeemStatus(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/暂停|停止|关闭/.test(s)) return 'suspended';
  if (/正常|开放|可赎回/.test(s)) return 'open';
  if (s === '0' || s === '001') return 'open';
  if (s === '1' || s === '002') return 'suspended';
  return null;
}

function classifyFixedInvest(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/不支持|暂停|关闭|停止/.test(s)) return false;
  if (/支持|开放|正常/.test(s)) return true;
  if (s === '0') return true;
  if (s === '1') return false;
  return null;
}

function parseConfirmDays(value) {
  if (value == null) return null;
  const m = String(value).match(/T\s*\+\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

// 「10,000.00」「1万」「1.5亿」「100元」全部接受。「暂无相关数据」「无限制」→ null。
function parseMoney(value) {
  if (value == null) return null;
  let s = String(value).replace(/,/g, '').trim();
  if (!s) return null;
  if (/暂无|未开通|--|—|无限制|不限/.test(s)) return null;
  let mult = 1;
  if (/亿元?$/.test(s)) {
    mult = 1e8;
    s = s.replace(/亿元?$/, '').trim();
  } else if (/万元?$/.test(s)) {
    mult = 1e4;
    s = s.replace(/万元?$/, '').trim();
  } else if (/元$/.test(s)) {
    s = s.replace(/元$/, '').trim();
  }
  const num = Number(s);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * mult * 100) / 100;
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  ).trim();
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── 数据源 1：移动端 JSON API ──────────────────────────────────────────────
async function tryMobapi(code) {
  // 端点2026-05 实测对公网 IP 均返回 ErrCode 404（“网络繁忙”），
  // 不是反爬而是接口本身失活。保留作 3s 探针，将来恢复则会优先命中。
  const url = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNewBuyInfo?FCODE=' + encodeURIComponent(code) + '&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0';
  console.log('[fund-limit] mobapi GET ' + url);
  let resp;
  try {
    resp = await fetchWithTimeout(url, {
      headers: {
        'user-agent': MOBILE_UA,
        'referer': 'https://fund.eastmoney.com/',
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    }, 3000);
  } catch (e) {
    console.log('[fund-limit] mobapi fetch failed: ' + (e && e.message || e));
    return null;
  }
  if (!resp.ok) {
    console.log('[fund-limit] mobapi http ' + resp.status);
    return null;
  }
  let json;
  try { json = await resp.json(); }
  catch (e) { console.log('[fund-limit] mobapi json parse failed: ' + (e && e.message || e)); return null; }
  if (!json || json.Success === false || (json.ErrCode && json.ErrCode !== 0 && json.ErrCode !== '0')) {
    console.log('[fund-limit] mobapi err code=' + (json && (json.ErrCode || json.ErrorCode)) + ' msg=' + (json && (json.ErrMsg || json.ErrorMessage)));
    return null;
  }
  const d = (json.Datas) || (json.datas) || null;
  if (!d) return null;
  const buyStatusText = d.BUYSTATUS || d.buyStatus || null;
  const redeemStatusText = d.SHSTATUS || d.shStatus || null;
  const fixedInvestText = d.DTZTSTATUS || d.dtZtStatus || null;
  const minPurchase = parseMoney(d.MINSG) ?? parseMoney(d.MINSGDT);
  const maxPurchasePerDay = parseMoney(d.MAXSG);
  const fixedInvestMin = parseMoney(d.DTMINSG);
  const confirmDays = parseConfirmDays(d.QRRQ) ?? parseConfirmDays(d.CONFIRMDAYS);
  return {
    code,
    buyStatus: classifyBuyStatus(buyStatusText),
    buyStatusText: buyStatusText,
    minPurchase,
    maxPurchasePerDay,
    redeemStatus: classifyRedeemStatus(redeemStatusText),
    fixedInvest: classifyFixedInvest(fixedInvestText),
    fixedInvestMin,
    confirmDays,
    source: 'mobapi',
    fetchedAt: nowIso()
  };
}

// ─── 数据源 2：F10 申赎页（jjfl_<code>.html） ────────────────────────────
async function tryF10Html(code) {
  const url = 'https://fundf10.eastmoney.com/jjfl_' + encodeURIComponent(code) + '.html';
  console.log('[fund-limit] f10 GET ' + url);
  let resp;
  try {
    resp = await fetchWithTimeout(url, {
      headers: {
        'user-agent': DESKTOP_UA,
        'referer': 'https://fundf10.eastmoney.com/',
        'accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    }, 15000);
  } catch (e) {
    console.log('[fund-limit] f10 fetch failed: ' + (e && e.message || e));
    throw e;
  }
  if (!resp.ok) { console.log('[fund-limit] f10 http ' + resp.status); return null; }
  const html = await resp.text();
  if (!html || html.length < 200) return null;
  // 金额表结构：<td class="th w110">label</td><td class="w135">value</td>
  function pickFromTable(label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('<td[^>]*\\bth\\b[^>]*>' + escaped + '</td>\\s*<td[^>]*>([^<]+)</td>', 'i');
    const m = html.match(re);
    return m ? decodeHtmlEntities(m[1].trim()) : null;
  }
  const text = stripTags(html);
  function nextToken(label) {
    // 从末尾往前找最后一个（跳过头部导航条）
    const idx = text.lastIndexOf(label);
    if (idx < 0) return null;
    const after = text.slice(idx + label.length).replace(/^[：:\s]+/, '');
    const m = after.match(/^([^\s：:，。；,;]+)/);
    return m ? m[1].trim() : null;
  }
  // 金额：F10 表中真实 label
  const minPurchaseText = pickFromTable('申购起点') || pickFromTable('首次购买') || pickFromTable('单笔最低申购金额');
  const maxPerDayText = pickFromTable('日累计申购限额') || pickFromTable('单日累计申购上限金额') || pickFromTable('单笔最高申购金额');
  const fixedInvestStartText = pickFromTable('定投起点');
  const confirmText = pickFromTable('买入确认日') || pickFromTable('交易确认日') || pickFromTable('份额确认日');
  // 状态：F10 表中没有“申购状态” label，只能拿赎回/定投状态。申购状态交给 detail 页。
  const redeemStatusText = nextToken('赎回状态');
  const fixedInvestText = nextToken('定投状态');
  // 未代销检测
  const noDistribution = /尚未开通[^。]{0,20}代销|暂无相关数据/.test(text);
  const result = {
    code,
    buyStatus: null,
    buyStatusText: null,
    minPurchase: parseMoney(minPurchaseText),
    maxPurchasePerDay: parseMoney(maxPerDayText),
    redeemStatus: classifyRedeemStatus(redeemStatusText),
    fixedInvest: classifyFixedInvest(fixedInvestText),
    fixedInvestMin: parseMoney(fixedInvestStartText),
    confirmDays: parseConfirmDays(confirmText),
    source: 'f10_html',
    fetchedAt: nowIso()
  };
  if (noDistribution && result.minPurchase == null && result.maxPurchasePerDay == null) {
    result.notice = '天天基金未代销该基金，金额段为空；状态以基金公司公告为准。';
  }
  return result;
}

// ─── 数据源 3：详情页徽章 fund.eastmoney.com/<code>.html ─────────────────
async function tryDetailHtml(code) {
  const url = 'https://fund.eastmoney.com/' + encodeURIComponent(code) + '.html';
  console.log('[fund-limit] detail GET ' + url);
  let resp;
  try {
    resp = await fetchWithTimeout(url, {
      headers: {
        'user-agent': DESKTOP_UA,
        'referer': 'https://fund.eastmoney.com/',
        'accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    }, 12000);
  } catch (e) {
    console.log('[fund-limit] detail fetch failed: ' + (e && e.message || e));
    throw e;
  }
  if (!resp.ok) { console.log('[fund-limit] detail http ' + resp.status); return null; }
  const html = await resp.text();
  const text = stripTags(html);
  // 交易状态：<限大额>、<开放赎回>中间可能隔括号说明
  const m = text.match(/交易状态[：:]\s*([^\s（(，。；,;]+)(?:\s*[（(][^）)]*[）)])?\s+([^\s，。；,;]+)/);
  if (!m) { console.log('[fund-limit] detail no badge match'); return null; }
  // 括号里的额外金额信息：“单日累计购买上限100元”
  const limitInBracket = (text.match(/单日累计购买上限\s*([\d.,]+\s*[万亿]?\s*元?)/) || [])[1] || null;
  const minInBracket = (text.match(/(?:首次|追加|起点|最低)购买\s*([\d.,]+\s*[万亿]?\s*元?)/) || [])[1] || null;
  return {
    code,
    buyStatus: classifyBuyStatus(m[1]),
    buyStatusText: m[1] || null,
    minPurchase: parseMoney(minInBracket),
    maxPurchasePerDay: parseMoney(limitInBracket),
    redeemStatus: classifyRedeemStatus(m[2]),
    fixedInvest: null,
    fixedInvestMin: null,
    confirmDays: null,
    source: 'detail_html',
    fetchedAt: nowIso()
  };
}

// 至少能回答「能不能买、能不能赎」其中之一才算「有用」，否则继续 fallback。
function isUseful(r) {
  if (!r) return false;
  return r.buyStatus != null
    || r.redeemStatus != null
    || r.minPurchase != null
    || r.maxPurchasePerDay != null;
}

const SOURCES = ['mobapi', 'f10_html', 'detail_html'];

function mergeResults(code, f10, detail) {
  if (!f10 && !detail) return null;
  const merged = {
    code,
    buyStatus: null,
    buyStatusText: null,
    minPurchase: null,
    maxPurchasePerDay: null,
    redeemStatus: null,
    fixedInvest: null,
    fixedInvestMin: null,
    confirmDays: null,
    source: f10 ? 'f10_html' : 'detail_html',
    fetchedAt: nowIso()
  };
  if (f10) {
    merged.minPurchase = f10.minPurchase;
    merged.maxPurchasePerDay = f10.maxPurchasePerDay;
    merged.redeemStatus = f10.redeemStatus;
    merged.fixedInvest = f10.fixedInvest;
    merged.fixedInvestMin = f10.fixedInvestMin;
    merged.confirmDays = f10.confirmDays;
    if (f10.notice) merged.notice = f10.notice;
  }
  if (detail) {
    if (detail.buyStatus != null) merged.buyStatus = detail.buyStatus;
    if (detail.buyStatusText) merged.buyStatusText = detail.buyStatusText;
    if (merged.redeemStatus == null && detail.redeemStatus != null) merged.redeemStatus = detail.redeemStatus;
    if (merged.minPurchase == null && detail.minPurchase != null) merged.minPurchase = detail.minPurchase;
    if (merged.maxPurchasePerDay == null && detail.maxPurchasePerDay != null) merged.maxPurchasePerDay = detail.maxPurchasePerDay;
  }
  return merged;
}

export async function fetchFundLimit({ code, force, env, ctx }) {
  if (!isValidFundCode(code)) {
    return { ok: false, status: 400, error: '基金代码必须是 6 位数字。', code: code || null };
  }
  const cacheKey = 'limit:' + code;
  if (env && env.FUND_LIMIT_KV && !force) {
    try {
      const cached = await env.FUND_LIMIT_KV.get(cacheKey, { type: 'json' });
      if (cached && cached.code === code) {
        console.log('[fund-limit] cache hit ' + code + ' source=' + cached.source);
        return { ok: true, status: 200, data: Object.assign({}, cached, { cached: true }) };
      }
    } catch (e) {
      console.log('[fund-limit] kv read failed: ' + (e && e.message || e));
    }
  }
  const tried = [];
  let chosen = null;
  // 1. mobapi 3s 探针
  let mobapiResult = null;
  try { mobapiResult = await tryMobapi(code); }
  catch (e) { console.log('[fund-limit] mobapi threw: ' + (e && e.message || e)); }
  tried.push({ source: 'mobapi', ok: !!mobapiResult, useful: isUseful(mobapiResult) });
  if (isUseful(mobapiResult)) {
    chosen = mobapiResult;
  } else {
    // 2. F10 + detail 并行，merge
    const [f10Settled, detailSettled] = await Promise.allSettled([
      tryF10Html(code),
      tryDetailHtml(code)
    ]);
    const f10 = f10Settled.status === 'fulfilled' ? f10Settled.value : null;
    const detail = detailSettled.status === 'fulfilled' ? detailSettled.value : null;
    tried.push({
      source: 'f10_html',
      ok: !!f10,
      useful: !!f10 && (f10.minPurchase != null || f10.maxPurchasePerDay != null || f10.redeemStatus != null),
      error: f10Settled.status === 'rejected' ? String((f10Settled.reason && f10Settled.reason.message) || f10Settled.reason) : undefined
    });
    tried.push({
      source: 'detail_html',
      ok: !!detail,
      useful: !!detail && (detail.buyStatus != null || detail.redeemStatus != null),
      error: detailSettled.status === 'rejected' ? String((detailSettled.reason && detailSettled.reason.message) || detailSettled.reason) : undefined
    });
    chosen = mergeResults(code, f10, detail);
  }
  if (!chosen) {
    return { ok: false, status: 502, error: '所有数据源均无法获取限额信息。', code, tried };
  }
  if (env && env.FUND_LIMIT_KV) {
    const ttl = Math.max(60, Number(env.FUND_LIMIT_CACHE_TTL_SECONDS) || FUND_LIMIT_DEFAULT_TTL_SECONDS);
    const writeP = env.FUND_LIMIT_KV
      .put(cacheKey, JSON.stringify(chosen), { expirationTtl: ttl })
      .catch((e) => console.log('[fund-limit] kv write failed: ' + (e && e.message || e)));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(writeP);
  }
  return { ok: true, status: 200, data: Object.assign({}, chosen, { cached: false, tried }) };
}
