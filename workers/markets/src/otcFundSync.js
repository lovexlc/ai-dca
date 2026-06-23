// 场外基金数据同步模块
// 定时拉取蛋卷基金数据并缓存到 KV

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Referer': 'https://danjuanfunds.com/',
  'Accept': 'application/json',
  'Accept-Language': 'zh-CN,zh;q=0.9'
};

const DANJUAN_HOST = 'https://danjuanfunds.com';

/**
 * 拉取基金的所有核心数据
 */
export async function fetchOtcFundFullData(fundCode) {
  const code = String(fundCode).replace(/^(sh|sz|bj)/i, '');

  try {
    // 并发请求三个核心接口
    const [derived, achievement, detail] = await Promise.allSettled([
      fetchDanjuanDerived(code),
      fetchDanjuanAchievement(code),
      fetchDanjuanDetail(code)
    ]);

    // 组合数据
    const result = {
      code,
      timestamp: Date.now(),
      derived: derived.status === 'fulfilled' ? derived.value : null,
      achievement: achievement.status === 'fulfilled' ? achievement.value : null,
      detail: detail.status === 'fulfilled' ? detail.value : null,
      errors: []
    };

    // 记录错误
    if (derived.status === 'rejected') result.errors.push({ api: 'derived', error: derived.reason?.message });
    if (achievement.status === 'rejected') result.errors.push({ api: 'achievement', error: achievement.reason?.message });
    if (detail.status === 'rejected') result.errors.push({ api: 'detail', error: detail.reason?.message });

    return result;
  } catch (err) {
    throw new Error(`fetch full data for ${code}: ${err.message}`);
  }
}

/**
 * 1. 基金净值和收益率
 * /djapi/fund/derived/{code}
 */
async function fetchDanjuanDerived(code) {
  const url = `${DANJUAN_HOST}/djapi/fund/derived/${code}`;
  const res = await fetch(url, {
    headers: COMMON_HEADERS,
    cf: { cacheTtl: 300 }
  });

  if (!res.ok) throw new Error(`derived HTTP ${res.status}`);

  const body = await res.json();
  if (body?.result_code !== 0 && body?.result_code !== '0') {
    throw new Error(`derived error: ${body?.message || body?.result_code}`);
  }

  return body.data;
}

/**
 * 2. 基金绩效分析（包含最大回撤）
 * /djapi/fundx/base/fund/achievement/{code}
 */
async function fetchDanjuanAchievement(code) {
  const url = `${DANJUAN_HOST}/djapi/fundx/base/fund/achievement/${code}`;
  const res = await fetch(url, {
    headers: COMMON_HEADERS,
    cf: { cacheTtl: 3600 }
  });

  if (!res.ok) throw new Error(`achievement HTTP ${res.status}`);

  const body = await res.json();
  if (body?.result_code !== 0 && body?.result_code !== '0') {
    throw new Error(`achievement error: ${body?.message || body?.result_code}`);
  }

  return body.data;
}

/**
 * 3. 基金持仓和规模
 * /djapi/fund/detail/{code}
 */
async function fetchDanjuanDetail(code) {
  const url = `${DANJUAN_HOST}/djapi/fund/detail/${code}`;
  const res = await fetch(url, {
    headers: COMMON_HEADERS,
    cf: { cacheTtl: 86400 }
  });

  if (!res.ok) throw new Error(`detail HTTP ${res.status}`);

  const body = await res.json();
  if (body?.result_code !== 0 && body?.result_code !== '0') {
    throw new Error(`detail error: ${body?.message || body?.result_code}`);
  }

  return body.data;
}

/**
 * 将拉取的数据转换为标准格式（兼容现有 API）
 */
