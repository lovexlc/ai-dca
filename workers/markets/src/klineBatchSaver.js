// K线数据收盘后批量保存任务
// 用于解决雪球接口K线数据时间窗口限制的问题
/* global console */

import { fetchYahooChart, normalizeYahooKline } from './fetchers.js';
import { kvGetJson, kvPutJson, r2GetJson, r2PutJson, klineKey } from './storage.js';
import { classifySymbol } from './symbols.js';
import { attachKlineHighPoint } from './klineHighPoint.js';
import { writeKlineHighPointCache } from './klineHighPointCache.js';
import {
  fetchCnKlineWithFallback,
  INTRADAY_KLINE_INTERVALS,
  mapLimit
} from './marketRuntime.js';

// 需要保存K线数据的时间周期配置
const KLINE_INTERVALS = {
  us: ['1d', '1w', '1mo', '1m', '5m', '15m', '30m', '60m'],  // 美股周期
  cn: ['1d', '1m', '5m', '15m', '30m', '60m']  // A股周期
};

// 热门股票池配置（可从 symbols.js 导入或单独维护）
const TRACKING_SYMBOLS = {
  us: [
    // 主要指数
    '^GSPC', '^DJI', '^IXIC', '^RUT',
    // 大盘股
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA',
    'JPM', 'V', 'WMT', 'JNJ', 'PG', 'DIS', 'NFLX',
    // ETF
    'SPY', 'QQQ', 'IWM', 'VOO', 'VTI'
  ],
  cn: [
    // 场内基金列表（与前端 marketsApi.js CN_ETF_WATCHLIST_PRESETS 保持一致）
    // 纳指ETF
    '513870', '513390', '513300', '513110', '513100',
    '159941', '159696', '159660', '159659', '159632',
    '159513', '159509', '159501', '159577',
    // 标普500ETF
    '161128', '513500', '513650', '159612'
  ]
};

/**
 * 批量保存指定市场的K线数据
 * @param {Object} env - Cloudflare Workers 环境变量
 * @param {string} market - 市场标识 ('us' | 'cn')
 * @param {Object} options - 配置选项
 * @returns {Object} 保存结果统计
 */
