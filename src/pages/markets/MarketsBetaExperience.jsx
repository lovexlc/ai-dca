import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sun,
  CloudSun,
  Cloud,
  CloudRain,
  CloudLightning,
  Sparkles,
  Sliders,
  TrendingUp,
  Shuffle,
  X,
  Moon,
  RefreshCw,
  ArrowRight,
  ExternalLink,
  ShieldAlert,
  Flame,
} from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { fetchQuotes } from '../../app/marketsApi.js';
import { resolveVixSignal, VIX_THRESHOLDS } from '../../app/vixSignal.js';
import { detectCurrentMarketSession } from '../../app/tradingSession.js';

// --- 14 只全量纳斯达克 100 ETF 元数据基准 (与 src/app/nasdaqCatalog.js 1:1 对齐) ---
const INITIAL_NASDAQ_ETFS = [
  { code: '513100', name: '国泰纳斯达克100ETF', exchange: '沪市', price: 1.892, baseChange: 2.35, premium: 8.45, iopv: 1.745, vol: 89400, group: 'H' },
  { code: '159941', name: '广发纳斯达克100ETF', exchange: '深市', price: 1.918, baseChange: 1.95, premium: 2.45, iopv: 1.872, vol: 72100, group: 'L' },
  { code: '159632', name: '华安纳斯达克100ETF', exchange: '深市', price: 1.638, baseChange: 1.82, premium: 1.33, iopv: 1.616, vol: 64200, group: 'L' },
  { code: '159509', name: '景顺长城纳斯达克科技ETF', exchange: '深市', price: 2.145, baseChange: 3.15, premium: 7.80, iopv: 1.990, vol: 95300, group: 'H' },
  { code: '513300', name: '华夏纳斯达克100ETF', exchange: '沪市', price: 1.488, baseChange: 1.75, premium: 1.25, iopv: 1.470, vol: 48900, group: 'L' },
  { code: '513390', name: '博时纳斯达克100ETF', exchange: '沪市', price: 1.512, baseChange: 1.68, premium: 1.40, iopv: 1.491, vol: 39500, group: 'L' },
  { code: '159501', name: '嘉实纳斯达克100ETF', exchange: '深市', price: 1.395, baseChange: 2.05, premium: 2.10, iopv: 1.366, vol: 51200, group: 'L' },
  { code: '159696', name: '易方达纳斯达克100ETF', exchange: '深市', price: 1.588, baseChange: 1.88, premium: 1.65, iopv: 1.562, vol: 46800, group: 'L' },
  { code: '513110', name: '华泰柏瑞纳斯达克100ETF', exchange: '沪市', price: 1.425, baseChange: 1.72, premium: 1.15, iopv: 1.409, vol: 31200, group: 'L' },
  { code: '513870', name: '富国纳斯达克100ETF', exchange: '沪市', price: 1.368, baseChange: 1.80, premium: 1.50, iopv: 1.348, vol: 28400, group: 'L' },
  { code: '159660', name: '汇添富纳斯达克100ETF', exchange: '深市', price: 1.450, baseChange: 1.65, premium: 1.20, iopv: 1.433, vol: 24500, group: 'L' },
  { code: '159659', name: '招商纳斯达克100ETF', exchange: '深市', price: 1.382, baseChange: 1.70, premium: 1.35, iopv: 1.364, vol: 21800, group: 'L' },
  { code: '159513', name: '大成纳斯达克100ETF', exchange: '深市', price: 1.410, baseChange: 1.78, premium: 1.45, iopv: 1.390, vol: 26700, group: 'L' },
  { code: '161130', name: '纳斯达克100LOF(易方达)', exchange: '深市LOF', price: 2.855, baseChange: 1.60, premium: 0.85, iopv: 2.831, vol: 18900, group: 'L' }
];

// --- 5 大气象状态定义 ---
const WEATHER_STATES = {
  blazingSun: {
    id: 'blazingSun',
    name: '艳阳高照',
    particleType: 'sunbeams',
    lightGlow: {
      primary: 'radial-gradient(circle, rgba(254, 215, 170, 0.75) 0%, rgba(254, 240, 138, 0.45) 45%, rgba(186, 230, 253, 0.25) 75%, transparent 95%)',
      secondary: 'radial-gradient(circle, rgba(191, 219, 254, 0.65) 0%, rgba(253, 230, 138, 0.35) 60%, transparent 85%)',
      horizon: 'radial-gradient(circle, rgba(254, 202, 202, 0.5) 0%, rgba(254, 243, 199, 0.4) 50%, transparent 85%)',
    },
    darkGlow: {
      primary: 'radial-gradient(circle, rgba(245, 158, 11, 0.45) 0%, rgba(239, 68, 68, 0.25) 50%, transparent 80%)',
      secondary: 'radial-gradient(circle, rgba(251, 146, 60, 0.4) 0%, rgba(217, 70, 239, 0.15) 60%, transparent 80%)',
      horizon: 'radial-gradient(circle, rgba(245, 158, 11, 0.3) 0%, rgba(220, 38, 38, 0.15) 60%, transparent 80%)',
    },
  },
  partlyCloudy: {
    id: 'partlyCloudy',
    name: '多云见晴',
    particleType: 'sunDust',
    lightGlow: {
      primary: 'radial-gradient(circle, rgba(186, 230, 253, 0.75) 0%, rgba(254, 240, 138, 0.45) 50%, transparent 85%)',
      secondary: 'radial-gradient(circle, rgba(224, 231, 255, 0.65) 0%, transparent 80%)',
      horizon: 'radial-gradient(circle, rgba(199, 210, 254, 0.4) 0%, transparent 80%)',
    },
    darkGlow: {
      primary: 'radial-gradient(circle, rgba(251, 191, 36, 0.32) 0%, rgba(99, 102, 241, 0.18) 50%, transparent 80%)',
      secondary: 'radial-gradient(circle, rgba(56, 189, 248, 0.25) 0%, rgba(168, 85, 247, 0.12) 60%, transparent 80%)',
      horizon: 'radial-gradient(circle, rgba(251, 191, 36, 0.2) 0%, transparent 70%)',
    },
  },
  overcast: {
    id: 'overcast',
    name: '多云微阴',
    particleType: 'floatingCloud',
    lightGlow: {
      primary: 'radial-gradient(circle, rgba(203, 213, 225, 0.7) 0%, rgba(226, 232, 240, 0.5) 50%, transparent 80%)',
      secondary: 'radial-gradient(circle, rgba(203, 213, 225, 0.5) 0%, transparent 75%)',
      horizon: 'radial-gradient(circle, rgba(241, 245, 249, 0.8) 0%, transparent 80%)',
    },
    darkGlow: {
      primary: 'radial-gradient(circle, rgba(148, 163, 184, 0.25) 0%, rgba(71, 85, 105, 0.2) 50%, transparent 80%)',
      secondary: 'radial-gradient(circle, rgba(51, 65, 85, 0.3) 0%, transparent 70%)',
      horizon: 'radial-gradient(circle, rgba(30, 41, 59, 0.3) 0%, transparent 80%)',
    },
  },
  rainy: {
    id: 'rainy',
    name: '阴雨霏霏',
    particleType: 'lightRain',
    lightGlow: {
      primary: 'radial-gradient(circle, rgba(147, 197, 253, 0.65) 0%, rgba(203, 213, 225, 0.6) 50%, transparent 85%)',
      secondary: 'radial-gradient(circle, rgba(186, 230, 253, 0.55) 0%, transparent 80%)',
      horizon: 'radial-gradient(circle, rgba(148, 163, 184, 0.4) 0%, transparent 80%)',
    },
    darkGlow: {
      primary: 'radial-gradient(circle, rgba(37, 99, 235, 0.28) 0%, rgba(15, 23, 42, 0.4) 60%, transparent 85%)',
      secondary: 'radial-gradient(circle, rgba(14, 165, 233, 0.22) 0%, transparent 70%)',
      horizon: 'radial-gradient(circle, rgba(2, 132, 199, 0.18) 0%, transparent 80%)',
    },
  },
  storm: {
    id: 'storm',
    name: '雷暴狂风',
    particleType: 'stormHeavyRain',
    lightGlow: {
      primary: 'radial-gradient(circle, rgba(129, 140, 248, 0.6) 0%, rgba(148, 163, 184, 0.65) 55%, transparent 85%)',
      secondary: 'radial-gradient(circle, rgba(165, 180, 252, 0.5) 0%, transparent 80%)',
      horizon: 'radial-gradient(circle, rgba(100, 116, 139, 0.45) 0%, transparent 85%)',
    },
    darkGlow: {
      primary: 'radial-gradient(circle, rgba(79, 70, 229, 0.38) 0%, rgba(15, 23, 42, 0.6) 50%, transparent 85%)',
      secondary: 'radial-gradient(circle, rgba(99, 102, 241, 0.3) 0%, rgba(220, 38, 38, 0.12) 60%, transparent 80%)',
      horizon: 'radial-gradient(circle, rgba(124, 58, 237, 0.25) 0%, transparent 80%)',
    },
  },
};

