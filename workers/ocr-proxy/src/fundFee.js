// A 股基金费率代理：场外优先蛋卷基金交易规则，场内 ETF 自动降级到天天基金 F10 费率页。
// 输出统一 schema：
// { code, fundType, source, managementFeeRate, custodyFeeRate, salesServiceFeeRate,
//   annualFeeRate, purchaseRules, redeemRules, operationFees, notice, fetchedAt }

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const EXCHANGE_FUND_PREFIX = /^(?:5|1)\d{5}$/;

function isValidFundCode(code) {
  return typeof code === 'string' && /^\d{6}$/.test(code);
}

function nowIso() {
  return new Date().toISOString();
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

function parsePercent(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value) <= 1 ? value * 100 : value;
  const text = String(value)
    .replace(/,/g, '')
    .replace(/％/g, '%')
    .replace(/每年|年|\(.*?\)|（.*?）/g, '')
    .trim();
  if (!text || /暂无|不适用|无|--|—/.test(text)) return null;
  const m = text.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  return Math.round((Math.abs(n) <= 1 && !/%/.test(text) ? n * 100 : n) * 10000) / 10000;
}

function normalizeRateTable(table) {
  if (!Array.isArray(table)) return [];
  return table
    .map((row) => {
      if (Array.isArray(row)) {
        return row.map((item) => String(item ?? '').trim()).filter(Boolean);
      }
      if (row && typeof row === 'object') {
        const out = {};
        Object.entries(row).forEach(([key, value]) => {
          if (value != null && value !== '') out[key] = String(value).trim();
        });
        return out;
      }
      return String(row ?? '').trim();
    })
    .filter((row) => Array.isArray(row) ? row.length : typeof row === 'object' ? Object.keys(row).length : Boolean(row));
}

function flattenRateTable(table) {
  return normalizeRateTable(table).map((row) => {
    if (Array.isArray(row)) return row.join(' ');
    if (row && typeof row === 'object') return Object.values(row).join(' ');
    return String(row || '');
  });
}

function pickRateFromRows(rows, labels) {
  const patterns = labels.map((label) => new RegExp(label + '[^\d%％]{0,20}(-?\d+(?:\.\d+)?\s*[%％]?)'));
  for (const text of rows) {
    for (const re of patterns) {
      const m = String(text || '').match(re);
      if (m) {
        const rate = parsePercent(m[1]);
        if (rate != null) return rate;
      }
    }
  }
  return null;
}

function combineAnnualFee(...rates) {
  const nums = rates.filter((n) => Number.isFinite(Number(n))).map(Number);
  if (!nums.length) return null;
  return Math.round(nums.reduce((sum, n) => sum + n, 0) * 10000) / 10000;
}

function buildUnifiedFee({ code, source, fundType, purchaseRules = [], redeemRules = [], operationFees = [], managementFeeRate = null, custodyFeeRate = null, salesServiceFeeRate = null, notice = '' }) {
  const annualFeeRate = combineAnnualFee(managementFeeRate, custodyFeeRate, salesServiceFeeRate);
  return {
    code,
    fundType,
    source,
    managementFeeRate,
    custodyFeeRate,
    salesServiceFeeRate,
    annualFeeRate,
    purchaseRules,
    redeemRules,
    operationFees,
    notice: notice || undefined,
    fetchedAt: nowIso()
  };
}

