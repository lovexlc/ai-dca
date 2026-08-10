import { CN_OTC_WATCHLIST_PRESETS } from '../../../src/app/marketsWatchlistStorage.js';
import { mapLimit, readFundLimitCache } from './fundLimit.js';

const CURRENT_SNAPSHOT_KEY = 'limit-overview:v1:current';
const EVENTS_KEY = 'limit-overview:v1:events';
const DAILY_KEY_PREFIX = 'limit-overview:v1:daily:';
const POLICY_KEY_PREFIX = 'limit-policy:v1:';
const POLICY_TTL_SECONDS = 7 * 24 * 60 * 60;
const SNAPSHOT_TTL_SECONDS = 45 * 24 * 60 * 60;
const HISTORY_TTL_SECONDS = 45 * 24 * 60 * 60;
const MAX_RECENT_EVENTS = 300;
const MAX_TREND_DAYS = 30;

function normalizedText(value = '') {
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

function validCode(value = '') {
  return /^\d{6}$/.test(String(value || '').trim());
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null;
}

function isoNow() {
  return new Date().toISOString();
}

function shanghaiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function shiftIsoDate(dateString, days) {
  const [year, month, day] = String(dateString || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function normalizeDate(value = '') {
  const source = String(value || '').trim();
  if (!source) return null;
  const iso = source.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const chinese = source.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (chinese) return `${chinese[1]}-${String(chinese[2]).padStart(2, '0')}-${String(chinese[3]).padStart(2, '0')}`;
  return null;
}

function extractEffectiveDate(text = '', fallback = null) {
  const fromRecord = normalizeDate(fallback);
  if (fromRecord) return fromRecord;
  const match = String(text || '').match(/(?:自|从|于)\s*(20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:起|开始|实施|恢复)?/);
  return match ? normalizeDate(match[1]) : null;
}

function extractShareClass(name = '') {
  const normalized = String(name || '').replace(/[\s）)]/g, '');
  const match = normalized.match(/(?:人民币|美元现汇|美元|USD|CNY)?([A-Z])(?:类)?$/i);
  return match ? match[1].toUpperCase() : null;
}

function buildFundKey(name = '', code = '') {
  const key = String(name || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/人民币|美元现汇|美元|USD|CNY/gi, '')
    .replace(/(?:[A-Z])(?:类)?$/i, '')
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, '')
    .trim()
    .toLowerCase();
  return key || `fund-${String(code || '').trim()}`;
}

function inferCurrency(name = '', sourceText = '') {
  return /美元|USD/i.test(`${name} ${sourceText}`) ? 'USD' : 'CNY';
}

function derivePurchaseStatus(record = {}, limitAmount = null) {
  const value = String(record?.buyStatus || '').toLowerCase();
  if (value === 'suspended') return 'suspended';
  if (value === 'limit_large' || limitAmount != null) return 'limited';
  if (value === 'open') return 'unlimited';
  return 'unknown';
}

function detectInvestorScope(text = '') {
  const source = String(text || '');
  const personal = /个人投资者/.test(source);
  const institutional = /机构投资者|非个人投资者/.test(source);
  if (personal && institutional) return 'mixed';
  if (personal) return 'personal';
  if (institutional) return 'institutional';
  return source ? 'all' : 'unknown';
}

function detectChannelScope(text = '', fallback = null) {
  const source = String(text || '');
  if (/全部销售机构|所有销售机构|全体销售机构/.test(source)) return 'all_sales';
  const direct = /直销渠道|直销柜台|本公司直销|基金(?:公司)?\s*APP|本公司官网|网上交易/.test(source);
  const distributor = /代销渠道|代销机构|销售机构|银行|券商|第三方平台/.test(source);
  if (direct && distributor) return 'mixed';
  if (direct) return 'direct';
  if (distributor) return 'distributor';
  if (fallback === 'app') return 'direct';
  if (fallback === 'channel') return 'distributor';
  return 'unknown';
}

function detectShareScope(text = '') {
  const source = String(text || '');
  if (!source) return 'unknown';
  if (/(?:每类|各类|不同).{0,40}(?:基金)?份额.{0,40}(?:单独计算|分别计算)|不同份额.{0,30}单独计算/.test(source)) {
    return 'per_class';
  }
  if (/(?:申请金额|申购金额).{0,40}(?:予以)?合计|(?:A|C|E|F|I)类?[^。；]{0,60}(?:合并计算|合计)|各类基金份额.{0,40}(?:合并计算|合计)/.test(source)) {
    return 'combined';
  }
  return 'unknown';
}

function detectLimitPeriod(text = '') {
  const source = String(text || '');
  if (/(?:单日|每日).{0,50}(?:单笔|累计|合计|申购)|(?:单笔|累计|合计|申购).{0,50}(?:单日|每日)/.test(source)) {
    return 'daily_cumulative';
  }
  if (/单笔/.test(source)) return 'single_transaction';
  return source ? 'other' : 'unknown';
}

function hasOrdinarySubscription(text = '', title = '') {
  return /申购|购买/.test(`${text} ${title}`);
}

function evidenceExcerpt(text = '') {
  const source = normalizedText(text);
  if (!source) return null;
  const index = source.search(/单日|每日|大额申购|限额|暂停申购|恢复申购/);
  const start = Math.max(0, index >= 0 ? index - 90 : 0);
  return source.slice(start, start + 420);
}

function buildQuotaGroupId({ fundKey, code, currency, investorScope, channelScope, shareScope, limitPeriod }) {
  if (!fundKey || !currency || !['all', 'personal'].includes(investorScope) || !['all_sales', 'direct', 'distributor'].includes(channelScope) || limitPeriod !== 'daily_cumulative') {
    return null;
  }
  const shareKey = shareScope === 'combined' ? 'shared' : shareScope === 'per_class' ? `class-${code}` : '';
  return shareKey ? ['v1', fundKey, currency, investorScope, channelScope, limitPeriod, shareKey].join('|') : null;
}

function refreshPolicyTiming(policy, now = new Date()) {
  const effectiveAt = normalizeDate(policy?.effectiveAt);
  const pending = Boolean(effectiveAt && effectiveAt > shanghaiDate(now));
  return {
    ...policy,
    effectiveAt,
    isPending: pending,
    eligible: Boolean(policy?.eligibleWhenEffective) && !pending
  };
}

export function buildFundLimitPolicy({ record = {}, preset = {}, rawRuleText = '', now = new Date(), sourceFetchError = '' } = {}) {
  const code = String(record?.code || preset?.symbol || '').trim();
  const fundName = String(preset?.name || record?.fundName || code).trim();
  const rawText = normalizedText(rawRuleText);
  const title = String(record?.sourceTitle || '').trim();
  const limitAmount = finitePositive(record?.maxPurchasePerDay);
  const purchaseStatus = derivePurchaseStatus(record, limitAmount);
  const effectiveAt = extractEffectiveDate(rawText, record?.effectiveDate);
  const investorScope = detectInvestorScope(rawText);
  const channelScope = detectChannelScope(rawText, record?.limitChannel);
  const shareScope = detectShareScope(rawText);
  const limitPeriod = detectLimitPeriod(rawText);
  const normalSubscription = hasOrdinarySubscription(rawText, title);
  const shareClass = extractShareClass(fundName);
  const fundKey = buildFundKey(fundName, code);
  const currency = inferCurrency(fundName, rawText);
  const reviewReasons = [];

  if (!validCode(code)) reviewReasons.push('invalid_code');
  if (purchaseStatus === 'unknown') reviewReasons.push('unknown_purchase_status');
  if (purchaseStatus === 'limited' && limitAmount == null) reviewReasons.push('missing_limit_amount');
  if (purchaseStatus === 'limited' && !normalSubscription) reviewReasons.push('ordinary_subscription_not_confirmed');
  if (purchaseStatus === 'limited' && limitPeriod !== 'daily_cumulative') reviewReasons.push('not_daily_cumulative');
  if (purchaseStatus === 'limited' && !['all', 'personal'].includes(investorScope)) reviewReasons.push('investor_scope_not_eligible');
  if (purchaseStatus === 'limited' && !['all_sales', 'direct', 'distributor'].includes(channelScope)) reviewReasons.push('channel_scope_not_confirmed');
  if (purchaseStatus === 'limited' && !['combined', 'per_class'].includes(shareScope)) reviewReasons.push('share_scope_not_confirmed');
  if (sourceFetchError) reviewReasons.push('announcement_fetch_failed');

  const quotaGroupId = buildQuotaGroupId({
    fundKey,
    code,
    currency,
    investorScope,
    channelScope,
    shareScope,
    limitPeriod
  });
  const futureEffective = Boolean(effectiveAt && effectiveAt > shanghaiDate(now));
  const eligibleWhenEffective = purchaseStatus === 'limited'
    && limitAmount != null
    && normalSubscription
    && limitPeriod === 'daily_cumulative'
    && ['all', 'personal'].includes(investorScope)
    && ['all_sales', 'direct', 'distributor'].includes(channelScope)
    && ['combined', 'per_class'].includes(shareScope)
    && Boolean(quotaGroupId)
    && !reviewReasons.length;

  return refreshPolicyTiming({
    version: 1,
    code,
    fundName,
    fundKey,
    shareClass,
    currency,
    purchaseStatus,
    limitAmount,
    limitPeriod,
    normalSubscription,
    investorScope,
    channelScope,
    shareScope,
    quotaGroupId,
    recordKey: ['v1', code, currency, channelScope].join('|'),
    effectiveAt,
    eligibleWhenEffective,
    eligible: eligibleWhenEffective && !futureEffective,
    isPending: futureEffective,
    parseStatus: reviewReasons.length ? 'review' : 'structured',
    reviewReasons,
    source: {
      sourceType: record?.source || null,
      sourceUrl: record?.sourceUrl || null,
      sourceTitle: title || null,
      publishedAt: record?.publishDate || null,
      artCode: record?.artCode || null,
      fetchedAt: record?.fetchedAt || null,
      rawRuleExcerpt: evidenceExcerpt(rawText)
    },
    observedAt: isoNow()
  }, now);
}

function clonePolicy(policy = {}) {
  return {
    ...policy,
    reviewReasons: Array.isArray(policy.reviewReasons) ? [...policy.reviewReasons] : []
  };
}

function summarizeCurrency(groups = []) {
  const totals = {};
  groups.forEach((group) => {
    if (!group?.currency || !Number.isFinite(group.limitAmount)) return;
    totals[group.currency] = Math.round(((totals[group.currency] || 0) + group.limitAmount) * 100) / 100;
  });
  return totals;
}

export function buildFundLimitOverview({ policies = [], expectedCount = null, asOf = isoNow() } = {}) {
  const records = (Array.isArray(policies) ? policies : []).map(clonePolicy);
  const grouped = new Map();
  const conflicts = new Set();

  records.forEach((record) => {
    if (!record.eligible || !record.quotaGroupId) return;
    const existing = grouped.get(record.quotaGroupId);
    if (!existing) {
      grouped.set(record.quotaGroupId, {
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
      record.parseStatus = 'review';
      record.quotaGroupId = null;
      if (!record.reviewReasons.includes('shared_quota_conflict')) record.reviewReasons.push('shared_quota_conflict');
    });
  }

  const quotaGroups = Array.from(grouped.values())
    .filter((group) => !conflicts.has(group.quotaGroupId))
    .map((group) => ({
      ...group,
      codes: Array.from(new Set(group.codes)).sort(),
      funds: group.funds.sort((left, right) => left.code.localeCompare(right.code))
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency) || right.limitAmount - left.limitAmount || left.quotaGroupId.localeCompare(right.quotaGroupId));

  const currentRecords = records.filter((record) => !record.isPending);
  const available = currentRecords.filter((record) => ['limited', 'unlimited'].includes(record.purchaseStatus));
  const reviewCount = records.filter((record) => record.parseStatus !== 'structured').length;
  const summary = {
    totalByCurrency: summarizeCurrency(quotaGroups),
    quotaGroupCount: quotaGroups.length,
    eligibleFundCount: currentRecords.filter((record) => record.eligible).length,
    availableFundCount: available.length,
    limitedFundCount: currentRecords.filter((record) => record.purchaseStatus === 'limited').length,
    unlimitedFundCount: currentRecords.filter((record) => record.purchaseStatus === 'unlimited').length,
    suspendedFundCount: currentRecords.filter((record) => record.purchaseStatus === 'suspended').length,
    pendingFundCount: records.filter((record) => record.isPending).length,
    missingFundCount: records.filter((record) => record.purchaseStatus === 'unknown').length,
    reviewCount,
    expectedFundCount: expectedCount == null ? records.length : expectedCount,
    coveredFundCount: records.filter((record) => record.purchaseStatus !== 'unknown').length
  };

  return {
    version: 1,
    asOf,
    summary,
    quotaGroups,
    records
  };
}

function eventValue(group = null, record = null) {
  if (group) return { limitAmount: group.limitAmount, currency: group.currency, codes: group.codes };
  if (record) return { purchaseStatus: record.purchaseStatus, limitAmount: record.limitAmount, currency: record.currency };
  return null;
}

function uniqueEvents(events = []) {
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
  const beforeGroups = new Map((previous.quotaGroups || []).map((group) => [group.quotaGroupId, group]));
  const afterGroups = new Map((current.quotaGroups || []).map((group) => [group.quotaGroupId, group]));
  const beforeRecords = new Map((previous.records || []).map((record) => [record.recordKey, record]));
  const events = [];

  afterGroups.forEach((group, quotaGroupId) => {
    const before = beforeGroups.get(quotaGroupId);
    if (!before) {
      events.push({
        type: 'new_limit',
        quotaGroupId,
        effectiveAt: group.effectiveAt || null,
        before: null,
        after: eventValue(group),
        observedAt: current.asOf
      });
      return;
    }
    if (Number(group.limitAmount) < Number(before.limitAmount)) {
      events.push({ type: 'tighten', quotaGroupId, effectiveAt: group.effectiveAt || null, before: eventValue(before), after: eventValue(group), observedAt: current.asOf });
    } else if (Number(group.limitAmount) > Number(before.limitAmount)) {
      events.push({ type: 'relax', quotaGroupId, effectiveAt: group.effectiveAt || null, before: eventValue(before), after: eventValue(group), observedAt: current.asOf });
    }
  });

  (current.records || []).forEach((record) => {
    const before = beforeRecords.get(record.recordKey);
    if (!before) return;
    if (before.purchaseStatus !== 'suspended' && record.purchaseStatus === 'suspended') {
      events.push({ type: 'suspend', recordKey: record.recordKey, code: record.code, fundName: record.fundName, effectiveAt: record.effectiveAt || null, before: eventValue(null, before), after: eventValue(null, record), observedAt: current.asOf });
    } else if (before.purchaseStatus === 'suspended' && ['limited', 'unlimited'].includes(record.purchaseStatus)) {
      events.push({ type: 'resume', recordKey: record.recordKey, code: record.code, fundName: record.fundName, effectiveAt: record.effectiveAt || null, before: eventValue(null, before), after: eventValue(null, record), observedAt: current.asOf });
    }
    if (before.shareScope !== record.shareScope || before.channelScope !== record.channelScope || before.investorScope !== record.investorScope) {
      events.push({ type: 'scope_changed', recordKey: record.recordKey, code: record.code, fundName: record.fundName, effectiveAt: record.effectiveAt || null, before: { shareScope: before.shareScope, channelScope: before.channelScope, investorScope: before.investorScope }, after: { shareScope: record.shareScope, channelScope: record.channelScope, investorScope: record.investorScope }, observedAt: current.asOf });
    }
  });

  return uniqueEvents(events);
}

async function fetchAnnouncementText(artCode, fetchImpl = fetch) {
  if (!artCode || typeof fetchImpl !== 'function') return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const url = `https://np-cnotice-fund.eastmoney.com/api/content/ann?art_code=${encodeURIComponent(artCode)}&client_source=web_fund&page_index=1`;
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
    return normalizedText(payload?.data?.notice_content || '');
  } catch (_error) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function policyCacheKey(record = {}) {
  return `${POLICY_KEY_PREFIX}${record.code || 'unknown'}:${record.artCode || 'fallback'}`;
}

async function loadPolicyForRecord({ record, preset, env, now, fetchImpl }) {
  const artCode = String(record?.artCode || '').trim();
  const cacheKey = policyCacheKey(record);
  if (artCode && env?.FUND_LIMIT_KV) {
    const cached = await env.FUND_LIMIT_KV.get(cacheKey, { type: 'json' }).catch(() => null);
    if (cached && cached.code === record.code && cached.source?.artCode === artCode) {
      return refreshPolicyTiming(cached, now);
    }
  }

  const rawRuleText = artCode ? await fetchAnnouncementText(artCode, fetchImpl) : '';
  const policy = buildFundLimitPolicy({
    record,
    preset,
    rawRuleText,
    now,
    sourceFetchError: artCode && !rawRuleText ? 'announcement_fetch_failed' : ''
  });
  if (artCode && rawRuleText && env?.FUND_LIMIT_KV) {
    await env.FUND_LIMIT_KV.put(cacheKey, JSON.stringify(policy), { expirationTtl: POLICY_TTL_SECONDS }).catch(() => {});
  }
  return policy;
}

function presetList() {
  return Array.from(new Map((CN_OTC_WATCHLIST_PRESETS || [])
    .filter((item) => validCode(item?.symbol))
    .map((item) => [String(item.symbol), item])).values());
}

function compactDailySnapshot(snapshot, date) {
  return {
    date,
    asOf: snapshot.asOf,
    totalByCurrency: snapshot.summary?.totalByCurrency || {},
    quotaGroupCount: snapshot.summary?.quotaGroupCount || 0,
    availableFundCount: snapshot.summary?.availableFundCount || 0,
    limitedFundCount: snapshot.summary?.limitedFundCount || 0,
    suspendedFundCount: snapshot.summary?.suspendedFundCount || 0,
    reviewCount: snapshot.summary?.reviewCount || 0,
    coveredFundCount: snapshot.summary?.coveredFundCount || 0
  };
}

async function readJson(env, key) {
  if (!env?.FUND_LIMIT_KV) return null;
  try {
    return await env.FUND_LIMIT_KV.get(key, { type: 'json' });
  } catch (_error) {
    return null;
  }
}

export async function refreshFundLimitOverview({ env, now = new Date(), concurrency = 4, fetchImpl = fetch } = {}) {
  if (!env?.FUND_LIMIT_KV) {
    return { ok: false, status: 503, error: '基金限额缓存未配置。' };
  }
  const presets = presetList();
  const policies = await mapLimit(presets, concurrency, async (preset) => {
    const code = String(preset.symbol);
    const cached = await readFundLimitCache({ code, env });
    if (!cached.ok || !cached.data) {
      return buildFundLimitPolicy({
        record: { code, buyStatus: null, fetchedAt: null },
        preset,
        rawRuleText: '',
        now,
        sourceFetchError: cached.error || 'limit_cache_miss'
      });
    }
    return loadPolicyForRecord({ record: cached.data, preset, env, now, fetchImpl });
  });

  const previous = await readJson(env, CURRENT_SNAPSHOT_KEY);
  const snapshot = buildFundLimitOverview({ policies, expectedCount: presets.length, asOf: now.toISOString() });
  const events = diffFundLimitOverviews(previous, snapshot);
  snapshot.events = events;
  const date = shanghaiDate(now);
  const previousEvents = await readJson(env, EVENTS_KEY);
  const recentEvents = uniqueEvents([...(events || []), ...(Array.isArray(previousEvents) ? previousEvents : [])]).slice(0, MAX_RECENT_EVENTS);

  await Promise.all([
    env.FUND_LIMIT_KV.put(CURRENT_SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: SNAPSHOT_TTL_SECONDS }),
    env.FUND_LIMIT_KV.put(`${DAILY_KEY_PREFIX}${date}`, JSON.stringify(compactDailySnapshot(snapshot, date)), { expirationTtl: HISTORY_TTL_SECONDS }),
    env.FUND_LIMIT_KV.put(EVENTS_KEY, JSON.stringify(recentEvents), { expirationTtl: HISTORY_TTL_SECONDS })
  ]);

  return { ok: true, status: 200, data: snapshot };
}

export async function loadFundLimitOverviewTrend({ env, days = MAX_TREND_DAYS, now = new Date() } = {}) {
  const count = Math.max(1, Math.min(MAX_TREND_DAYS, Number(days) || MAX_TREND_DAYS));
  const today = shanghaiDate(now);
  const dates = Array.from({ length: count }, (_unused, index) => shiftIsoDate(today, -(count - 1 - index)));
  const rows = await Promise.all(dates.map(async (date) => readJson(env, `${DAILY_KEY_PREFIX}${date}`)));
  return rows.filter(Boolean);
}

export async function readFundLimitOverview({ env, days = MAX_TREND_DAYS, now = new Date() } = {}) {
  if (!env?.FUND_LIMIT_KV) {
    return { ok: false, status: 503, error: '基金限额缓存未配置。' };
  }
  const snapshot = await readJson(env, CURRENT_SNAPSHOT_KEY);
  if (!snapshot) {
    return { ok: false, status: 404, error: '场外限额聚合快照尚未生成。' };
  }
  const [trend, recentEvents] = await Promise.all([
    loadFundLimitOverviewTrend({ env, days, now }),
    readJson(env, EVENTS_KEY)
  ]);
  return {
    ok: true,
    status: 200,
    data: {
      ...snapshot,
      trend,
      recentEvents: Array.isArray(recentEvents) ? recentEvents : []
    }
  };
}
