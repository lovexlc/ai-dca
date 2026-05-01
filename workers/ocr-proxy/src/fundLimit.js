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
  const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNewBuyInfo`
    + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0`;
  console.log(`[fund-limit] mobapi GET ${url}`);
  const resp = await fetchWithTimeout(url, {
    headers: {
      'user-agent': MOBILE_UA,
      'referer': 'https://fund.eastmoney.com/',
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  }, 8000);
  if (!resp.ok) {
    console.log(`[fund-limit] mobapi http ${resp.status}`);
    return null;
  }
  const data = await resp.json().catch(() => null);
  if (!data || typeof data !== 'object') {
    console.log('[fund-limit] mobapi non-json');
    return null;
  }
  const errCode = data.ErrCode ?? data.errcode ?? data.errCode;
  if (errCode != null && String(errCode) !== '0') {
    console.log(`[fund-limit] mobapi err code=${errCode} msg=${data.ErrMsg || data.errmsg || ''}`);
    return null;
  }
  const d = Array.isArray(data.Datas) ? data.Datas[0] : data.Datas;
  if (!d || typeof d !== 'object') {
    console.log('[fund-limit] mobapi empty datas');
    return null;
  }

  // 兼容多种字段命名：text 名（*NAME）优先于状态码（*STATUS / *ZT）。
  const buyStatusRaw = d.SGZTNAME ?? d.BUYSTATUSNAME ?? d.BUYSTATUSTEXT ?? d.BUYSTATUS ?? d.SGZT;
  const redeemStatusRaw = d.SHZTNAME ?? d.SHSTATUSNAME ?? d.SHSTATUS ?? d.SHZT;
  const dtztRaw = d.DTZTNAME ?? d.DTZTSTATUSNAME ?? d.DTZTSTATUS ?? d.DTZT;

  return {
    code,
    buyStatus: classifyBuyStatus(buyStatusRaw),
    buyStatusText: (typeof buyStatusRaw === 'string' && /[\u4e00-\u9fa5]/.test(buyStatusRaw)) ? buyStatusRaw : null,
    minPurchase: parseMoney(d.MINSG ?? d.MINSGDT),
    maxPurchasePerDay: parseMoney(d.DTSGE ?? d.MAXSG ?? d.DTMAXSG),
    redeemStatus: classifyRedeemStatus(redeemStatusRaw),
    fixedInvest: classifyFixedInvest(dtztRaw),
    confirmDays: parseConfirmDays(d.QRRQ || d.QRZQ || d.SGQRR),
    source: 'mobapi',
    fetchedAt: nowIso()
  };
}

// ─── 数据源 2：F10 申赎页（jjfl_<code>.html） ────────────────────────────
async function tryF10Html(code) {
  const url = `https://fundf10.eastmoney.com/jjfl_${encodeURIComponent(code)}.html`;
  console.log(`[fund-limit] f10 GET ${url}`);
  const resp = await fetchWithTimeout(url, {
    headers: {
      'user-agent': DESKTOP_UA,
      'referer': 'https://fundf10.eastmoney.com/',
      'accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9'
    }
  }, 10000);
  if (!resp.ok) {
    console.log(`[fund-limit] f10 http ${resp.status}`);
    return null;
  }
  const html = await resp.text();
  if (!html || html.length < 200) {
    console.log('[fund-limit] f10 body too small');
    return null;
  }

  const text = stripTags(html);

  // 取「<label>：xxx」直到下一段空白或下一个全角标点。
  function nextToken(label) {
    const idx = text.indexOf(label);
    if (idx < 0) return null;
    const after = text.slice(idx + label.length).replace(/^[：:\s]+/, '');
    const m = after.match(/^([^\s：:，。；,;]+)/);
    return m ? m[1].trim() : null;
  }

  function pickMoney(...labels) {
    for (const label of labels) {
      const re = new RegExp(
        label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        + '[（(]?元[）)]?[：:]\\s*([^\\s：:，。；,;]+)'
      );
      const m = text.match(re);
      if (m) return m[1];
    }
    return null;
  }

  const buyStatusText = nextToken('申购状态');
  const redeemStatusText = nextToken('赎回状态');
  const fixedInvestText = nextToken('定投状态');
  const confirmText = nextToken('交易确认日') || nextToken('份额确认日');

  const minPurchaseText = pickMoney(
    '单笔最低申购金额',
    '最低申购金额',
    '首次最低申购金额'
  );
  const maxPerDayText = pickMoney(
    '单日累计申购上限金额',
    '单日累计申购金额上限',
    '单日申购限额',
    '单日限额',
    '申购单日限额'
  );

  // 「尚未开通天天基金代销」/ 大段「暂无相关数据」 → 给 UI 一个解释字段。
  const noDistribution = /尚未开通[^。]{0,20}代销|该基金暂未开通|暂无相关数据/.test(text);

  const result = {
    code,
    buyStatus: classifyBuyStatus(buyStatusText),
    buyStatusText: buyStatusText || null,
    minPurchase: parseMoney(minPurchaseText),
    maxPurchasePerDay: parseMoney(maxPerDayText),
    redeemStatus: classifyRedeemStatus(redeemStatusText),
    fixedInvest: classifyFixedInvest(fixedInvestText),
    confirmDays: parseConfirmDays(confirmText),
    source: 'f10_html',
    fetchedAt: nowIso()
  };
  if (noDistribution) {
    result.notice = '天天基金未代销该基金，金额段可能为空；状态仍以基金公司公告为准。';
  }
  return result;
}