async function tryDanjuanFee(code) {
  const url = 'https://danjuanfunds.com/djapi/fund/detail/' + encodeURIComponent(code);
  console.log('[fund-fee] danjuan GET ' + url);
  const resp = await fetchWithTimeout(url, {
    headers: {
      'user-agent': DESKTOP_UA,
      'accept': 'application/json, text/plain, */*',
      'referer': 'https://danjuanfunds.com/'
    }
  }, 8000);
  if (!resp.ok) throw new Error('danjuan HTTP ' + resp.status);
  const json = await resp.json();
  if (json && json.result_code === 600001) {
    return {
      unavailable: true,
      resultCode: json.result_code,
      message: json.message || '该基金暂不销售'
    };
  }
  const rates = json?.data?.fund_rates;
  if (!rates) return null;
  const purchaseRules = normalizeRateTable(rates.declare_rate_table);
  const redeemRules = normalizeRateTable(rates.withdraw_rate_table);
  const operationFees = normalizeRateTable(rates.other_rate_table);
  const opLines = flattenRateTable(rates.other_rate_table);
  const managementFeeRate = pickRateFromRows(opLines, ['管理费', '基金管理费']);
  const custodyFeeRate = pickRateFromRows(opLines, ['托管费', '基金托管费']);
  const salesServiceFeeRate = pickRateFromRows(opLines, ['销售服务费']);
  return buildUnifiedFee({
    code,
    source: 'danjuan',
    fundType: 'otc',
    purchaseRules,
    redeemRules,
    operationFees,
    managementFeeRate,
    custodyFeeRate,
    salesServiceFeeRate
  });
}

function extractTables(html) {
  const tables = [];
  const re = /<table\b[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tableHtml = m[0];
    const rows = [];
    const rowRe = /<tr\b[\s\S]*?<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(tableHtml))) {
      const cells = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cm;
      while ((cm = cellRe.exec(rm[0]))) {
        const cell = stripTags(cm[1]);
        if (cell) cells.push(cell);
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push({ text: stripTags(tableHtml), rows });
  }
  return tables;
}

function findValueAfterLabel(text, labels) {
  for (const label of labels) {
    const re = new RegExp(label + '[：:\\s]*(-?\\d+(?:\\.\\d+)?\\s*[%％]?)');
    const m = String(text || '').match(re);
    if (m) return m[1];
  }
  return null;
}

