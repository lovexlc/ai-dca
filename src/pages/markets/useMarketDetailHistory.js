// 详情页历史数据的调度 hook：K 线、净值历史、溢价快照。
// 从 MarketsExperience 抽出，组件只保留展示职责。
// 关键约定：
// - 普通加载全部走缓存优先（navHistoryClient / fund-metrics localStorage 自己有过期判定），
//   只有 refreshDetailHistory（明确刷新入口）才传 forceRefresh / forceLive。
// - 分时（5m）区间仍先走 live 再回退缓存：浏览器 K 线缓存按日期归一化，存不了分钟线。
// - 共享请求按自身 key 写缓存，完成或失败都正确结束 loading，
//   快速切换标的/区间不会让旧请求的取消丢掉结果或把 loading 卡死。
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchKline } from './marketsApiLoader.js';
import {
  getCnEtfPremiumSnapshotForMarkets,
  getNavHistoryForMarkets,
  getNavSnapshotForMarkets,
} from './marketsNavServiceLoader.js';
import { shouldFetchCnEtfPremiumSnapshot, shouldFetchDetailNavHistory } from './marketDetailDataPolicy.js';
import {
  shouldForceLiveChartRange,
} from './marketFundMetrics.js';
import { normalizeCnFundCode } from './marketDisplayUtils.js';
import { useCnFundDailyCandles } from './useCnFundDailyCandles.js';
import {
  loadDetailNavHistoryState,
  planDetailKlineRequest,
  planDetailNavRequest,
  shouldRequestDetailKline,
  shouldRequestDetailNavHistory,
} from './marketDetailHistory.js';

