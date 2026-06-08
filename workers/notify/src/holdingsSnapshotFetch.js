import {
  fetchFundNavSnapshot,
  fetchFundMetricPrices
} from './getNav.js';
import {
  getExpectedLatestNavDate,
  resolveHoldingKindAsync
} from './holdingsNavSupport.js';

export function isExchangeLikeCode(code) {
  // 场内 ETF / LOF / 封闭基金：都以 1 或 5 开头。
  return /^(1[5-9]|5\d)\d{4}$/.test(String(code || ''));
}

function shanghaiDateFromTimestamp(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return '';
  try {
    return new Date(parsed).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch (_e) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
}

function isAfterShanghaiNavCacheCutoff() {
  // 返回当前上海时间是否 >= 15:30。场内 NAV 只在这个点之后才写缓存，避免缓存盘中报价。
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    const parts = fmt.formatToParts(new Date());
    const hh = Number(parts.find((p) => p.type === 'hour')?.value || '0');
    const mm = Number(parts.find((p) => p.type === 'minute')?.value || '0');
    return (hh * 60 + mm) >= (15 * 60 + 30);
  } catch (_e) {
    return false;
  }
}

/**
 * 拉取持仓收益计算用价格快照，双策略 KV 缓存 + service binding。
 *
 * 口径：
 * - exchange：场内基金/ETF 用 markets/fund-metrics 行情价与昨收价 preClose。
 * - otc / qdii：场外基金继续用单位净值 NAV。
 */
