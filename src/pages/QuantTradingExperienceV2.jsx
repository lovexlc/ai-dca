import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  ListChecks,
  Play,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  TrendingUp,
  Trophy,
  Zap
} from 'lucide-react';
import { Card } from '../components/experience-ui.jsx';
import { TagInput } from '../components/TagInput.jsx';
import { MetricCard } from '../components/MetricCard.jsx';
import { TabNavigation } from '../components/TabNavigation.jsx';
import { RealTimeSignalCard } from '../components/RealTimeSignalCard.jsx';
import { InteractiveChartContainer } from '../components/InteractiveChartContainer.jsx';
import { TradeHistoryCard } from '../components/TradeHistoryCard.jsx';
import { EquityChart, KlineChart, PremiumChart } from '../components/BacktestCharts.jsx';
import { showToast } from '../app/toast.js';
import { formatTradeDateTime } from '../app/tradeDisplay.js';
import {
  approveQuantPremiumBacktestInWorker,
  loadQuantPremiumStrategiesFromWorker,
  loadQuantPremiumBacktestLatestFromWorker,
  loadQuantPremiumStrategySnapshotFromWorker,
  normalizeQuantPremiumConfigShape,
  saveQuantPremiumStrategyToWorker,
  runQuantPremiumOnce
} from '../app/quantPremiumSync.js';
import { runBacktest } from '../app/backtest/index.js';
import { fetchBacktestData } from '../app/backtestDataFetcher.js';
import '../styles/quant-studio-redesign.css';

const BACKTEST_TIMEFRAME_OPTIONS = [
  { value: '5m', label: '5m 默认（约 3-4 周）' },
  { value: '1m', label: '1m（约 3-4 个交易日）' },
  { value: '15m', label: '15m（约 2-3 个月）' },
  { value: '30m', label: '30m' },
  { value: '60m', label: '60m' },
  { value: '1d', label: '1d（日线长期）' }
];

const QUANT_V2_TABS = new Set(['config', 'backtest', 'live', 'history']);

function normalizeQuantV2Tab(value = '') {
  const tab = String(value || '').trim();
  return QUANT_V2_TABS.has(tab) ? tab : 'config';
}