// --- 交易时段配置 ---
const SESSION_CONFIGS = {
  weekend: {
    name: '周末休市',
    timeDesc: '休市结算 · 历史收盘',
    badge: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
    statusDot: 'bg-slate-400',
    note: '【周末休市】场内交易暂停，外围市场休市。当前展示最新收盘价与估算溢价率，待周一 09:30 恢复实时撮合。',
  },
  trading: {
    name: 'A股盘中',
    timeDesc: '09:30-15:00 · 实时撮合',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    statusDot: 'bg-emerald-500 animate-pulse',
    note: '【A股交易中】14只场内纳指ETF实时交易撮合，秒级行情驱动气象流动。',
  },
  noon: {
    name: 'A股午休',
    timeDesc: '11:30-13:00 · 宁静微风',
    badge: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
    statusDot: 'bg-cyan-500',
    note: '【午间休市】场内行情暂停，环境微风停歇，静待 13:00 下午开盘。',
  },
  closed: {
    name: '收盘晚霞',
    timeDesc: '15:00-21:30 · 暮光晚霞',
    badge: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
    statusDot: 'bg-slate-400',
    note: '【A股收盘结算】日间战报归档，天光沉淀为暮色晚霞，静候美股夜盘。',
  },
  us_night: {
    name: '美股夜盘',
    timeDesc: '21:30-04:00 · QQQ交易',
    badge: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
    statusDot: 'bg-indigo-500 animate-pulse',
    note: '【美股夜盘交易中】QQQ与NDX期货直接联动，星光闪耀夜间看盘。',
  },
};

// 辅助函数：根据代码容错从行情集合中匹配真实行情对象 (兼容 513100, sh513100, sz159509 等不同格式)
export function findQuoteForCode(quotes = {}, code = '') {
  if (!quotes || typeof quotes !== 'object') return null;
  const digits = String(code).replace(/^[a-zA-Z]+/, '');
  return quotes[digits] || quotes[code] || quotes[`sh${digits}`] || quotes[`sz${digits}`] || null;
}

// --- 4 因子多维情绪合成函数 (严格对齐 vixSignal.js 阈值与 CNN Fear & Greed) ---
export function calculateNasdaqCompositeWeather(ndxChange, fg, vix, realUpCount, realDownCount) {
  let upCount = typeof realUpCount === 'number'
    ? realUpCount
    : Math.min(Math.max(Math.round((ndxChange + 4) * 1.5) + 7, 0), 14);
  let downCount = typeof realDownCount === 'number'
    ? realDownCount
    : 14 - upCount;
  const etfNetRatio = (upCount - downCount) / 14;

  let vixDeltaTemp = 0;
  let vixLevel = 'calm';
  let vixLabel = '平静低波';
  let vixTone = 'emerald';

  if (vix >= VIX_THRESHOLDS.heavyBuy) {
    vixLevel = 'heavyBuy';
    vixLabel = '极端恐慌 · 重仓出击';
    vixTone = 'rose';
    vixDeltaTemp = -25 - (vix - 50) * 0.8;
  } else if (vix >= VIX_THRESHOLDS.buyAll) {
    vixLevel = 'buyAll';
    vixLabel = '高恐慌 · 全开加仓';
    vixTone = 'rose';
    vixDeltaTemp = -18 - (vix - 40) * 0.7;
  } else if (vix >= VIX_THRESHOLDS.buyIndex) {
    vixLevel = 'buyIndex';
    vixLabel = '中高恐慌 · 指数定投';
    vixTone = 'amber';
    vixDeltaTemp = -10 - (vix - 30) * 0.8;
  } else if (vix >= VIX_THRESHOLDS.watch) {
    vixLevel = 'watch';
    vixLabel = '警戒备用';
    vixTone = 'yellow';
    vixDeltaTemp = -4 - (vix - 25) * 1.2;
  } else if (vix >= 18) {
    vixLevel = 'calm';
    vixLabel = '平静微澜';
    vixTone = 'emerald';
    vixDeltaTemp = -(vix - 18) * 0.5;
  } else {
    vixLevel = 'calm';
    vixLabel = '极度平静';
    vixTone = 'emerald';
    vixDeltaTemp = (18 - vix) * 0.65;
  }

  let fgLevel = 'neutral';
  let fgLabel = '中性博弈';
  if (fg >= 75) {
    fgLevel = 'extreme_greed';
    fgLabel = '极度贪婪';
  } else if (fg >= 55) {
    fgLevel = 'greed';
    fgLabel = '贪婪做多';
  } else if (fg >= 45) {
    fgLevel = 'neutral';
    fgLabel = '中性博弈';
  } else if (fg >= 25) {
    fgLevel = 'fear';
    fgLabel = '恐慌避险';
  } else {
    fgLevel = 'extreme_fear';
    fgLabel = '极度恐慌';
  }
  const fgDeltaTemp = (fg - 50) * 0.32;
  const ndxDeltaTemp = ndxChange * 5.2;

  const baseTemp = 16.0;
  const compositeTemp = baseTemp + ndxDeltaTemp + fgDeltaTemp + vixDeltaTemp + (etfNetRatio * 4.0);
  const roundedTemp = Math.round(compositeTemp * 10) / 10;
  const tempFormatted = roundedTemp >= 0 ? `+${roundedTemp.toFixed(1)}°C` : `${roundedTemp.toFixed(1)}°C`;

  let weatherObj;
  if (compositeTemp >= 30.0) {
    weatherObj = WEATHER_STATES.blazingSun;
  } else if (compositeTemp >= 18.0) {
    weatherObj = WEATHER_STATES.partlyCloudy;
  } else if (compositeTemp >= 8.0) {
    weatherObj = WEATHER_STATES.overcast;
  } else if (compositeTemp >= -2.0) {
    weatherObj = WEATHER_STATES.rainy;
  } else {
    weatherObj = WEATHER_STATES.storm;
  }

  return {
    compositeTemp: roundedTemp,
    tempFormatted,
    weatherObj,
    upCount,
    downCount,
    vixLevel,
    vixLabel,
    vixTone,
    fgLevel,
    fgLabel,
  };
}