async function tryEastmoneyF10Fee(code, unavailableMessage = '') {
  const url = 'https://fundf10.eastmoney.com/jjfl_' + encodeURIComponent(code) + '.html';
  console.log('[fund-fee] f10 GET ' + url);
  const resp = await fetchWithTimeout(url, {
    headers: {
      'user-agent': DESKTOP_UA,
      'referer': 'https://fundf10.eastmoney.com/',
      'accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  }, 12000);
  if (!resp.ok) throw new Error('f10 HTTP ' + resp.status);
  const html = await resp.text();
  if (!html || html.length < 200) return null;
  const text = stripTags(html);
  const tables = extractTables(html);
  const operationTable = tables.find((t) => /运作费用|管理费|托管费|销售服务费/.test(t.text));
  const operationFees = operationTable ? operationTable.rows : [];
  const opText = operationTable ? operationTable.text : text;
  const managementFeeRate = parsePercent(findValueAfterLabel(opText, ['管理费率', '基金管理费', '管理费']))
    ?? parsePercent((opText.match(/管理费[^\d%％]{0,20}(-?\d+(?:\.\d+)?\s*[%％]?)/) || [])[1]);
  const custodyFeeRate = parsePercent(findValueAfterLabel(opText, ['托管费率', '基金托管费', '托管费']))
    ?? parsePercent((opText.match(/托管费[^\d%％]{0,20}(-?\d+(?:\.\d+)?\s*[%％]?)/) || [])[1]);
  const salesServiceFeeRate = parsePercent(findValueAfterLabel(opText, ['销售服务费率', '销售服务费']))
    ?? parsePercent((opText.match(/销售服务费[^\d%％]{0,20}(-?\d+(?:\.\d+)?\s*[%％]?)/) || [])[1]);
  const purchaseTable = tables.find((t) => /申购费率|申购金额|购买金额/.test(t.text));
  const redeemTable = tables.find((t) => /赎回费率|持有期限|赎回/.test(t.text));
  const noDistribution = /尚未开通[^。]{0,20}代销|暂无相关数据|场内交易/.test(text) || EXCHANGE_FUND_PREFIX.test(code);
  return buildUnifiedFee({
    code,
    source: 'eastmoney_f10',
    fundType: noDistribution ? 'exchange' : 'otc',
    purchaseRules: purchaseTable ? purchaseTable.rows : [],
    redeemRules: redeemTable ? redeemTable.rows : [],
    operationFees,
    managementFeeRate,
    custodyFeeRate,
    salesServiceFeeRate,
    notice: noDistribution
      ? '场内基金不适用平台申购/赎回费率，已展示基金运作费用；场内买卖成本请使用券商佣金。'
      : unavailableMessage
  });
}

export async function fetchFundFee({ code, force, env, ctx }) {
  if (!isValidFundCode(code)) {
    return { ok: false, status: 400, error: '基金代码必须是 6 位数字。', code: code || null };
  }
  const cacheKey = 'fee:' + code;
  if (env && env.FUND_LIMIT_KV && !force) {
    try {
      const cached = await env.FUND_LIMIT_KV.get(cacheKey, { type: 'json' });
      if (cached && cached.code === code) {
        console.log('[fund-fee] cache hit ' + code + ' source=' + cached.source);
        return { ok: true, status: 200, data: Object.assign({}, cached, { cached: true }) };
      }
    } catch (e) {
      console.log('[fund-fee] kv read failed: ' + (e && e.message || e));
    }
  }

  const tried = [];
  let chosen = null;
  let danjuanUnavailableMessage = '';
  try {
    const dj = await tryDanjuanFee(code);
    tried.push({ source: 'danjuan', ok: !!dj && !dj.unavailable, resultCode: dj?.resultCode, message: dj?.message });
    if (dj && !dj.unavailable) chosen = dj;
    if (dj && dj.unavailable) danjuanUnavailableMessage = dj.message || '';
  } catch (err) {
    tried.push({ source: 'danjuan', ok: false, error: err instanceof Error ? err.message : String(err) });
  }

  if (!chosen || chosen.annualFeeRate == null || EXCHANGE_FUND_PREFIX.test(code)) {
    try {
      const f10 = await tryEastmoneyF10Fee(code, danjuanUnavailableMessage);
      tried.push({ source: 'eastmoney_f10', ok: !!f10, useful: !!f10 && f10.annualFeeRate != null });
      if (f10 && (EXCHANGE_FUND_PREFIX.test(code) || !chosen || chosen.annualFeeRate == null)) chosen = f10;
    } catch (err) {
      tried.push({ source: 'eastmoney_f10', ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!chosen) {
    return { ok: false, status: 502, error: '所有数据源均无法获取基金费率。', code, tried };
  }
  if (env && env.FUND_LIMIT_KV) {
    const writeP = env.FUND_LIMIT_KV
      .put(cacheKey, JSON.stringify(chosen))
      .catch((e) => console.log('[fund-fee] kv write failed: ' + (e && e.message || e)));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(writeP);
  }
  return { ok: true, status: 200, data: Object.assign({}, chosen, { cached: false, tried }) };
}

export async function fetchFundFeesBatch({ codes, force, env, ctx, concurrency }) {
  const dedup = [];
  const seen = new Set();
  for (const raw of (codes || [])) {
    const code = String(raw || '').trim();
    if (!isValidFundCode(code) || seen.has(code)) continue;
    seen.add(code);
    dedup.push(code);
  }
  if (!dedup.length) {
    return { ok: false, status: 400, error: '请求中缺少有效的 6 位基金代码。', items: [], successCount: 0, failureCount: 0 };
  }
  const limit = Math.max(1, Math.min(Number(concurrency) || 4, 8));
  const out = new Array(dedup.length);
  let cursor = 0;
  async function runner() {
    while (cursor < dedup.length) {
      const idx = cursor++;
      const code = dedup[idx];
      try {
        const r = await fetchFundFee({ code, force, env, ctx });
        out[idx] = r.ok ? { code, ok: true, data: r.data } : { code, ok: false, status: r.status || 502, error: r.error || 'unknown', tried: r.tried || [] };
      } catch (err) {
        out[idx] = { code, ok: false, status: 502, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, dedup.length) }, runner));
  const successCount = out.filter((item) => item && item.ok).length;
  return {
    ok: true,
    status: 200,
    items: out,
    successCount,
    failureCount: out.length - successCount
  };
}