// 格式化辅助函数
function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatPercent(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '--';
  return num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function readPercentInput(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeLiveSignal(snapshot) {
  const source = snapshot?.signal
    || (Array.isArray(snapshot?.signals) ? snapshot.signals[0] : null)
    || (Array.isArray(snapshot?.triggers) ? snapshot.triggers[0] : null);
  if (!source || typeof source !== 'object') return null;
  const gapValue = Number(source.gapPct ?? source.gapPercent);
  return {
    rule: source.rule || source.ruleName || source.ruleId || '',
    fromCode: source.fromCode || source.from || source.from_code || '',
    toCode: source.toCode || source.to || source.to_code || '',
    gapPct: Number.isFinite(gapValue) ? gapValue.toFixed(2) : '',
    threshold: source.threshold ?? source.triggerPct ?? '',
    triggered: source.triggered !== undefined ? Boolean(source.triggered) : true,
    timestamp: source.timestamp || source.ts || source.date || snapshot.generatedAt || snapshot.computedAt || ''
  };
}

function resolveTradeSettlementValue(trade = {}) {
  if (trade.type === 'buy') return trade.totalCost ?? trade.amount;
  return trade.netProceeds ?? trade.amount;
}

function backtestStatusLabel(status = '') {
  if (status === 'passed') return '回测有效';
  if (status === 'failed') return '回测无效';
  if (status === 'stale') return '需重新回测';
  return '未回测';
}

function backtestStatusClass(status = '') {
  if (status === 'passed') return 'bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'bg-rose-50 text-rose-700';
  if (status === 'stale') return 'bg-amber-50 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

export default function QuantTradingExperienceV2({ initialTab = 'config', singleTab = false } = {}) {
  // 状态管理
  const [strategies, setStrategies] = useState([]);
  const [activeStrategyId, setActiveStrategyId] = useState('');
  const [activeTab, setActiveTab] = useState(() => normalizeQuantV2Tab(initialTab));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backtesting, setBacktesting] = useState(false);

  // 策略配置
  const [highCodes, setHighCodes] = useState([]);
  const [lowCodes, setLowCodes] = useState([]);
  const [ruleA, setRuleA] = useState(1);  // intraSellLowerPct: 卖L买H的阈值
  const [ruleB, setRuleB] = useState(3);  // intraBuyOtherPct: 卖H买L的阈值
  const [backtestTf, setBacktestTf] = useState('5m');
  const [buyFeeRate, setBuyFeeRate] = useState(1);   // 买入手续费，单位：万X
  const [sellFeeRate, setSellFeeRate] = useState(1); // 卖出手续费，单位：万X

  // 回测结果
  const [backtest, setBacktest] = useState(null);
  const [chartView, setChartView] = useState('equity');

  // 实盘监控
  const [snapshot, setSnapshot] = useState(null);
  const [liveSignals, setLiveSignals] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setActiveTab(normalizeQuantV2Tab(initialTab));
  }, [initialTab]);

  // 加载策略列表
  useEffect(() => {
    loadStrategies();
    // 初始进入 v2 工作台时加载一次策略；后续策略切换由 loadStrategy 显式处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStrategies() {
    try {
      const list = await loadQuantPremiumStrategiesFromWorker();
      setStrategies(list);
      const nextId = activeStrategyId && list.some((item) => item.id === activeStrategyId)
        ? activeStrategyId
        : list[0]?.id || '';
      if (nextId) {
        await loadStrategy(nextId, list);
      }
    } catch (error) {
      console.error('加载策略失败:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadStrategy(strategyId, sourceStrategies = strategies) {
    setActiveStrategyId(strategyId);
    const strategy = sourceStrategies.find(s => s.id === strategyId);
    if (strategy) {
      setHighCodes(strategy.highCodes || []);
      setLowCodes(strategy.lowCodes || []);
      setRuleA(strategy.intraSellLowerPct || 1);
      setRuleB(strategy.intraBuyOtherPct || 3);
    } else {
      setHighCodes([]);
      setLowCodes([]);
      setRuleA(1);
      setRuleB(3);
    }

    // 加载回测结果
    try {
      const { result, gate } = await loadQuantPremiumBacktestLatestFromWorker(strategyId);
      setBacktest(result);
      if (gate) {
        setStrategies((current) => current.map((item) => item.id === strategyId
          ? normalizeQuantPremiumConfigShape({ ...item, backtestGate: gate })
          : item));
      }
      if (result?.timeframe) {
        setBacktestTf(result.timeframe);
      }
    } catch (error) {
      console.error('加载回测结果失败:', error);
    }

    // 加载实盘快照
    try {
      const snap = await loadQuantPremiumStrategySnapshotFromWorker(strategyId);
      setSnapshot(snap?.snapshot || null);
    } catch (error) {
      console.error('加载实盘快照失败:', error);
    }
  }

  function handleCreateStrategy() {
    const id = `strategy-${Date.now().toString(36)}`;
    const next = normalizeQuantPremiumConfigShape({
      id,
      enabled: true,
      name: `V2 策略 ${strategies.length + 1}`,
      highCodes: [],
      lowCodes: [],
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3
    });
    setStrategies((current) => [next, ...current]);
    setActiveStrategyId(id);
    setHighCodes([]);
    setLowCodes([]);
    setRuleA(1);
    setRuleB(3);
    setBacktest(null);
    setSnapshot(null);
    setActiveTab('config');
  }

  async function handleRefreshSnapshot() {
    if (!activeStrategyId) return;
    setRefreshing(true);
    try {
      const result = await runQuantPremiumOnce(activeStrategyId);
      const nextSnapshot = result.snapshot || null;
      const nextSignal = normalizeLiveSignal(nextSnapshot);
      setSnapshot(nextSnapshot);
      if (nextSignal) {
        setLiveSignals([nextSignal, ...liveSignals.slice(0, 9)]);
      }
      showToast({ title: '刷新成功', tone: 'emerald' });
    } catch (error) {
      showToast({ title: '刷新失败', description: error.message, tone: 'rose' });
    } finally {
      setRefreshing(false);
    }
  }

  function buildCurrentStrategyConfig() {
    const existing = strategies.find((item) => item.id === activeStrategyId);
    return normalizeQuantPremiumConfigShape({
      ...existing,
      id: existing?.id || activeStrategyId || 'default',
      enabled: existing?.enabled ?? true,
      highCodes: Array.isArray(highCodes) ? highCodes : [],
      lowCodes: Array.isArray(lowCodes) ? lowCodes : [],
      intraSellLowerPct: readPercentInput(ruleA, 1),
      intraBuyOtherPct: readPercentInput(ruleB, 3)
    });
  }

  function applySavedStrategy(result) {
    setStrategies(result.strategies);
    setActiveStrategyId(result.strategy.id);
    setHighCodes(result.strategy.highCodes || []);
    setLowCodes(result.strategy.lowCodes || []);
    setRuleA(result.strategy.intraSellLowerPct || 1);
    setRuleB(result.strategy.intraBuyOtherPct || 3);
  }

  async function handleSaveStrategy() {
    const config = buildCurrentStrategyConfig();
    if (!config.highCodes.length || !config.lowCodes.length) {
      showToast({ title: 'H 和 L 至少各设置一只 ETF', tone: 'amber' });
      return;
    }

    setSaving(true);
    try {
      const result = await saveQuantPremiumStrategyToWorker(config);
      applySavedStrategy(result);
      showToast({ title: '策略已保存', tone: 'emerald' });
    } catch (error) {
      showToast({ title: '保存失败', description: error.message, tone: 'rose' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndBacktest() {
    // 确保从状态读取最新值
    const currentHighCodes = Array.isArray(highCodes) ? highCodes : [];
    const currentLowCodes = Array.isArray(lowCodes) ? lowCodes : [];
    const currentRuleA = readPercentInput(ruleA, 1);
    const currentRuleB = readPercentInput(ruleB, 3);

    console.log('回测前检查:', {
      highCodes: currentHighCodes,
      lowCodes: currentLowCodes,
      ruleA: currentRuleA,
      ruleB: currentRuleB
    });

    if (currentHighCodes.length === 0 || currentLowCodes.length === 0) {
      showToast({ title: 'H 和 L 至少各设置一只 ETF', tone: 'amber' });
      return;
    }

    setBacktesting(true);
    try {
      // 保存配置 - 使用当前值（允许负数）
      const config = buildCurrentStrategyConfig();

      console.log('保存配置:', config);

      const saveResult = await saveQuantPremiumStrategyToWorker(config);
      applySavedStrategy(saveResult);

      // 使用本地回测引擎
      const strategy = saveResult.strategy;
      const highCodes = strategy.highCodes || [];
      const lowCodes = strategy.lowCodes || [];
      const codes = Array.from(new Set([...highCodes, ...lowCodes]));

      // 获取历史数据
      const { historyByCode, navHistoryByCode } = await fetchBacktestData(codes);

      // 构建回测配置
      const backtestStrategy = {
        type: 'premium-spread',
        highCodes,
        lowCodes,
        intraSellLowerPct: strategy.intraSellLowerPct || 0.2,
        intraBuyOtherPct: strategy.intraBuyOtherPct || 0.5,
        activeSide: strategy.activeSide || 'all'
      };

      const backtestOptions = {
        timeframe: backtestTf,
        historyByCode,
        navHistoryByCode,
        initialEquity: 100000,
        feeRate: (Number(buyFeeRate) + Number(sellFeeRate)) / 2 / 10000,
        minFee: 0,
        tickSize: 0.001,
        slippageTicks: 1,
        lotSize: 100
      };

      const result = runBacktest(backtestStrategy, backtestOptions);

      console.log('回测结果:', result);

      setBacktest(result);
      if (result?.status) {
        const nextGate = {
          ...(saveResult.strategy.backtestGate || {}),
          status: result.status,
          latestRunId: result.runId || saveResult.strategy.backtestGate?.latestRunId || '',
          approvedAt: '',
          approvedFingerprint: '',
          summary: result.summary || saveResult.strategy.backtestGate?.summary || null,
          updatedAt: result.finishedAt || new Date().toISOString()
        };
        setStrategies((current) => current.map((item) => item.id === saveResult.strategy.id
          ? normalizeQuantPremiumConfigShape({ ...item, backtestGate: nextGate })
          : item));
      }
      setActiveTab('backtest');
      showToast({ title: result?.status === 'passed' ? '回测有效' : '回测完成', tone: result?.status === 'passed' ? 'emerald' : 'amber' });
    } catch (error) {
      console.error('回测失败:', error);
      showToast({ title: '回测失败', description: error.message, tone: 'rose' });
    } finally {
      setBacktesting(false);
    }
  }

  async function handleLiveSignalToggle(enabled) {
    const targetStrategy = strategies.find((item) => item.id === activeStrategyId);
    if (!targetStrategy) return;
    setSaving(true);
    try {
      const result = enabled
        ? await approveQuantPremiumBacktestInWorker(
          targetStrategy.id,
          backtest?.runId || targetStrategy.backtestGate?.latestRunId || '',
          { enableLiveSignal: true }
        )
        : await saveQuantPremiumStrategyToWorker({
          ...targetStrategy,
          liveSignalEnabled: false
        });
      applySavedStrategy(result);
      showToast({ title: enabled ? '实盘信号已确认' : '实盘信号已关闭', tone: 'emerald' });
    } catch (error) {
      showToast({ title: '实盘信号更新失败', description: error.message, tone: 'rose' });
    } finally {
      setSaving(false);
    }
  }

  // 计算核心指标
  const currentStrategy = strategies.find((item) => item.id === activeStrategyId) || null;
  const summary = backtest?.summary || {};
  const totalReturnPct = summary.totalReturnPct || 0;
  const winRatePct = summary.winRatePct || 0;
  const sharpeRatio = summary.sharpeRatio || 0;
  const maxDrawdownPct = summary.maxDrawdownPct || 0;
  const backtestGate = currentStrategy?.backtestGate || {};
  const visibleBacktestStatus = backtest?.status || backtestGate.status;
  const backtestPassed = visibleBacktestStatus === 'passed';
  const backtestApproved = backtestPassed && Boolean(backtestGate.approvedAt) && currentStrategy?.liveSignalEnabled;
  const backtestQuality = backtest?.quality || null;
  const missingKlineCodes = Array.isArray(backtestQuality?.missingKlineCodes) ? backtestQuality.missingKlineCodes : [];
  const backtestRange = summary.from || summary.to ? `${summary.from || '--'} 至 ${summary.to || '--'}` : '--';

  const returnTone = totalReturnPct > 0 ? 'positive' : totalReturnPct < 0 ? 'negative' : 'neutral';
  const winRateTone = winRatePct >= 60 ? 'positive' : winRatePct >= 50 ? 'neutral' : 'negative';
  const sharpeTone = sharpeRatio >= 1.5 ? 'positive' : sharpeRatio >= 1 ? 'neutral' : 'negative';
  const drawdownTone = Math.abs(maxDrawdownPct) <= 5 ? 'positive' : Math.abs(maxDrawdownPct) <= 10 ? 'neutral' : 'negative';
  const currentLiveSignal = normalizeLiveSignal(snapshot);
  const showSharedChrome = !singleTab;
  const showBacktestMetrics = showSharedChrome || activeTab === 'backtest';

  // Tab 配置 - 仅保留策略配置
  const tabs = [
    { id: 'config', label: '策略配置', mobileLabel: '配置', icon: Settings }
  ];

  // 图表视图配置
  const chartViews = [
    { id: 'equity', label: '权益曲线' },
    { id: 'kline', label: 'K线+信号' },
    { id: 'premium', label: '溢价差' }
  ];

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <RefreshCw className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
          <p className="mt-3 text-sm text-slate-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="quant-studio-v2 min-h-screen bg-slate-50">
      {/* 顶部导航栏 */}
      {showSharedChrome ? <div className="border-b border-slate-200 bg-white px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold text-slate-900 truncate">量化研究</h1>
            <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-slate-600">ETF溢价差轮动</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <select
              value={activeStrategyId}
              onChange={(e) => loadStrategy(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 sm:px-4 py-2.5 min-h-[44px] text-xs sm:text-sm font-semibold text-slate-900 max-w-[120px] sm:max-w-none"
            >
              {strategies.map(s => (
                <option key={s.id} value={s.id}>{s.name || s.id}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCreateStrategy}
              className="rounded-lg bg-indigo-600 px-3 sm:px-4 py-2.5 min-h-[44px] text-xs sm:text-sm font-semibold text-white hover:bg-indigo-700 whitespace-nowrap"
            >
              <span className="hidden sm:inline">+ 新建策略</span>
              <span className="sm:hidden">+</span>
            </button>
          </div>
        </div>
      </div> : null}

      {/* 核心指标卡片区 */}
      {showBacktestMetrics ? <div className="px-4 sm:px-6 py-4 sm:py-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          <MetricCard
            label="累计收益"
            value={formatPercent(totalReturnPct, 2)}
            subtitle={formatMoney(summary.totalProfit || 0)}
            tone={returnTone}
            Icon={TrendingUp}
          />
          <MetricCard
            label="盈利轮动"
            value={formatPercent(winRatePct, 0)}
            subtitle={`${summary.trades || 0} 次轮动`}
            tone={winRateTone}
            Icon={Trophy}
          />
          <MetricCard
            label="夏普比率"
            value={formatNumber(sharpeRatio, 2)}
            subtitle="风险调整后收益"
            tone={sharpeTone}
            Icon={Zap}
          />
          <MetricCard
            label="最大回撤"
            value={formatPercent(maxDrawdownPct, 2)}
            subtitle="历史最大损失"
            tone={drawdownTone}
            Icon={Activity}
          />
        </div>

        {/* 持有对比 */}
        {backtest && (summary.holdHighReturnPct !== undefined || summary.holdLowReturnPct !== undefined) && (
          <div className="mt-4 sm:mt-6">
            <Card className="hold-comparison-card animate-in p-4 sm:p-6 bg-slate-50">
              <h3 className="text-xs sm:text-sm font-semibold text-slate-700 mb-3">持有收益对比</h3>
              <div className="grid grid-cols-3 gap-3 sm:gap-4">
                <div className="text-center">
                  <div className="text-xs text-slate-600">策略收益</div>
                  <div className={`mt-1 text-lg sm:text-xl font-bold ${
                    totalReturnPct > 0 ? 'text-emerald-600' : totalReturnPct < 0 ? 'text-rose-600' : 'text-slate-900'
                  }`}>
                    {formatPercent(totalReturnPct, 2)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">轮动策略</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-600">持有 H</div>
                  <div className={`mt-1 text-lg sm:text-xl font-bold ${
                    summary.holdHighReturnPct === null ? 'text-slate-400' :
                    summary.holdHighReturnPct > 0 ? 'text-emerald-600' :
                    summary.holdHighReturnPct < 0 ? 'text-rose-600' : 'text-slate-900'
                  }`}>
                    {summary.holdHighReturnPct === null ? 'N/A' : formatPercent(summary.holdHighReturnPct, 2)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{summary.highCode || ''}</div>
                  {summary.holdHighReturnPct === null && (
                    <div className="text-xs text-slate-400 mt-1">数据不足</div>
                  )}
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-600">持有 L</div>
                  <div className={`mt-1 text-lg sm:text-xl font-bold ${
                    summary.holdLowReturnPct === null ? 'text-slate-400' :
                    summary.holdLowReturnPct > 0 ? 'text-emerald-600' :
                    summary.holdLowReturnPct < 0 ? 'text-rose-600' : 'text-slate-900'
                  }`}>
                    {summary.holdLowReturnPct === null ? 'N/A' : formatPercent(summary.holdLowReturnPct, 2)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{summary.lowCode || ''}</div>
                  {summary.holdLowReturnPct === null && (
                    <div className="text-xs text-slate-400 mt-1">数据不足</div>
                  )}
                </div>
              </div>
              {summary.holdHighReturnPct !== null && summary.holdLowReturnPct !== null &&
               totalReturnPct > summary.holdHighReturnPct && totalReturnPct > summary.holdLowReturnPct && (
                <div className="mt-3 text-center">
                  <span className="badge-outperform">
                    <TrendingUp className="h-3 w-3" />
                    策略跑赢单独持有
                  </span>
                </div>
              )}
            </Card>
          </div>
        )}
      </div> : null}

      {/* Tab 导航 - 只有一个 tab 时隐藏 */}
      {showSharedChrome && tabs.length > 1 ? <TabNavigation
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
        className="sticky top-0 z-10 shadow-sm"
      /> : null}

      {/* Tab 内容区 - 只显示策略配置 */}
      <div className="px-4 sm:px-6 py-4 sm:py-8">
        <div className="mx-auto max-w-4xl space-y-4 sm:space-y-8">
            <Card className="config-card animate-in p-4 sm:p-8">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">ETF 配置</h2>
              <p className="mt-1 text-xs sm:text-sm text-slate-600">配置高溢价（H）和低溢价（L）ETF池</p>

              <div className="mt-6 space-y-6">
                <TagInput
                  label="H 高溢价 ETF（卖出方）"
                  placeholder="输入代码如 159513"
                  tags={highCodes}
                  onChange={setHighCodes}
                />

                <TagInput
                  label="L 低溢价 ETF（买入方）"
                  placeholder="输入代码如 159501"
                  tags={lowCodes}
                  onChange={setLowCodes}
                />
              </div>
            </Card>

            <Card className="config-card animate-in animate-in-delay-1 p-4 sm:p-8">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">交易规则</h2>
              <p className="mt-1 text-xs sm:text-sm text-slate-600">配置溢价差触发阈值</p>

              <div className="mt-6 space-y-6">
                <div className="rule-config-row">
                  <label htmlFor="quant-v2-rule-a" className="block text-sm font-semibold text-slate-700 mb-3">
                    规则 A：卖 L 买 H
                  </label>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="text-xs sm:text-sm text-slate-600">溢价差 ≤</span>
                    <input
                      id="quant-v2-rule-a"
                      aria-label="规则 A：卖 L 买 H"
                      type="text"
                      inputMode="decimal"
                      value={ruleA}
                      onChange={(e) => {
                        const val = e.target.value;
                        // 允许负号、数字和小数点
                        if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                          setRuleA(val);
                        }
                      }}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (val === '' || val === '-' || val === '.') {
                          setRuleA(1);
                          return;
                        }
                        const num = parseFloat(val);
                        setRuleA(Number.isFinite(num) ? num : 1);
                      }}
                      className="w-20 sm:w-24 rounded-lg border border-slate-300 px-3 py-2.5 min-h-[44px] text-center text-sm font-semibold"
                    />
                    <span className="text-xs sm:text-sm text-slate-600">% 时触发</span>
                  </div>
                  <p className="rule-hint mt-2 text-xs text-slate-500">
                    持有L时，溢价差缩小到此阈值以内，卖出L买入H
                  </p>
                </div>

                <div className="rule-config-row">
                  <label htmlFor="quant-v2-rule-b" className="block text-sm font-semibold text-slate-700 mb-3">
                    规则 B：卖 H 买 L
                  </label>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="text-xs sm:text-sm text-slate-600">溢价差 ≥</span>
                    <input
                      id="quant-v2-rule-b"
                      aria-label="规则 B：卖 H 买 L"
                      type="text"
                      inputMode="decimal"
                      value={ruleB}
                      onChange={(e) => {
                        const val = e.target.value;
                        // 允许负号、数字和小数点
                        if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                          setRuleB(val);
                        }
                      }}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (val === '' || val === '-' || val === '.') {
                          setRuleB(3);
                          return;
                        }
                        const num = parseFloat(val);
                        setRuleB(Number.isFinite(num) ? num : 3);
                      }}
                      className="w-20 sm:w-24 rounded-lg border border-slate-300 px-3 py-2.5 min-h-[44px] text-center text-sm font-semibold"
                    />
                    <span className="text-xs sm:text-sm text-slate-600">% 时触发</span>
                  </div>
                  <p className="rule-hint mt-2 text-xs text-slate-500">
                    持有H时，溢价差扩大到此阈值以上，卖出H买入L
                  </p>
                </div>
              </div>
            </Card>

            <Card className="config-card animate-in animate-in-delay-2 p-4 sm:p-8">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">交易费用</h2>
              <p className="mt-1 text-xs sm:text-sm text-slate-600">配置买入和卖出的手续费率（单位：万X）</p>

              <div className="mt-6 space-y-6">
                <div>
                  <label htmlFor="buy-fee-rate" className="block text-sm font-semibold text-slate-700 mb-3">
                    买入手续费
                  </label>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="text-xs sm:text-sm text-slate-600">万</span>
                    <input
                      id="buy-fee-rate"
                      aria-label="买入手续费"
                      type="text"
                      inputMode="decimal"
                      value={buyFeeRate}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || /^\d*\.?\d*$/.test(val)) {
                          setBuyFeeRate(val);
                        }
                      }}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (val === '' || val === '.') {
                          setBuyFeeRate(1);
                          return;
                        }
                        const num = parseFloat(val);
                        setBuyFeeRate(Number.isFinite(num) && num >= 0 ? num : 1);
                      }}
                      className="w-20 sm:w-24 rounded-lg border border-slate-300 px-3 py-2.5 min-h-[44px] text-center text-sm font-semibold"
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    万1 = 0.01%，万0.5 = 0.005%
                  </p>
                </div>

                <div>
                  <label htmlFor="sell-fee-rate" className="block text-sm font-semibold text-slate-700 mb-3">
                    卖出手续费
                  </label>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="text-xs sm:text-sm text-slate-600">万</span>
                    <input
                      id="sell-fee-rate"
                      aria-label="卖出手续费"
                      type="text"
                      inputMode="decimal"
                      value={sellFeeRate}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || /^\d*\.?\d*$/.test(val)) {
                          setSellFeeRate(val);
                        }
                      }}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (val === '' || val === '.') {
                          setSellFeeRate(1);
                          return;
                        }
                        const num = parseFloat(val);
                        setSellFeeRate(Number.isFinite(num) && num >= 0 ? num : 1);
                      }}
                      className="w-20 sm:w-24 rounded-lg border border-slate-300 px-3 py-2.5 min-h-[44px] text-center text-sm font-semibold"
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    万1 = 0.01%，万0.5 = 0.005%
                  </p>
                </div>

                <div className="info-box">
                  <div className="info-box-icon">💡</div>
                  <div className="info-box-content">
                    <p className="info-box-title">手续费说明</p>
                    <p>场内 ETF 的手续费通常在万0.5到万2.5之间，具体费率以券商为准。</p>
                  </div>
                </div>
              </div>
            </Card>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSaveStrategy}
                disabled={saving}
                className="btn-secondary flex-1 rounded-xl bg-slate-600 px-6 py-3 sm:py-4 text-sm sm:text-base font-bold text-white hover:bg-slate-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save className="h-5 w-5" />
                    保存策略
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleSaveAndBacktest}
                disabled={backtesting}
                className="btn-run flex-1 rounded-xl bg-indigo-600 px-6 py-3 sm:py-4 text-sm sm:text-base font-bold text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {backtesting ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    回测中...
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5" />
                    保存并运行回测
                  </>
                )}
              </button>
            </div>
          </div>
      </div>
    </div>
  );
}