// ─── 数据源 3：详情页徽章 fund.eastmoney.com/<code>.html ─────────────────
async function tryDetailHtml(code) {
  const url = `https://fund.eastmoney.com/${encodeURIComponent(code)}.html`;
  console.log(`[fund-limit] detail GET ${url}`);
  const resp = await fetchWithTimeout(url, {
    headers: {
      'user-agent': DESKTOP_UA,
      'referer': 'https://fund.eastmoney.com/',
      'accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9'
    }
  }, 10000);
  if (!resp.ok) {
    console.log(`[fund-limit] detail http ${resp.status}`);
    return null;
  }
  const html = await resp.text();
  if (!html) return null;
  const text = stripTags(html);
  const m = text.match(/交易状态[：:]\s*([^\s，。；,;]+)\s+([^\s，。；,;]+)/);
  if (!m) {
    console.log('[fund-limit] detail no match');
    return null;
  }
  return {
    code,
    buyStatus: classifyBuyStatus(m[1]),
    buyStatusText: m[1] || null,
    minPurchase: null,
    maxPurchasePerDay: null,
    redeemStatus: classifyRedeemStatus(m[2]),
    fixedInvest: null,
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

const SOURCES = [
  { name: 'mobapi', fn: tryMobapi },
  { name: 'f10_html', fn: tryF10Html },
  { name: 'detail_html', fn: tryDetailHtml }
];

export async function fetchFundLimit({ code, force, env, ctx }) {
  if (!isValidFundCode(code)) {
    return { ok: false, status: 400, error: '基金代码必须是 6 位数字。', code: code || null };
  }

  const cacheKey = `limit:${code}`;

  // 1. 命中 KV 缓存
  if (env && env.FUND_LIMIT_KV && !force) {
    try {
      const cached = await env.FUND_LIMIT_KV.get(cacheKey, { type: 'json' });
      if (cached && cached.code === code) {
        console.log(`[fund-limit] cache hit ${code} source=${cached.source}`);
        return { ok: true, status: 200, data: { ...cached, cached: true } };
      }
    } catch (e) {
      console.log(`[fund-limit] kv read failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 2. 三级回退
  let chosen = null;
  let lastResult = null;
  const tried = [];
  for (const { name, fn } of SOURCES) {
    let r = null;
    let err = null;
    try {
      r = await fn(code);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      console.log(`[fund-limit] ${name} threw: ${err}`);
    }
    tried.push({ source: name, ok: !!r, useful: isUseful(r), error: err || undefined });
    if (r) lastResult = r;
    if (isUseful(r)) {
      chosen = r;
      break;
    }
  }

  // 三个源全部空手，但 detail 至少给了状态徽章 → 把 lastResult 退回去也比 502 好。
  if (!chosen && lastResult) {
    chosen = lastResult;
  }

  if (!chosen) {
    console.log(`[fund-limit] all sources failed for ${code}`);
    return { ok: false, status: 502, error: '所有数据源均无法获取限额信息。', code, tried };
  }

  // 3. 写回 KV（fire-and-forget，走 ctx.waitUntil 不阻塞响应）
  if (env && env.FUND_LIMIT_KV) {
    const ttl = Math.max(60, Number(env.FUND_LIMIT_CACHE_TTL_SECONDS) || FUND_LIMIT_DEFAULT_TTL_SECONDS);
    const writeP = env.FUND_LIMIT_KV
      .put(cacheKey, JSON.stringify(chosen), { expirationTtl: ttl })
      .catch((e) => console.log(`[fund-limit] kv write failed: ${e instanceof Error ? e.message : e}`));
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(writeP);
    }
  }

  return { ok: true, status: 200, data: { ...chosen, cached: false, tried } };
}
