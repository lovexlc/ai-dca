/**
 * 历史数据获取模块
 * 替代原版的纯数学函数生成，使用真实或真实模拟数据
 */

import { roundTo } from './quantTrading.js';

/**
 * 从后端API获取历史溢价数据
 */
export async function fetchHistoricalPremiums(symbols, startDate, endDate, options = {}) {
  const { allowSimulation = true } = options;
  try {
    const params = new URLSearchParams({
      symbols: symbols.join(','),
      start: startDate,
      end: endDate
    });

    const response = await fetch(`/api/v1/quant/historical-premiums?${params}`, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return normalizeHistoricalData(data);
  } catch (error) {
    console.error('Failed to fetch historical premiums:', error);
    if (allowSimulation) {
      // Fallback to realistic simulation for demo/test flows.
      return generateRealisticSimulation(symbols, startDate, endDate);
    }
    throw new Error('历史溢价数据暂不可用，请稍后重试或检查数据接口权限');
  }
}

/**
 * 规范化历史数据格式
 */
function normalizeHistoricalData(rawData) {
  if (!Array.isArray(rawData)) {
    throw new Error('Invalid data format: expected array');
  }

  return rawData.map(row => ({
    date: row.date,
    sellBid: roundTo(row.sell_bid || 0, 3),
    sellAsk: roundTo(row.sell_ask || 0, 3),
    sellIOPV: roundTo(row.sell_iopv || 0, 3),
    sellPremiumPct: roundTo(row.sell_premium_pct || 0, 4),
    buyBid: roundTo(row.buy_bid || 0, 3),
    buyAsk: roundTo(row.buy_ask || 0, 3),
    buyIOPV: roundTo(row.buy_iopv || 0, 3),
    buyPremiumPct: roundTo(row.buy_premium_pct || 0, 4),
    marketState: row.market_state || '',
    volume: row.volume || 0
  }));
}

/**
 * 生成基于真实特征的模拟数据（比纯正弦波更真实）
 *
 * 特征：
 * 1. 跟踪美股隔夜涨跌（早盘跳空）
 * 2. 早盘高溢价，尾盘收敛
 * 3. 偶尔出现极端溢价（±2%）
 * 4. 加入随机噪声
 */
export function generateRealisticSimulation(symbols, startDate, endDate) {
  const [sellSymbol, buySymbol] = symbols;
  const days = daysBetween(startDate, endDate);
  const rows = [];

  // 模拟纳指基准价格走势
  let nasdaqBase = 1.50;

  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const isWeekend = getWeekday(date) >= 6;

    if (isWeekend) {
      // 周末不交易，但记录数据（显示持仓市值）
      rows.push(createWeekendRow(date, nasdaqBase));
      continue;
    }

    // 1. 美股隔夜涨跌（跳空）
    const overnightMove = gaussianRandom(0, 0.015); // 平均±1.5%
    nasdaqBase *= (1 + overnightMove);

    // 2. 早盘情绪溢价
    const morningPremium = Math.abs(overnightMove) > 0.01
      ? overnightMove * 20  // 大涨跌时溢价更高
      : gaussianRandom(0.2, 0.15); // 平均0.2%，标准差0.15%

    // 3. 日内收敛
    const intradayConverge = gaussianRandom(-0.05, 0.03); // 日内平均收敛0.05%

    // 4. 偶尔极端事件
    const extremeEvent = Math.random() < 0.02 // 2%概率
      ? gaussianRandom(0, 1.5)
      : 0;

    // 计算溢价率
    const sellBasePremium = morningPremium + intradayConverge + extremeEvent;
    const buyBasePremium = sellBasePremium * gaussianRandom(0.4, 0.15); // 买入标的溢价通常更低

    const sellPremiumPct = roundTo(
      Math.max(-3, Math.min(3, sellBasePremium)), // 限制在±3%
      4
    );

    const buyPremiumPct = roundTo(
      Math.max(-3, Math.min(3, buyBasePremium)),
      4
    );

    // 根据溢价计算价格
    const sellIOPV = roundTo(nasdaqBase * 1.18, 3); // 159513跟踪的是科技股，略高估值
    const buyIOPV = roundTo(nasdaqBase, 3);

    const sellBid = roundTo(sellIOPV * (1 + sellPremiumPct / 100), 3);
    const sellAsk = roundTo(sellBid + 0.001, 3); // 1tick买卖价差

    const buyBid = roundTo(buyIOPV * (1 + buyPremiumPct / 100), 3);
    const buyAsk = roundTo(buyBid + 0.001, 3);

    rows.push({
      date,
      sellBid,
      sellAsk,
      sellIOPV,
      sellPremiumPct,
      buyBid,
      buyAsk,
      buyIOPV,
      buyPremiumPct,
      marketState: 'trading',
      volume: Math.floor(gaussianRandom(50000000, 20000000))
    });
  }

  return rows;
}

/**
 * 创建周末数据行（不交易）
 */
function createWeekendRow(date, basePrice) {
  return {
    date,
    sellBid: 0,
    sellAsk: 0,
    sellIOPV: roundTo(basePrice * 1.18, 3),
    sellPremiumPct: 0,
    buyBid: 0,
    buyAsk: 0,
    buyIOPV: roundTo(basePrice, 3),
    buyPremiumPct: 0,
    marketState: 'closed',
    volume: 0
  };
}

/**
 * 高斯随机数生成器（Box-Muller变换）
 */
function gaussianRandom(mean = 0, stdDev = 1) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * stdDev;
}

/**
 * 日期工具函数
 */
function daysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getWeekday(dateStr) {
  return new Date(dateStr).getDay(); // 0=Sunday, 6=Saturday
}

/**
 * 从localStorage缓存历史数据
 */
const CACHE_KEY = 'aiDcaQuantHistoricalDataCache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时

export async function getCachedHistoricalData(symbols, startDate, endDate, forceRefresh = false, options = {}) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fetchHistoricalPremiums(symbols, startDate, endDate, options);
  }

  const cacheKey = `${CACHE_KEY}_${symbols.join('_')}_${startDate}_${endDate}`;

  if (!forceRefresh) {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
          return data;
        }
      }
    } catch (error) {
      console.warn('Cache read failed:', error);
    }
  }

  // 获取新数据
  const data = await fetchHistoricalPremiums(symbols, startDate, endDate, options);

  // 写入缓存
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.warn('Cache write failed:', error);
  }

  return data;
}

/**
 * 清除历史数据缓存
 */
export function clearHistoricalDataCache() {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const keys = Object.keys(window.localStorage);
  keys.forEach(key => {
    if (key.startsWith(CACHE_KEY)) {
      window.localStorage.removeItem(key);
    }
  });
}