export function MarketsBetaExperience({ onSelectClassic }) {
  const [theme, setTheme] = useState('light');
  const [session, setSession] = useState(detectCurrentMarketSession);
  const [ndxChange, setNdxChange] = useState(0.63);
  const [fearGreed, setFearGreed] = useState(29);
  const [vix, setVix] = useState(14.81);
  const [isSimulated, setIsSimulated] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('markets'); // 'markets' | 'fundSwitch'
  const [controlDrawerOpen, setControlDrawerOpen] = useState(false);
  const [backdropOpacity, setBackdropOpacity] = useState(0.92);
  const [enableParticles, setEnableParticles] = useState(true);
  const [liveQuotes, setLiveQuotes] = useState({});
  const [liveLoading, setLiveLoading] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState('');
  const canvasRef = useRef(null);

  // 1. 尝试拉取线上实时行情 (^VIX, CNN_FNG, QQQ, 14只ETF)
  useEffect(() => {
    let cancelled = false;
    const fetchRealData = async () => {
      setLiveLoading(true);
      try {
        const symbols = ['^VIX', 'CNN_FNG', 'QQQ', ...INITIAL_NASDAQ_ETFS.map((e) => e.code)];
        const quotePayload = await fetchQuotes(symbols).catch(() => null);
        const quoteMap = quotePayload?.quotes || quotePayload || {};
        if (!cancelled && quoteMap && typeof quoteMap === 'object' && Object.keys(quoteMap).length > 0) {
          setLiveQuotes(quoteMap);
          setLastSyncTime(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
          if (!isSimulated) {
            const vixQuote = quoteMap['^VIX'];
            if (vixQuote?.price && Number(vixQuote.price) > 0) {
              setVix(Number(Number(vixQuote.price).toFixed(2)));
            }
            const fngQuote = quoteMap['CNN_FNG'];
            if (fngQuote?.price && Number(fngQuote.price) > 0) {
              setFearGreed(Math.round(Number(fngQuote.price)));
            }
            const qqqQuote = quoteMap['QQQ'];
            if (qqqQuote?.changePercent !== undefined && Number.isFinite(Number(qqqQuote.changePercent))) {
              setNdxChange(Number(Number(qqqQuote.changePercent).toFixed(2)));
            }
            setSession(detectCurrentMarketSession());
          }
        }
      } catch (_err) {
        // Fallback to baseline
      } finally {
        if (!cancelled) setLiveLoading(false);
      }
    };

    fetchRealData();
    const interval = setInterval(fetchRealData, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isSimulated]);

  // 2. 动态计算 14 只纳指 ETF 数据 (真实行情注入与 fallback 兼容)
  const tableData = useMemo(() => {
    return INITIAL_NASDAQ_ETFS.map((item) => {
      const live = findQuoteForCode(liveQuotes, item.code);
      const dynamicPrice = live?.price !== undefined && Number(live.price) > 0
        ? Number(Number(live.price).toFixed(3))
        : Number((item.price * (1 + (isSimulated ? (ndxChange - 0.63) : 0) / 100)).toFixed(3));

      const dynamicChange = live?.changePercent !== undefined && Number.isFinite(Number(live.changePercent))
        ? (isSimulated ? Number((Number(live.changePercent) + (ndxChange - 0.63)).toFixed(2)) : Number(Number(live.changePercent).toFixed(2)))
        : Number((item.baseChange + (ndxChange - 0.63) * 0.85).toFixed(2));

      const dynamicIopv = live?.iopv !== undefined && Number(live.iopv) > 0
        ? Number(Number(live.iopv).toFixed(3))
        : item.iopv;

      const dynamicPremium = live?.premiumPercent !== undefined && Number.isFinite(Number(live.premiumPercent))
        ? Number(Number(live.premiumPercent).toFixed(2))
        : (dynamicPrice > 0 && dynamicIopv > 0
            ? Number(((dynamicPrice / dynamicIopv - 1) * 100).toFixed(2))
            : item.premium);

      const dynamicVol = live?.turnover !== undefined && Number(live.turnover) > 0
        ? Math.round(Number(live.turnover) / 10000)
        : (live?.volume !== undefined && Number(live.volume) > 0
            ? Math.round(Number(live.volume) / 100)
            : item.vol);

      const isUp = dynamicChange >= 0;
      const isHighPremium = dynamicPremium >= 5.0;

      return {
        ...item,
        currentPrice: dynamicPrice,
        currentChange: dynamicChange,
        premium: dynamicPremium,
        iopv: dynamicIopv,
        vol: dynamicVol,
        isUp,
        isHighPremium,
        group: isHighPremium ? 'H' : 'L',
      };
    });
  }, [liveQuotes, ndxChange, isSimulated]);

  // 3. 统计 14 只标的真实涨跌晴雨分布
  const { realUpCount, realDownCount } = useMemo(() => {
    let up = 0;
    let down = 0;
    tableData.forEach((item) => {
      if (item.currentChange >= 0) up++;
      else down++;
    });
    return { realUpCount: up, realDownCount: down };
  }, [tableData]);

  // 4. 多因子气象合成计算 (联动实盘涨跌比)
  const metrics = useMemo(() => {
    return calculateNasdaqCompositeWeather(ndxChange, fearGreed, vix, realUpCount, realDownCount);
  }, [ndxChange, fearGreed, vix, realUpCount, realDownCount]);

  // 5. 动态计算最高溢价端 (H) 与最低平价端 (L) 跑道配对
  const sortedByPremium = useMemo(() => {
    return [...tableData].sort((a, b) => b.premium - a.premium);
  }, [tableData]);

  const topH = sortedByPremium[0] || tableData[0];
  const bottomL = sortedByPremium[sortedByPremium.length - 1] || tableData[tableData.length - 1];
  const realSpread = Number((topH.premium - bottomL.premium).toFixed(2));
  const spreadThreshold = 6.50;
  const isOverThreshold = realSpread >= spreadThreshold;
  const runwayProgress = Math.min(Math.max(Math.round((realSpread / (spreadThreshold * 1.5)) * 100), 12), 95);

  const weather = metrics.weatherObj;
  const currentSessionConfig = SESSION_CONFIGS[session] || SESSION_CONFIGS.weekend;
  const isLight = theme === 'light';

  // 6. 动态叙事生成 (含周末休市与极端恐慌/狂热研判)
  const dynamicCommentary = useMemo(() => {
    if (session === 'weekend') {
      return {
        headline: '周末休市结算 · 纳指全周行情回顾与溢价复盘',
        desc: `场内交易暂停。最新外盘波动率 VIX 读数 ${vix.toFixed(1)} (${metrics.vixLabel})，Fear & Greed 恐慌指数 ${fearGreed} (${metrics.fgLabel})。14 只场内纳指 ETF 维持最新收盘价与估算溢价率，建议周前复盘高低溢价差并预设搬家计划。`,
      };
    }
    if (vix >= 30 || fearGreed <= 25) {
      return {
        headline: '纳指狂风雷暴 · 恐慌出清与金字塔大买点',
        desc: `CBOE VIX 恐慌指数飙升至 ${vix.toFixed(1)} (${metrics.vixLabel})，CNN 恐慌与贪婪指数深跌至 ${fearGreed} (${metrics.fgLabel})。场内 14 只纳指 ETF 出现错杀折价，已触发定投金字塔加码买入档位！`,
      };
    }
    if (vix < 18 && fearGreed >= 70 && ndxChange >= 1.0) {
      return {
        headline: '纳指晴空万里 · 低波动炽热做多盛宴',
        desc: `美股纳指放量上攻，波动率 VIX 仅 ${vix.toFixed(1)} (${metrics.vixLabel})，恐慌与贪婪指数达 ${fearGreed} (${metrics.fgLabel})。14 只场内纳指 ETF 齐升，高低溢价差显著扩大，搬家套利良机凸显。`,
      };
    }
    if (ndxChange < 0 && vix >= 25) {
      return {
        headline: '纳指阵雨微凉 · 波动率上升与防御避险',
        desc: `外围震荡加剧，VIX 触及 ${vix.toFixed(1)} (${metrics.vixLabel})，市场情绪降温至 ${fearGreed} (${metrics.fgLabel})。14 只纳指 ETF 呈结构性分化，建议锁定高溢价收益并向平价端迁移。`,
      };
    }
    return {
      headline: '纳指多云博弈 · 窄幅震荡静待催化',
      desc: `大盘在平衡线附近整理，VIX 读数 ${vix.toFixed(1)} (${metrics.vixLabel})，Fear & Greed 指数 ${fearGreed} (${metrics.fgLabel})。各纳指标的折溢价适中，适合排查搬家套利收益。`,
    };
  }, [session, vix, fearGreed, ndxChange, metrics.vixLabel, metrics.fgLabel]);

  // 一键重置为线上实盘数据与当前自然时段
  const handleResetLive = () => {
    setIsSimulated(false);
    setSession(detectCurrentMarketSession());
    const vixQuote = liveQuotes['^VIX'];
    if (vixQuote?.price && Number(vixQuote.price) > 0) {
      setVix(Number(Number(vixQuote.price).toFixed(2)));
    }
    const fngQuote = liveQuotes['CNN_FNG'];
    if (fngQuote?.price && Number(fngQuote.price) > 0) {
      setFearGreed(Math.round(Number(fngQuote.price)));
    }
    const qqqQuote = liveQuotes['QQQ'];
    if (qqqQuote?.changePercent !== undefined && Number.isFinite(Number(qqqQuote.changePercent))) {
      setNdxChange(Number(Number(qqqQuote.changePercent).toFixed(2)));
    }
  };

  const changeSign = ndxChange >= 0 ? `+${ndxChange.toFixed(2)}%` : `${ndxChange.toFixed(2)}%`;
  const glowSet = isLight ? weather.lightGlow : weather.darkGlow;

  // 7. Canvas 粒子动画引擎
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const particles = [];
    const count = 38;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        length: Math.random() * 20 + 10,
        speedY: Math.random() * 7 + 3,
        speedX: (Math.random() - 0.5) * 1.5,
        radius: Math.random() * 2.5 + 1,
        opacity: Math.random() * 0.4 + 0.15,
        angle: Math.random() * Math.PI * 2,
      });
    }

    const render = () => {
      if (!enableParticles) {
        ctx.clearRect(0, 0, width, height);
        animationFrameId = requestAnimationFrame(render);
        return;
      }
      ctx.clearRect(0, 0, width, height);
      const mode = weather.particleType;

      if (mode === 'lightRain' || mode === 'stormHeavyRain') {
        const isStorm = mode === 'stormHeavyRain';
        ctx.strokeStyle = isLight
          ? (isStorm ? 'rgba(79, 70, 229, 0.45)' : 'rgba(59, 130, 246, 0.35)')
          : (isStorm ? 'rgba(199, 210, 254, 0.45)' : 'rgba(186, 230, 253, 0.35)');
        ctx.lineWidth = isStorm ? 1.5 : 1;

        particles.forEach((p) => {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - 2, p.y + (isStorm ? p.length * 1.8 : p.length));
          ctx.stroke();

          p.y += isStorm ? p.speedY * 2 : p.speedY * 1.2;
          p.x -= isStorm ? 1.5 : 0.7;

          if (p.y > height) {
            p.y = -20;
            p.x = Math.random() * width;
          }
        });
      } else if (mode === 'sunbeams' || mode === 'sunDust') {
        particles.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 1.4, 0, Math.PI * 2);
          ctx.fillStyle = isLight
            ? (mode === 'sunbeams' ? `rgba(245, 158, 11, ${p.opacity * 0.55})` : `rgba(217, 119, 6, ${p.opacity * 0.4})`)
            : (mode === 'sunbeams' ? `rgba(251, 191, 36, ${p.opacity * 0.7})` : `rgba(253, 224, 71, ${p.opacity * 0.5})`);
          ctx.fill();

          p.y -= 0.35;
          p.x += Math.sin(p.angle) * 0.35;
          p.angle += 0.02;

          if (p.y < -10) {
            p.y = height + 10;
            p.x = Math.random() * width;
          }
        });
      } else {
        particles.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = isLight ? `rgba(100, 116, 139, ${p.opacity * 0.25})` : `rgba(148, 163, 184, ${p.opacity * 0.3})`;
          ctx.fill();

          p.x += 0.2;
          if (p.x > width + 10) p.x = -10;
        });
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [weather.particleType, enableParticles, isLight]);

  // 快速情景预设
  const applyPreset = (rate, fgVal, vixVal) => {
    setNdxChange(rate);
    setFearGreed(fgVal);
    setVix(vixVal);
    setIsSimulated(true);
  };

  return (
    <div className={cx('markets-beta-container relative min-h-screen rounded-2xl overflow-hidden transition-colors duration-300 font-sans', isLight ? 'bg-slate-50/70 text-slate-900' : 'bg-slate-950 text-slate-100 dark')}>
      {/* 1. 全局纳指天气背景层 */}
      <div className="fixed inset-0 pointer-events-none transition-opacity duration-700 ease-out z-0 overflow-hidden" style={{ opacity: backdropOpacity }}>
        <div className="absolute -top-[15%] left-[10vw] w-[80vw] h-[80vw] rounded-full blur-[140px] transition-all duration-1000 animate-pulse" style={{ background: glowSet.primary }} />
        <div className="absolute top-[35%] -right-[10vw] w-[70vw] h-[70vw] rounded-full blur-[160px] transition-all duration-1000" style={{ background: glowSet.secondary }} />
        <div className="absolute -bottom-[20%] left-[20vw] w-[65vw] h-[55vw] rounded-full blur-[170px] transition-all duration-1000" style={{ background: glowSet.horizon }} />
        {weather.id === 'storm' && (
          <div className="absolute inset-0 bg-indigo-200/50 mix-blend-screen animate-pulse pointer-events-none" />
        )}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      </div>

      {/* 2. 顶栏 HUD 胶囊卡片与功能区 */}
      <header className="relative z-20 sticky top-0 h-14 px-4 lg:px-6 flex items-center justify-between backdrop-blur-md bg-white/75 dark:bg-slate-900/75 border-b border-slate-200/80 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-amber-500 flex items-center justify-center text-white font-black text-xs shadow-xs">
            NDX
          </div>
          <div>
            <h1 className="font-bold text-sm sm:text-base tracking-tight flex items-center gap-2">
              <span>纳指行情中心 (新版Beta)</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold border border-indigo-500/20">
                14只纳指标的全监控
              </span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* 切明暗 */}
          <button
            type="button"
            onClick={() => setTheme(isLight ? 'dark' : 'light')}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 text-xs font-semibold shadow-xs hover:scale-105 transition-all cursor-pointer"
          >
            <span>{isLight ? '🌙 切深色' : '☀️ 切浅色'}</span>
          </button>

          {/* 气象站 HUD 胶囊 */}
          <div
            onClick={() => setControlDrawerOpen((v) => !v)}
            className="flex items-center gap-2 sm:gap-2.5 px-3 py-1.5 rounded-full border border-slate-300/80 dark:border-slate-700 bg-white/85 dark:bg-slate-900/85 transition-all cursor-pointer shadow-xs hover:scale-[1.02]"
            title="点击展开气象控制台"
          >
            <div className="w-5 h-5 flex items-center justify-center shrink-0">
              {weather.id === 'blazingSun' && <Sun size={18} className="text-amber-500 animate-spin" />}
              {weather.id === 'partlyCloudy' && <CloudSun size={18} className="text-amber-500" />}
              {weather.id === 'overcast' && <Cloud size={18} className="text-slate-400" />}
              {weather.id === 'rainy' && <CloudRain size={18} className="text-sky-500" />}
              {weather.id === 'storm' && <CloudLightning size={18} className="text-indigo-500 animate-pulse" />}
            </div>

            <div className="flex flex-col text-left">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs">{weather.name}</span>
                <span className={cx('text-[10px] sm:text-[11px] font-mono px-1.5 py-0.2 rounded font-black', metrics.compositeTemp >= 0 ? 'text-rose-500 bg-rose-500/10' : 'text-emerald-500 bg-emerald-500/10')}>
                  {metrics.tempFormatted}
                </span>
                <span className={cx('hidden md:inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold', vix >= 30 ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30' : vix >= 25 ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border border-yellow-500/30' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20')}>
                  <span>VIX</span>
                  <b>{vix.toFixed(1)}</b>
                </span>
                <span className={cx('hidden lg:inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold', fearGreed >= 75 ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20' : fearGreed >= 55 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20')}>
                  <span>F&G</span>
                  <b>{fearGreed}</b>
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                <span className={cx('inline-block w-1.5 h-1.5 rounded-full', currentSessionConfig.statusDot)} />
                <span className="hidden sm:inline font-mono">{currentSessionConfig.name} · {currentSessionConfig.timeDesc.split(' · ')[0]}</span>
                {isSimulated ? (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">模拟</span>
                ) : (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold">实盘</span>
                )}
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <span className="hidden sm:inline text-slate-500">纳指</span>
                <span className={cx('font-mono font-bold', ndxChange >= 0 ? 'text-rose-500' : 'text-emerald-500')}>{changeSign}</span>
              </div>
            </div>

            <Sliders size={14} className="text-slate-400 ml-1 hidden sm:block" />
          </div>

          {/* 若处于模拟状态，提供快捷恢复实盘按钮 */}
          {isSimulated && (
            <button
              type="button"
              onClick={handleResetLive}
              title="点击恢复最新实盘数据"
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold transition cursor-pointer"
            >
              <RefreshCw size={12} />
              <span>恢复实盘</span>
            </button>
          )}

          {/* 切换模拟控制台按钮 */}
          <button
            type="button"
            onClick={() => setControlDrawerOpen((v) => !v)}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition cursor-pointer"
          >
            <Sliders size={13} />
            <span className="hidden sm:inline">情景模拟</span>
          </button>
        </div>
      </header>

      {/* 3. 核心视图区 */}
      <main className="relative z-10 p-3 sm:p-5 lg:p-6 space-y-5 max-w-7xl mx-auto">
        {/* 今日纳指气象快报 Banner (四因子量化情绪矩阵) */}
        <section className="backdrop-blur-md bg-white/80 dark:bg-slate-900/80 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden transition-all duration-700">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 relative z-10">
            <div className="flex items-start sm:items-center gap-3.5 flex-1 min-w-0 pr-2">
              <div className={cx('w-13 h-13 sm:w-15 sm:h-15 rounded-2xl flex items-center justify-center shrink-0 border shadow-xs', weather.id === 'blazingSun' ? 'bg-amber-500/15 border-amber-500/30 text-amber-500' : weather.id === 'storm' ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-500' : 'bg-slate-200/60 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700')}>
                {weather.id === 'blazingSun' && <Sun size={32} className="animate-spin" />}
                {weather.id === 'partlyCloudy' && <CloudSun size={32} />}
                {weather.id === 'overcast' && <Cloud size={32} />}
                {weather.id === 'rainy' && <CloudRain size={32} />}
                {weather.id === 'storm' && <CloudLightning size={32} className="animate-pulse" />}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white">
                    {dynamicCommentary.headline}
                  </span>
                  <span className={cx('text-xs px-2.5 py-0.5 rounded-full font-bold border', currentSessionConfig.badge)}>
                    {currentSessionConfig.name} · {currentSessionConfig.timeDesc}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                  {dynamicCommentary.desc} {currentSessionConfig.note}
                </p>
              </div>
            </div>

            {/* 4 因子量化情绪矩阵 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 bg-slate-100/80 dark:bg-slate-800/70 p-3 sm:p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/80 shrink-0">
              <div className="text-center px-1">
                <div className="text-[10px] text-slate-500 font-medium">体感温标</div>
                <div className={cx('text-base sm:text-lg font-mono font-black mt-0.5', metrics.compositeTemp >= 0 ? 'text-rose-500' : 'text-emerald-500')}>
                  {metrics.tempFormatted}
                </div>
                <div className={cx('text-[10px] font-bold', metrics.compositeTemp >= 0 ? 'text-rose-500' : 'text-emerald-500')}>
                  {metrics.compositeTemp >= 30 ? '极度过热' : metrics.compositeTemp >= 18 ? '温和做多' : metrics.compositeTemp >= 8 ? '中性博弈' : metrics.compositeTemp >= -2 ? '偏冷微寒' : '极度严寒'}
                </div>
              </div>

              <div className="text-center px-1 border-l border-slate-200 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 font-medium">Fear & Greed</div>
                <div className={cx('text-base sm:text-lg font-mono font-black mt-0.5', fearGreed >= 75 ? 'text-rose-500' : fearGreed >= 55 ? 'text-amber-500' : fearGreed >= 45 ? 'text-slate-600 dark:text-slate-300' : 'text-sky-500')}>
                  {fearGreed}
                </div>
                <div className={cx('text-[10px] font-bold', fearGreed >= 75 ? 'text-rose-500' : fearGreed >= 55 ? 'text-amber-500' : 'text-slate-500')}>
                  {metrics.fgLabel}
                </div>
              </div>

              <div className="text-center px-1 border-l sm:border-l border-slate-200 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 font-medium">VIX 波动率</div>
                <div className={cx('text-base sm:text-lg font-mono font-black mt-0.5', vix >= 30 ? 'text-rose-500' : vix >= 25 ? 'text-yellow-600 dark:text-yellow-400' : 'text-emerald-500')}>
                  {vix.toFixed(1)}
                </div>
                <div className={cx('text-[10px] font-bold', vix >= 30 ? 'text-rose-500' : vix >= 25 ? 'text-yellow-600 dark:text-yellow-400' : 'text-emerald-500')}>
                  {metrics.vixLabel}
                </div>
              </div>

              <div className="text-center px-1 border-l border-slate-200 dark:border-slate-700">
                <div className="text-[10px] text-slate-500 font-medium">14只纳指晴雨比</div>
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <span className="text-xs font-bold text-rose-500">{metrics.upCount} 晴</span>
                  <div className="w-10 sm:w-12 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden flex">
                    <div className="h-full bg-rose-500 rounded-full transition-all duration-500" style={{ width: `${Math.round((metrics.upCount / 14) * 100)}%` }} />
                  </div>
                  <span className="text-xs font-bold text-emerald-500">{metrics.downCount} 雨</span>
                </div>
                <div className="text-[9px] text-slate-400 mt-0.5">
                  {metrics.upCount >= 10 ? '流动性充裕' : metrics.upCount >= 6 ? '分化轮动中' : '避险防守'}
                </div>
              </div>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-500" />
        </section>

        {/* 内部 Tab 切换 (【行情中心 (14只纳指全监控)】 vs 【基金切换 / 搬家跑道】) */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveSubTab('markets')}
              className={cx(
                'px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer flex items-center gap-1.5',
                activeSubTab === 'markets'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900'
              )}
            >
              <TrendingUp size={14} />
              <span>纳指 100 标的监控 (14)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('fundSwitch')}
              className={cx(
                'px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer flex items-center gap-1.5',
                activeSubTab === 'fundSwitch'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900'
              )}
            >
              <Shuffle size={14} />
              <span>基金搬家策略跑道 (方案 A-1)</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            {liveLoading && <RefreshCw size={12} className="animate-spin text-indigo-500" />}
            <span className="hidden sm:inline">行情实时推演</span>
          </div>
        </div>

        {/* 子视图 1: 纳指 100 场内全集大表格 (双向粘性冻结) */}
        {activeSubTab === 'markets' && (
          <div className="backdrop-blur-md bg-white/80 dark:bg-slate-900/80 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
            <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60 dark:bg-slate-800/40">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-3 py-1 rounded-lg bg-indigo-600 text-white shadow-2xs">纳指 100 场内全集 (14)</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-lg text-slate-500">高溢价端 (H) 与 平价端 (L) 联动</span>
              </div>
              <div className="text-[11px] text-slate-400">
                表头垂直下拉锁定 + 左侧代码/价格双列横拉锁定
              </div>
            </div>

            {/* 电脑端双向冻结表 */}
            <div className="hidden md:block relative max-h-[460px] overflow-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-30 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="sticky left-0 z-40 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur px-4 py-3.5 w-48 border-r border-slate-200 dark:border-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                      纳指标的名称 / 代码
                    </th>
                    <th className="sticky left-48 z-40 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur px-4 py-3.5 w-28 text-right border-r border-slate-200 dark:border-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                      最新成交价
                    </th>
                    <th className="px-4 py-3.5 text-right w-28">当日涨跌幅</th>
                    <th className="px-4 py-3.5 text-right w-28">实时溢价率</th>
                    <th className="px-4 py-3.5 text-right w-28">溢价分组</th>
                    <th className="px-4 py-3.5 text-right w-32">预估净值 (IOPV)</th>
                    <th className="px-4 py-3.5 text-right w-32">成交额 (万元)</th>
                    <th className="px-4 py-3.5 text-right w-36">套利搬家建议</th>
                    <th className="px-4 py-3.5 text-center w-24">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono text-slate-800 dark:text-slate-200">
                  {tableData.map((item, idx) => {
                    const rowBg = idx % 2 === 0
                      ? (isLight ? 'bg-white/60' : 'bg-slate-900/40')
                      : (isLight ? 'bg-slate-50/40' : 'bg-slate-900/10');
                    return (
                      <tr key={item.code} className={cx(rowBg, 'hover:bg-indigo-50/70 dark:hover:bg-indigo-950/30 transition')}>
                        <td className={cx('sticky left-0 z-20 backdrop-blur px-4 py-3.5 border-r border-slate-200 dark:border-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.05)]', rowBg)}>
                          <div className="font-bold text-slate-900 dark:text-white text-xs">{item.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{item.code} · {item.exchange}</div>
                        </td>
                        <td className={cx('sticky left-48 z-20 backdrop-blur px-4 py-3.5 text-right font-black text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-800 shadow-[2px_0_5px_rgba(0,0,0,0.05)]', rowBg)}>
                          {item.currentPrice.toFixed(3)}
                        </td>
                        <td className={cx('px-4 py-3.5 text-right font-black', item.isUp ? 'text-rose-500' : 'text-emerald-500')}>
                          {item.isUp ? `+${item.currentChange.toFixed(2)}%` : `${item.currentChange.toFixed(2)}%`}
                        </td>
                        <td className={cx('px-4 py-3.5 text-right font-bold', item.premium >= 3 ? 'text-amber-500' : 'text-slate-700 dark:text-slate-300')}>
                          +{item.premium.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className={cx('inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold', item.isHighPremium ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30' : 'bg-slate-200/60 dark:bg-slate-800 text-slate-500')}>
                            {item.isHighPremium ? 'H (高溢价)' : 'L (平价)'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-400 font-mono">{item.iopv.toFixed(3)}</td>
                        <td className="px-4 py-3.5 text-right text-slate-700 dark:text-slate-300 font-mono">{item.vol.toLocaleString()}</td>
                        <td className="px-4 py-3.5 text-right font-sans text-[11px]">
                          <span className={cx('px-2 py-0.5 rounded font-bold', item.isHighPremium ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20')}>
                            {item.isHighPremium ? '卖出高溢价' : '平价买入端'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <button
                            type="button"
                            onClick={() => setActiveSubTab('fundSwitch')}
                            className="text-indigo-600 dark:text-indigo-400 hover:underline font-bold text-[11px] cursor-pointer"
                          >
                            搬家对比
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 移动端卡片流 */}
            <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800">
              {tableData.map((item) => (
                <div key={item.code} className="p-3.5 space-y-2 hover:bg-slate-100/50 dark:hover:bg-slate-800/30 transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-xs text-slate-900 dark:text-white">{item.name}</span>
                      <span className="text-[11px] text-slate-400 ml-1 font-mono">{item.code}</span>
                    </div>
                    <span className={cx('font-mono text-xs font-black', item.isUp ? 'text-rose-500' : 'text-emerald-500')}>
                      {item.isUp ? `+${item.currentChange.toFixed(2)}%` : `${item.currentChange.toFixed(2)}%`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 font-mono">
                    <span>现价: <b>{item.currentPrice.toFixed(3)}</b></span>
                    <span>实时溢价: <b className={item.premium >= 3 ? 'text-amber-500 font-bold' : ''}>+{item.premium.toFixed(2)}%</b></span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-800 text-[11px]">
                    <span className="text-slate-400">{item.exchange} · IOPV {item.iopv.toFixed(3)}</span>
                    <span className={cx('font-bold', item.isHighPremium ? 'text-rose-500' : 'text-emerald-500')}>
                      {item.isHighPremium ? '卖出高溢价' : '平价买入端'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 子视图 2: 基金切换 / 搬家跑道 (方案 A-1 增强跑道) */}
        {activeSubTab === 'fundSwitch' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="backdrop-blur-md bg-white/80 dark:bg-slate-900/80 rounded-xl p-3.5 border-l-4 border-l-indigo-500 border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="text-[11px] text-slate-500">监控策略标的</div>
                <div className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-0.5">14 只纳指标的联动</div>
                <div className="text-[10px] text-slate-400 mt-1">全集动态扫描 H / L 极值配对</div>
              </div>
              <div className="backdrop-blur-md bg-white/80 dark:bg-slate-900/80 rounded-xl p-3.5 border-l-4 border-l-rose-500 border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="text-[11px] text-slate-500">最高利差机会 (H - L)</div>
                <div className="text-xl font-bold font-mono text-rose-500 mt-0.5">+{realSpread.toFixed(2)}%</div>
                <div className={cx('text-[10px] mt-1 font-semibold', isOverThreshold ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400')}>
                  {isOverThreshold ? '已越过门槛 · 建议搬家' : '价差平缓 · 监控中'}
                </div>
              </div>
              <div className="backdrop-blur-md bg-white/80 dark:bg-slate-900/80 rounded-xl p-3.5 border-l-4 border-l-emerald-500 border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="text-[11px] text-slate-500">累计套利搬家增强收益</div>
                <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">+14.35%</div>
                <div className="text-[10px] text-slate-400 mt-1">历史胜率 92.5% · 规则 #QDII-01</div>
              </div>
            </div>

            {/* 方案 A-1 增强跑道卡片 */}
            <div className="backdrop-blur-md bg-white/80 dark:bg-slate-900/80 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                    {topH.name} ⇋ {bottomL.name} 溢价差套利
                  </h3>
                  <span className={cx('text-[10px] px-2 py-0.5 rounded font-bold border', isOverThreshold ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20')}>
                    {isOverThreshold ? '利差走阔 · 冲向终点' : '利差蓄势 · 监控中'}
                  </span>
                </div>
                <span className="text-xs text-slate-400 font-mono">规则 #QDII-01</span>
              </div>

              {/* H / L 标的信息 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                <div className="bg-rose-50/60 dark:bg-rose-950/20 p-3 rounded-xl border border-rose-200/80 dark:border-rose-900/40">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-rose-700 dark:text-rose-300 font-bold">高溢价端 (H)</span>
                    <span className="font-mono text-rose-600 font-bold">溢价 +{topH.premium.toFixed(2)}%</span>
                  </div>
                  <div className="font-bold text-sm text-slate-900 dark:text-white mt-1">{topH.code} {topH.name}</div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">最新价: {topH.currentPrice.toFixed(3)} · IOPV: {topH.iopv.toFixed(3)}</div>
                </div>

                <div className="bg-emerald-50/60 dark:bg-emerald-950/20 p-3 rounded-xl border border-emerald-200/80 dark:border-emerald-900/40">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-emerald-700 dark:text-emerald-300 font-bold">平价端 (L)</span>
                    <span className="font-mono text-emerald-600 font-bold">溢价 +{bottomL.premium.toFixed(2)}%</span>
                  </div>
                  <div className="font-bold text-sm text-slate-900 dark:text-white mt-1">{bottomL.code} {bottomL.name}</div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">最新价: {bottomL.currentPrice.toFixed(3)} · IOPV: {bottomL.iopv.toFixed(3)}</div>
                </div>
              </div>

              {/* 跑道：小人在上方，胶囊在下方 */}
              <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 space-y-2">
                <div className="flex justify-between items-center text-xs font-semibold">
                  <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <span>溢价差监控</span>
                    <span className="font-mono text-slate-400">门槛: {spreadThreshold.toFixed(2)}%</span>
                  </span>
                  <span className={cx('font-bold', isOverThreshold ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300')}>
                    当前实时价差: {realSpread.toFixed(2)}% {isOverThreshold ? '🚀' : '👀'}
                  </span>
                </div>

                <div className="relative pt-7 pb-8 px-4">
                  <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full relative overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 rounded-full transition-all duration-500" style={{ width: `${runwayProgress}%` }} />
                  </div>

                  <div className="absolute top-1 -translate-x-1/2 flex flex-col items-center pointer-events-none transition-all duration-500" style={{ left: `${runwayProgress}%` }}>
                    <span className="text-lg leading-none animate-bounce">🏃</span>
                  </div>

                  <div className="absolute top-11 -translate-x-1/2 flex flex-col items-center transition-all duration-500" style={{ left: `${runwayProgress}%` }}>
                    <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[10px] font-mono font-black shadow-xs whitespace-nowrap">
                      当前: {realSpread.toFixed(2)}%
                    </span>
                  </div>

                  <div className="absolute right-3 top-1 flex flex-col items-center">
                    <span className="text-lg leading-none">🏁</span>
                  </div>
                  <div className="absolute right-3 top-11 flex flex-col items-center">
                    <span className="text-[10px] font-mono text-slate-400 font-bold whitespace-nowrap">{spreadThreshold.toFixed(2)}%</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pt-2 text-[11px] text-slate-500 border-t border-slate-200/80 dark:border-slate-700/60">
                  <span>
                    提示: 当前价差 ({realSpread.toFixed(2)}%) {isOverThreshold ? `已越过目标阈值 (${spreadThreshold.toFixed(2)}%)，建议将高溢价端 ${topH.code} 卖出并切换为 ${bottomL.code} 锁定利差。` : `尚未达到目标阈值 (${spreadThreshold.toFixed(2)}%)，保持观望或继续持有平价端。`}
                  </span>
                  <button type="button" className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-xs cursor-pointer shrink-0">
                    一键生成搬家计划
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 4. 浮动展开按钮 (抽屉收起时显示) */}
      {!controlDrawerOpen && (
        <button
          type="button"
          onClick={() => setControlDrawerOpen(true)}
          className="fixed bottom-4 right-4 z-40 px-4 py-2.5 rounded-full backdrop-blur-md bg-white/90 dark:bg-slate-900/90 shadow-xl border border-indigo-500/40 text-xs font-bold flex items-center gap-2 hover:scale-105 active:scale-95 transition-all cursor-pointer"
        >
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
          <span>🎛️ 纳指气象控制台</span>
        </button>
      )}

      {/* 5. 气象控制台抽屉 (支持无级调节 NDX + Fear&Greed + VIX) */}
      {controlDrawerOpen && (
        <aside className="fixed bottom-4 right-4 z-50 w-[94vw] sm:w-[420px] max-h-[85vh] overflow-y-auto backdrop-blur-md bg-white/95 dark:bg-slate-900/95 rounded-2xl p-5 shadow-2xl border border-indigo-500/30 transition-all">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">纳指气象与时段控制台</h3>
            </div>
            <button
              type="button"
              onClick={() => setControlDrawerOpen(false)}
              className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1 rounded-lg transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4 text-xs">
            {/* 实盘 vs 模拟状态看板 */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <span className={cx('w-2.5 h-2.5 rounded-full', isSimulated ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500')} />
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">
                    {isSimulated ? '当前处于自定义情景模拟' : '实盘行情动态联动中'}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {isSimulated ? '已覆写实盘基准，可自由推演' : `最新同步: ${lastSyncTime || '已就绪'}`}
                  </div>
                </div>
              </div>

              {isSimulated && (
                <button
                  type="button"
                  onClick={handleResetLive}
                  className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] shadow-xs cursor-pointer flex items-center gap-1.5 transition"
                >
                  <RefreshCw size={11} />
                  <span>恢复实盘</span>
                </button>
              )}
            </div>

            {/* 模式 */}
            <div className="p-2.5 rounded-xl bg-slate-100/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-2">0. 全局明暗主题 (Theme Mode)</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  className={cx('px-3 py-2 rounded-lg text-xs font-bold border flex items-center justify-center gap-2 transition cursor-pointer', isLight ? 'bg-amber-500 text-white border-amber-500 shadow-xs' : 'bg-transparent text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700')}
                >
                  <span>☀️ 浅色日间看盘</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('dark')}
                  className={cx('px-3 py-2 rounded-lg text-xs font-bold border flex items-center justify-center gap-2 transition cursor-pointer', !isLight ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs' : 'bg-transparent text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700')}
                >
                  <span>🌙 深色夜间看盘</span>
                </button>
              </div>
            </div>

            {/* 时段 */}
            <div>
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-2">1. 交易时段与日光模拟 (Trading Session)</label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(SESSION_CONFIGS).map(([key, item]) => {
                  const active = session === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSession(key);
                        setIsSimulated(true);
                      }}
                      className={cx(
                        'px-3 py-2 rounded-xl text-left border transition flex items-center gap-2 cursor-pointer',
                        active
                          ? 'bg-indigo-600/15 border-indigo-500 text-indigo-700 dark:text-indigo-300 font-bold'
                          : 'bg-slate-100/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      )}
                    >
                      <div>
                        <div className="font-bold">{item.name}</div>
                        <div className="text-[10px] text-slate-400">{item.timeDesc.split(' · ')[0]}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3 无级调节滑块 */}
            <div className="p-3 rounded-xl bg-slate-100/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
              <label className="block font-bold text-slate-800 dark:text-slate-200">2. 核心量化因子调节 (Quantitative Factors)</label>

              {/* NDX */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">1) 纳指日涨跌幅 (NDX Rate):</span>
                  <span className={cx('font-mono text-xs font-black', ndxChange >= 0 ? 'text-rose-500' : 'text-emerald-500')}>
                    {changeSign}
                  </span>
                </div>
                <input
                  type="range"
                  min="-5"
                  max="5"
                  step="0.05"
                  value={ndxChange}
                  onChange={(e) => {
                    setNdxChange(parseFloat(e.target.value));
                    setIsSimulated(true);
                  }}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                  <span>-5.0% 暴跌</span>
                  <span>0.0% 平盘</span>
                  <span>+5.0% 暴涨</span>
                </div>
              </div>

              {/* Fear & Greed */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">2) Fear & Greed 情绪指数:</span>
                  <span className={cx('font-mono text-xs font-black', fearGreed >= 75 ? 'text-rose-500' : fearGreed >= 55 ? 'text-amber-500' : 'text-slate-600 dark:text-slate-300')}>
                    {fearGreed} ({metrics.fgLabel})
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={fearGreed}
                  onChange={(e) => {
                    setFearGreed(parseInt(e.target.value, 10));
                    setIsSimulated(true);
                  }}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                  <span>0 极度恐惧</span>
                  <span>50 中性</span>
                  <span>100 极度贪婪</span>
                </div>
              </div>

              {/* VIX */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">3) CBOE VIX 恐慌指数:</span>
                  <span className={cx('font-mono text-xs font-black', vix >= 30 ? 'text-rose-500' : vix >= 25 ? 'text-yellow-600' : 'text-emerald-500')}>
                    {vix.toFixed(1)} ({metrics.vixLabel})
                  </span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="60"
                  step="0.5"
                  value={vix}
                  onChange={(e) => {
                    setVix(parseFloat(e.target.value));
                    setIsSimulated(true);
                  }}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-600"
                />
                <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                  <span>10 平静</span>
                  <span>25 警戒</span>
                  <span>30 买指数</span>
                  <span>40 全开</span>
                  <span>50+ 极端恐慌</span>
                </div>
              </div>
            </div>

            {/* 快速预设 */}
            <div>
              <label className="block font-bold text-slate-800 dark:text-slate-200 mb-2">3. 快速预设典型综合情景</label>
              <div className="grid grid-cols-5 gap-1.5 text-center">
                <button
                  type="button"
                  onClick={() => applyPreset(3.2, 88, 13.5)}
                  className="p-2 rounded-xl bg-slate-100/70 dark:bg-slate-800/60 hover:bg-rose-500/10 border border-slate-200 dark:border-slate-700 hover:border-rose-500/50 transition cursor-pointer"
                >
                  <div className="text-base">☀️</div>
                  <div className="font-bold text-[10px] text-rose-500 mt-0.5">大牛狂热</div>
                  <div className="text-[9px] text-slate-400">V13.5·F88</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyPreset(0.85, 68, 16.0)}
                  className="p-2 rounded-xl bg-slate-100/70 dark:bg-slate-800/60 hover:bg-amber-500/10 border border-slate-200 dark:border-slate-700 hover:border-amber-500/50 transition cursor-pointer"
                >
                  <div className="text-base">⛅</div>
                  <div className="font-bold text-[10px] text-amber-500 mt-0.5">温和稳进</div>
                  <div className="text-[9px] text-slate-400">V16.0·F68</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyPreset(0.0, 50, 18.0)}
                  className="p-2 rounded-xl bg-slate-100/70 dark:bg-slate-800/60 hover:bg-slate-400/10 border border-slate-200 dark:border-slate-700 hover:border-slate-400 transition cursor-pointer"
                >
                  <div className="text-base">☁️</div>
                  <div className="font-bold text-[10px] text-slate-500 mt-0.5">平盘博弈</div>
                  <div className="text-[9px] text-slate-400">V18.0·F50</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyPreset(-0.95, 32, 26.5)}
                  className="p-2 rounded-xl bg-slate-100/70 dark:bg-slate-800/60 hover:bg-sky-500/10 border border-slate-200 dark:border-slate-700 hover:border-sky-500/50 transition cursor-pointer"
                >
                  <div className="text-base">🌧️</div>
                  <div className="font-bold text-[10px] text-sky-500 mt-0.5">避险警戒</div>
                  <div className="text-[9px] text-slate-400">V26.5·F32</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyPreset(-3.2, 12, 44.0)}
                  className="p-2 rounded-xl bg-slate-100/70 dark:bg-slate-800/60 hover:bg-indigo-500/10 border border-slate-200 dark:border-slate-700 hover:border-indigo-500/50 transition cursor-pointer"
                >
                  <div className="text-base">⛈️</div>
                  <div className="font-bold text-[10px] text-indigo-500 mt-0.5">恐慌雷暴</div>
                  <div className="text-[9px] text-slate-400">V44.0·F12</div>
                </button>
              </div>
            </div>

            {/* 舒适度调节 */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-3">
              <label className="block font-bold text-slate-800 dark:text-slate-200">4. 视觉舒适度调节 (Comfort)</label>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">背景光晕浓度:</span>
                <div className="flex items-center gap-2 flex-1 max-w-[180px]">
                  <input
                    type="range"
                    min="0.15"
                    max="1"
                    step="0.05"
                    value={backdropOpacity}
                    onChange={(e) => setBackdropOpacity(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                  <span className="font-mono text-slate-700 dark:text-slate-300 w-8 text-right font-bold">
                    {Math.round(backdropOpacity * 100)}%
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500">动态微粒子 (雨丝/浮尘):</span>
                <button
                  type="button"
                  onClick={() => setEnableParticles((v) => !v)}
                  className={cx(
                    'px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer',
                    enableParticles ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                  )}
                >
                  {enableParticles ? '已开启' : '已关闭'}
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
