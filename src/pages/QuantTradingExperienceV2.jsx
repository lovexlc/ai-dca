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
  loadQuantPremiumStrategiesFromWorker,
  loadQuantPremiumBacktestLatestFromWorker,
  loadQuantPremiumStrategySnapshotFromWorker,
  normalizeQuantPremiumConfigShape,
  saveQuantPremiumStrategyToWorker,
  runQuantPremiumBacktestInWorker,
  runQuantPremiumOnce
} from '../app/quantPremiumSync.js';

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

export default function QuantTradingExperienceV2({ initialTab = 'config' } = {}) {
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

      // 运行回测
      const result = await runQuantPremiumBacktestInWorker(saveResult.strategy.id, {
        timeframe: backtestTf,
        useV2: true,
        feeRate: (Number(buyFeeRate) + Number(sellFeeRate)) / 2 / 10000  // 转换为小数
      });

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
    const targetGate = targetStrategy.backtestGate || {};
    setSaving(true);
    try {
      const effectiveBacktestGate = targetGate?.status === 'passed' || backtest?.status !== 'passed'
        ? targetGate
        : {
          ...(targetGate || {}),
          status: 'passed',
          latestRunId: backtest.runId || targetGate?.latestRunId || '',
          summary: backtest.summary || targetGate?.summary || null,
          updatedAt: backtest.finishedAt || new Date().toISOString()
        };
      const result = await saveQuantPremiumStrategyToWorker({
        ...targetStrategy,
        backtestGate: effectiveBacktestGate,
        liveSignalEnabled: enabled,
        approveLiveSignal: enabled
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

  // Tab 配置
  const tabs = [
    { id: 'config', label: '策略配置', mobileLabel: '配置', icon: Settings },
    { id: 'backtest', label: '回测', mobileLabel: '回测', icon: BarChart3, badge: backtest ? '✓' : null },
    { id: 'live', label: '实盘监控', mobileLabel: '实盘', icon: Activity },
    { id: 'history', label: '交易历史', mobileLabel: '历史', icon: ListChecks }
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
    <div className="min-h-screen bg-slate-50">
      {/* 顶部导航栏 */}
      <div className="border-b border-slate-200 bg-white px-4 sm:px-6 py-3 sm:py-4">
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
      </div>

      {/* 核心指标卡片区 */}
      <div className="px-4 sm:px-6 py-4 sm:py-8">
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
            <Card className="p-4 sm:p-6 bg-slate-50">
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
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                    <TrendingUp className="h-3 w-3" />
                    策略跑赢单独持有
                  </span>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* Tab 导航 */}
      <TabNavigation
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
        className="sticky top-0 z-10 shadow-sm"
      />

      {/* Tab 内容区 */}
      <div className="px-4 sm:px-6 py-4 sm:py-8">
        {activeTab === 'config' && (
          <div className="mx-auto max-w-4xl space-y-4 sm:space-y-8">
            <Card className="p-4 sm:p-8">
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

            <Card className="p-4 sm:p-8">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">交易规则</h2>
              <p className="mt-1 text-xs sm:text-sm text-slate-600">配置溢价差触发阈值</p>

              <div className="mt-6 space-y-6">
                <div>
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
                  <p className="mt-2 text-xs text-slate-500">
                    持有L时，溢价差缩小到此阈值以内，卖出L买入H
                  </p>
                </div>

                <div>
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
                  <p className="mt-2 text-xs text-slate-500">
                    持有H时，溢价差扩大到此阈值以上，卖出H买入L
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4 sm:p-8">
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

                <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
                  <div className="flex gap-2">
                    <span className="text-blue-600">💡</span>
                    <div className="flex-1 text-xs text-blue-900">
                      <p className="font-semibold mb-1">手续费说明</p>
                      <p>场内 ETF 的手续费通常在万0.5到万2.5之间，具体费率以券商为准。</p>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSaveStrategy}
                disabled={saving}
                className="flex-1 rounded-xl bg-slate-600 px-6 py-3 sm:py-4 text-sm sm:text-base font-bold text-white hover:bg-slate-700 disabled:opacity-50 flex items-center justify-center gap-2"
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
                className="flex-1 rounded-xl bg-indigo-600 px-6 py-3 sm:py-4 text-sm sm:text-base font-bold text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
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
        )}

        {activeTab === 'backtest' && (
          <div className="mx-auto max-w-7xl space-y-4 sm:space-y-8">
            <Card className="p-4 sm:p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-400">BACKTEST</div>
                  <h2 className="mt-1 text-base sm:text-lg font-bold text-slate-900">历史回测</h2>
                  <p className="mt-1 text-xs sm:text-sm text-slate-600">使用 V2 引擎运行回测，并在通过后确认是否用于实盘信号。</p>
                </div>
                <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-bold ${backtestStatusClass(visibleBacktestStatus)}`}>
                  {backtestStatusLabel(visibleBacktestStatus)}
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <label htmlFor="quant-v2-backtest-timeframe" className="block text-sm font-semibold text-slate-700 mb-2">
                    K 线粒度
                  </label>
                  <select
                    id="quant-v2-backtest-timeframe"
                    className="w-full rounded-lg border border-slate-300 px-3 sm:px-4 py-2 text-sm font-semibold text-slate-900"
                    value={backtestTf}
                    onChange={(e) => setBacktestTf(e.target.value)}
                  >
                    {BACKTEST_TIMEFRAME_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleSaveAndBacktest}
                  disabled={backtesting}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 sm:px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50 w-full sm:w-auto"
                >
                  {backtesting ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      回测中
                    </>
                  ) : (
                    <>
                      <BarChart3 className="h-4 w-4" />
                      运行回测
                    </>
                  )}
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => handleLiveSignalToggle(true)}
                  disabled={saving || !backtestPassed || backtestApproved}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 sm:px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {backtestApproved ? '实盘信号已确认' : '确认用于实盘信号'}
                </button>
                <button
                  type="button"
                  onClick={() => handleLiveSignalToggle(false)}
                  disabled={saving || !currentStrategy?.liveSignalEnabled}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-3 sm:px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  关闭实盘信号
                </button>
              </div>
            </Card>
            {backtest ? (
              <>
                <Card className="p-4 sm:p-6">
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-lg bg-slate-50 px-4 py-3">
                      <div className="text-xs font-bold text-slate-400">回测区间</div>
                      <div className="mt-1 font-semibold text-slate-900">{backtestRange}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-4 py-3">
                      <div className="text-xs font-bold text-slate-400">数据覆盖</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatPercent(summary.dataCoveragePct, 1)}</div>
                    </div>
                  </div>
                  {missingKlineCodes.length ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-700">
                      缺失 K 线代码：{missingKlineCodes.join('、')}。可换更高粒度重试，或先从策略中移除缺数据标的。
                    </div>
                  ) : null}
                </Card>

                <InteractiveChartContainer
                  views={chartViews}
                  activeView={chartView}
                  onViewChange={setChartView}
                >
                  {chartView === 'equity' && (
                    <EquityChart data={backtest.rows || []} />
                  )}
                  {chartView === 'kline' && (
                    <KlineChart
                      candles={backtest.chart?.candles || []}
                      signals={backtest.signals || []}
                    />
                  )}
                  {chartView === 'premium' && (
                    <PremiumChart data={backtest.rows || []} />
                  )}
                </InteractiveChartContainer>

                <Card className="p-4 sm:p-6">
                  <h3 className="text-sm font-bold text-slate-700 mb-4">详细指标</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                    <div className="text-center">
                      <div className="text-xs text-slate-600">样本</div>
                      <div className="mt-1 text-base sm:text-lg font-bold text-slate-900">
                        {summary.sampleCount || 0}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-600">信号</div>
                      <div className="mt-1 text-base sm:text-lg font-bold text-slate-900">
                        {summary.trades || summary.signalCount || 0}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-600">价格覆盖</div>
                      <div className="mt-1 text-base sm:text-lg font-bold text-slate-900">
                        {formatPercent(summary.priceCoveragePct, 0)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-600">NAV覆盖</div>
                      <div className="mt-1 text-base sm:text-lg font-bold text-slate-900">
                        {formatPercent(summary.navCoveragePct, 0)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-600">数据覆盖</div>
                      <div className="mt-1 text-base sm:text-lg font-bold text-slate-900">
                        {formatPercent(summary.dataCoveragePct, 0)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-600">最终权益</div>
                      <div className="mt-1 text-base sm:text-lg font-bold text-slate-900">
                        {formatMoney(summary.finalEquity)}
                      </div>
                    </div>
                  </div>
                </Card>
              </>
            ) : (
              <Card className="p-12">
                <div className="text-center text-slate-400">
                  <BarChart3 className="mx-auto h-16 w-16 mb-4" />
                  <p className="text-lg font-semibold">暂无回测结果</p>
                  <p className="text-sm mt-2">请先在策略配置中配置并运行回测</p>
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'live' && (
          <div className="mx-auto max-w-4xl space-y-4 sm:space-y-6">
            {/* 实时信号 */}
            <Card className="p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-slate-900">实时信号</h3>
                <button
                  type="button"
                  onClick={handleRefreshSnapshot}
                  disabled={refreshing}
                  className="flex items-center gap-2 rounded-lg bg-indigo-100 px-3 py-2.5 min-h-[44px] text-xs sm:text-sm font-semibold text-indigo-700 hover:bg-indigo-200 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 sm:h-4 w-3.5 sm:w-4 ${refreshing ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>

              {currentLiveSignal ? (
                <RealTimeSignalCard
                  signal={currentLiveSignal}
                />
              ) : (
                <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-6 sm:p-8 text-center">
                  <Activity className="mx-auto h-10 sm:h-12 w-10 sm:w-12 text-slate-400 mb-3" />
                  <p className="text-xs sm:text-sm text-slate-600">暂无信号，点击刷新获取最新数据</p>
                </div>
              )}

              {liveSignals.length > 0 && (
                <div className="mt-4 space-y-3">
                  <h4 className="text-sm font-bold text-slate-700">历史信号</h4>
                  {liveSignals.map((sig, idx) => (
                    <RealTimeSignalCard
                      key={idx}
                      signal={sig}
                      className="opacity-70"
                    />
                  ))}
                </div>
              )}
            </Card>

            {/* 当前持仓 */}
            <Card className="p-4 sm:p-6">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-4">当前持仓</h3>
              {snapshot?.positions && Object.keys(snapshot.positions).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(snapshot.positions).map(([code, pos]) => (
                    <div key={code} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 sm:p-4">
                      <div>
                        <div className="text-sm font-bold text-slate-900">{code}</div>
                        <div className="text-xs text-slate-600">{pos.name || code}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs sm:text-sm font-semibold text-slate-900">
                          {formatNumber(pos.shares, 0)} 股 @ {formatPrice(pos.costPrice)}
                        </div>
                        <div className="text-xs text-slate-600">
                          市值: {formatMoney(pos.shares * pos.costPrice)}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between rounded-lg bg-indigo-50 p-3 sm:p-4 border-2 border-indigo-200">
                    <div className="text-sm font-bold text-indigo-900">现金</div>
                    <div className="text-sm font-bold text-indigo-900">
                      {formatMoney(snapshot.cash || 0)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-slate-400 py-8">
                  <p className="text-sm">暂无持仓数据</p>
                </div>
              )}
            </Card>

            {/* 实时行情 */}
            {snapshot?.quotes && Object.keys(snapshot.quotes).length > 0 && (
              <Card className="p-4 sm:p-6">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-4">实时行情</h3>
                <div className="space-y-3">
                  {Object.entries(snapshot.quotes).map(([code, quote]) => (
                    <div key={code} className="rounded-lg bg-slate-50 p-3 sm:p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="text-sm font-bold text-slate-900">{code}</span>
                          <span className="ml-2 text-xs text-slate-600">{quote.name}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {quote.asOf ? new Date(quote.asOf).toLocaleTimeString('zh-CN') : '--'}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:gap-3 text-xs">
                        <div>
                          <span className="text-slate-600">买一: </span>
                          <span className="font-semibold text-emerald-700">{formatPrice(quote.bid)}</span>
                        </div>
                        <div>
                          <span className="text-slate-600">卖一: </span>
                          <span className="font-semibold text-rose-700">{formatPrice(quote.ask)}</span>
                        </div>
                        <div>
                          <span className="text-slate-600">IOPV: </span>
                          <span className="font-semibold text-slate-900">{formatPrice(quote.iopv)}</span>
                        </div>
                        <div>
                          <span className="text-slate-600">最高: </span>
                          <span className="font-semibold text-rose-600">{formatPrice(quote.high)}</span>
                        </div>
                        <div>
                          <span className="text-slate-600">最低: </span>
                          <span className="font-semibold text-emerald-600">{formatPrice(quote.low)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="mx-auto max-w-6xl">
            <Card className="overflow-hidden">
              <div className="bg-slate-50 px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200">
                <h3 className="text-base sm:text-lg font-bold text-slate-900">交易历史</h3>
                <p className="text-xs sm:text-sm text-slate-600 mt-1">回测模拟交易记录</p>
              </div>

              {backtest?.trades && backtest.trades.length > 0 ? (
                <>
                  {/* 移动端卡片视图 */}
                  <div className="block sm:hidden p-4 space-y-3">
                    {backtest.trades.map((trade, idx) => (
                      <TradeHistoryCard key={idx} trade={trade} />
                    ))}
                  </div>

                  {/* 桌面端表格视图 */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 text-xs font-bold text-slate-700">
                        <tr>
                          <th className="px-4 py-3 text-left">时间</th>
                          <th className="px-4 py-3 text-left">类型</th>
                          <th className="px-4 py-3 text-left">代码</th>
                          <th className="px-4 py-3 text-right">股数</th>
                          <th className="px-4 py-3 text-right">价格</th>
                          <th className="px-4 py-3 text-right">金额</th>
                          <th className="px-4 py-3 text-right">手续费</th>
                          <th className="px-4 py-3 text-right">结算金额</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {backtest.trades.map((trade, idx) => (
                          <tr key={idx} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 text-sm text-slate-900">
                              {formatTradeDateTime(trade)}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${
                                trade.type === 'buy'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-rose-100 text-rose-700'
                              }`}>
                                {trade.type === 'buy' ? '买入' : '卖出'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                              {trade.code}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-slate-900">
                              {formatNumber(trade.shares, 0)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-slate-900">
                              {formatPrice(trade.price)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-slate-900">
                              {formatMoney(trade.amount)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-slate-600">
                              {formatMoney(trade.fee)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-semibold text-slate-900">
                              {formatMoney(resolveTradeSettlementValue(trade))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="text-center text-slate-400 py-12">
                  <ListChecks className="mx-auto h-12 w-12 mb-3" />
                  <p className="text-lg font-semibold">暂无交易记录</p>
                  <p className="text-sm mt-2">运行回测后查看模拟交易</p>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