export async function saveKlineDataBatch(env, market, options = {}) {
  const {
    symbols = TRACKING_SYMBOLS[market] || [],
    intervals = KLINE_INTERVALS[market] || [],
    concurrency = 3,  // 并发数，避免过载
    skipExisting = false  // 是否跳过已存在的数据
  } = options;

  console.log(`[kline-batch] Start saving ${market} kline data`, {
    symbolCount: symbols.length,
    intervals,
    concurrency,
    timestamp: new Date().toISOString()
  });

  const results = {
    market,
    startTime: new Date().toISOString(),
    totalSymbols: symbols.length,
    totalTasks: symbols.length * intervals.length,
    success: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  // 生成所有任务
  const tasks = [];
  for (const symbol of symbols) {
    for (const interval of intervals) {
      tasks.push({ symbol, interval });
    }
  }

  // 限制并发执行
  await mapLimit(tasks, concurrency, async (task) => {
    const { symbol, interval } = task;
    try {
      await saveKlineDataForSymbol(env, market, symbol, interval, { skipExisting });
      results.success++;

      if (results.success % 10 === 0) {
        console.log(`[kline-batch] Progress: ${results.success}/${results.totalTasks}`);
      }
    } catch (error) {
      results.failed++;
      const errorMsg = `${symbol}:${interval} - ${error.message}`;
      results.errors.push(errorMsg);
      console.error(`[kline-batch] Failed:`, errorMsg);
    }
  });

  results.endTime = new Date().toISOString();
  const duration = (new Date(results.endTime) - new Date(results.startTime)) / 1000;
  results.durationSeconds = Math.round(duration);

  console.log(`[kline-batch] Completed ${market} kline batch save`, {
    success: results.success,
    failed: results.failed,
    skipped: results.skipped,
    duration: `${results.durationSeconds}s`,
    errors: results.errors.slice(0, 10)  // 只记录前10个错误
  });

  return results;
}

/**
 * 保存单个股票的K线数据
 * @param {Object} env - Cloudflare Workers 环境变量
 * @param {string} market - 市场标识
 * @param {string} symbol - 股票代码
 * @param {string} interval - 时间周期
 * @param {Object} options - 配置选项
 */
async function saveKlineDataForSymbol(env, market, symbol, interval, options = {}) {
  const { skipExisting = false } = options;

  const { code } = classifySymbol(symbol);
  const r2k = klineKey(market, code, interval);

  // 检查是否已存在且较新
  if (skipExisting) {
    const existing = await r2GetJson(env, r2k);
    if (existing && existing.candles && existing.candles.length > 0) {
      const lastUpdateTime = new Date(existing.generatedAt || 0).getTime();
      const now = Date.now();
      const hoursSinceUpdate = (now - lastUpdateTime) / (1000 * 60 * 60);

      // 如果是日线且12小时内更新过，跳过
      // 如果是分钟线且2小时内更新过，跳过
      const skipThresholdHours = interval === '1d' ? 12 : 2;
      if (hoursSinceUpdate < skipThresholdHours) {
        console.log(`[kline-batch] Skip ${symbol}:${interval} - recently updated ${Math.round(hoursSinceUpdate)}h ago`);
        return;
      }
    }
  }

  // 获取新数据
  let payload;
  if (market === 'us') {
    // 美股使用 Yahoo Finance
    const yahooRange = {
      '1d': '2y',
      '1w': '5y',
      '1mo': '5y',
      '5m': '5d',
      '15m': '1mo',
      '60m': '3mo'
    }[interval] || '2y';

    const yahooInterval = {
      '1d': '1d',
      '1w': '1wk',
      '1mo': '1mo',
      '5m': '5m',
      '15m': '15m',
      '60m': '60m'
    }[interval] || '1d';

    const raw = await fetchYahooChart(code, { range: yahooRange, interval: yahooInterval });
    payload = {
      ...normalizeYahooKline(raw, interval),
      market,
      generatedAt: new Date().toISOString(),
      batchSaved: true
    };
  } else {
    // A股使用雪球
    const limit = interval === '1d' ? 500 : (INTRADAY_KLINE_INTERVALS.has(interval) ? 1000 : 300);
    payload = await fetchCnKlineWithFallback(env, code, interval, { limit });
    payload.batchSaved = true;
    payload.generatedAt = new Date().toISOString();
  }

  // 保存到 R2
  payload = attachKlineHighPoint(payload, { interval, source: 'daily-kline-365d' });
  await r2PutJson(env, r2k, payload);
  await writeKlineHighPointCache(env, { market, symbol: code, interval, highPoint: payload.highPoint });

  console.log(`[kline-batch] Saved ${symbol}:${interval}`, {
    r2Key: r2k,
    candleCount: payload.candles?.length || 0,
    source: payload.source
  });
}

/**
 * 收盘后定时任务入口
 * @param {Object} env - Cloudflare Workers 环境变量
 * @param {string} market - 市场标识 ('us' | 'cn')
 */
export async function runAfterMarketCloseTask(env, market) {
  console.log(`[after-market-close] Running ${market} kline save task`);

  try {
    const results = await saveKlineDataBatch(env, market, {
      concurrency: 5,  // 收盘后可以稍微提高并发
      skipExisting: false  // 收盘后强制更新
    });

    // 记录到 KV 以便查询任务历史
    const historyKey = `kline-batch-history:${market}`;
    const history = await kvGetJson(env, historyKey) || { runs: [] };
    history.runs.unshift({
      timestamp: results.startTime,
      success: results.success,
      failed: results.failed,
      duration: results.durationSeconds,
      errors: results.errors.slice(0, 5)
    });
    // 只保留最近10次记录
    history.runs = history.runs.slice(0, 10);
    await kvPutJson(env, historyKey, history, { ttlSeconds: 7 * 24 * 3600 });

    return results;
  } catch (error) {
    console.error(`[after-market-close] ${market} task failed:`, error);
    throw error;
  }
}
