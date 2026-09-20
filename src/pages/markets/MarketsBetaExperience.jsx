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
  RefreshCw,
  ArrowRight,
  ExternalLink,
  Lock,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  Award,
} from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { fetchQuotes } from '../../app/marketsApi.js';
import { detectCurrentMarketSession } from '../../app/tradingSession.js';
import { readLedgerState } from '../../app/holdingsLedgerStorage.js';

// --- 14 只全量纳斯达克 100 ETF 元数据基准 (与 src/app/nasdaqCatalog.js 1:1 对齐) ---
const INITIAL_NASDAQ_ETFS = [
  { code: '159509', name: '景顺长城纳斯达克科技ETF', shortName: '景顺科技', exchange: '深市', price: 2.916, baseChange: 2.89, premium: 27.12, iopv: 2.294, vol: 92990, group: 'H', rec: '卖出高溢价' },
  { code: '513100', name: '国泰纳斯达克100ETF', shortName: '国泰纳指', exchange: '沪市', price: 2.269, baseChange: 2.21, premium: 14.37, iopv: 1.984, vol: 47461, group: 'H', rec: '卖出高溢价' },
  { code: '159941', name: '广发纳斯达克100ETF', shortName: '广发纳指', exchange: '深市', price: 1.678, baseChange: 2.32, premium: 12.98, iopv: 1.485, vol: 111821, group: 'H', rec: '卖出高溢价' },
  { code: '159632', name: '华安纳斯达克100ETF', shortName: '华安纳指', exchange: '深市', price: 2.489, baseChange: 1.97, premium: 10.47, iopv: 2.253, vol: 16579, group: 'H', rec: '卖出高溢价' },
  { code: '513300', name: '华夏纳斯达克100ETF', shortName: '华夏纳指', exchange: '沪市', price: 1.945, baseChange: 1.83, premium: 9.24, iopv: 1.780, vol: 28410, group: 'H', rec: '卖出高溢价' },
  { code: '159660', name: '嘉实纳斯达克100ETF', shortName: '嘉实纳指', exchange: '深市', price: 1.832, baseChange: 1.65, premium: 8.10, iopv: 1.695, vol: 19200, group: 'H', rec: '卖出高溢价' },
  { code: '159696', name: '招商纳斯达克100ETF', shortName: '招商纳指', exchange: '深市', price: 1.765, baseChange: 1.48, premium: 7.45, iopv: 1.643, vol: 14320, group: 'H', rec: '卖出高溢价' },
  { code: '159513', name: '大成纳斯达克100ETF', shortName: '大成纳指', exchange: '深市', price: 1.612, baseChange: 1.22, premium: 6.80, iopv: 1.509, vol: 12100, group: 'H', rec: '卖出高溢价' },
  { code: '513110', name: '华泰柏瑞纳斯达克100ETF', shortName: '华泰纳指', exchange: '沪市', price: 1.589, baseChange: 1.15, premium: 5.90, iopv: 1.500, vol: 15400, group: 'L', rec: '平价买入端' },
  { code: '159659', name: '汇添富纳斯达克100ETF', shortName: '汇添富', exchange: '深市', price: 1.542, baseChange: 0.95, premium: 4.20, iopv: 1.480, vol: 8900, group: 'L', rec: '平价买入端' },
  { code: '513870', name: '富国纳斯达克100ETF', shortName: '富国纳指', exchange: '沪市', price: 1.488, baseChange: 0.81, premium: 3.10, iopv: 1.443, vol: 7200, rec: '平价买入端' },
  { code: '159501', name: '易方达纳斯达克100ETF', shortName: '易方达', exchange: '深市', price: 1.420, baseChange: 0.70, premium: 2.05, iopv: 1.391, vol: 6400, rec: '平价买入端' },
  { code: '513000', name: '博时纳斯达克100ETF', shortName: '博时纳指', exchange: '沪市', price: 1.398, baseChange: 0.65, premium: 1.12, iopv: 1.383, vol: 5300, rec: '平价买入端' },
  { code: '161130', name: '易方达标普信息科技LOF', shortName: '易方达LOF', exchange: '深市LOF', price: 1.350, baseChange: 0.00, premium: 0.00, iopv: 1.350, vol: 24300, group: 'L', rec: '平价买入端' },
];

// --- 5 大气象状态定义 ---
const WEATHER_STATES = {
  blazingSun: {
    id: 'blazingSun',
    name: '艳阳高照',
    icon: '☀️',
    color: 'text-amber-500',
    glowA: 'rgba(245, 158, 11, 0.4)',
    glowB: 'rgba(239, 68, 68, 0.25)',
  },
  partlyCloudy: {
    id: 'partlyCloudy',
    name: '多云见晴',
    icon: '🌤️',
    color: 'text-amber-500',
    glowA: 'rgba(245, 158, 11, 0.25)',
    glowB: 'rgba(99, 102, 241, 0.2)',
  },
  overcast: {
    id: 'overcast',
    name: '阴云密布',
    icon: '☁️',
    color: 'text-slate-400',
    glowA: 'rgba(148, 163, 184, 0.25)',
    glowB: 'rgba(71, 85, 105, 0.2)',
  },
  rainy: {
    id: 'rainy',
    name: '细雨连绵',
    icon: '🌧️',
    color: 'text-sky-500',
    glowA: 'rgba(14, 165, 233, 0.3)',
    glowB: 'rgba(99, 102, 241, 0.2)',
  },
  storm: {
    id: 'storm',
    name: '恐慌雷暴',
    icon: '⚡',
    color: 'text-indigo-500',
    glowA: 'rgba(99, 102, 241, 0.4)',
    glowB: 'rgba(225, 29, 72, 0.3)',
  },
};

function findQuoteForCode(quoteMap, rawCode) {
  if (!quoteMap || typeof quoteMap !== 'object') return null;
  const candidates = [
    rawCode,
    rawCode.replace(/\D/g, ''),
    `sh${rawCode}`,
    `sz${rawCode}`,
    `SH${rawCode}`,
    `SZ${rawCode}`,
  ];
  for (const c of candidates) {
    if (quoteMap[c]) return quoteMap[c];
  }
  return null;
}

