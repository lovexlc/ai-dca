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
import { useMarketsBetaSync } from './useMarketsBetaSync.js';

// --- 14 只全量纳斯达克 100 ETF 元数据基准 (与 src/app/nasdaqCatalog.js 1:1 对齐) ---
const INITIAL_NASDAQ_ETFS = [
  { code: '159509', name: '景顺长城纳斯达克科技ETF(QDII)', shortName: '景顺科技', exchange: '深市', price: 2.916, baseChange: 2.89, premium: 27.12, iopv: 2.294, vol: 92990, group: 'H', rec: '卖出高溢价' },
  { code: '513100', name: '国泰纳斯达克100ETF', shortName: '国泰纳指', exchange: '沪市', price: 2.269, baseChange: 2.21, premium: 14.37, iopv: 1.984, vol: 47461, group: 'H', rec: '卖出高溢价' },
  { code: '159501', name: '嘉实纳斯达克100ETF(QDII)', shortName: '嘉实纳指', exchange: '深市', price: 2.129, baseChange: 1.62, premium: 14.25, iopv: 1.863, vol: 10274, group: 'H', rec: '卖出高溢价' },
  { code: '159941', name: '广发纳斯达克100ETF', shortName: '广发纳指', exchange: '深市', price: 1.678, baseChange: 2.32, premium: 12.98, iopv: 1.485, vol: 111821, group: 'H', rec: '卖出高溢价' },
  { code: '159696', name: '易方达纳斯达克100ETF(QDI)', shortName: '易方达', exchange: '深市', price: 2.048, baseChange: 1.79, premium: 10.90, iopv: 1.847, vol: 11525, group: 'H', rec: '卖出高溢价' },
  { code: '159659', name: '招商纳斯达克100ETF(QDII)', shortName: '招商纳指', exchange: '深市', price: 2.368, baseChange: 1.72, premium: 10.50, iopv: 2.143, vol: 13420, group: 'H', rec: '卖出高溢价' },
  { code: '159632', name: '华安纳斯达克100ETF(QDII)', shortName: '华安纳指', exchange: '深市', price: 2.489, baseChange: 1.97, premium: 10.47, iopv: 2.253, vol: 16579, group: 'H', rec: '卖出高溢价' },
  { code: '513300', name: '华夏纳斯达克100ETF(QDII)', shortName: '华夏纳指', exchange: '沪市', price: 2.712, baseChange: 1.80, premium: 10.29, iopv: 2.459, vol: 38458, group: 'H', rec: '卖出高溢价' },
  { code: '513870', name: '富国纳斯达克100ETF(QDII)', shortName: '富国纳指', exchange: '沪市', price: 2.083, baseChange: 2.06, premium: 10.26, iopv: 1.889, vol: 7200, group: 'L', rec: '平价买入端' },
  { code: '513110', name: '华泰柏瑞纳斯达克100ETF(QDII)', shortName: '华泰纳指', exchange: '沪市', price: 2.509, baseChange: 2.03, premium: 10.15, iopv: 2.278, vol: 15400, group: 'L', rec: '平价买入端' },
  { code: '159660', name: '汇添富纳斯达克100ETF', shortName: '汇添富', exchange: '深市', price: 2.387, baseChange: 1.92, premium: 10.14, iopv: 2.167, vol: 20439, group: 'L', rec: '平价买入端' },
  { code: '513390', name: '博时纳斯达克100ETF(QDII)', shortName: '博时纳指', exchange: '沪市', price: 2.448, baseChange: 1.62, premium: 9.93, iopv: 2.227, vol: 18300, group: 'L', rec: '平价买入端' },
  { code: '159513', name: '大成纳斯达克100ETF(QDII)', shortName: '大成纳指', exchange: '深市', price: 1.821, baseChange: 2.13, premium: 9.84, iopv: 1.658, vol: 32523, group: 'L', rec: '平价买入端' },
  { code: '161130', name: '易方达标普信息科技LOF', shortName: '易方达LOF', exchange: '深市LOF', price: 7.168, baseChange: 1.70, premium: 5.44, iopv: 6.798, vol: 24300, group: 'L', rec: '平价买入端' },
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

function cleanCode(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function findQuoteForCode(quoteMap, rawCode) {
  if (!quoteMap || typeof quoteMap !== 'object') return null;
  const digits = cleanCode(rawCode);
  const candidates = [
    rawCode,
    digits,
    `sh${digits}`,
    `sz${digits}`,
    `SH${digits}`,
    `SZ${digits}`,
  ];
  if (digits === '161130') candidates.push('161128', 'sz161128', 'SZ161128');
  if (digits === '161128') candidates.push('161130', 'sz161130', 'SZ161130');
  if (digits === '513390') candidates.push('513000', 'sh513000', 'SH513000');
  if (digits === '513000') candidates.push('513390', 'sh513390', 'SH513390');

  for (const c of candidates) {
    if (quoteMap[c] && typeof quoteMap[c] === 'object') {
      const q = quoteMap[c];
      if (q.price !== undefined || q.close !== undefined || q.premiumPercent !== undefined || q.vendorPremiumPercent !== undefined) {
        return q;
      }
    }
  }
  return null;
}

function resolvePremium(live, dynamicPrice, fallbackItem) {
  const rawPrem = live?.premiumPercent ?? live?.vendorPremiumPercent ?? live?.premium_rate;
  if (rawPrem !== undefined && rawPrem !== null && Number.isFinite(Number(rawPrem))) {
    return Number(Number(rawPrem).toFixed(2));
  }
  const iopv = live?.iopv !== undefined && Number(live.iopv) > 0 ? Number(live.iopv) : fallbackItem.iopv;
  if (dynamicPrice > 0 && iopv > 0) {
    return Number(((dynamicPrice / iopv - 1) * 100).toFixed(2));
  }
  return fallbackItem.premium;
}

function classifyPremiumGroups(items = [], threshold = 0) {
  const sorted = [...(Array.isArray(items) ? items : [])]
    .sort((a, b) => Number(b.premium) - Number(a.premium));
  const thresholdValue = Number.isFinite(Number(threshold)) ? Number(threshold) : 0;
  let selectedSplit = null;
  let largestGap = null;

  for (let index = 1; index < sorted.length; index += 1) {
    const highMinimum = Number(sorted[index - 1]?.premium);
    const lowMaximum = Number(sorted[index]?.premium);
    if (!Number.isFinite(highMinimum) || !Number.isFinite(lowMaximum)) continue;
    const gap = Number((highMinimum - lowMaximum).toFixed(2));

    if (!largestGap || gap > largestGap.gap) {
      largestGap = { splitIndex: index, gap };
    }
    if (gap > thresholdValue && (!selectedSplit || gap > selectedSplit.gap)) {
      selectedSplit = { splitIndex: index, gap };
    }
  }

  const hasValidSplit = Boolean(selectedSplit);
  const splitIndex = selectedSplit?.splitIndex ?? 0;
  const groupedItems = sorted.map((item, index) => {
    const group = hasValidSplit ? (index < splitIndex ? 'H' : 'L') : null;
    return {
      ...item,
      group,
      isHighPremium: group === 'H',
      rec: group === 'H' ? '卖出高溢价' : group === 'L' ? '低溢价买入端' : '未形成分组',
    };
  });
  const highItems = groupedItems.filter((item) => item.group === 'H');
  const lowItems = groupedItems.filter((item) => item.group === 'L');

  return {
    items: groupedItems,
    highItems,
    lowItems,
    hasValidSplit,
    groupSpread: selectedSplit?.gap ?? null,
    maxObservedGap: largestGap?.gap ?? null,
    lowestHigh: highItems[highItems.length - 1] || null,
    highestLow: lowItems[0] || null,
  };
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

  // 远程持仓记录与换基方案配置同步 Hook
  const {
    loading: syncLoading,
    syncing: isSyncing,
    hasRealHoldings,
    nasdaqHoldings,
    boundHoldingFund: autoBoundHoldingFund,
    switchConfig,
    activeRule,
    ruleThreshold,
    ruleName,
    refreshSync,
  } = useMarketsBetaSync();

  // 用户专属自定义参数 (气象触发规则、微气候透明度、搬家价差阈值默认由方案策略提供)
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

  // 同步切换策略规则中的利差门槛至设置
  useEffect(() => {
    if (ruleThreshold && Number.isFinite(ruleThreshold)) {
      setUserSettings((prev) => ({ ...prev, spreadThreshold: ruleThreshold }));
    }
  }, [ruleThreshold]);

  // 综合判定持仓与策略是否就绪
  const isHoldingsReady = hasRealHoldings || mockHoldingsActive;

  // 绑定当前跑道生效的持仓标的信息
  const activeHolding = useMemo(() => {
    if (hasRealHoldings && autoBoundHoldingFund) {
      return autoBoundHoldingFund;
    }
    if (mockHoldingsActive) {
      return {
        code: '159509',
        name: '景顺长城纳斯达克科技ETF',
        shortName: '景顺科技',
        totalShares: 10000,
        avgCost: 2.15,
        totalCost: 21500,
        currentPrice: 2.916,
        marketValue: 29160,
        unrealizedProfit: 7660,
        unrealizedReturnRate: 35.63,
      };
    }
    return null;
  }, [hasRealHoldings, autoBoundHoldingFund, mockHoldingsActive]);

  // 1. 尝试拉取线上实时行情 (独立分批请求，规避美股指标故障影响境内 ETF 行情)
  useEffect(() => {
    let cancelled = false;
    const fetchRealData = async () => {
      try {
        const etfCodes = Array.from(new Set([
          ...INITIAL_NASDAQ_ETFS.map((e) => e.code),
          '513390',
          '513000',
          '161128',
          '161130',
        ]));
        const [etfPayload, usPayload] = await Promise.all([
          fetchQuotes(etfCodes).catch(() => null),
          fetchQuotes(['^VIX', 'CNN_FNG', 'QQQ']).catch(() => null),
        ]);
        const etfQuotes = etfPayload?.quotes || etfPayload || {};
        const usQuotes = usPayload?.quotes || usPayload || {};
        const mergedQuotes = {
          ...(typeof etfQuotes === 'object' ? etfQuotes : {}),
          ...(typeof usQuotes === 'object' ? usQuotes : {}),
        };

        if (!cancelled && Object.keys(mergedQuotes).length > 0) {
          setLiveQuotes((prev) => ({ ...prev, ...mergedQuotes }));
          const vixQuote = mergedQuotes['^VIX'];
          if (vixQuote?.price && Number(vixQuote.price) > 0) {
            setVix(Number(Number(vixQuote.price).toFixed(2)));
          }
          const fngQuote = mergedQuotes['CNN_FNG'];
          if (fngQuote?.price && Number(fngQuote.price) > 0) {
            setFearGreed(Math.round(Number(fngQuote.price)));
          }
          const qqqQuote = mergedQuotes['QQQ'];
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

  // 保证 Beta 模式下移动端整页及表格顺畅滚动，彻底清除经典全屏锁
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.documentElement.classList.remove('markets-full-table-active');
    document.body.classList.remove('markets-full-table-active');
  }, []);

  // 2. 动态计算 14 只纳指 ETF 数据与持仓关联
  const rawTableData = useMemo(() => {
    const rawItems = INITIAL_NASDAQ_ETFS.map((item) => {
      const live = findQuoteForCode(liveQuotes, item.code);
      const dynamicPrice = live?.price !== undefined && Number(live.price) > 0
        ? Number(Number(live.price).toFixed(3))
        : (live?.close !== undefined && Number(live.close) > 0
            ? Number(Number(live.close).toFixed(3))
            : item.price);

      const dynamicChange = live?.changePercent !== undefined && Number.isFinite(Number(live.changePercent))
        ? Number(Number(live.changePercent).toFixed(2))
        : item.baseChange;

      const dynamicPremium = resolvePremium(live, dynamicPrice, item);

      const dynamicIopv = live?.iopv !== undefined && Number(live.iopv) > 0
        ? Number(Number(live.iopv).toFixed(3))
        : (dynamicPrice > 0 && dynamicPremium !== undefined
            ? Number((dynamicPrice / (1 + dynamicPremium / 100)).toFixed(3))
            : item.iopv);

      const dynamicVol = live?.turnover !== undefined && Number(live.turnover) > 0
        ? Math.round(Number(live.turnover) / 10000)
        : (live?.volume !== undefined && Number(live.volume) > 0
            ? Math.round(Number(live.volume) / 100)
            : item.vol);

      const isUp = dynamicChange >= 0;

      // 匹配用户当前实际持仓或模拟持仓 (支持 161130 / 161128, 513390 / 513000 别名兼容)
      const holdingMatch = nasdaqHoldings.find((h) => {
        const hc = cleanCode(h.code);
        const ic = cleanCode(item.code);
        if (hc === ic) return true;
        if ((ic === '161128' || ic === '161130') && (hc === '161128' || hc === '161130')) return true;
        if ((ic === '513390' || ic === '513000') && (hc === '513390' || hc === '513000')) return true;
        return false;
      }) || (mockHoldingsActive && item.code === '159509' ? {
        code: '159509',
        totalShares: 10000,
        avgCost: 2.15,
        unrealizedReturnRate: 35.63,
      } : null);

      const isHeld = Boolean(holdingMatch && holdingMatch.totalShares > 0);
      const heldShares = holdingMatch?.totalShares || 0;
      const heldProfitRate = holdingMatch?.unrealizedReturnRate || 0;

      return {
        ...item,
        currentPrice: dynamicPrice,
        currentChange: dynamicChange,
        premium: dynamicPremium,
        iopv: dynamicIopv,
        vol: dynamicVol,
        isUp,
        isHeld,
        heldShares,
        heldProfitRate,
      };
    });

    return rawItems;
  }, [liveQuotes, nasdaqHoldings, mockHoldingsActive]);

  const premiumGrouping = useMemo(
    () => classifyPremiumGroups(rawTableData, userSettings.spreadThreshold),
    [rawTableData, userSettings.spreadThreshold]
  );
  const tableData = premiumGrouping.items;

  // 3. 动态统计各维度数量 (绑定过滤按钮标签)
  const { totalCount, hCount, lCount, extremeCount } = useMemo(() => {
    let h = 0;
    let l = 0;
    let ext = 0;
    tableData.forEach((item) => {
      if (item.group === 'H') h++;
      if (item.group === 'L') l++;
      if (item.premium >= 10) ext++;
    });
    return {
      totalCount: tableData.length,
      hCount: h,
      lCount: l,
      extremeCount: ext,
    };
  }, [tableData]);

  // 4. 统计 14 只标的晴雨比
  const { upCount, downCount } = useMemo(() => {
    let up = 0;
    let down = 0;
    tableData.forEach((item) => {
      if (item.currentChange >= 0) up++;
      else down++;
    });
    return { upCount: up, downCount: down };
  }, [tableData]);

  // 5. 体感温标合成计算
  const compositeTemp = useMemo(() => {
    const ndxDelta = ndxChange * 5.2;
    const fgDelta = (fearGreed - 50) * 0.32;
    const vixDelta = vix >= 25 ? -4 - (vix - 25) * 1.2 : vix >= 18 ? -(vix - 18) * 0.5 : (18 - vix) * 0.65;
    const etfDelta = ((upCount - downCount) / 14) * 4.0;
    const rounded = Math.round((16.0 + ndxDelta + fgDelta + vixDelta + etfDelta) * 10) / 10;
    return rounded;
  }, [ndxChange, fearGreed, vix, upCount, downCount]);

  const tempFormatted = compositeTemp >= 0 ? `+${compositeTemp.toFixed(1)}°C` : `${compositeTemp.toFixed(1)}°C`;

  // 6. 根据用户规则评估天气
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

  // 7. 根据有效 H/L 分组计算跑道
  const topH = premiumGrouping.highItems[0] || null;
  const bottomL = premiumGrouping.lowItems[premiumGrouping.lowItems.length - 1] || null;

  const holdingQuote = useMemo(() => {
    if (activeHolding) {
      const activeCode = cleanCode(activeHolding.code);
      const found = tableData.find((t) => {
        const tc = cleanCode(t.code);
        if (tc === activeCode) return true;
        if ((activeCode === '161128' || activeCode === '161130') && (tc === '161128' || tc === '161130')) return true;
        if ((activeCode === '513390' || activeCode === '513000') && (tc === '513390' || tc === '513000')) return true;
        return false;
      });
      if (found) return found;
    }
    return topH;
  }, [activeHolding, tableData, topH]);

  // 绑定目标换入端标的：若切换策略中指定了承接标的候选集，优先从中挑选溢价率最低者
  const targetFund = useMemo(() => {
    if (!premiumGrouping.hasValidSplit) return null;
    const candidateCodes = Array.isArray(activeRule?.candidateFundCodes) && activeRule.candidateFundCodes.length > 0
      ? new Set(activeRule.candidateFundCodes.map((c) => cleanCode(c)))
      : null;
    const lowItems = premiumGrouping.lowItems;
    if (candidateCodes && candidateCodes.size > 0) {
      const matchedCandidates = lowItems.filter((t) => {
        const tc = cleanCode(t.code);
        if (candidateCodes.has(tc)) return true;
        if ((candidateCodes.has('161128') || candidateCodes.has('161130')) && (tc === '161128' || tc === '161130')) return true;
        if ((candidateCodes.has('513390') || candidateCodes.has('513000')) && (tc === '513390' || tc === '513000')) return true;
        return false;
      });
      if (matchedCandidates.length > 0) {
        return [...matchedCandidates].sort((a, b) => a.premium - b.premium)[0];
      }
    }
    return bottomL;
  }, [activeRule, premiumGrouping, bottomL]);

  const spreadThreshold = userSettings.spreadThreshold;
  const realSpread = holdingQuote && targetFund
    ? Number((holdingQuote.premium - targetFund.premium).toFixed(2))
    : 0;
  const isOverThreshold = premiumGrouping.hasValidSplit && realSpread > spreadThreshold;
  const excessSpread = Number((realSpread - spreadThreshold).toFixed(2));

  // 测算根据实时价差可换入的额外增益份额
  const { shareGain, shareGainPct, estimateTargetShares } = useMemo(() => {
    const shares = activeHolding?.totalShares || 10000;
    const hp = holdingQuote?.currentPrice || 1;
    const tp = targetFund?.currentPrice || 1;
    if (hp <= 0 || tp <= 0) {
      return { shareGain: 0, shareGainPct: 0, estimateTargetShares: shares };
    }
    const targetShares = Math.round((shares * hp) / tp);
    const diff = targetShares - shares;
    const pct = Number(((hp / tp - 1) * 100).toFixed(1));
    return {
      shareGain: Math.max(0, diff),
      shareGainPct: pct,
      estimateTargetShares: targetShares,
    };
  }, [activeHolding, holdingQuote, targetFund]);

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
    <div className="relative min-h-[calc(100vh-120px)] antialiased font-sans px-2.5 sm:px-4 py-2 sm:py-3 pb-24 sm:pb-8 touch-pan-y text-slate-900 dark:text-slate-100">
      
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
                   {premiumGrouping.hasValidSplit && premiumGrouping.lowestHigh && premiumGrouping.highestLow ? (
                     <>当前 H 组最低溢价 ({premiumGrouping.lowestHigh.code} +{premiumGrouping.lowestHigh.premium.toFixed(2)}%) 与 L 组最高溢价 ({premiumGrouping.highestLow.code} +{premiumGrouping.highestLow.premium.toFixed(2)}%) 的分界差为 {premiumGrouping.groupSpread.toFixed(2)}%，配置门槛为 {spreadThreshold.toFixed(2)}%。{isOverThreshold ? '当前持仓已超过切换门槛' : '当前持仓暂未超过切换门槛'}。</>
                   ) : (
                     <>当前未形成满足 H 组最低溢价减 L 组最高溢价大于 {spreadThreshold.toFixed(2)}% 的有效分组，最大相邻溢价断层为 {premiumGrouping.maxObservedGap == null ? '--' : premiumGrouping.maxObservedGap.toFixed(2) + '%'}。</>
                   )}
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
                  全部 ({totalCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('high')}
                  className={cx('px-2.5 py-0.8 rounded-md text-xs font-bold transition cursor-pointer whitespace-nowrap', filterType === 'high' ? 'bg-rose-500 text-white shadow-2xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400')}
                >
                  高溢价 H端 ({hCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('low')}
                  className={cx('px-2.5 py-0.8 rounded-md text-xs font-bold transition cursor-pointer whitespace-nowrap', filterType === 'low' ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400')}
                >
                  平价 L端 ({lCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('extreme')}
                  className={cx('px-2.5 py-0.8 rounded-md text-xs font-bold transition cursor-pointer whitespace-nowrap', filterType === 'extreme' ? 'bg-amber-500 text-white shadow-2xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400')}
                >
                  溢价 &gt; 10% ({extremeCount})
                </button>
              </div>

              {/* 持仓前置提示卡点 (单行轻巧呈现) */}
              <div className="flex items-center justify-between sm:justify-end gap-2 text-[11px] pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                <span className={cx('font-medium truncate', isHoldingsReady ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                  {isHoldingsReady ? (
                    `✅ 已绑定 ${activeHolding?.code} ${activeHolding?.shortName || activeHolding?.name || ''} · ${ruleName} (门槛 ${spreadThreshold.toFixed(2)}%)`
                  ) : (
                    '⚠️ 搬家需先录入持仓与策略 (已关闭)'
                  )}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isSyncing && (
                    <span className="text-[10px] text-indigo-500 font-mono animate-pulse">同步中...</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setMockHoldingsActive((v) => !v)}
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold border border-indigo-400/50 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950 shrink-0 cursor-pointer"
                  >
                    {isHoldingsReady ? '恢复锁定' : '⚡模拟激活'}
                  </button>
                </div>
              </div>
            </div>

            {/* ======================================================== */}
            {/* A. 手机端专属：高密度垂直行情报价列表 (App-Native 2-Tier Row) */}
            {/* 完美契合 375px~430px 屏幕，绝无横向溢出，一屏呈现 8+ 行 */}
            {/* ======================================================== */}
            <div className="block md:hidden bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs touch-pan-y">
              {/* 移动端吸顶表头 (粘性附着在顶栏下方 44px) */}
              <div className="sticky top-[44px] z-20 bg-slate-100/95 dark:bg-slate-800/95 backdrop-blur-xs rounded-t-xl px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <div className="w-[125px] shrink-0">标的 / 代码</div>
                <div className="flex-1 text-right pr-2">最新价 / IOPV</div>
                <div className="w-[85px] text-right pr-2">溢价率 / 涨跌</div>
                <div className="w-[52px] text-center shrink-0">操作</div>
              </div>

              {/* 移动端高密度数据流 */}
              <div className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-xs">
                {filteredTableData.map((item, idx) => {
                  const isLast = idx === filteredTableData.length - 1;
                  const rowBg = idx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/30';
                  return (
                    <div
                      key={item.code}
                      className={cx(
                        'px-3 py-2.5 flex items-center justify-between gap-1 transition',
                        rowBg,
                        isLast && 'rounded-b-xl'
                      )}
                    >
                      {/* 列 1: 标的名称 + 标的代码 & 属性标签 */}
                      <div className="w-[125px] shrink-0 truncate">
                        <div className="font-bold text-xs text-slate-900 dark:text-white truncate flex items-center gap-1">
                          <span className="truncate">{item.shortName || item.name}</span>
                          {item.isHeld && (
                            <span className="shrink-0 text-[8px] px-1 py-0.1 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-bold border border-indigo-500/30">
                              持仓
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <span>{item.code}</span>
                          {item.isHeld && (
                            <span className="text-[9px] font-mono text-indigo-500 font-semibold truncate">
                              {item.heldShares.toLocaleString()}份
                            </span>
                          )}
                          <span className={cx(
                            'text-[9px] px-1 py-0.1 rounded font-bold',
                            item.group === 'H' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          )}>
                            {item.group === 'H' ? '高溢价' : item.group === 'L' ? '低溢价' : '未分组'}
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
                          {item.premium >= 0 ? `+${item.premium.toFixed(2)}%` : `${item.premium.toFixed(2)}%`}
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
                            <div className="font-bold text-slate-900 dark:text-white text-xs truncate flex items-center gap-1.5">
                              <span className="truncate">{item.name}</span>
                              {item.isHeld && (
                                <span className="shrink-0 text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-bold border border-indigo-500/30">
                                  持仓
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
                              <span>{item.code}</span>
                              {item.isHeld && (
                                <span className="text-[10px] text-indigo-500 font-semibold truncate">
                                  {item.heldShares.toLocaleString()}份 (浮盈 {item.heldProfitRate >= 0 ? '+' : ''}{item.heldProfitRate.toFixed(1)}%)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={cx('sticky left-[180px] z-20 px-3.5 py-3 w-[105px] min-w-[105px] max-w-[105px] text-right font-black text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-800 shadow-[2px_0_6px_rgba(0,0,0,0.06)] group-hover:bg-indigo-50 dark:group-hover:bg-slate-800', rowBg)}>
                            {item.currentPrice.toFixed(3)}
                          </td>
                          <td className={cx('px-3 py-3 text-right font-black', item.currentChange >= 0 ? 'text-rose-500' : 'text-emerald-500')}>
                            {item.currentChange >= 0 ? `+${item.currentChange.toFixed(2)}%` : `${item.currentChange.toFixed(2)}%`}
                          </td>
                          <td className={cx('px-3 py-3 text-right font-bold', item.premium >= 10 ? 'text-rose-500 font-black' : item.premium >= 5 ? 'text-amber-500' : 'text-slate-600 dark:text-slate-400')}>
                            {item.premium >= 0 ? `+${item.premium.toFixed(2)}%` : `${item.premium.toFixed(2)}%`}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={cx('inline-block px-2 py-0.5 rounded text-[10px] font-bold', item.group === 'H' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30' : item.group === 'L' ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700' : 'bg-amber-50 text-amber-600 border border-amber-200')}>
                              {item.group === 'H' ? 'H (高溢价)' : item.group === 'L' ? 'L (低溢价)' : '未分组'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right text-slate-400 font-mono">{item.iopv.toFixed(3)}</td>
                          <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-300 font-mono">{item.vol.toLocaleString()}</td>
                          <td className="px-3 py-3 text-center">
                            <span className={cx('px-2 py-0.5 rounded text-[10px] font-bold', item.group === 'H' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20' : item.group === 'L' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20')}>
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
            ) : !premiumGrouping.hasValidSplit ? (
              <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur rounded-2xl p-4 sm:p-6 border border-amber-200 dark:border-amber-900/60 shadow-sm space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center text-xl shrink-0">⚠️</div>
                  <div>
                    <h3 className="font-black text-base sm:text-lg text-slate-900 dark:text-white">当前未形成有效 H / L 分组</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      当前最大相邻溢价断层为 {premiumGrouping.maxObservedGap == null ? '--' : premiumGrouping.maxObservedGap.toFixed(2) + '%'}，未达到配置的 H 组最低溢价减 L 组最高溢价门槛 {spreadThreshold.toFixed(2)}%。暂不生成切换跑道。
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('markets')}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition cursor-pointer"
                >
                  返回查看标的分组
                </button>
              </div>
            ) : (
              /* 状态 B：已激活状态 (已录入持仓与阈值时展现) */
              <div className="space-y-2.5 sm:space-y-3">
                {/* 顶部持仓指示条 */}
                <div className="bg-indigo-600/10 dark:bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-1.5 text-xs">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="font-bold text-indigo-700 dark:text-indigo-300 font-mono text-[11px] sm:text-xs">
                      {activeHolding?.code} {activeHolding?.shortName || activeHolding?.name} (持仓 {activeHolding?.totalShares.toLocaleString()} 份 · 浮盈 {activeHolding?.unrealizedReturnRate >= 0 ? '+' : ''}{activeHolding?.unrealizedReturnRate.toFixed(2)}%)
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">⇋</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono text-[11px] sm:text-xs">
                      {targetFund.code} {targetFund.shortName || targetFund.name} (低溢价换入 · 溢价 +{targetFund.premium.toFixed(2)}%)
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
                    <div className="text-xs sm:text-base font-bold font-mono text-emerald-500 mt-0.5">+{shareGain.toLocaleString()}份</div>
                  </div>
                </div>

                {/* 跑道卡片 */}
                <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur rounded-xl p-3.5 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                      <h3 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                        {activeHolding?.code} {activeHolding?.shortName || activeHolding?.name} ⇋ {targetFund.code} {targetFund.shortName || targetFund.name} 套利跑道
                      </h3>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold border border-rose-500/20">
                        {isOverThreshold ? '超额盈利区' : '蓄势待发区'}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">规则 #{ruleName}</span>
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
                        建议卖出 <b className="text-slate-800 dark:text-slate-200 font-mono">{activeHolding?.code}</b> 换入 <b className="text-slate-800 dark:text-slate-200 font-mono">{targetFund.code}</b> 锁定超额利差。
                      </div>
                      <button
                        type="button"
                        onClick={() => alert(`已生成搬家调仓计划单：卖出 ${activeHolding?.code} ${activeHolding?.shortName || activeHolding?.name} ${activeHolding?.totalShares.toLocaleString()} 份，预计换入 ${targetFund.code} ${targetFund.shortName || targetFund.name} ${estimateTargetShares.toLocaleString()} 份（测算增益 +${shareGain.toLocaleString()} 份）。`)}
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

              {/* 持仓与方案状态指示卡 */}
              <div className={cx('p-2.5 rounded-lg border text-xs', isHoldingsReady ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200' : 'border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200')}>
                <div className="flex items-center justify-between font-bold">
                  <span className="flex items-center gap-1">
                    <span>{isHoldingsReady ? '✅' : '⚠️'}</span>
                    <span>持仓状态：{isHoldingsReady ? `已激活 (${activeHolding?.code} ${activeHolding?.shortName || activeHolding?.name || ''})` : '未检测到持仓'}</span>
                  </span>
                  {isHoldingsReady ? (
                    <span className="text-[9px] bg-emerald-200 dark:bg-emerald-900/80 text-emerald-800 dark:text-emerald-200 px-1 py-0.2 rounded font-mono font-bold">
                      {ruleName}
                    </span>
                  ) : (
                    <span className="text-[9px] bg-amber-200 dark:bg-amber-900/80 text-amber-800 dark:text-amber-200 px-1 py-0.2 rounded font-mono font-bold">已关闭</span>
                  )}
                </div>
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
                    onClick={() => refreshSync()}
                    className="px-2 py-0.8 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[10px] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    title="从远程接口重新拉取最新持仓和切换方案"
                  >
                    {isSyncing ? '同步中...' : '🔄 重新拉取'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMockHoldingsActive((v) => !v)}
                    className="px-2 py-0.8 rounded border border-indigo-400 text-indigo-600 dark:text-indigo-300 font-bold text-[10px] hover:bg-indigo-50 cursor-pointer ml-auto"
                  >
                    {isHoldingsReady ? '恢复锁定' : '⚡模拟激活'}
                  </button>
                </div>
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
