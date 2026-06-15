/**
 * 量化交易历史数据API
 * 提供ETF历史溢价率、盘口等数据
 */

import { Router } from 'itty-router';
import { corsHeaders, withCors } from './cors.js';
import { verifyAuth } from './auth.js';

const router = Router();

/**
 * GET /api/v1/quant/historical-premiums
 * 查询历史溢价数据
 *
 * 参数：
 * - symbols: 标的代码，逗号分隔，如 "159513,513100"
 * - start: 开始日期 YYYY-MM-DD
 * - end: 结束日期 YYYY-MM-DD
 * - source: 数据源，可选 xueqiu|akshare，默认 xueqiu
 */
router.get('/api/v1/quant/historical-premiums', async (request, env) => {
  try {
    // 认证检查（可选，根据需求决定是否公开）
    const authResult = await verifyAuth(request, env);
    if (!authResult.valid && env.QUANT_REQUIRE_AUTH === 'true') {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(request.url);
    const symbolsParam = url.searchParams.get('symbols');
    const startDate = url.searchParams.get('start');
    const endDate = url.searchParams.get('end');
    const source = url.searchParams.get('source') || 'xueqiu';

    // 参数验证
    if (!symbolsParam || !startDate || !endDate) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: symbols, start, end'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (symbols.length === 0 || symbols.length > 10) {
      return new Response(JSON.stringify({
        error: 'Invalid symbols count (1-10 allowed)'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 日期范围限制（最多查询1年）
    const daysDiff = Math.floor((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
    if (daysDiff < 0 || daysDiff > 365) {
      return new Response(JSON.stringify({
        error: 'Invalid date range (max 365 days)'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 从KV缓存读取
    const cacheKey = `quant:historical:${symbolsParam}:${startDate}:${endDate}:${source}`;
    const cached = await env.KV?.get(cacheKey, 'json');
    if (cached) {
      console.log('Historical data cache hit:', cacheKey);
      return new Response(JSON.stringify(cached), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Cache': 'HIT'
        }
      });
    }

    // 获取历史数据
    const data = await fetchHistoricalData(symbols, startDate, endDate, source, env);

    // 写入KV缓存（TTL 24小时）
    if (env.KV && data.length > 0) {
      await env.KV.put(cacheKey, JSON.stringify(data), {
        expirationTtl: 24 * 60 * 60
      });
    }

    return new Response(JSON.stringify(data), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'X-Cache': 'MISS'
      }
    });

  } catch (error) {
    console.error('Historical data fetch error:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

/**
 * 从雪球获取历史数据
 */
async function fetchFromXueqiu(symbols, startDate, endDate) {
  const results = [];

  // 对于两个标的，需要分别查询然后合并
  const [sellSymbol, buySymbol] = symbols;

  // 查询每日K线和IOPV
  const sellData = await fetchXueqiuKline(sellSymbol, startDate, endDate);
  const buyData = await fetchXueqiuKline(buySymbol, startDate, endDate);

  // 合并数据
  const dateMap = new Map();

  for (const row of sellData) {
    dateMap.set(row.date, {
      date: row.date,
      sell_bid: row.close, // 用收盘价近似
      sell_ask: row.close + 0.001,
      sell_iopv: row.iopv,
      sell_premium_pct: row.iopv > 0 ? ((row.close - row.iopv) / row.iopv * 100) : 0,
      sell_volume: row.volume
    });
  }

  for (const row of buyData) {
    const existing = dateMap.get(row.date);
    if (existing) {
      existing.buy_bid = row.close;
      existing.buy_ask = row.close + 0.001;
      existing.buy_iopv = row.iopv;
      existing.buy_premium_pct = row.iopv > 0 ? ((row.close - row.iopv) / row.iopv * 100) : 0;
      existing.buy_volume = row.volume;
      existing.market_state = 'trading';
    }
  }

  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 查询雪球K线数据
 */
async function fetchXueqiuKline(symbol, startDate, endDate) {
  const url = `https://stock.xueqiu.com/v5/stock/chart/kline.json`;
  const params = new URLSearchParams({
    symbol: symbol.startsWith('1') ? `SH${symbol}` : `SZ${symbol}`,
    begin: new Date(startDate).getTime(),
    end: new Date(endDate).getTime(),
    period: 'day',
    type: 'before',
    count: -1,
    indicator: 'kline,pe,pb,ps,pcf,market_capital,agt,ggt,balance'
  });

  const response = await fetch(`${url}?${params}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Referer': 'https://xueqiu.com/'
    }
  });

  if (!response.ok) {
    throw new Error(`Xueqiu API error: ${response.status}`);
  }

  const json = await response.json();

  if (!json.data || !json.data.item) {
    return [];
  }

  // 解析K线数据
  const items = json.data.item;
  const columns = json.data.column;

  return items.map(item => {
    const obj = {};
    columns.forEach((col, idx) => {
      obj[col] = item[idx];
    });

    return {
      date: new Date(obj.timestamp).toISOString().slice(0, 10),
      open: obj.open,
      high: obj.high,
      low: obj.low,
      close: obj.close,
      volume: obj.volume,
      iopv: obj.nav_base || 0 // IOPV字段
    };
  });
}

/**
 * 主获取函数
 */
async function fetchHistoricalData(symbols, startDate, endDate, source, env) {
  if (source === 'xueqiu') {
    return await fetchFromXueqiu(symbols, startDate, endDate);
  }

  // 其他数据源可以在这里扩展
  throw new Error(`Unsupported data source: ${source}`);
}

/**
 * GET /api/v1/quant/intraday-premium
 * 获取日内分时溢价数据（用于更精细的回测）
 */
router.get('/api/v1/quant/intraday-premium', async (request, env) => {
  // 预留接口，用于获取分钟级数据
  return new Response(JSON.stringify({
    error: 'Not implemented yet'
  }), {
    status: 501,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});

export default router;