export function transformOtcFundData(fullData) {
  if (!fullData || !fullData.derived) return null;

  const d = fullData.derived;
  const a = fullData.achievement;
  const detail = fullData.detail;

  // 找到"成立以来"的最大回撤
  const sinceInceptionPerf = a?.annual_performance_list?.find(p => p.period_time === '成立以来');
  const maxDrawdown = sinceInceptionPerf?.self_max_draw_down
    ? parseFloat(sinceInceptionPerf.self_max_draw_down.replace('%', ''))
    : null;

  // 基金规模
  const assetTotal = detail?.fund_position?.asset_tot || null;

  return {
    code: fullData.code,
    symbol: fullData.code,
    name: d.fd_name || '',
    price: null,
    currentPrice: null,
    close: null,
    previousClose: null,
    change: null,
    changePercent: parseFloat(d.nav_grtd) || null,
    latestNav: parseFloat(d.unit_nav) || null,
    latestNavDate: d.end_date || '',
    iopv: null,
    marketState: '',
    asOf: new Date(fullData.timestamp).toISOString(),
    source: 'danjuan',
    fallback: 'danjuan',
    primaryError: '',
    fundTypeCode: d.fd_type || null,
    updatedAt: d.updated_at || 0,

    // 收益率
    ytdReturn: parseFloat(d.nav_grlty) || null,
    return1w: parseFloat(d.nav_grl1w) || null,
    return1m: parseFloat(d.nav_grl1m) || null,
    return3m: parseFloat(d.nav_grl3m) || null,
    return6m: parseFloat(d.nav_grl6m) || null,
    return1y: parseFloat(d.nav_grl1y) || null,
    returnBase: parseFloat(d.nav_grbase) || null,

    // 新增字段
    maxDrawdown,
    fundSize: assetTotal,

    // 元数据
    _cached: true,
    _cacheTime: fullData.timestamp
  };
}

/**
 * 批量同步场外基金数据
 * @param {string[]} fundCodes - 基金代码列表
 * @param {KVNamespace} kv - KV 存储
 * @param {number} concurrency - 并发数
 */
export async function syncOtcFunds(fundCodes, kv, concurrency = 5) {
  const results = {
    total: fundCodes.length,
    success: 0,
    failed: 0,
    errors: []
  };

  // 分批处理
  for (let i = 0; i < fundCodes.length; i += concurrency) {
    const batch = fundCodes.slice(i, i + concurrency);

    const settled = await Promise.allSettled(
      batch.map(async (code) => {
        try {
          // 拉取数据
          const fullData = await fetchOtcFundFullData(code);

          // 存储到 KV
          const key = `otc_fund:${code}`;
          await kv.put(key, JSON.stringify(fullData), {
            expirationTtl: 86400 // 24小时过期
          });

          results.success++;
          return { code, success: true };
        } catch (err) {
          results.failed++;
          results.errors.push({ code, error: err.message });
          return { code, success: false, error: err.message };
        }
      })
    );

    // 短暂延迟，避免请求过快
    if (i + concurrency < fundCodes.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * 从 KV 读取场外基金数据
 */
export async function getOtcFundFromCache(fundCode, kv) {
  const code = String(fundCode).replace(/^(sh|sz|bj)/i, '');
  const key = `otc_fund:${code}`;

  const cached = await kv.get(key, 'json');
  if (!cached) return null;

  // 转换为标准格式
  return transformOtcFundData(cached);
}

/**
 * 定时任务包装函数
 * 用于在 Worker 定时任务中调用
 */
export async function syncOtcFundsTask(env, fundCodes) {
  try {
    console.log('[otc-sync] Starting sync for', fundCodes.length, 'funds');
    const results = await syncOtcFunds(fundCodes, env.MARKETS_KV, 3);
    console.log('[otc-sync] Completed:', results.success, 'success,', results.failed, 'failed');
    if (results.errors.length > 0) {
      console.error('[otc-sync] Errors:', JSON.stringify(results.errors));
    }
    return results;
  } catch (err) {
    console.error('[otc-sync] Task failed:', err);
    throw err;
  }
}
