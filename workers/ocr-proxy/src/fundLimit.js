// fund-limit 数据源代理：公告 (LLM 抽取) + F10 + 详情页 三路并行 + KV 缓存。
//
// 调用入口：fetchFundLimit({ code, force, env, ctx })，由 src/index.js 的
// /api/fund-limit 路由分发。
//
// 数据源优先级（1 最高）：
//   1. announcement：拼东财公告列表 API → 标题正则筛「大额申购/限额/暂停/恢复/调整」
//      → np-cnotice-fund 详情 API 拿 notice_content (东财后端已把 PDF 转为纯文本) +
//      attach_url (PDF 原件链接，可供前端错贴) → 喟给 @cf/moonshotai/kimi-k2.6
//      抽结构化 JSON → 以 art_code 为错 KV 缓存 7 天（公告内容不变）。
//      优势：这是「基金公司公告口径」，权威、不受代错状态限制。
//   2. F10 申赎页 jjfl_<code>.html —— 结构化「购买信息」表，含金额段。
//      天天基金未代错的基金会显示「暂无相关数据」，金额拿不到但状态仍可用。
//   3. 详情页 <code>.html 的「交易状态：限大额 开放赎回」徽章 —— 兑底，没有金额。
//
// 并行调度：三路同时走，merge 于完成后；announcement 独立走自己的
// KV 缓存，不会拖慢 F10/detail 主路径。LLM 调用在未命中公告错 KV 时才发生。
//
// 输出 schema（与 README 约定一致）：
//   { code, buyStatus, buyStatusText, minPurchase, maxPurchasePerDay,
//     redeemStatus, fixedInvest, fixedInvestMin, confirmDays,
//     source, fetchedAt, cached?, tried?, notice?,
//     // 公告补充字段（仅 source==='announcement' 或 announcement 参与了 merge 时出现）
//     effectiveDate?, sourceTitle?, sourceUrl?, publishDate? }

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 限额信息变化频率低（基金公司发公告才变），默认 TTL 拉长到 1 天，依赖 force=1 手动刷新。
const FUND_LIMIT_DEFAULT_TTL_SECONDS = 24 * 3600; // 1 天 (默认、f10/detail 源)
const FUND_LIMIT_ANNOUNCEMENT_TTL_SECONDS = 7 * 24 * 3600; // 7 天 (chosen 来自公告时，与底层 ann-result 对齐)
const ANNOUNCEMENT_RESULT_TTL_SECONDS = 7 * 24 * 3600; // 7 天（公告内容不变）
const ANNOUNCEMENT_NEGATIVE_TTL_SECONDS = 24 * 3600; // 1 天（未命中公告不必频繁重试）
const ANNOUNCEMENT_LLM_MODEL = '@cf/moonshotai/kimi-k2.6';

// 标题筛选正则：匹配一切跟「大额申购 / 限额 / 限购 / 暂停申购 / 恢复申购 / 调整大额 / 大额定投」相关的标题。
const ANNOUNCEMENT_TITLE_PATTERN = /(?:调整|限制|限购|暂停|恢复|开放|限制)?大额(?:申购|定投|定期定额)|限额申购|暂停申购|恢复申购|限额业务|调整申购/;

function isValidFundCode(code) {
  return typeof code === 'string' && /^\d{6}$/.test(code);
}

function nowIso() {
  return new Date().toISOString();
}

// 文本/状态码 → 三态枚举。优先看中文文本，其次回退到 0/1/2 状态码。
function classifyBuyStatus(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/暂停申购|暂停|停止|关闭/.test(s)) return 'suspended';
  if (/限大额|限额|限购|大额限制|大额申购/.test(s)) return 'limit_large';
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
  if (typeof value === 'boolean') return value;
  const s = String(value).trim();
  if (!s) return null;
  if (/不支持|暂停|关闭|停止/.test(s)) return false;
  if (/支持|开放|正常/.test(s)) return true;
  if (s === '0' || s === 'true') return true;
  if (s === '1' || s === 'false') return false;
  return null;
}

