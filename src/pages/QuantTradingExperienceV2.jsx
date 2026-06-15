import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  LineChart,
  ListChecks,
  Play,
  RefreshCw,
  Settings,
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
import { EquityChart, KlineChart, PremiumChart } from '../components/BacktestCharts.jsx';
import { showToast } from '../app/toast.js';
import {
  loadQuantPremiumStrategiesFromWorker,
  loadQuantPremiumBacktestLatestFromWorker,
  loadQuantPremiumSnapshotFromWorker,
  loadQuantPremiumStrategySnapshotFromWorker,
  normalizeQuantPremiumConfigShape,
  parseQuantPremiumCodes,
  saveQuantPremiumStrategyToWorker,
  runQuantPremiumBacktestInWorker,
  runQuantPremiumOnce
} from '../app/quantPremiumSync.js';

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

export default function QuantTradingExperienceV2() {
  // 状态管理
  const [strategies, setStrategies] = useState([]);
  const [activeStrategyId, setActiveStrategyId] = useState('');
  const [activeTab, setActiveTab] = useState('config');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backtesting, setBacktesting] = useState(false);

  // 策略配置
  const [highCodes, setHighCodes] = useState([]);
  const [lowCodes, setLowCodes] = useState([]);
  const [ruleA, setRuleA] = useState(3);
  const [ruleB, setRuleB] = useState(1);
  const [useV2, setUseV2] = useState(true);

  // 回测结果
  const [backtest, setBacktest] = useState(null);
  const [chartView, setChartView] = useState('equity');

  // 实盘监控
  const [snapshot, setSnapshot] = useState(null);
  const [liveSignals, setLiveSignals] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  // 加载策略列表
  useEffect(() => {
    loadStrategies();
  }, []);

  async function loadStrategies() {
    try {
      const list = await loadQuantPremiumStrategiesFromWorker();
      setStrategies(list);
      if (list.length > 0 && !activeStrategyId) {
        loadStrategy(list[0].id);
      }
    } catch (error) {
      console.error('加载策略失败:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadStrategy(strategyId) {
    setActiveStrategyId(strategyId);
    const strategy = strategies.find(s => s.id === strategyId);
    if (strategy) {
      setHighCodes(strategy.highCodes || []);
      setLowCodes(strategy.lowCodes || []);
      setRuleA(strategy.intraSellLowerPct || 3);
      setRuleB(strategy.intraBuyOtherPct || 1);
    }

    // 加载回测结果
    try {
      const { result } = await loadQuantPremiumBacktestLatestFromWorker(strategyId);
      setBacktest(result);
    } catch (error) {
      console.error('加载回测结果失败:', error);
    }

    // 加载实盘快照
    try {
      const snap = await loadQuantPremiumStrategySnapshotFromWorker(strategyId);
      setSnapshot(snap);
    } catch (error) {
      console.error('加载实盘快照失败:', error);
    }
  }

  async function handleRefreshSnapshot() {
    if (!activeStrategyId) return;
    setRefreshing(true);
    try {
      const result = await runQuantPremiumOnce(activeStrategyId);
      setSnapshot(result.snapshot);
      if (result.signal) {
        setLiveSignals([result.signal, ...liveSignals.slice(0, 9)]);
      }
      showToast({ title: '刷新成功', tone: 'emerald' });
    } catch (error) {
      showToast({ title: '刷新失败', description: error.message, tone: 'rose' });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSaveAndBacktest() {
    console.log('回测前检查:', { highCodes, lowCodes });

    if (!Array.isArray(highCodes) || highCodes.length === 0 || !Array.isArray(lowCodes) || lowCodes.length === 0) {
      showToast({ title: 'H 和 L 至少各设置一只 ETF', tone: 'amber' });
      return;
    }

    setBacktesting(true);
    try {
      // 保存配置
      const config = normalizeQuantPremiumConfigShape({
        id: activeStrategyId,
        highCodes,
        lowCodes,
        intraSellLowerPct: ruleA,
        intraBuyOtherPct: ruleB
      });

      console.log('保存配置:', config);

      const saveResult = await saveQuantPremiumStrategyToWorker(config);
      setActiveStrategyId(saveResult.strategy.id);

      // 运行回测
      const result = await runQuantPremiumBacktestInWorker(saveResult.strategy.id, {
        timeframe: '5m',
        useV2
      });

      setBacktest(result);
      setActiveTab('backtest');
      showToast({ title: '回测完成', tone: 'emerald' });
    } catch (error) {
      console.error('回测失败:', error);
      showToast({ title: '回测失败', description: error.message, tone: 'rose' });
    } finally {
      setBacktesting(false);
    }
  }

  // 计算核心指标
  const summary = backtest?.summary || {};
  const totalReturnPct = summary.totalReturnPct || 0;
  const winRatePct = summary.winRatePct || 0;
  const sharpeRatio = summary.sharpeRatio || 0;
  const maxDrawdownPct = summary.maxDrawdownPct || 0;

  const returnTone = totalReturnPct > 0 ? 'positive' : totalReturnPct < 0 ? 'negative' : 'neutral';
  const winRateTone = winRatePct >= 60 ? 'positive' : winRatePct >= 50 ? 'neutral' : 'negative';
  const sharpeTone = sharpeRatio >= 1.5 ? 'positive' : sharpeRatio >= 1 ? 'neutral' : 'negative';
  const drawdownTone = Math.abs(maxDrawdownPct) <= 5 ? 'positive' : Math.abs(maxDrawdownPct) <= 10 ? 'neutral' : 'negative';

  // Tab 配置
  const tabs = [
    { id: 'config', label: '策略配置', icon: Settings },
    { id: 'backtest', label: '回测分析', icon: BarChart3, badge: backtest ? '✓' : null },
    { id: 'live', label: '实盘监控', icon: Activity },
    { id: 'history', label: '交易历史', icon: ListChecks }
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
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">量化研究</h1>
            <p className="mt-1 text-sm text-slate-600">ETF溢价差轮动策略</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={activeStrategyId}
              onChange={(e) => loadStrategy(e.target.value)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900"
            >
              {strategies.map(s => (
                <option key={s.id} value={s.id}>{s.name || s.id}</option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              + 新建策略
            </button>
          </div>
        </div>
      </div>

      {/* 核心指标卡片区 */}
      <div className="px-6 py-8">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="累计收益"
            value={formatPercent(totalReturnPct, 2)}
            subtitle={formatMoney(summary.totalProfit || 0)}
            tone={returnTone}
            Icon={TrendingUp}
          />
          <MetricCard
            label="胜率 (V2)"
            value={formatPercent(winRatePct, 0)}
            subtitle={`${summary.trades || 0} 笔交易`}
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
      </div>

      {/* Tab 导航 */}
      <TabNavigation
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
        className="sticky top-0 z-10 shadow-sm"
      />

      {/* Tab 内容区 */}
      <div className="px-6 py-8">
        {activeTab === 'config' && (
          <div className="mx-auto max-w-4xl space-y-8">
            <Card className="p-8">
              <h2 className="text-lg font-bold text-slate-900">ETF 配置</h2>
              <p className="mt-1 text-sm text-slate-600">配置高溢价（H）和低溢价（L）ETF池</p>

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

            <Card className="p-8">
              <h2 className="text-lg font-bold text-slate-900">交易规则</h2>
              <p className="mt-1 text-sm text-slate-600">配置溢价差触发阈值</p>

              <div className="mt-6 space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">
                    规则 A：卖 H 买 L
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-600">溢价差 ≤</span>
                    <input
                      type="number"
                      value={ruleA}
                      onChange={(e) => setRuleA(Number(e.target.value))}
                      step="0.1"
                      className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-semibold"
                    />
                    <span className="text-sm text-slate-600">% 时触发</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    高溢价ETF相对低溢价ETF的差价缩小到此阈值以内时，卖出H买入L
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">
                    规则 B：卖 L 买 H
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-600">溢价差 ≥</span>
                    <input
                      type="number"
                      value={ruleB}
                      onChange={(e) => setRuleB(Number(e.target.value))}
                      step="0.1"
                      className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-semibold"
                    />
                    <span className="text-sm text-slate-600">% 时触发</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    低溢价ETF相对高溢价ETF的差价扩大到此阈值以上时，卖出L买入H
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-8">
              <h2 className="text-lg font-bold text-slate-900">回测设置</h2>

              <div className="mt-6">
                <label className="inline-flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={useV2}
                    onChange={(e) => setUseV2(e.target.checked)}
                    className="h-5 w-5 rounded border-slate-300 text-indigo-600"
                  />
                  <div>
                    <span className="text-sm font-semibold text-slate-900">使用 V2 回测引擎</span>
                    <p className="text-xs text-slate-600">持仓追踪 + 真实交易模拟 + 准确胜率 + 夏普比率</p>
                  </div>
                </label>
              </div>

              <div className="mt-6">
                <button
                  type="button"
                  onClick={handleSaveAndBacktest}
                  disabled={backtesting}
                  className="w-full rounded-xl bg-indigo-600 px-6 py-4 text-base font-bold text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
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
            </Card>
          </div>
        )}

        {activeTab === 'backtest' && (
          <div className="mx-auto max-w-7xl space-y-8">
            {backtest ? (
              <>
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

                <Card className="p-6">
                  <h3 className="text-sm font-bold text-slate-700 mb-4">详细指标</h3>
                  <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                    <div className="text-center">
                      <div className="text-xs text-slate-600">样本</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">
                        {summary.sampleCount || 0}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-600">信号</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">
                        {summary.trades || summary.signalCount || 0}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-600">价格覆盖</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">
                        {formatPercent(summary.priceCoveragePct, 0)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-600">NAV覆盖</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">
                        {formatPercent(summary.navCoveragePct, 0)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-600">数据覆盖</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">
                        {formatPercent(summary.dataCoveragePct, 0)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-600">最终权益</div>
                      <div className="mt-1 text-lg font-bold text-slate-900">
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
                  <p className="text-sm mt-2">请先在"策略配置"中配置并运行回测</p>
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'live' && (
          <div className="mx-auto max-w-4xl space-y-6">
            {/* 实时信号 */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">实时信号</h3>
                <button
                  type="button"
                  onClick={handleRefreshSnapshot}
                  disabled={refreshing}
                  className="flex items-center gap-2 rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-200 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>

              {snapshot?.signal ? (
                <RealTimeSignalCard
                  signal={{
                    rule: snapshot.signal.rule,
                    fromCode: snapshot.signal.fromCode,
                    toCode: snapshot.signal.toCode,
                    gapPct: snapshot.signal.gapPct?.toFixed(2),
                    threshold: snapshot.signal.threshold,
                    triggered: snapshot.signal.triggered,
                    timestamp: snapshot.generatedAt
                  }}
                />
              ) : (
                <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-8 text-center">
                  <Activity className="mx-auto h-12 w-12 text-slate-400 mb-3" />
                  <p className="text-sm text-slate-600">暂无信号，点击刷新获取最新数据</p>
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
            <Card className="p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">当前持仓</h3>
              {snapshot?.positions && Object.keys(snapshot.positions).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(snapshot.positions).map(([code, pos]) => (
                    <div key={code} className="flex items-center justify-between rounded-lg bg-slate-50 p-4">
                      <div>
                        <div className="text-sm font-bold text-slate-900">{code}</div>
                        <div className="text-xs text-slate-600">{pos.name || code}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-slate-900">
                          {formatNumber(pos.shares, 0)} 股 @ {formatPrice(pos.costPrice)}
                        </div>
                        <div className="text-xs text-slate-600">
                          市值: {formatMoney(pos.shares * pos.costPrice)}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between rounded-lg bg-indigo-50 p-4 border-2 border-indigo-200">
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
              <Card className="p-6">
                <h3 className="text-lg font-bold text-slate-900 mb-4">实时行情</h3>
                <div className="space-y-3">
                  {Object.entries(snapshot.quotes).map(([code, quote]) => (
                    <div key={code} className="rounded-lg bg-slate-50 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="text-sm font-bold text-slate-900">{code}</span>
                          <span className="ml-2 text-xs text-slate-600">{quote.name}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {quote.asOf ? new Date(quote.asOf).toLocaleTimeString('zh-CN') : '--'}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-xs">
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
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                <h3 className="text-lg font-bold text-slate-900">交易历史</h3>
                <p className="text-sm text-slate-600 mt-1">回测模拟交易记录</p>
              </div>

              {backtest?.trades && backtest.trades.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 text-xs font-bold text-slate-700">
                      <tr>
                        <th className="px-4 py-3 text-left">日期</th>
                        <th className="px-4 py-3 text-left">类型</th>
                        <th className="px-4 py-3 text-left">代码</th>
                        <th className="px-4 py-3 text-right">股数</th>
                        <th className="px-4 py-3 text-right">价格</th>
                        <th className="px-4 py-3 text-right">金额</th>
                        <th className="px-4 py-3 text-right">手续费</th>
                        <th className="px-4 py-3 text-right">总成本</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {backtest.trades.map((trade, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-sm text-slate-900">
                            {trade.date || '--'}
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
                            {formatMoney(trade.totalCost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