export async function fetchHoldingsNavSnapshots(env, codes = [], options = {}) {
  if (!codes.length) return {};
  const { bucketKindByCode = {}, todayShanghai = '', refreshExchange = false } = options;

  const kindByCode = {};
  for (const code of codes) {
    const bucketKind = bucketKindByCode[code] || (isExchangeLikeCode(code) ? 'exchange' : 'otc');
    kindByCode[code] = await resolveHoldingKindAsync(code, bucketKind, env);
  }

  const cacheReads = await Promise.all(codes.map(async (code) => {
    try {
      const raw = await env?.NOTIFY_STATE?.get(`nav:${code}`);
      if (!raw) return [code, null];
      return [code, JSON.parse(raw)];
    } catch (_e) {
      return [code, null];
    }
  }));
  const cachedByCode = Object.fromEntries(cacheReads);

  const result = {};
  const missing = [];
  let exchangeHit = 0, exchangeMiss = 0, otcHit = 0, otcMiss = 0;
  for (const code of codes) {
    const cached = cachedByCode[code];
    const kind = kindByCode[code];
    let cacheValid = false;
    if (cached && Number.isFinite(Number(cached.latestNav)) && cached.latestNavDate) {
      if (todayShanghai) {
        const expected = getExpectedLatestNavDate(kind, todayShanghai);
        if (kind === 'exchange') {
          cacheValid = String(cached.latestNavDate) >= expected;
        } else {
          const sourceUpdatedDate = shanghaiDateFromTimestamp(cached.sourceUpdatedAt);
          cacheValid = sourceUpdatedDate === todayShanghai || String(cached.latestNavDate) >= expected;
        }
      } else if (kind === 'exchange') {
        cacheValid = true;
      }
    }
    if (cacheValid) {
      result[code] = cached;
      if (kind === 'exchange') exchangeHit += 1; else otcHit += 1;
    } else {
      missing.push(code);
      if (kind === 'exchange') exchangeMiss += 1; else otcMiss += 1;
    }
  }

  console.log('[notify][nav][cache] read', JSON.stringify({
    total: codes.length,
    hit: codes.length - missing.length,
    miss: missing.length,
    exchangeHit, exchangeMiss, otcHit, otcMiss,
    missSample: missing.slice(0, 5)
  }));

  if (!missing.length) return result;

  const afterCacheCutoff = isAfterShanghaiNavCacheCutoff();
  const exchangeMissing = missing.filter((code) => kindByCode[code] === 'exchange');
  const navMissing = missing.filter((code) => kindByCode[code] !== 'exchange');
  const list = [];

  if (exchangeMissing.length) {
    try {
      const priceMap = await fetchFundMetricPrices(exchangeMissing, env, { refresh: refreshExchange, fundKinds: kindByCode });
      let priceCount = 0;
      for (const code of exchangeMissing) {
        const quote = priceMap?.[code];
        const latestPrice = Number(quote?.price);
        const previousPrice = Number(quote?.preClose);
        if (!Number.isFinite(latestPrice) || latestPrice <= 0 || !Number.isFinite(previousPrice) || previousPrice <= 0) {
          if (cachedByCode[code]) result[code] = cachedByCode[code];
          continue;
        }
        priceCount += 1;
        list.push({
          code,
          price: latestPrice,
          currentPrice: latestPrice,
          close: latestPrice,
          previousClose: previousPrice,
          change: Number.isFinite(Number(quote?.change)) ? Number(quote.change) : latestPrice - previousPrice,
          changePercent: Number.isFinite(Number(quote?.changePercent))
            ? Number(quote.changePercent)
            : ((latestPrice / previousPrice) - 1) * 100,
          latestNav: Number.isFinite(Number(quote?.latestNav)) && Number(quote.latestNav) > 0
            ? Number(quote.latestNav)
            : latestPrice,
          latestNavDate: String(quote?.date || todayShanghai || '').trim(),
          previousNav: previousPrice,
          quoteDate: String(quote?.quoteDate || quote?.date || todayShanghai || '').trim(),
          previousNavDate: '',
          source: quote?.source || 'fund-metrics',
          priceSource: quote?.source || 'fund-metrics',
          valueType: 'price',
          time: String(quote?.time || '').trim(),
          asOf: String(quote?.asOf || quote?.updatedAt || '').trim(),
          marketState: String(quote?.marketState || '').trim(),
          ok: true
        });
      }
      console.log('[notify][price] fund-metrics result', JSON.stringify({
        requested: exchangeMissing.length,
        priceCount,
        sample: exchangeMissing.slice(0, 5)
      }));
    } catch (priceErr) {
      console.log('[notify][price] fund-metrics fetch failed', JSON.stringify({
        message: priceErr?.message || String(priceErr),
        requested: exchangeMissing.length
      }));
      for (const code of exchangeMissing) {
        if (cachedByCode[code]) result[code] = cachedByCode[code];
      }
    }
  }

  if (navMissing.length) {
    const generatedAt = new Date().toISOString();
    const queue = [...navMissing];
    const results = [];
    const worker = async () => {
      while (queue.length) {
        const code = queue.shift();
        if (!code) continue;
        try {
          const snap = await fetchFundNavSnapshot(code, generatedAt, env, { fundKinds: kindByCode });
          results.push(snap);
        } catch (fetchErr) {
          results.push({
            ok: false,
            code,
            error: fetchErr?.message || String(fetchErr),
            updatedAt: generatedAt
          });
        }
      }
    };
    const concurrency = Math.min(6, queue.length);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    list.push(...results);
  }

  let written = 0, skippedExchange = 0, skippedSameOrOlder = 0;

  for (const snap of list) {
    const code = String(snap?.code || '').trim();
    if (!code) continue;
    if (snap?.ok === false) {
      if (cachedByCode[code]) result[code] = cachedByCode[code];
      continue;
    }
    result[code] = snap;

    const kind = kindByCode[code];
    const cached = cachedByCode[code];
    const freshDate = String(snap.latestNavDate || '');
    const cachedDate = String(cached?.latestNavDate || '');
    const freshSourceUpdatedDate = shanghaiDateFromTimestamp(snap.sourceUpdatedAt);
    const cachedSourceUpdatedDate = shanghaiDateFromTimestamp(cached?.sourceUpdatedAt);
    const sourceFreshenedToday = kind !== 'exchange'
      && todayShanghai
      && freshSourceUpdatedDate === todayShanghai
      && cachedSourceUpdatedDate !== todayShanghai;
    const isNewer = freshDate && (!cachedDate || freshDate > cachedDate || sourceFreshenedToday);

    if (!isNewer) { skippedSameOrOlder += 1; continue; }

    if (kind === 'exchange' && !afterCacheCutoff) {
      skippedExchange += 1;
      continue;
    }

    try {
      await env?.NOTIFY_STATE?.put(`nav:${code}`, JSON.stringify(snap), { expirationTtl: 7 * 24 * 3600 });
      written += 1;
    } catch (kvErr) {
      console.log('[notify][nav][cache] write failed', JSON.stringify({
        code, message: kvErr?.message || String(kvErr)
      }));
    }
  }

  console.log('[notify][nav][cache] write summary', JSON.stringify({
    fetchedCount: list.length,
    written,
    skippedExchangeBeforeCutoff: skippedExchange,
    skippedSameOrOlder,
    afterCacheCutoff
  }));

  return result;
}