function parseConfirmDays(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const m = String(value).match(/T\s*\+\s*(\d+)/i);
  if (m) return Number(m[1]);
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

// 「10,000.00」「1万」「1.5亿」「100元」全部接受。「暂无相关数据」「无限制」→ null。
function parseMoney(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value : null;
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

// ─── 数据源 1：基金公司限额公告 + LLM 抽取 ───────────────────────
async function tryAnnouncement(code, env, ctx) {
  // 优先查 KV （公告结果独立错 ann-result:<code>，粒度与主缓存不同）
  if (env && env.FUND_LIMIT_KV) {
    try {
      const cached = await env.FUND_LIMIT_KV.get('ann-result:' + code, { type: 'json' });
      if (cached && typeof cached === 'object') {
        // negative cache: { _negative: true } —— 闭环表示「近期查不到相关公告」
        if (cached._negative) {
          console.log('[fund-limit] ann negative cache hit ' + code);
          return null;
        }
        console.log('[fund-limit] ann cache hit ' + code + ' art=' + cached.artCode);
        return cached;
      }
    } catch (e) {
      console.log('[fund-limit] ann kv read failed: ' + (e && e.message || e));
    }
  }

  // 1) 拉公告列表
  // 备注：东财该接口在部分情况下会返回 ErrCode=-999（疑似风控/缓存命中），导致 Data 为空。
  // 加上时间戳参数（_）可显著降低 -999 概率。
  const listUrl = 'https://api.fund.eastmoney.com/f10/JJGG?fundcode=' + encodeURIComponent(code)
    + '&pageIndex=1&pageSize=20&type=0&_=' + Date.now();
  console.log('[fund-limit] ann list GET ' + listUrl);
  let listResp;
  try {
    listResp = await fetchWithTimeout(listUrl, {
      headers: {
        'user-agent': DESKTOP_UA,
        'referer': 'https://fundf10.eastmoney.com/',
        'accept': 'application/json, text/plain, */*'
      }
    }, 5000);
  } catch (e) {
    console.log('[fund-limit] ann list fetch failed: ' + (e && e.message || e));
    return null;
  }
  if (!listResp.ok) { console.log('[fund-limit] ann list http ' + listResp.status); return null; }
  let listJson;
  try { listJson = await listResp.json(); }
  catch (e) { console.log('[fund-limit] ann list parse failed: ' + (e && e.message || e)); return null; }
  const items = Array.isArray(listJson && listJson.Data) ? listJson.Data : [];
  if (!items.length) {
    console.log('[fund-limit] ann list empty for ' + code);
    writeNegativeAnnCache(env, ctx, code);
    return null;
  }

  // 2) 标题筛「大额申购/限额」类公告，按发布日排序取最新
  const matched = items
    .filter((it) => it && typeof it.TITLE === 'string' && ANNOUNCEMENT_TITLE_PATTERN.test(it.TITLE))
    .sort((a, b) => String(b.PUBLISHDATE || '').localeCompare(String(a.PUBLISHDATE || '')));
  if (!matched.length) {
    console.log('[fund-limit] ann no matching title in ' + items.length + ' items');
    writeNegativeAnnCache(env, ctx, code);
    return null;
  }
  const top = matched[0];
  const artCode = top.ID;
  console.log('[fund-limit] ann matched title=' + JSON.stringify(top.TITLE) + ' art=' + artCode + ' date=' + top.PUBLISHDATEDesc);

  // 3) 拼 PDF 与详情链接
  const pdfUrl = 'https://pdf.dfcfw.com/pdf/H2_' + artCode + '_1.pdf';
  const detailApiUrl = 'https://np-cnotice-fund.eastmoney.com/api/content/ann?art_code=' + encodeURIComponent(artCode) + '&client_source=web_fund&page_index=1';
  console.log('[fund-limit] ann detail GET ' + detailApiUrl);
  let detailResp;
  try {
    detailResp = await fetchWithTimeout(detailApiUrl, {
      headers: {
        'user-agent': DESKTOP_UA,
        'referer': 'https://fundf10.eastmoney.com/',
        'accept': 'application/json, text/plain, */*'
      }
    }, 5000);
  } catch (e) {
    console.log('[fund-limit] ann detail fetch failed: ' + (e && e.message || e));
    return null;
  }
  if (!detailResp.ok) { console.log('[fund-limit] ann detail http ' + detailResp.status); return null; }
  let detailJson;
  try { detailJson = await detailResp.json(); }
  catch (e) { console.log('[fund-limit] ann detail parse failed: ' + (e && e.message || e)); return null; }
  const dd = detailJson && detailJson.data;
  const noticeContent = dd && typeof dd.notice_content === 'string' ? dd.notice_content : '';
  if (!noticeContent || noticeContent.length < 50) {
    console.log('[fund-limit] ann notice_content too short: ' + (noticeContent && noticeContent.length));
    return null;
  }
  const attachUrl = (dd && (dd.attach_url_web || dd.attach_url)) || pdfUrl;

  // 4) 喟给 LLM 抽结构化 JSON
  if (!env || !env.AI || typeof env.AI.run !== 'function') {
    console.log('[fund-limit] ann no AI binding, skip LLM extraction');
    return null;
  }
  const trimmed = noticeContent.length > 6000 ? noticeContent.slice(0, 6000) : noticeContent;
  const llmStart = Date.now();
  let llmJson;
  try {
    llmJson = await callAnnouncementLLM(env, code, top.TITLE, trimmed);
  } catch (e) {
    console.log('[fund-limit] ann LLM failed: ' + (e && e.message || e));
    return null;
  }
  console.log('[fund-limit] ann LLM ok in ' + (Date.now() - llmStart) + 'ms keys=' + Object.keys(llmJson || {}).join(','));

  // 5) 映射到统一 schema
  const result = {
    code,
    buyStatus: classifyBuyStatus(llmJson.buyStatus || llmJson.buyStatusText),
    buyStatusText: llmJson.buyStatusText || null,
    minPurchase: parseMoney(llmJson.minPurchase),
    maxPurchasePerDay: parseMoney(llmJson.maxPurchasePerDay),
    redeemStatus: classifyRedeemStatus(llmJson.redeemStatus || llmJson.redeemStatusText),
    fixedInvest: classifyFixedInvest(llmJson.fixedInvest),
    fixedInvestMin: parseMoney(llmJson.fixedInvestMin),
    confirmDays: parseConfirmDays(llmJson.confirmDays),
    source: 'announcement',
    fetchedAt: nowIso(),
    artCode,
    sourceTitle: top.TITLE,
    sourceUrl: attachUrl,
    publishDate: top.PUBLISHDATEDesc || null,
    effectiveDate: llmJson.effectiveDate || null
  };

  // 6) 写 KV (公告结果几乎不变 → 7 天)
  if (env && env.FUND_LIMIT_KV) {
    const writeP = env.FUND_LIMIT_KV
      .put('ann-result:' + code, JSON.stringify(result), { expirationTtl: ANNOUNCEMENT_RESULT_TTL_SECONDS })
      .catch((e) => console.log('[fund-limit] ann kv write failed: ' + (e && e.message || e)));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(writeP);
  }

  return result;
}

function writeNegativeAnnCache(env, ctx, code) {
  if (!env || !env.FUND_LIMIT_KV) return;
  const writeP = env.FUND_LIMIT_KV
    .put('ann-result:' + code, JSON.stringify({ _negative: true, ts: nowIso() }), { expirationTtl: ANNOUNCEMENT_NEGATIVE_TTL_SECONDS })
    .catch((e) => console.log('[fund-limit] ann negative kv write failed: ' + (e && e.message || e)));
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(writeP);
}

// LLM 抽取：OpenAI-兼容格式，system + user，要求返回严格 JSON（temperature 低）。
async function callAnnouncementLLM(env, code, title, noticeContent) {
  const model = String(env.ANNOUNCEMENT_LLM_MODEL || ANNOUNCEMENT_LLM_MODEL).trim();
  const systemPrompt = '你是中国公募基金限额公告的结构化抽取助手。输入是一段公告原文，你需要抽取「申购/赎回/定投/限额」相关信息。重要：不要输出任何思考过程、注释、说明、分析；只输出一个严格 JSON 对象，不要任何 markdown 包裹。输出必须以 { 开始、以 } 结束。';
  const userText = [
    '公告标题：' + title,
    '基金代码：' + code,
    '',
    '公告原文：',
    '----------',
    noticeContent,
    '----------',
    '',
    '请抽取以下字段返回 JSON（不确定的字段返 null，不要猜）：',
    '{',
    '  "buyStatus": "open" | "limit_large" | "suspended" | null,   // 公告后的申购状态枚举',
    '  "buyStatusText": string | null,                              // 公告中原文，如「限制大额申购」',
    '  "minPurchase": number | null,                                // 单笔最低申购金额（元），只填公告明文提及的金额',
    '  "maxPurchasePerDay": number | null,                          // 单日累计限额（元），公告中「超过 X 元不受理」里的 X',
    '  "redeemStatus": "open" | "suspended" | null,',
    '  "fixedInvest": true | false | null,                          // 定投是否受限；false 表示公告明文说暂停定投',
    '  "fixedInvestMin": number | null,                             // 定投起点（元）',
    '  "confirmDays": number | null,                                // T+N 中的 N，仅公告明文提及时填',
    '  "effectiveDate": string | null                               // 限额生效日 ISO YYYY-MM-DD',
    '}',
    '注意：',
    '- 金额必须是数字（不是字符串），单位统一转为元：「1 万元」→ 10000，「1.5 亿元」→ 150000000。',
    '- 如果公告是「调整大额申购从“X元”为“Y元”」，maxPurchasePerDay 填 Y（生效后的值）。',
    '- 如果公告明说「暂停大额申购」，需同时填 buyStatus="limit_large"，maxPurchasePerDay=null 或 0（表示不接受任何大额）。',
    '- 如果公告明说「暂停申购」（非大额），buyStatus="suspended"。',
    '- 如果公告明说「恢复大额申购 / 恢复正常申购」，buyStatus="open"。',
    '- 不要包裹代码块，不要加任何中文说明，只返 JSON 对象。'
  ].join('\n');

  const maxTokens = Number(env.OCR_MAX_TOKENS) || 4096;
  const input = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ],
    max_tokens: maxTokens,
    temperature: 0.05
  };
  console.log('[fund-limit] ann LLM call model=' + model + ' contentLen=' + noticeContent.length);
  const payload = await env.AI.run(model, input);

  // Workers AI 不同模型返回的 shape 差别很大。全面候选集（与 ocr-proxy parseModelResponse 一致）：
  const candidates = [
    payload && payload.response,
    payload && payload.description,
    payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.parsed,
    payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content,
    payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.reasoning_content,
    payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.tool_calls && payload.choices[0].message.tool_calls[0] && payload.choices[0].message.tool_calls[0].function && payload.choices[0].message.tool_calls[0].function.arguments,
    payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.function_call && payload.choices[0].message.function_call.arguments,
    payload && payload.choices && payload.choices[0] && payload.choices[0].text,
    payload && payload.output_text,
    payload && payload.output,
    payload && payload.response && payload.response.output_text,
    payload && payload.response && payload.response.output
  ];
  let content = '';
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'string' && c.trim()) { content = c; break; }
    if (Array.isArray(c) || typeof c === 'object') { content = JSON.stringify(c); break; }
  }
  if (!content) {
    const topKeys = payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 8).join(',') : 'NA';
    const msgKeys = payload && payload.choices && payload.choices[0] && payload.choices[0].message && typeof payload.choices[0].message === 'object'
      ? Object.keys(payload.choices[0].message).slice(0, 8).join(',') : 'NA';
    const errMsg = (payload && payload.error && (payload.error.message || payload.error)) || '';
    console.log('[fund-limit] ann LLM empty payload top=[' + topKeys + '] msg=[' + msgKeys + '] err=' + JSON.stringify(errMsg).slice(0, 200) + ' sample=' + JSON.stringify(payload).slice(0, 600));
    throw new Error('上游模型返回空 content (top=' + topKeys + ' msg=' + msgKeys + ')');
  }

  // 剖取 JSON：可能被 ```json ... ``` 包裹或多余文本包阅
  let jsonText = String(content).trim();
  const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) jsonText = fenced[1].trim();
  if (!jsonText.startsWith('{') && !jsonText.startsWith('[')) {
    const m = jsonText.match(/\{[\s\S]*\}/);
    if (m) jsonText = m[0];
  }
  let parsed;
  try { parsed = JSON.parse(jsonText); }
  catch (e) {
    console.log('[fund-limit] ann LLM raw content=' + String(content).slice(0, 500));
    throw new Error('模型输出非法 JSON: ' + (e && e.message || e));
  }
  return parsed;
}