export function MarketsBetaExperience({ onSelectClassic }) {
  const [ndxChange, setNdxChange] = useState(0.63);
  const [fearGreed, setFearGreed] = useState(29);
  const [vix, setVix] = useState(14.81);
  const [activeSubTab, setActiveSubTab] = useState('markets'); // 'markets' | 'fundSwitch'
  const [filterType, setFilterType] = useState('all'); // 'all' | 'high' | 'low' | 'extreme'
  const [commentaryOpen, setCommentaryOpen] = useState(false);
  const [controlDrawerOpen, setControlDrawerOpen] = useState(false);
  const [holdingsGuideModalOpen, setHoldingsGuideModalOpen] = useState(false);
  const [modalTargetAsset, setModalTargetAsset] = useState(null);
  const [mockHoldingsActive, setMockHoldingsActive] = useState(false);
  const [liveQuotes, setLiveQuotes] = useState({});
  const canvasRef = useRef(null);

  // 用户专属自定义参数 (气象触发规则、微气候透明度、搬家价差阈值默认 3.00%)
  const [userSettings, setUserSettings] = useState({
    backdropOpacity: 0.35,
    particlesEnabled: true,
    particleSpeed: 'normal',
    spreadThreshold: 3.00,
    rules: {
      blazingSunTemp: 25,
      fgGreed: 75,
      partlyCloudyTemp: 10,
      overcastTemp: 0,
      rainyTemp: -10,
      vixAlert: 25,
      vixStorm: 30,
      fgStorm: 20,
    },
  });

  // 读取本地持仓账本
  const hasRealHoldings = useMemo(() => {
    try {
      const ledger = readLedgerState();
      if (!ledger) return false;
      const txs = Array.isArray(ledger.transactions) ? ledger.transactions : [];
      const nasdaqCodes = new Set(INITIAL_NASDAQ_ETFS.map((e) => e.code));
      return txs.some((tx) => nasdaqCodes.has(tx.code) || nasdaqCodes.has(tx.symbol));
    } catch {
      return false;
    }
  }, []);

  // 综合判定持仓与策略是否就绪
  const isHoldingsReady = hasRealHoldings || mockHoldingsActive;

  // 1. 尝试拉取线上实时行情
  useEffect(() => {
    let cancelled = false;
    const fetchRealData = async () => {
      try {
        const symbols = ['^VIX', 'CNN_FNG', 'QQQ', ...INITIAL_NASDAQ_ETFS.map((e) => e.code)];
        const quotePayload = await fetchQuotes(symbols).catch(() => null);
        const quoteMap = quotePayload?.quotes || quotePayload || {};
        if (!cancelled && quoteMap && typeof quoteMap === 'object' && Object.keys(quoteMap).length > 0) {
          setLiveQuotes(quoteMap);
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
        }
      } catch (_err) {
        // Fallback to baseline
      }
    };

    fetchRealData();
    const interval = setInterval(fetchRealData, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // 2. 动态计算 14 只纳指 ETF 数据
  const tableData = useMemo(() => {
    return INITIAL_NASDAQ_ETFS.map((item) => {
      const live = findQuoteForCode(liveQuotes, item.code);
      const dynamicPrice = live?.price !== undefined && Number(live.price) > 0
        ? Number(Number(live.price).toFixed(3))
        : item.price;

      const dynamicChange = live?.changePercent !== undefined && Number.isFinite(Number(live.changePercent))
        ? Number(Number(live.changePercent).toFixed(2))
        : item.baseChange;

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
  }, [liveQuotes]);

  // 3. 统计 14 只标的晴雨比
  const { upCount, downCount } = useMemo(() => {
    let up = 0;
    let down = 0;
    tableData.forEach((item) => {
      if (item.currentChange >= 0) up++;
      else down++;
    });
    return { upCount: up, downCount: down };
  }, [tableData]);

  // 4. 体感温标合成计算
  const compositeTemp = useMemo(() => {
    const ndxDelta = ndxChange * 5.2;
    const fgDelta = (fearGreed - 50) * 0.32;
    const vixDelta = vix >= 25 ? -4 - (vix - 25) * 1.2 : vix >= 18 ? -(vix - 18) * 0.5 : (18 - vix) * 0.65;
    const etfDelta = ((upCount - downCount) / 14) * 4.0;
    const rounded = Math.round((16.0 + ndxDelta + fgDelta + vixDelta + etfDelta) * 10) / 10;
    return rounded;
  }, [ndxChange, fearGreed, vix, upCount, downCount]);

  const tempFormatted = compositeTemp >= 0 ? `+${compositeTemp.toFixed(1)}°C` : `${compositeTemp.toFixed(1)}°C`;

  // 5. 根据用户规则评估天气
  const currentWeather = useMemo(() => {
    const r = userSettings.rules;
    if (vix >= r.vixStorm || fearGreed <= r.fgStorm) {
      return WEATHER_STATES.storm;
    }
    if (compositeTemp >= r.blazingSunTemp || fearGreed >= r.fgGreed) {
      return WEATHER_STATES.blazingSun;
    }
    if (compositeTemp >= r.partlyCloudyTemp) {
      return WEATHER_STATES.partlyCloudy;
    }
    if (compositeTemp >= r.overcastTemp) {
      return WEATHER_STATES.overcast;
    }
    return WEATHER_STATES.rainy;
  }, [userSettings.rules, vix, fearGreed, compositeTemp]);

  // 6. 跑道 H / L 利差与门槛计算
  const sortedByPremium = useMemo(() => {
    return [...tableData].sort((a, b) => b.premium - a.premium);
  }, [tableData]);

  const topH = sortedByPremium[0] || tableData[0];
  const bottomL = sortedByPremium[sortedByPremium.length - 1] || tableData[tableData.length - 1];
  const realSpread = Number((topH.premium - bottomL.premium).toFixed(2));
  const spreadThreshold = userSettings.spreadThreshold;
  const isOverThreshold = realSpread >= spreadThreshold;
  const excessSpread = Number((realSpread - spreadThreshold).toFixed(2));

  // 动态跑道标杆与跑步小人位置映射
  const gatePos = Math.min(Math.max(Math.round((spreadThreshold / 15) * 60) + 12, 18), 58);
  const runnerPos = useMemo(() => {
    if (realSpread <= 0) return 6;
    if (!isOverThreshold) {
      return Math.max(Math.round((realSpread / spreadThreshold) * gatePos), 10);
    }
    const excess = realSpread - spreadThreshold;
    const maxExcess = Math.max(excess * 1.25, 24);
    return Math.min(Math.round(gatePos + (excess / maxExcess) * (94 - gatePos)), 94);
  }, [realSpread, spreadThreshold, gatePos, isOverThreshold]);

  // 表格快速过滤
  const filteredTableData = useMemo(() => {
    return tableData.filter((item) => {
      if (filterType === 'high') return item.group === 'H';
      if (filterType === 'low') return item.group === 'L';
      if (filterType === 'extreme') return item.premium >= 10;
      return true;
    });
  }, [tableData, filterType]);

  // Canvas 微粒子引擎
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const particles = [];
    for (let i = 0; i < 30; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: Math.random() * 2 + 1,
        speedY: Math.random() * 0.4 + 0.2,
        speedX: (Math.random() - 0.5) * 0.3,
        alpha: Math.random() * 0.5 + 0.2,
      });
    }

    const animate = () => {
      if (userSettings.particlesEnabled) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const speedMultiplier = userSettings.particleSpeed === 'fast' ? 2 : userSettings.particleSpeed === 'slow' ? 0.5 : 1;

        particles.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(99, 102, 241, ${p.alpha * 0.3})`;
          ctx.fill();

          p.y += p.speedY * speedMultiplier;
          p.x += p.speedX * speedMultiplier;

          if (p.y > canvas.height) p.y = -5;
          if (p.x > canvas.width) p.x = 0;
          if (p.x < 0) p.x = canvas.width;
        });
      }
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [userSettings.particlesEnabled, userSettings.particleSpeed]);

  const openTabInNewWindow = (url) => {
    window.open(url, '_blank');
  };

  const handleRunwayTabClick = () => {
    setActiveSubTab('fundSwitch');
    if (!isHoldingsReady) {
      setModalTargetAsset(null);
      setHoldingsGuideModalOpen(true);
    }
  };

  const handleTableRowAction = (item) => {
    if (isHoldingsReady) {
      setActiveSubTab('fundSwitch');
    } else {
      setModalTargetAsset({ code: item.code, name: item.name });
      setHoldingsGuideModalOpen(true);
    }
  };

  return (
    <div className="relative min-h-[calc(100vh-120px)] antialiased font-sans px-2.5 sm:px-4 py-2 sm:py-3 text-slate-900 dark:text-slate-100">
      
      {/* 0. 动态微气候背景光晕与粒子层 */}
      <div
        className="fixed inset-0 pointer-events-none transition-opacity duration-500 z-0 overflow-hidden"
        style={{ opacity: userSettings.backdropOpacity }}
      >
        <div
          className="absolute -top-[10%] left-[15vw] w-[60vw] h-[60vw] rounded-full blur-[140px] transition-all duration-1000"
          style={{ background: `radial-gradient(circle, ${currentWeather.glowA} 0%, transparent 70%)` }}
        />
        <div
          className="absolute top-[30%] -right-[10vw] w-[55vw] h-[55vw] rounded-full blur-[160px] transition-all duration-1000"
          style={{ background: `radial-gradient(circle, ${currentWeather.glowB} 0%, transparent 70%)` }}
        />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      </div>

      {/* 外层容器：紧凑高密度，杜绝页面多余内边距与冗余顶栏 */}
      <div className="relative z-10 max-w-[1520px] mx-auto space-y-2.5">

        {/* ======================================================== */}
        {/* 核心：高密度综合态势栏 (Sleek Compact Executive Ribbon) */}
        {/* 适配手机端：第一行紧凑排版，第二行微型 HUD，高度仅 ~46px */}
        {/* ======================================================== */}
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs px-2.5 sm:px-3 py-1.5 sm:py-2">
          
          <div className="flex items-center justify-between gap-2">
            {/* 左区：标的视图切换 (唯一的导航入口) */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700/80 shrink-0">
              <button
                type="button"
                onClick={() => setActiveSubTab('markets')}
                className={cx(
                  'px-2.5 sm:px-3 py-1 rounded-md text-xs font-bold transition flex items-center gap-1 cursor-pointer',
                  activeSubTab === 'markets'
                    ? 'bg-white dark:bg-indigo-600 text-indigo-600 dark:text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                )}
              >
                <span>📊 纳指标的</span>
                <span className="text-[10px] px-1 py-0.2 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 font-mono">14</span>
              </button>

              <button
                type="button"
                onClick={handleRunwayTabClick}
                className={cx(
                  'px-2.5 sm:px-3 py-1 rounded-md text-xs font-semibold transition flex items-center gap-1 cursor-pointer',
                  activeSubTab === 'fundSwitch'
                    ? 'bg-white dark:bg-indigo-600 text-indigo-600 dark:text-white shadow-2xs font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                )}
              >
                <span>🏃 套利跑道</span>
                {isHoldingsReady ? (
                  <span className="text-[10px] px-1 py-0.2 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 font-mono font-bold flex items-center gap-0.5">
                    <span>🚀</span>
                    <span>+{realSpread.toFixed(1)}%</span>
                  </span>
                ) : (
                  <span className="text-[10px] px-1 py-0.2 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono font-bold flex items-center gap-0.5">
                    <span>🔒</span>
                    <span>待配</span>
                  </span>
                )}
              </button>
            </div>

            {/* PC 端中间：四因子微型 HUD */}
            <div className="hidden lg:flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60">
                <span className="text-sm">{currentWeather.icon}</span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{currentWeather.name}</span>
                <span className="text-xs font-mono font-black text-rose-500">{tempFormatted}</span>
              </div>

              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60" title="CNN 贪婪与恐慌指数">
                <span className="text-[10px] text-slate-400 font-medium">F&G</span>
                <span className="text-xs font-mono font-black text-sky-500">{fearGreed}</span>
                <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400 hidden xl:inline">恐慌避险</span>
              </div>

              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60" title="CBOE 波动率指数 (^VIX)">
                <span className="text-[10px] text-slate-400 font-medium">VIX</span>
                <span className="text-xs font-mono font-black text-emerald-500">{vix.toFixed(1)}</span>
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hidden xl:inline">极度平静</span>
              </div>

              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60">
                <span className="text-[10px] text-slate-400 font-medium">晴雨比</span>
                <span className="text-xs font-mono font-bold text-rose-500">{upCount}晴</span>
                <div className="w-6 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.round((upCount / 14) * 100)}%` }} />
                </div>
                <span className="text-xs font-mono font-bold text-slate-400">{downCount}雨</span>
              </div>
            </div>

            {/* 右区：研报折叠 + 自定义设置 */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setCommentaryOpen((v) => !v)}
                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1 transition cursor-pointer"
                title="展开/收起研报"
              >
                <span>💡</span>
                <span className="hidden sm:inline">研报</span>
                <ChevronDown size={11} className={cx('transition-transform duration-200', commentaryOpen && 'rotate-180')} />
              </button>

              <button
                type="button"
                onClick={() => setControlDrawerOpen(true)}
                className="px-2.5 sm:px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold flex items-center gap-1 shadow-xs transition cursor-pointer"
              >
                <Sliders size={12} />
                <span>设置</span>
              </button>
            </div>
          </div>

          {/* 手机端独占：单行轻巧微型气候条 (Ticker) */}
          <div className="flex lg:hidden items-center justify-between gap-1.5 pt-1.5 mt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 font-mono overflow-x-auto no-scrollbar whitespace-nowrap">
            <div className="flex items-center gap-1">
              <span>{currentWeather.icon}</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{currentWeather.name}</span>
              <span className="text-rose-500 font-black">{tempFormatted}</span>
            </div>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-400">F&G:</span>
              <span className="text-sky-500 font-bold">{fearGreed}</span>
            </div>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-400">VIX:</span>
              <span className="text-emerald-500 font-bold">{vix.toFixed(1)}</span>
            </div>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <div className="flex items-center gap-1">
              <span className="text-rose-500 font-bold">{upCount}晴</span>
              <span className="text-slate-400 font-bold">{downCount}雨</span>
            </div>
          </div>
        </div>

        {/* 可折叠的行情简报条 (默认隐藏) */}
        {commentaryOpen && (
          <div className="bg-indigo-50/90 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 rounded-xl p-3 text-xs text-slate-700 dark:text-slate-300 transition-all">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-indigo-950 dark:text-indigo-200 text-xs sm:text-sm">周末休市结算 · 纳指全周行情回顾与溢价复盘</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 font-mono">休市撮合暂停</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  外围市场休市，14 只场内纳指 ETF 维持最新收盘价与估算溢价率。高溢价端 (159509 +27.12%) 与平价端 (161130 +0.00%) 价差高达 27.12%，显著超过设定的搬家启动门槛 ({spreadThreshold.toFixed(2)}%)，建议重点监控搬家策略。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCommentaryOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer shrink-0"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* 视图 1：纳指 100 标的表 (核心英雄区：手机与电脑端自适应) */}
        {/* ======================================================== */}
        {activeSubTab === 'markets' && (
          <div className="space-y-2">
            {/* 快捷过滤条 (手机端单行横滑，绝不折叠折行挤占高度) */}
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur rounded-xl border border-slate-200 dark:border-slate-800 px-2.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 shadow-xs">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 shrink-0">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0">过滤:</span>
                <button
                  type="button"
                  onClick={() => setFilterType('all')}
                  className={cx('px-2.5 py-0.8 rounded-md text-xs font-bold transition cursor-pointer whitespace-nowrap', filterType === 'all' ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400')}
                >
                  全部 (14)
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('high')}
                  className={cx('px-2.5 py-0.8 rounded-md text-xs font-bold transition cursor-pointer whitespace-nowrap', filterType === 'high' ? 'bg-rose-500 text-white shadow-2xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400')}
                >
                  高溢价 H端 (8)
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('low')}
                  className={cx('px-2.5 py-0.8 rounded-md text-xs font-bold transition cursor-pointer whitespace-nowrap', filterType === 'low' ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400')}
                >
                  平价 L端 (6)
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('extreme')}
                  className={cx('px-2.5 py-0.8 rounded-md text-xs font-bold transition cursor-pointer whitespace-nowrap', filterType === 'extreme' ? 'bg-amber-500 text-white shadow-2xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400')}
                >
                  溢价 &gt; 10% (4)
                </button>
              </div>

              {/* 持仓前置提示卡点 (单行轻巧呈现) */}
              <div className="flex items-center justify-between sm:justify-end gap-2 text-[11px] pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                <span className={cx('font-medium truncate', isHoldingsReady ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                  {isHoldingsReady ? '✅ 已绑定 159509 持仓 · 门槛 3.00%' : '⚠️ 搬家需先录入持仓 (已关闭)'}
                </span>
                <button
                  type="button"
                  onClick={() => setMockHoldingsActive((v) => !v)}
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold border border-indigo-400/50 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950 shrink-0 cursor-pointer"
                >
                  {isHoldingsReady ? '恢复锁定' : '⚡模拟激活'}
                </button>
              </div>
            </div>

            {/* ======================================================== */}
            {/* A. 手机端专属：高密度垂直行情报价列表 (App-Native 2-Tier Row) */}
            {/* 完美契合 375px~430px 屏幕，绝无横向溢出，一屏呈现 8+ 行 */}
            {/* ======================================================== */}
            <div className="block md:hidden bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
              {/* 移动端吸顶表头 */}
              <div className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <div className="w-[125px] shrink-0">标的 / 代码</div>
                <div className="flex-1 text-right pr-2">最新价 / IOPV</div>
                <div className="w-[85px] text-right pr-2">溢价率 / 涨跌</div>
                <div className="w-[52px] text-center shrink-0">操作</div>
              </div>

              {/* 移动端高密度数据流 */}
              <div className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-xs">
                {filteredTableData.map((item, idx) => {
                  const rowBg = idx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/30';
                  return (
                    <div
                      key={item.code}
                      className={cx('px-3 py-2.5 flex items-center justify-between gap-1 transition', rowBg)}
                    >
                      {/* 列 1: 标的名称 + 标的代码 & 属性标签 */}
                      <div className="w-[125px] shrink-0 truncate">
                        <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                          {item.shortName || item.name}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <span>{item.code}</span>
                          <span className={cx(
                            'text-[9px] px-1 py-0.1 rounded font-bold',
                            item.group === 'H' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          )}>
                            {item.group === 'H' ? '高溢价' : '平价端'}
                          </span>
                        </div>
                      </div>

                      {/* 列 2: 最新价 + IOPV */}
                      <div className="flex-1 text-right pr-2">
                        <div className="font-black text-xs text-slate-900 dark:text-white">
                          {item.currentPrice.toFixed(3)}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          IOPV {item.iopv.toFixed(3)}
                        </div>
                      </div>

                      {/* 列 3: 实时溢价率 + 当日涨跌幅 */}
                      <div className="w-[85px] text-right pr-2">
                        <div className={cx('font-black text-xs', item.premium >= 10 ? 'text-rose-500' : item.premium >= 5 ? 'text-amber-500' : 'text-slate-700 dark:text-slate-300')}>
                          +{item.premium.toFixed(2)}%
                        </div>
                        <div className={cx('text-[10px] font-bold mt-0.5', item.currentChange >= 0 ? 'text-rose-500' : 'text-emerald-500')}>
                          {item.currentChange >= 0 ? `+${item.currentChange.toFixed(2)}%` : `${item.currentChange.toFixed(2)}%`}
                        </div>
                      </div>

                      {/* 列 4: 搬家对比轻按钮 */}
                      <div className="w-[52px] text-center shrink-0">
                        {isHoldingsReady ? (
                          <button
                            type="button"
                            onClick={() => handleTableRowAction(item)}
                            className="px-2 py-1 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-bold text-[10px] hover:bg-indigo-100 transition cursor-pointer"
                          >
                            🏃搬家
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleTableRowAction(item)}
                            className="px-2 py-1 rounded bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 font-bold text-[10px] hover:bg-amber-100 transition cursor-pointer"
                            title="未录入持仓"
                          >
                            🔒搬家
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ======================================================== */}
            {/* B. 电脑端专属：完整 9 列双向冻结表格 (Desktop Wide Table) */}
            {/* ======================================================== */}
            <div className="hidden md:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
              <div className="relative max-h-[660px] overflow-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 z-30 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="sticky left-0 z-40 bg-slate-100 dark:bg-slate-800 px-3.5 py-3 w-[180px] min-w-[180px] max-w-[180px] border-r border-slate-200 dark:border-slate-700">
                        纳指标的 / 代码
                      </th>
                      <th className="sticky left-[180px] z-40 bg-slate-100 dark:bg-slate-800 px-3.5 py-3 w-[105px] min-w-[105px] max-w-[105px] text-right border-r border-slate-200 dark:border-slate-700 shadow-[2px_0_6px_rgba(0,0,0,0.06)]">
                        最新收盘价
                      </th>
                      <th className="px-3 py-3 text-right w-24">当日涨跌幅</th>
                      <th className="px-3 py-3 text-right w-28">实时溢价率</th>
                      <th className="px-3 py-3 text-center w-24">分组属性</th>
                      <th className="px-3 py-3 text-right w-28">预估净值(IOPV)</th>
                      <th className="px-3 py-3 text-right w-28">成交额(万元)</th>
                      <th className="px-3 py-3 text-center w-32">搬家建议</th>
                      <th className="px-3 py-3 text-center w-28">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-slate-800 dark:text-slate-200">
                    {filteredTableData.map((item, idx) => {
                      const rowBg = idx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/60 dark:bg-slate-800/40';
                      return (
                        <tr key={item.code} className="hover:bg-indigo-50/70 dark:hover:bg-indigo-950/30 transition group">
                          <td className={cx('sticky left-0 z-20 px-3.5 py-3 w-[180px] min-w-[180px] max-w-[180px] border-r border-slate-200 dark:border-slate-800 group-hover:bg-indigo-50 dark:group-hover:bg-slate-800', rowBg)}>
                            <div className="font-bold text-slate-900 dark:text-white text-xs truncate">{item.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono">{item.code}</div>
                          </td>
                          <td className={cx('sticky left-[180px] z-20 px-3.5 py-3 w-[105px] min-w-[105px] max-w-[105px] text-right font-black text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-800 shadow-[2px_0_6px_rgba(0,0,0,0.06)] group-hover:bg-indigo-50 dark:group-hover:bg-slate-800', rowBg)}>
                            {item.currentPrice.toFixed(3)}
                          </td>
                          <td className={cx('px-3 py-3 text-right font-black', item.currentChange >= 0 ? 'text-rose-500' : 'text-emerald-500')}>
                            {item.currentChange >= 0 ? `+${item.currentChange.toFixed(2)}%` : `${item.currentChange.toFixed(2)}%`}
                          </td>
                          <td className={cx('px-3 py-3 text-right font-bold', item.premium >= 10 ? 'text-rose-500 font-black' : item.premium >= 5 ? 'text-amber-500' : 'text-slate-600 dark:text-slate-400')}>
                            +{item.premium.toFixed(2)}%
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={cx('inline-block px-2 py-0.5 rounded text-[10px] font-bold', item.group === 'H' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700')}>
                              {item.group === 'H' ? 'H (高溢价)' : 'L (平价端)'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right text-slate-400 font-mono">{item.iopv.toFixed(3)}</td>
                          <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-300 font-mono">{item.vol.toLocaleString()}</td>
                          <td className="px-3 py-3 text-center">
                            <span className={cx('px-2 py-0.5 rounded text-[10px] font-bold', item.group === 'H' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20')}>
                              {item.rec}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            {isHoldingsReady ? (
                              <button
                                type="button"
                                onClick={() => handleTableRowAction(item)}
                                className="text-indigo-600 dark:text-indigo-400 hover:underline font-bold text-[11px] cursor-pointer flex items-center justify-center gap-1 mx-auto"
                              >
                                <span>🏃</span>
                                <span>搬家对比</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleTableRowAction(item)}
                                className="text-amber-600 dark:text-amber-400 hover:underline font-bold text-[11px] cursor-pointer flex items-center justify-center gap-1 mx-auto"
                                title="未录入持仓，点击查看引导"
                              >
                                <span>🔒</span>
                                <span>搬家对比</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* 视图 2：套利搬家跑道 (锁定态 vs 激活态) */}
        {/* ======================================================== */}
        {activeSubTab === 'fundSwitch' && (
          <div className="space-y-3">
            {/* 状态 A：锁定/自动关闭状态 (无持仓或未配置阈值时展现) */}
            {!isHoldingsReady ? (
              <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur rounded-2xl p-4 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 sm:space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center text-xl sm:text-2xl shrink-0">
                      🔒
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-black text-base sm:text-lg text-slate-900 dark:text-white">套利搬家跑道尚未激活 (功能已自动关闭)</h3>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold border border-rose-500/20">需先录入持仓与切换条件</span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl leading-relaxed">
                        搬家套利的核心是将您已持有的<b>高溢价标的卖出</b>，并同步换入<b>同赛道平价标的</b>锁定超额收益。未录入底仓或未配置门槛时系统已自动关闭推演。
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setMockHoldingsActive(true)}
                    className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-rose-600 hover:opacity-90 active:scale-95 text-white font-bold text-xs shadow-md transition cursor-pointer shrink-0 flex items-center justify-center gap-2"
                  >
                    <span>⚡</span>
                    <span>模拟一键激活体验</span>
                  </button>
                </div>

                {/* 两步配置引导卡片 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  {/* 步骤 1: 录入持仓 */}
                  <div className="p-4 sm:p-5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between space-y-3 hover:border-indigo-400 transition">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-md bg-indigo-600 text-white font-black text-xs flex items-center justify-center">1</span>
                          <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">步骤一：录入真实纳指持仓标的</span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 font-bold">前置必须</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        录入您持有的具体纳指标的（如 <b>159509 景顺科技</b>、<b>513100 国泰纳指</b> 等）与份额，跑道方可测算真实搬家换仓增益。
                      </p>
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => openTabInNewWindow('home.html?tab=holdings')}
                        className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer"
                      >
                        <span>📥 前往录入持仓标的</span>
                        <span className="text-[10px] opacity-80 font-mono">(新标签页 ↗)</span>
                      </button>
                    </div>
                  </div>

                  {/* 步骤 2: 配置切换策略 */}
                  <div className="p-4 sm:p-5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between space-y-3 hover:border-indigo-400 transition">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-md bg-indigo-600 text-white font-black text-xs flex items-center justify-center">2</span>
                          <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">步骤二：配置切换条件与价差门槛</span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 font-bold">前置必须</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        在基金切换策略中配置期望的<b>利差门槛 ({spreadThreshold.toFixed(2)}%)</b> 与承接标的，超过门槛将自动点亮跑道冲刺。
                      </p>
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => openTabInNewWindow('home.html?tab=fundSwitch')}
                        className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer"
                      >
                        <span>⚙️ 前往配置切换策略</span>
                        <span className="text-[10px] opacity-80 font-mono">(新标签页 ↗)</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* 状态 B：已激活状态 (已录入持仓与阈值时展现) */
              <div className="space-y-2.5 sm:space-y-3">
                {/* 顶部持仓指示条 */}
                <div className="bg-indigo-600/10 dark:bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-1.5 text-xs">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="font-bold text-indigo-700 dark:text-indigo-300 font-mono text-[11px] sm:text-xs">
                      159509 景顺科技 (持仓 10,000 份 · 浮盈 +35.63%)
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">⇋</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono text-[11px] sm:text-xs">
                      161130 易方达LOF (平价换入)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">门槛: <b className="font-mono text-rose-500">{spreadThreshold.toFixed(2)}%</b></span>
                    <button
                      type="button"
                      onClick={() => setMockHoldingsActive(false)}
                      className="text-[10px] text-slate-400 hover:text-rose-500 underline cursor-pointer"
                    >
                      [恢复锁定]
                    </button>
                  </div>
                </div>

                {/* 统计指标三卡片 (移动端 3 列紧凑并列) */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur rounded-xl p-2.5 border-l-2 sm:border-l-4 border-l-indigo-500 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="text-[10px] text-slate-400 truncate">监控标的池</div>
                    <div className="text-xs sm:text-base font-bold font-mono text-slate-900 dark:text-white mt-0.5">14只纳指</div>
                  </div>

                  <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur rounded-xl p-2.5 border-l-2 sm:border-l-4 border-l-rose-500 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="text-[10px] text-slate-400 truncate">持仓利差 (H-L)</div>
                    <div className="text-xs sm:text-base font-bold font-mono text-rose-500 mt-0.5">+{realSpread.toFixed(1)}%</div>
                  </div>

                  <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur rounded-xl p-2.5 border-l-2 sm:border-l-4 border-l-emerald-500 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="text-[10px] text-slate-400 truncate">测算增益份额</div>
                    <div className="text-xs sm:text-base font-bold font-mono text-emerald-500 mt-0.5">+1,160份</div>
                  </div>
                </div>

                {/* 跑道卡片 */}
                <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur rounded-xl p-3.5 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                      <h3 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                        159509 景顺科技 ⇋ 161130 易方达 套利跑道
                      </h3>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold border border-rose-500/20">
                        超额盈利区
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">规则 #QDII-01</span>
                  </div>

                  {/* 冲刺跑道轨道 */}
                  <div className="p-3 sm:p-5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 space-y-2">
                    <div className="flex justify-between items-center text-xs font-semibold">
                      <span className="text-slate-600 dark:text-slate-300 text-[11px] sm:text-xs">
                        门槛标杆: <b className="font-mono">{spreadThreshold.toFixed(2)}%</b>
                      </span>
                      <span className="font-mono font-black text-xs sm:text-sm text-rose-500">
                        价差 +{realSpread.toFixed(2)}% (超 +{excessSpread.toFixed(2)}%)
                      </span>
                    </div>

                    {/* 跑道轨 */}
                    <div className="relative pt-6 sm:pt-8 pb-8 sm:pb-10 px-2 sm:px-4">
                      <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full relative overflow-hidden shadow-inner">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 rounded-full transition-all duration-700"
                          style={{ width: `${runnerPos}%` }}
                        />
                      </div>

                      {/* 门槛标杆 */}
                      <div
                        className="absolute top-1 bottom-2 flex flex-col items-center pointer-events-none z-10 transition-all duration-300"
                        style={{ left: `${gatePos}%` }}
                      >
                        <div className="w-0.5 h-full border-l border-dashed border-rose-500" />
                        <span className="absolute -top-1 px-1 py-0.2 rounded bg-rose-500 text-white text-[9px] font-mono font-bold shadow-xs whitespace-nowrap">
                          🚩 {spreadThreshold.toFixed(1)}%
                        </span>
                      </div>

                      {/* 终点奖杯 */}
                      <div className="absolute right-1 top-0.5 flex flex-col items-center pointer-events-none">
                        <span className="text-base sm:text-xl leading-none">🏆</span>
                        <span className="text-[8px] sm:text-[9px] font-mono text-amber-600 font-bold whitespace-nowrap">丰厚区</span>
                      </div>

                      {/* 跑步小人 */}
                      <div
                        className="absolute top-0 flex flex-col items-center pointer-events-none z-20 transition-all duration-700"
                        style={{ left: `${runnerPos}%`, transform: 'translateX(-50%)' }}
                      >
                        <span className="text-lg sm:text-2xl leading-none animate-bounce">🏃</span>
                      </div>

                      {/* 小人指示牌 */}
                      <div
                        className="absolute top-10 sm:top-12 flex flex-col items-center z-20 transition-all duration-700"
                        style={{ left: `${runnerPos}%`, transform: 'translateX(-50%)' }}
                      >
                        <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-mono font-black shadow-md whitespace-nowrap">
                          +{realSpread.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* 底部指引与 CTA 按钮 */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pt-2 text-[11px] text-slate-500 border-t border-slate-200 dark:border-slate-700">
                      <div>
                        建议卖出 <b className="text-slate-800 dark:text-slate-200 font-mono">159509</b> 换入 <b className="text-slate-800 dark:text-slate-200 font-mono">161130</b> 锁定超额利差。
                      </div>
                      <button
                        type="button"
                        onClick={() => alert('已生成搬家调仓计划单：卖出 159509 景顺科技 10,000 份，换入 161130 易方达 21,600 份。')}
                        className="w-full sm:w-auto px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-xs shadow-xs transition cursor-pointer shrink-0 text-center"
                      >
                        一键生成搬家计划 →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ======================================================== */}
      {/* 核心弹窗：持仓与切换策略前置条件引导弹窗 (Holdings Guide Modal) */}
      {/* ======================================================== */}
      {holdingsGuideModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setHoldingsGuideModalOpen(false)}
          />

          <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-xl w-full p-4 sm:p-6 space-y-4 z-10 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center text-lg shrink-0">
                  🔒
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">套利搬家功能前置条件指引</h3>
                  <p className="text-[11px] text-slate-400">搬家功能需要真实持仓底仓与策略阈值作为推演基础</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHoldingsGuideModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 text-base cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-950 dark:text-indigo-200 leading-relaxed space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300">
                <span>💡</span>
                <span>{modalTargetAsset ? `您正在查看：${modalTargetAsset.code} ${modalTargetAsset.name}` : '为什么需要先录入持仓？'}</span>
              </div>
              <p>
                <b>搬家的本质是：高抛手中持仓，换入平价标的锁定利润。</b><br />
                没有底仓无法执行“卖出高溢价”操作。因此系统已<b>自动关闭搬家跑道</b>，需完成以下配置后开启：
              </p>
            </div>

            <div className="space-y-2.5">
              {/* 步骤 1: 录入持仓 */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-indigo-600 text-white font-bold text-[10px] flex items-center justify-center">1</span>
                    <span className="font-bold text-xs text-slate-900 dark:text-white">录入您的纳指 ETF 持仓标的</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    录入您当前持有的标的与份额（如 159509、513100 等）
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openTabInNewWindow('home.html?tab=holdings')}
                  className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center justify-center gap-1 shrink-0"
                >
                  <span>📥 前往录入持仓</span>
                  <span className="text-[10px] opacity-80">(新标签 ↗)</span>
                </button>
              </div>

              {/* 步骤 2: 配置切换策略 */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-indigo-600 text-white font-bold text-[10px] flex items-center justify-center">2</span>
                    <span className="font-bold text-xs text-slate-900 dark:text-white">配置基金切换策略与价差阈值</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    设置触发搬家的利差门槛（如 3.00%）与目标换入标的
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openTabInNewWindow('home.html?tab=fundSwitch')}
                  className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center justify-center gap-1 shrink-0"
                >
                  <span>⚙️ 前往配置策略</span>
                  <span className="text-[10px] opacity-80">(新标签 ↗)</span>
                </button>
              </div>
            </div>

            {/* 快速模拟体验通道 */}
            <div className="p-3 rounded-xl bg-gradient-to-r from-indigo-50 to-rose-50 dark:from-indigo-950/40 dark:to-rose-950/40 border border-indigo-200 dark:border-indigo-800 flex items-center justify-between gap-2">
              <div className="text-[11px] text-slate-600 dark:text-slate-300">
                <span className="font-bold text-indigo-700 dark:text-indigo-300">⚡ 快速预览体验：</span>
                立即查看跑道小人？
              </div>
              <button
                type="button"
                onClick={() => {
                  setMockHoldingsActive(true);
                  setHoldingsGuideModalOpen(false);
                  setActiveSubTab('fundSwitch');
                }}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-rose-600 text-white font-bold text-xs shadow-xs hover:opacity-90 transition cursor-pointer shrink-0"
              >
                一键模拟开启
              </button>
            </div>

            <div className="pt-1 flex justify-end">
              <button
                type="button"
                onClick={() => setHoldingsGuideModalOpen(false)}
                className="px-4 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 transition cursor-pointer"
              >
                稍后配置 / 返回标的表
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 核心交互：自定义设置抽屉 (Custom Settings Drawer) */}
      {/* ======================================================== */}
      {controlDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end pointer-events-none">
          <div
            className="fixed inset-0 bg-black/45 backdrop-blur-xs transition-opacity pointer-events-auto"
            onClick={() => setControlDrawerOpen(false)}
          />

          <aside className="relative z-10 w-full sm:w-[460px] h-[92vh] sm:h-full bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-none border-l border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-2xl overflow-y-auto pointer-events-auto space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-sm font-bold">
                  ⚙️
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">自定义气象与策略参数设置</h3>
                  <p className="text-[10px] text-slate-400">配置专属天气触发规则与搬家策略门槛</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setControlDrawerOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg transition cursor-pointer text-sm"
              >
                ✕
              </button>
            </div>

            {/* 模块 1: 🎨 视觉微气候 */}
            <div className="space-y-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span>🎨</span>
                  <span>背景光晕透明度与动态粒子</span>
                </h4>
                <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                  {Math.round(userSettings.backdropOpacity * 100)}%
                </span>
              </div>

              <div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={userSettings.backdropOpacity}
                  onChange={(e) => setUserSettings((prev) => ({ ...prev, backdropOpacity: parseFloat(e.target.value) }))}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>

              <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/60 flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-300 font-medium">动态微粒子</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setUserSettings((prev) => ({ ...prev, particlesEnabled: !prev.particlesEnabled }))}
                    className={cx('px-2 py-0.8 rounded-lg text-xs font-bold transition cursor-pointer', userSettings.particlesEnabled ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500')}
                  >
                    {userSettings.particlesEnabled ? '开启' : '关闭'}
                  </button>
                  <select
                    value={userSettings.particleSpeed}
                    onChange={(e) => setUserSettings((prev) => ({ ...prev, particleSpeed: e.target.value }))}
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] px-2 py-0.8 rounded-lg cursor-pointer"
                  >
                    <option value="slow">慢速</option>
                    <option value="normal">标准</option>
                    <option value="fast">快速</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 模块 2: 🏃 基金切换策略与触发门槛 */}
            <div className="space-y-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span>🚩</span>
                  <span>搬家策略触发门槛 (H - L 价差)</span>
                </h4>
                <span className="text-xs font-mono font-bold text-rose-500 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded border border-rose-200 dark:border-rose-800">
                  {userSettings.spreadThreshold.toFixed(2)}%
                </span>
              </div>

              {/* 持仓绑定状态指示卡 */}
              <div className={cx('p-2.5 rounded-lg border text-xs', isHoldingsReady ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200' : 'border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200')}>
                <div className="flex items-center justify-between font-bold">
                  <span className="flex items-center gap-1">
                    <span>{isHoldingsReady ? '✅' : '⚠️'}</span>
                    <span>持仓状态：{isHoldingsReady ? '已激活 (159509)' : '未检测到持仓'}</span>
                  </span>
                  {!isHoldingsReady && (
                    <span className="text-[9px] bg-amber-200 dark:bg-amber-900/80 text-amber-800 dark:text-amber-200 px-1 py-0.2 rounded font-mono font-bold">已关闭</span>
                  )}
                </div>
                {!isHoldingsReady && (
                  <div className="flex items-center gap-1.5 pt-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => openTabInNewWindow('home.html?tab=holdings')}
                      className="px-2 py-0.8 rounded bg-indigo-600 text-white font-bold text-[10px] hover:bg-indigo-500 cursor-pointer"
                    >
                      录入持仓 ↗
                    </button>
                    <button
                      type="button"
                      onClick={() => openTabInNewWindow('home.html?tab=fundSwitch')}
                      className="px-2 py-0.8 rounded bg-slate-800 text-white font-bold text-[10px] hover:bg-slate-700 cursor-pointer"
                    >
                      配置切换 ↗
                    </button>
                    <button
                      type="button"
                      onClick={() => setMockHoldingsActive(true)}
                      className="px-2 py-0.8 rounded border border-indigo-400 text-indigo-600 dark:text-indigo-300 font-bold text-[10px] hover:bg-indigo-50 cursor-pointer ml-auto"
                    >
                      ⚡模拟激活
                    </button>
                  </div>
                )}
              </div>

              {/* 切换策略配置区 */}
              <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    价差达标触发门槛 (H - L)
                  </span>
                  <span className="text-[10px] text-emerald-600 font-semibold">自动同步跑道</span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="1"
                    max="15"
                    step="0.25"
                    value={userSettings.spreadThreshold}
                    onChange={(e) => setUserSettings((prev) => ({ ...prev, spreadThreshold: parseFloat(e.target.value) || 3.00 }))}
                    className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-600"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      value={userSettings.spreadThreshold}
                      min="0.5"
                      max="25"
                      step="0.1"
                      onChange={(e) => setUserSettings((prev) => ({ ...prev, spreadThreshold: parseFloat(e.target.value) || 3.00 }))}
                      className="w-14 px-1.5 py-0.8 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-xs font-bold text-right"
                    />
                    <span className="text-xs text-slate-400 font-mono">%</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-wrap pt-0.5">
                  <span className="text-[10px] text-slate-400">预设:</span>
                  {[2.00, 3.00, 6.50, 10.00].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setUserSettings((prev) => ({ ...prev, spreadThreshold: val }))}
                      className={cx(
                        'px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer',
                        userSettings.spreadThreshold === val
                          ? 'bg-rose-50 text-rose-600 border border-rose-200 font-bold'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      )}
                    >
                      {val.toFixed(1)}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 模块 3: 🌦️ 天气规则配置 */}
            <div className="space-y-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-1">
                  <span>🌦️</span>
                  <span>天气触发规则 (实时温标 {tempFormatted})</span>
                </h4>
              </div>

              <div className="space-y-1.5">
                <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px]">
                  <span>☀️ 艳阳高照 (温标 ≥)</span>
                  <input
                    type="number"
                    value={userSettings.rules.blazingSunTemp}
                    onChange={(e) => setUserSettings((prev) => ({ ...prev, rules: { ...prev.rules, blazingSunTemp: parseFloat(e.target.value) || 25 } }))}
                    className="w-14 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-right font-mono font-bold"
                  />
                </div>

                <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px]">
                  <span>🌤️ 多云见晴 (温标 ≥)</span>
                  <input
                    type="number"
                    value={userSettings.rules.partlyCloudyTemp}
                    onChange={(e) => setUserSettings((prev) => ({ ...prev, rules: { ...prev.rules, partlyCloudyTemp: parseFloat(e.target.value) || 10 } }))}
                    className="w-14 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-right font-mono font-bold"
                  />
                </div>

                <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px]">
                  <span>☁️ 阴云密布 (温标 ≥)</span>
                  <input
                    type="number"
                    value={userSettings.rules.overcastTemp}
                    onChange={(e) => setUserSettings((prev) => ({ ...prev, rules: { ...prev.rules, overcastTemp: parseFloat(e.target.value) || 0 } }))}
                    className="w-14 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-right font-mono font-bold"
                  />
                </div>

                <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px]">
                  <span>🌧️ 细雨连绵 (温标 ≥)</span>
                  <input
                    type="number"
                    value={userSettings.rules.rainyTemp}
                    onChange={(e) => setUserSettings((prev) => ({ ...prev, rules: { ...prev.rules, rainyTemp: parseFloat(e.target.value) || -10 } }))}
                    className="w-14 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-right font-mono font-bold"
                  />
                </div>

                <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px]">
                  <span>⚡ 恐慌雷暴 (VIX 警戒 ≥)</span>
                  <input
                    type="number"
                    value={userSettings.rules.vixStorm}
                    onChange={(e) => setUserSettings((prev) => ({ ...prev, rules: { ...prev.rules, vixStorm: parseFloat(e.target.value) || 30 } }))}
                    className="w-14 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-right font-mono font-bold"
                  />
                </div>
              </div>
            </div>

            {/* 抽屉底部操作栏 */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setUserSettings({
                    backdropOpacity: 0.35,
                    particlesEnabled: true,
                    particleSpeed: 'normal',
                    spreadThreshold: 3.00,
                    rules: {
                      blazingSunTemp: 25,
                      fgGreed: 75,
                      partlyCloudyTemp: 10,
                      overcastTemp: 0,
                      rainyTemp: -10,
                      vixAlert: 25,
                      vixStorm: 30,
                      fgStorm: 20,
                    },
                  });
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 transition cursor-pointer"
              >
                恢复默认
              </button>
              <button
                type="button"
                onClick={() => setControlDrawerOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-xs transition cursor-pointer"
              >
                保存设置
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
