import { CN_OTC_WATCHLIST_PRESETS } from '../../../src/app/marketsWatchlistStorage.js';
import { mapLimit, readFundLimitCache } from './fundLimit.js';

const CURRENT_KEY = 'limit-overview:v1:current';
const EVENTS_KEY = 'limit-overview:v1:events';
const DAILY_KEY_PREFIX = 'limit-overview:v1:daily:';
const POLICY_KEY_PREFIX = 'limit-policy:v1:';
const MAX_TREND_DAYS = 30;
const POLICY_TTL_SECONDS = 7 * 24 * 60 * 60;
const HISTORY_TTL_SECONDS = 45 * 24 * 60 * 60;
const MAX_EVENTS = 300;

function validCode(value = '') {
  return /^\d{6}$/.test(String(value || '').trim());
}

function asMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null;
}

function cleanText(value = '') {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[\u3000\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function shiftDate(dateString, offset) {
  const [year, month, day] = String(dateString || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function normalizeDate(value = '') {
  const source = String(value || '').trim();
  const iso = source.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const chinese = source.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (chinese) return `${chinese[1]}-${String(chinese[2]).padStart(2, '0')}-${String(chinese[3]).padStart(2, '0')}`;
  return null;
}

function effectiveDate(text = '', fallback = null) {
  const direct = normalizeDate(fallback);
  if (direct) return direct;
  const matched = String(text || '').match(/(?:自|从|于)\s*(20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:起|开始|实施|恢复)?/);
  return matched ? normalizeDate(matched[1]) : null;
}

function shareClass(name = '') {
  const normalized = String(name || '').replace(/[\s）)]/g, '');
  const matched = normalized.match(/(?:人民币|美元现汇|美元|USD|CNY)?([A-Z])(?:类)?$/i);
  return matched ? matched[1].toUpperCase() : null;
}

function fundKey(name = '', code = '') {
  const normalized = String(name || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/人民币|美元现汇|美元|USD|CNY/gi, '')
    .replace(/(?:[A-Z])(?:类)?$/i, '')
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, '')
    .trim()
    .toLowerCase();
  return normalized || `fund-${code}`;
}

function currency(name = '', text = '') {
  return /美元|USD/i.test(`${name} ${text}`) ? 'USD' : 'CNY';
}

function purchaseStatus(record = {}, limitAmount = null) {
  const status = String(record?.buyStatus || '').toLowerCase();
  if (status === 'suspended') return 'suspended';
  if (status === 'limit_large' || limitAmount != null) return 'limited';
  if (status === 'open') return 'unlimited';
  return 'unknown';
}

function investorScope(text = '') {
  const hasPersonal = /个人投资者/.test(text);
  const hasInstitutional = /机构投资者|非个人投资者/.test(text);
  if (hasPersonal && hasInstitutional) return 'mixed';
  if (hasPersonal) return 'personal';
  if (hasInstitutional) return 'institutional';
  return text ? 'all' : 'unknown';
}

function channelScope(text = '', fallback = null) {
  if (/全部销售机构|所有销售机构|全体销售机构/.test(text)) return 'all_sales';
  const direct = /直销渠道|直销柜台|本公司直销|基金(?:公司)?\s*APP|本公司官网|网上交易/.test(text);
  const distributor = /代销渠道|代销机构|销售机构|银行|券商|第三方平台/.test(text);
  if (direct && distributor) return 'mixed';
  if (direct) return 'direct';
  if (distributor) return 'distributor';
  if (fallback === 'app') return 'direct';
  if (fallback === 'channel') return 'distributor';
  return 'unknown';
}

function shareScope(text = '') {
  if (!text) return 'unknown';
  if (/(?:每类|各类|不同).{0,40}(?:基金)?份额.{0,40}(?:单独计算|分别计算)|不同份额.{0,30}单独计算/.test(text)) return 'per_class';
  if (/(?:申请金额|申购金额).{0,40}(?:予以)?合计|(?:A|C|E|F|I)类?[^。；]{0,60}(?:合并计算|合计)|各类基金份额.{0,40}(?:合并计算|合计)/.test(text)) return 'combined';
  return 'unknown';
}

function limitPeriod(text = '') {
  if (/(?:单日|每日).{0,50}(?:单笔|累计|合计|申购)|(?:单笔|累计|合计|申购).{0,50}(?:单日|每日)/.test(text)) return 'daily_cumulative';
  if (/单笔/.test(text)) return 'single_transaction';
  return text ? 'other' : 'unknown';
}

function ruleExcerpt(text = '') {
  if (!text) return null;
  const index = text.search(/单日|每日|大额申购|限额|暂停申购|恢复申购/);
  return text.slice(Math.max(0, index >= 0 ? index - 90 : 0), Math.max(0, index >= 0 ? index - 90 : 0) + 420);
}

function groupId({ baseFundKey, code, ruleCurrency, ruleInvestorScope, ruleChannelScope, ruleShareScope, ruleLimitPeriod }) {
  if (!baseFundKey || !['all', 'personal'].includes(ruleInvestorScope) || !['all_sales', 'direct', 'distributor'].includes(ruleChannelScope) || ruleLimitPeriod !== 'daily_cumulative') return null;
  if (ruleShareScope === 'combined') return ['v1', baseFundKey, ruleCurrency, ruleInvestorScope, ruleChannelScope, ruleLimitPeriod, 'shared'].join('|');
  if (ruleShareScope === 'per_class') return ['v1', baseFundKey, ruleCurrency, ruleInvestorScope, ruleChannelScope, ruleLimitPeriod, `class-${code}`].join('|');
  return null;
}

function withTiming(policy, now = new Date()) {
  const pending = Boolean(policy.effectiveAt && policy.effectiveAt > shanghaiDate(now));
  return { ...policy, isPending: pending, eligible: Boolean(policy.eligibleWhenEffective) && !pending };
}

export function buildFundLimitPolicy({ record = {}, preset = {}, rawRuleText = '', now = new Date(), sourceFetchError = '' } = {}) {
  const code = String(record?.code || preset?.symbol || '').trim();
  const name = String(preset?.name || record?.fundName || code).trim();
  const rawText = cleanText(rawRuleText);
  const amount = asMoney(record?.maxPurchasePerDay);
  const status = purchaseStatus(record, amount);
  const ruleInvestorScope = investorScope(rawText);
  const ruleChannelScope = channelScope(rawText, record?.limitChannel);
  const ruleShareScope = shareScope(rawText);
  const ruleLimitPeriod = limitPeriod(rawText);
  const ordinarySubscription = /申购|购买/.test(`${rawText} ${record?.sourceTitle || ''}`);
  const ruleCurrency = currency(name, rawText);
  const baseFundKey = fundKey(name, code);
  const ruleEffectiveAt = effectiveDate(rawText, record?.effectiveDate);
  const reviewReasons = [];

  if (!validCode(code)) reviewReasons.push('invalid_code');
  if (status === 'unknown') reviewReasons.push('unknown_purchase_status');
  if (status === 'limited' && amount == null) reviewReasons.push('missing_limit_amount');
  if (status === 'limited' && !ordinarySubscription) reviewReasons.push('ordinary_subscription_not_confirmed');
  if (status === 'limited' && ruleLimitPeriod !== 'daily_cumulative') reviewReasons.push('not_daily_cumulative');
  if (status === 'limited' && !['all', 'personal'].includes(ruleInvestorScope)) reviewReasons.push('investor_scope_not_eligible');
  if (status === 'limited' && !['all_sales', 'direct', 'distributor'].includes(ruleChannelScope)) reviewReasons.push('channel_scope_not_confirmed');
  if (status === 'limited' && !['combined', 'per_class'].includes(ruleShareScope)) reviewReasons.push('share_scope_not_confirmed');
  if (sourceFetchError) reviewReasons.push('announcement_fetch_failed');

  const quotaGroupId = groupId({
    baseFundKey,
    code,
    ruleCurrency,
    ruleInvestorScope,
    ruleChannelScope,
    ruleShareScope,
    ruleLimitPeriod
  });
  const eligibleWhenEffective = status === 'limited'
    && amount != null
    && ordinarySubscription
    && Boolean(quotaGroupId)
    && reviewReasons.length === 0;

  return withTiming({
    version: 1,
    code,
    fundName: name,
    fundKey: baseFundKey,
    shareClass: shareClass(name),
    currency: ruleCurrency,
    purchaseStatus: status,
    limitAmount: amount,
    limitPeriod: ruleLimitPeriod,
    normalSubscription: ordinarySubscription,
    investorScope: ruleInvestorScope,
    channelScope: ruleChannelScope,
    shareScope: ruleShareScope,
    quotaGroupId,
    recordKey: ['v1', code, ruleCurrency, ruleChannelScope].join('|'),
    effectiveAt: ruleEffectiveAt,
    eligibleWhenEffective,
    eligible: eligibleWhenEffective,
    isPending: false,
    parseStatus: reviewReasons.length ? 'review' : 'structured',
    reviewReasons,
    source: {
      sourceType: record?.source || null,
      sourceUrl: record?.sourceUrl || null,
      sourceTitle: record?.sourceTitle || null,
      publishedAt: record?.publishDate || null,
      artCode: record?.artCode || null,
      fetchedAt: record?.fetchedAt || null,
      rawRuleExcerpt: ruleExcerpt(rawText)
    },
    observedAt: new Date().toISOString()
  }, now);
}

function clonePolicy(policy = {}) {
  return { ...policy, reviewReasons: Array.isArray(policy.reviewReasons) ? [...policy.reviewReasons] : [] };
}

export function buildFundLimitOverview({ policies = [], expectedCount = null, asOf = new Date().toISOString() } = {}) {
  const records = (Array.isArray(policies) ? policies : []).map(clonePolicy);
  const groups = new Map();
  const conflicts = new Set();

  records.forEach((record) => {
    if (!record.eligible || !record.quotaGroupId) return;
    const existing = groups.get(record.quotaGroupId);
    if (!existing) {
      groups.set(record.quotaGroupId, {
        quotaGroupId: record.quotaGroupId,
        fundKey: record.fundKey,
        currency: record.currency,
        investorScope: record.investorScope,
        channelScope: record.channelScope,
        shareScope: record.shareScope,
        limitPeriod: record.limitPeriod,
        limitAmount: record.limitAmount,
        effectiveAt: record.effectiveAt,
        codes: [record.code],
        funds: [{ code: record.code, name: record.fundName, shareClass: record.shareClass }]
      });
      return;
    }
    if (existing.limitAmount !== record.limitAmount || existing.effectiveAt !== record.effectiveAt) {
      conflicts.add(record.quotaGroupId);
      return;
    }
    existing.codes.push(record.code);
    existing.funds.push({ code: record.code, name: record.fundName, shareClass: record.shareClass });
  });

  if (conflicts.size) {
    records.forEach((record) => {
      if (!conflicts.has(record.quotaGroupId)) return;
      record.eligible = false;
      record.quotaGroupId = null;
      record.parseStatus = 'review';
      if (!record.reviewReasons.includes('shared_quota_conflict')) record.reviewReasons.push('shared_quota_conflict');
    });
  }

  const quotaGroups = Array.from(groups.values())
    .filter((group) => !conflicts.has(group.quotaGroupId))
    .map((group) => ({
      ...group,
      codes: Array.from(new Set(group.codes)).sort(),
      funds: group.funds.sort((left, right) => left.code.localeCompare(right.code))
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency) || right.limitAmount - left.limitAmount);

  const totalByCurrency = {};
  quotaGroups.forEach((group) => {
    totalByCurrency[group.currency] = Math.round(((totalByCurrency[group.currency] || 0) + group.limitAmount) * 100) / 100;
  });
  const currentRecords = records.filter((record) => !record.isPending);
  const available = currentRecords.filter((record) => ['limited', 'unlimited'].includes(record.purchaseStatus));

  return {
    version: 1,
    asOf,
    summary: {
      totalByCurrency,
      quotaGroupCount: quotaGroups.length,
      eligibleFundCount: currentRecords.filter((record) => record.eligible).length,
      availableFundCount: available.length,
      limitedFundCount: currentRecords.filter((record) => record.purchaseStatus === 'limited').length,
      unlimitedFundCount: currentRecords.filter((record) => record.purchaseStatus === 'unlimited').length,
      suspendedFundCount: currentRecords.filter((record) => record.purchaseStatus === 'suspended').length,
      pendingFundCount: records.filter((record) => record.isPending).length,
      missingFundCount: records.filter((record) => record.purchaseStatus === 'unknown').length,
      reviewCount: records.filter((record) => record.parseStatus !== 'structured').length,
      expectedFundCount: expectedCount == null ? records.length : expectedCount,
      coveredFundCount: records.filter((record) => record.purchaseStatus !== 'unknown').length
    },
    quotaGroups,
    records
  };
}

function groupValue(group) {
  return { limitAmount: group.limitAmount, currency: group.currency, codes: group.codes };
}

function recordValue(record) {
  return { purchaseStatus: record.purchaseStatus, limitAmount: record.limitAmount, currency: record.currency };
}

function dedupeEvents(events = []) {
  const seen = new Set();
  return events.filter((event) => {
    const key = [event.type, event.quotaGroupId || event.recordKey || '', JSON.stringify(event.before), JSON.stringify(event.after)].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function diffFundLimitOverviews(previous = null, current = null) {
  if (!previous || !current) return [];
  const previousGroups = new Map((previous.quotaGroups || []).map((group) => [group.quotaGroupId, group]));
  const previousRecords = new Map((previous.records || []).map((record) => [record.recordKey, record]));
  const events = [];

  (current.quotaGroups || []).forEach((group) => {
    const before = previousGroups.get(group.quotaGroupId);
    if (!before) {
      events.push({ type: 'new_limit', quotaGroupId: group.quotaGroupId, effectiveAt: group.effectiveAt || null, before: null, after: groupValue(group), observedAt: current.asOf });
    } else if (group.limitAmount < before.limitAmount) {
      events.push({ type: 'tighten', quotaGroupId: group.quotaGroupId, effectiveAt: group.effectiveAt || null, before: groupValue(before), after: groupValue(group), observedAt: current.asOf });
    } else if (group.limitAmount > before.limitAmount) {
      events.push({ type: 'relax', quotaGroupId: group.quotaGroupId, effectiveAt: group.effectiveAt || null, before: groupValue(before), after: groupValue(group), observedAt: current.asOf });
    }
  });

  (current.records || []).forEach((record) => {
    const before = previousRecords.get(record.recordKey);
    if (!before) return;
    if (before.purchaseStatus !== 'suspended' && record.purchaseStatus === 'suspended') {
      events.push({ type: 'suspend', recordKey: record.recordKey, code: record.code, fundName: record.fundName, before: recordValue(before), after: recordValue(record), observedAt: current.asOf });
    } else if (before.purchaseStatus === 'suspended' && ['limited', 'unlimited'].includes(record.purchaseStatus)) {
      events.push({ type: 'resume', recordKey: record.recordKey, code: record.code, fundName: record.fundName, before: recordValue(before), after: recordValue(record), observedAt: current.asOf });
    }
    if (before.shareScope !== record.shareScope || before.channelScope !== record.channelScope || before.investorScope !== record.investorScope) {
      events.push({ type: 'scope_changed', recordKey: record.recordKey, code: record.code, fundName: record.fundName, before: { shareScope: before.shareScope, channelScope: before.channelScope, investorScope: before.investorScope }, after: { shareScope: record.shareScope, channelScope: record.channelScope, investorScope: record.investorScope }, observedAt: current.asOf });
    }
  });

  return dedupeEvents(events);
}

async function readJson(env, key) {
  try {
    return await env?.FUND_LIMIT_KV?.get(key, { type: 'json' });
  } catch (_error) {
    return null;
  }
}

async function fetchAnnouncementText(artCode, fetchImpl = fetch) {
  if (!artCode || typeof fetchImpl !== 'function') return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const url = 'https://np-cnotice-fund.eastmoney.com/api/content/ann?art_code='
      + encodeURIComponent(artCode)
      + '&client_source=web_fund&page_index=1';
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/json, text/plain, */*',
        referer: 'https://fundf10.eastmoney.com/',
        'user-agent': 'Mozilla/5.0 (compatible; ai-dca-limit-overview/1.0)'
      },
      signal: controller.signal
    });
    if (!response.ok) return '';
    const payload = await response.json().catch(() => null);
    return cleanText(payload?.data?.notice_content || '');
  } catch (_error) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function policyKey(record = {}) {
  return `${POLICY_KEY_PREFIX}${record.code || 'unknown'}:${record.artCode || 'fallback'}`;
}

async function loadPolicy({ record, preset, env, now, fetchImpl }) {
  const artCode = String(record?.artCode || '').trim();
  if (artCode) {
    const cached = await readJson(env, policyKey(record));
    if (cached?.code === record.code && cached?.source?.artCode === artCode) return withTiming(cached, now);
  }
  const rawRuleText = artCode ? await fetchAnnouncementText(artCode, fetchImpl) : '';
  const policy = buildFundLimitPolicy({
    record,
    preset,
    rawRuleText,
    now,
    sourceFetchError: artCode && !rawRuleText ? 'announcement_fetch_failed' : ''
  });
  if (artCode && rawRuleText) {
    await env.FUND_LIMIT_KV.put(policyKey(record), JSON.stringify(policy), { expirationTtl: POLICY_TTL_SECONDS }).catch(() => {});
  }
  return policy;
}

function presets() {
  return Array.from(new Map((CN_OTC_WATCHLIST_PRESETS || [])
    .filter((item) => validCode(item?.symbol))
    .map((item) => [String(item.symbol), item])).values());
}

function dailySnapshot(snapshot, date) {
  return {
    date,
    asOf: snapshot.asOf,
    totalByCurrency: snapshot.summary.totalByCurrency,
    quotaGroupCount: snapshot.summary.quotaGroupCount,
    availableFundCount: snapshot.summary.availableFundCount,
    limitedFundCount: snapshot.summary.limitedFundCount,
    suspendedFundCount: snapshot.summary.suspendedFundCount,
    reviewCount: snapshot.summary.reviewCount,
    coveredFundCount: snapshot.summary.coveredFundCount
  };
}

export async function refreshFundLimitOverview({ env, now = new Date(), concurrency = 4, fetchImpl = fetch } = {}) {
  if (!env?.FUND_LIMIT_KV) return { ok: false, status: 503, error: '基金限额缓存未配置。' };
  const list = presets();
  const policies = await mapLimit(list, concurrency, async (preset) => {
    const code = String(preset.symbol);
    const cached = await readFundLimitCache({ code, env });
    if (!cached.ok || !cached.data) {
      return buildFundLimitPolicy({ record: { code }, preset, sourceFetchError: cached.error || 'limit_cache_miss', now });
    }
    return loadPolicy({ record: cached.data, preset, env, now, fetchImpl });
  });

  const previous = await readJson(env, CURRENT_KEY);
  const snapshot = buildFundLimitOverview({ policies, expectedCount: list.length, asOf: now.toISOString() });
  snapshot.events = diffFundLimitOverviews(previous, snapshot);
  const date = shanghaiDate(now);
  const oldEvents = await readJson(env, EVENTS_KEY);
  const events = dedupeEvents([...(snapshot.events || []), ...(Array.isArray(oldEvents) ? oldEvents : [])]).slice(0, MAX_EVENTS);

  await Promise.all([
    env.FUND_LIMIT_KV.put(CURRENT_KEY, JSON.stringify(snapshot), { expirationTtl: HISTORY_TTL_SECONDS }),
    env.FUND_LIMIT_KV.put(`${DAILY_KEY_PREFIX}${date}`, JSON.stringify(dailySnapshot(snapshot, date)), { expirationTtl: HISTORY_TTL_SECONDS }),
    env.FUND_LIMIT_KV.put(EVENTS_KEY, JSON.stringify(events), { expirationTtl: HISTORY_TTL_SECONDS })
  ]);
  return { ok: true, status: 200, data: snapshot };
}

export async function loadFundLimitOverviewTrend({ env, days = MAX_TREND_DAYS, now = new Date() } = {}) {
  const count = Math.max(1, Math.min(MAX_TREND_DAYS, Number(days) || MAX_TREND_DAYS));
  const today = shanghaiDate(now);
  const rows = await Promise.all(Array.from({ length: count }, (_unused, index) => {
    const date = shiftDate(today, -(count - 1 - index));
    return readJson(env, `${DAILY_KEY_PREFIX}${date}`);
  }));
  return rows.filter(Boolean);
}

export async function readFundLimitOverview({ env, days = MAX_TREND_DAYS, now = new Date() } = {}) {
  if (!env?.FUND_LIMIT_KV) return { ok: false, status: 503, error: '基金限额缓存未配置。' };
  const snapshot = await readJson(env, CURRENT_KEY);
  if (!snapshot) return { ok: false, status: 404, error: '场外限额聚合快照尚未生成。' };
  const [trend, recentEvents] = await Promise.all([
    loadFundLimitOverviewTrend({ env, days, now }),
    readJson(env, EVENTS_KEY)
  ]);
  return { ok: true, status: 200, data: { ...snapshot, trend, recentEvents: Array.isArray(recentEvents) ? recentEvents : [] } };
}