export function useMarketDetailHistory({
  market,
  selectedSymbol,
  chartRange,
  chartCustomRange,
  cnFundParam,
  isCnOtcFund,
  quotePrice,
  isOtcList = false,
}) {
  const [chartCandlesMap, setChartCandlesMap] = useState({});
  const [chartLoading, setChartLoading] = useState(false);
  const [premiumMap, setPremiumMap] = useState({});
  const [navHistoryMap, setNavHistoryMap] = useState({});
  const chartInflightRef = useRef(new Set());
  const activeChartRequestRef = useRef('');
  const premiumInflightRef = useRef(new Set());
  const navHistoryInflightRef = useRef(new Set());
  const navHistoryMapRef = useRef({});

  useEffect(() => {
    navHistoryMapRef.current = navHistoryMap;
  }, [navHistoryMap]);

  useCnFundDailyCandles({ market, selectedSymbol, chartCandlesMap, chartInflightRef, fetchKline, isOtcList, setChartCandlesMap });

  const runDetailKline = useCallback((plan, { force = false } = {}) => {
    if (chartInflightRef.current.has(plan.inflightKey)) return;
    chartInflightRef.current.add(plan.inflightKey);
    activeChartRequestRef.current = plan.requestKey;
    setChartLoading(true);
    (async () => {
      const options = { timeframe: plan.request.timeframe, limit: plan.request.limit, session: plan.request.session, market: plan.market };
      try {
        let r;
        if (force || shouldForceLiveChartRange(plan.rangeKey, plan.customRange)) {
          try {
            r = await fetchKline(plan.symbol, { ...options, forceLive: true });
          } catch {
            // 分时实时刷新短暂失败时读取浏览器或 Worker 缓存，避免刷新详情页后清空已有图表。
            r = await fetchKline(plan.symbol, options);
          }
        } else {
          r = await fetchKline(plan.symbol, options);
        }
        const candles = Array.isArray(r && r.candles) ? r.candles : [];
        setChartCandlesMap((prev) => ({ ...prev, [plan.cacheKey]: candles }));
      } catch {
        // 保留同一范围已加载的数据，瞬时网络错误不应把图表清空。
      } finally {
        chartInflightRef.current.delete(plan.inflightKey);
        if (activeChartRequestRef.current === plan.requestKey) setChartLoading(false);
      }
    })();
  }, []);

  const runDetailNavHistory = useCallback((plan, { force = false } = {}) => {
    if (navHistoryInflightRef.current.has(plan.key)) return;
    navHistoryInflightRef.current.add(plan.key);
    setNavHistoryMap((prev) => ({ ...prev, [plan.key]: { ...(prev[plan.key] || {}), loading: true, error: '' } }));
    loadDetailNavHistoryState({
      code: plan.code,
      query: { ...plan.query, forceLive: force === true },
      prevState: navHistoryMapRef.current?.[plan.key] || null,
      getNavHistory: getNavHistoryForMarkets,
      getNavSnapshot: getNavSnapshotForMarkets,
    })
      .then((state) => {
        setNavHistoryMap((prev) => ({ ...prev, [plan.key]: state }));
      })
      .finally(() => {
        navHistoryInflightRef.current.delete(plan.key);
      });
  }, []);

  const runDetailPremiumSnapshot = useCallback((symbol, price, { force = false } = {}) => {
    if (premiumInflightRef.current.has(symbol)) return;
    premiumInflightRef.current.add(symbol);
    setPremiumMap((prev) => ({ ...prev, [symbol]: { loading: true, data: prev[symbol]?.data || null, error: '' } }));
    (async () => {
      try {
        const premium = await getCnEtfPremiumSnapshotForMarkets(symbol, {
          price,
          qqqChangePercent: 0,
          forceRefresh: force === true,
        });
        setPremiumMap((prev) => ({ ...prev, [symbol]: { loading: false, error: '', data: premium } }));
      } catch (error) {
        setPremiumMap((prev) => ({
          ...prev,
          [symbol]: { loading: false, data: prev[symbol]?.data || null, error: error instanceof Error ? error.message : '溢价计算失败' },
        }));
      } finally {
        premiumInflightRef.current.delete(symbol);
      }
    })();
  }, []);

  // 当 selectedSymbol / chartRange 变化时拉取对应 tf 的 candles。
  useEffect(() => {
    if (!selectedSymbol) return;
    const plan = planDetailKlineRequest(market, selectedSymbol, chartRange, chartCustomRange);
    activeChartRequestRef.current = plan.requestKey;
    const settled = Object.prototype.hasOwnProperty.call(chartCandlesMap, plan.cacheKey);
    const inflight = chartInflightRef.current.has(plan.inflightKey);
    if (!shouldRequestDetailKline({ settled, inflight })) {
      // 同一请求在途则继续显示加载；已有该区间的结果则立即结束 loading。
      setChartLoading(inflight);
      return;
    }
    runDetailKline(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, selectedSymbol, chartRange, chartCustomRange?.from, chartCustomRange?.to, chartCandlesMap, runDetailKline]);

  useEffect(() => {
    if (!shouldFetchDetailNavHistory({ market, symbol: selectedSymbol, cnFundParam, isCnOtcFund })) return;
    const code = normalizeCnFundCode(selectedSymbol);
    if (!/^\d{6}$/.test(code)) return;
    const plan = planDetailNavRequest(code, chartRange, chartCustomRange);
    const state = navHistoryMap[plan.key];
    const settled = Boolean(state) && state.loading === false;
    if (!shouldRequestDetailNavHistory({ settled, inflight: navHistoryInflightRef.current.has(plan.key) })) return;
    runDetailNavHistory(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, selectedSymbol, cnFundParam, isCnOtcFund, chartRange, chartCustomRange?.from, chartCustomRange?.to, navHistoryMap, runDetailNavHistory]);

  useEffect(() => {
    if (!shouldFetchCnEtfPremiumSnapshot({ market, symbol: selectedSymbol, cnFundParam, isCnOtcFund })) return;
    const code = normalizeCnFundCode(selectedSymbol);
    if (!/^\d{6}$/.test(code)) return;
    runDetailPremiumSnapshot(code, Number(quotePrice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, selectedSymbol, cnFundParam, isCnOtcFund, quotePrice, runDetailPremiumSnapshot]);

  // 明确刷新入口：只有用户触发的重试/刷新才绕过缓存。
  const refreshDetailHistory = useCallback(() => {
    if (!selectedSymbol) return;
    const klinePlan = planDetailKlineRequest(market, selectedSymbol, chartRange, chartCustomRange);
    runDetailKline(klinePlan, { force: true });
    const code = normalizeCnFundCode(selectedSymbol);
    if (shouldFetchDetailNavHistory({ market, symbol: selectedSymbol, cnFundParam, isCnOtcFund }) && /^\d{6}$/.test(code)) {
      const navPlan = planDetailNavRequest(code, chartRange, chartCustomRange);
      runDetailNavHistory(navPlan, { force: true });
    }
    if (shouldFetchCnEtfPremiumSnapshot({ market, symbol: selectedSymbol, cnFundParam, isCnOtcFund }) && /^\d{6}$/.test(code)) {
      runDetailPremiumSnapshot(code, Number(quotePrice), { force: true });
    }
  }, [market, selectedSymbol, chartRange, chartCustomRange?.from, chartCustomRange?.to, cnFundParam, isCnOtcFund, quotePrice, runDetailKline, runDetailNavHistory, runDetailPremiumSnapshot]);

  return {
    chartCandlesMap,
    chartLoading,
    premiumMap,
    navHistoryMap,
    refreshDetailHistory,
  };
}