// ─── 数据源 2：F10 申赎页（jjfl_<code>.html） ──────────────────────────
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
  // 未代错检测
  const noDistribution = /尚未开通[^。]{0,20}代错|暂无相关数据/.test(text);
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
    result.notice = '天天基金未代错该基金，金额段为空；状态以基金公司公告为准。';
  }
  return result;
}

// ─── 数据源 3：详情页徽章 fund.eastmoney.com/<code>.html ────────────────
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
  const m = text.match(/交易状态[：:]\s*([^\s（(，。；,;]+)(?:\s*[（(][^）)]*[）)])?\s+([^\s，。；,;]+)/);
  if (!m) { console.log('[fund-limit] detail no badge match'); return null; }
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

const SOURCES = ['announcement', 'f10_html', 'detail_html'];

// merge 优先级：announcement > F10 > detail。公告是「基金公司口径」，权威。
function mergeResults(code, ann, f10, detail) {
  if (!ann && !f10 && !detail) return null;
  // 选主 source：用有金额、有状态的那个当主
  let primarySource = 'detail_html';
  if (ann) primarySource = 'announcement';
  else if (f10) primarySource = 'f10_html';
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
    source: primarySource,
    fetchedAt: nowIso()
  };
  // 从低优先到高优先依次覆盖，使高优先能覆盖低优先。
  // detail (最低)
  if (detail) {
    if (detail.buyStatus != null) merged.buyStatus = detail.buyStatus;
    if (detail.buyStatusText) merged.buyStatusText = detail.buyStatusText;
    if (detail.redeemStatus != null) merged.redeemStatus = detail.redeemStatus;
    if (detail.minPurchase != null) merged.minPurchase = detail.minPurchase;
    if (detail.maxPurchasePerDay != null) merged.maxPurchasePerDay = detail.maxPurchasePerDay;
  }
  // F10 (中)
  if (f10) {
    if (f10.minPurchase != null) merged.minPurchase = f10.minPurchase;
    if (f10.maxPurchasePerDay != null) merged.maxPurchasePerDay = f10.maxPurchasePerDay;
    if (f10.redeemStatus != null) merged.redeemStatus = f10.redeemStatus;
    if (f10.fixedInvest != null) merged.fixedInvest = f10.fixedInvest;
    if (f10.fixedInvestMin != null) merged.fixedInvestMin = f10.fixedInvestMin;
    if (f10.confirmDays != null) merged.confirmDays = f10.confirmDays;
    if (f10.notice) merged.notice = f10.notice;
  }
  // announcement (最高)
  if (ann) {
    if (ann.buyStatus != null) merged.buyStatus = ann.buyStatus;
    if (ann.buyStatusText) merged.buyStatusText = ann.buyStatusText;
    if (ann.minPurchase != null) merged.minPurchase = ann.minPurchase;
    if (ann.maxPurchasePerDay != null) merged.maxPurchasePerDay = ann.maxPurchasePerDay;
    if (ann.redeemStatus != null) merged.redeemStatus = ann.redeemStatus;
    if (ann.fixedInvest != null) merged.fixedInvest = ann.fixedInvest;
    if (ann.fixedInvestMin != null) merged.fixedInvestMin = ann.fixedInvestMin;
    if (ann.confirmDays != null) merged.confirmDays = ann.confirmDays;
    // 公告独享字段
    if (ann.sourceTitle) merged.sourceTitle = ann.sourceTitle;
    if (ann.sourceUrl) merged.sourceUrl = ann.sourceUrl;
    if (ann.publishDate) merged.publishDate = ann.publishDate;
    if (ann.effectiveDate) merged.effectiveDate = ann.effectiveDate;
    if (ann.artCode) merged.artCode = ann.artCode;
    // 如果 F10 带了 notice (「未代错」)但公告提供了金额，则清除 notice (变得多余)
    if (merged.notice && (merged.minPurchase != null || merged.maxPurchasePerDay != null)) {
      delete merged.notice;
    }
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
  // 三路并行：announcement + F10 + detail
  const [annSettled, f10Settled, detailSettled] = await Promise.allSettled([
    tryAnnouncement(code, env, ctx),
    tryF10Html(code),
    tryDetailHtml(code)
  ]);
  const ann = annSettled.status === 'fulfilled' ? annSettled.value : null;
  const f10 = f10Settled.status === 'fulfilled' ? f10Settled.value : null;
  const detail = detailSettled.status === 'fulfilled' ? detailSettled.value : null;
  tried.push({
    source: 'announcement',
    ok: !!ann,
    useful: !!ann && (ann.buyStatus != null || ann.maxPurchasePerDay != null),
    error: annSettled.status === 'rejected' ? String((annSettled.reason && annSettled.reason.message) || annSettled.reason) : undefined
  });
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
  const chosen = mergeResults(code, ann, f10, detail);
  if (!chosen) {
    return { ok: false, status: 502, error: '所有数据源均无法获取限额信息。', code, tried };
  }
  if (env && env.FUND_LIMIT_KV) {
    // 公告源 → 7 天；f10/detail 源 → 默认 TTL（1 天，可被 env.FUND_LIMIT_CACHE_TTL_SECONDS 覆盖）。
    const baseTtl = Math.max(60, Number(env.FUND_LIMIT_CACHE_TTL_SECONDS) || FUND_LIMIT_DEFAULT_TTL_SECONDS);
    const ttl = chosen.source === 'announcement' ? FUND_LIMIT_ANNOUNCEMENT_TTL_SECONDS : baseTtl;
    const writeP = env.FUND_LIMIT_KV
      .put(cacheKey, JSON.stringify(chosen), { expirationTtl: ttl })
      .catch((e) => console.log('[fund-limit] kv write failed: ' + (e && e.message || e)));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(writeP);
  }
  return { ok: true, status: 200, data: Object.assign({}, chosen, { cached: false, tried }) };
}

export { SOURCES };
