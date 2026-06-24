import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Play, RefreshCw, Settings, ShieldCheck, TrendingUp } from 'lucide-react';
import { Card, cx, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';
import { showToast } from '../app/toast.js';
import {
  readQuantProjectState,
  saveQuantProjectState,
  resetQuantProjectState,
  executeSimulatedSwitch,
  computeAccountSummary,
  evaluatePremiumSpread,
  shanghaiDateKey,
  buildOrderPlanV2,
  RiskMonitor,
  getCachedHistoricalData,
  RECOMMENDED_STRATEGY_CONFIGS,
  recommendParameters
} from '../app/quantTrading.js';
import { buildPremiumSpreadInputFromLegacyRows, runBacktest } from '../app/backtest/index.js';

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatPercent(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `${num.toFixed(digits)}%`;
}

function formatNumber(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function StatusBadge({ status }) {
  const config = {
    switch: { label: '可交易', tone: 'emerald', Icon: TrendingUp },
    wait: { label: '观察中', tone: 'slate', Icon: Activity }
  };
  const c = config[status] || config.wait;
  const toneClass = c.tone === 'emerald' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600';

  return (
    <div className="flex items-center gap-2">
      <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold', toneClass)}>
        <c.Icon className="h-3.5 w-3.5" />
        {c.label}
      </span>
      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
        统一引擎
      </span>
    </div>
  );
}

function MetricCard({ label, value, note, tone = 'slate', Icon }) {
  const valueColor = tone === 'emerald' ? 'text-emerald-600'
    : tone === 'red' ? 'text-red-500'
    : 'text-slate-900';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-400">{label}</div>
        {Icon && <Icon className="h-4 w-4 text-slate-400" />}
      </div>
      <div className={cx('mt-2 text-2xl font-semibold tabular-nums', valueColor)}>
        {value}
      </div>
      {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
    </div>
  );
}

function RiskAlerts({ alerts }) {
  if (!alerts || alerts.length === 0) return null;

  const errors = alerts.filter(a => a.level === 'ERROR');
  const warnings = alerts.filter(a => a.level === 'WARNING');

  return (
    <div className="space-y-2">
      {errors.map((alert, idx) => (
        <div key={idx} className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-red-900">{alert.code}</div>
            <div className="mt-1 text-sm text-red-700">{alert.message}</div>
          </div>
        </div>
      ))}
      {warnings.map((alert, idx) => (
        <div key={idx} className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-amber-900">{alert.code}</div>
            <div className="mt-1 text-sm text-amber-700">{alert.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EtfSwitchStrategyPage() {
  const [state, setState] = useState(() => readQuantProjectState());
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtesting, setBacktesting] = useState(false);
  const [riskCheck, setRiskCheck] = useState(null);
  const [activePreset, setActivePreset] = useState('balanced');

  const enhancedRisk = state.settings?.enableEnhancedRiskControl !== false;

  const orderPlan = useMemo(() => buildOrderPlanV2(state), [state]);

  const summary = useMemo(() => computeAccountSummary(state), [state]);
  const signal = useMemo(() => evaluatePremiumSpread(state), [state]);

  // 风控检查
  useEffect(() => {
    if (enhancedRisk) {
      const monitor = new RiskMonitor();
      const check = monitor.checkRisks(state, orderPlan);
      setRiskCheck(check);
    } else {
      setRiskCheck(null);
    }
  }, [state, orderPlan, enhancedRisk]);

  const handleExecuteTrade = useCallback(() => {
    if (!orderPlan.canTrade) {
      showToast({ title: '无法交易', description: orderPlan.rejectReason, tone: 'amber' });
      return;
    }

    if (riskCheck && !riskCheck.passed) {
      showToast({
        title: '风控熔断',
        description: `检测到${riskCheck.alerts.filter(a => a.level === 'ERROR').length}个严重风险`,
        tone: 'red'
      });
      return;
    }

    const result = executeSimulatedSwitch(state);
    if (result.fills.length > 0) {
      setState(result.state);
      saveQuantProjectState(result.state);
      showToast({
        title: '模拟交易成功',
        description: `成交${result.fills.length}笔，预估收益 ${formatMoney(orderPlan.estimatedCapture)}`,
        tone: 'emerald'
      });
    }
  }, [state, orderPlan, riskCheck]);

  const handleRunBacktest = useCallback(async () => {
    setBacktesting(true);
    try {
      // 统一使用 runBacktest() 接口
      const endDate = shanghaiDateKey();
      const startDate = new Date(new Date(endDate).getTime() - 90 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);

      const historicalData = await getCachedHistoricalData(
        [state.strategy.sellSymbol, state.strategy.buySymbol],
        startDate,
        endDate
      );
      const { historyByCode, navHistoryByCode } = buildPremiumSpreadInputFromLegacyRows(historicalData, {
        highCode: state.strategy.sellSymbol,
        lowCode: state.strategy.buySymbol
      });

      // 构建策略配置（适配新接口）
      const strategy = {
        type: 'premium-spread',
        highCodes: [state.strategy.sellSymbol],
        lowCodes: [state.strategy.buySymbol],
        intraSellLowerPct: state.strategy.triggerSpreadPct,
        intraBuyOtherPct: state.strategy.triggerSpreadPct,
        activeSide: 'all'
      };

      const options = {
        timeframe: '1d',
        historyByCode,
        navHistoryByCode,
        initialEquity: state.account.cash,
        feeRate: state.account.feeRate,
        minFee: state.account.minFee,
        tickSize: state.account.tickSize,
        slippageTicks: state.account.slippageTicks,
        lotSize: state.strategy.lotSize
      };

      const result = runBacktest(strategy, options);
      setBacktestResult(result);

      // 显示参数推荐
      const recommendations = recommendParameters(result);
      if (recommendations.length > 0) {
        console.log('参数优化建议：', recommendations);
      }

      showToast({ title: '回测完成', tone: 'emerald' });
    } catch (error) {
      showToast({ title: '回测失败', description: error.message, tone: 'red' });
    } finally {
      setBacktesting(false);
    }
  }, [state]);

  const handleApplyPreset = useCallback((presetName) => {
    const preset = RECOMMENDED_STRATEGY_CONFIGS[presetName];
    if (!preset) return;

    setState(prev => ({
      ...prev,
      strategy: {
        ...prev.strategy,
        ...preset
      }
    }));
    setActivePreset(presetName);
    showToast({ title: `已应用${preset.name}配置`, tone: 'indigo' });
  }, []);

  const handleReset = useCallback(() => {
    const newState = resetQuantProjectState();
    setState(newState);
    setBacktestResult(null);
    showToast({ title: '已重置为初始状态', tone: 'slate' });
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">ETF 切换策略</h1>
            <span className="rounded-lg bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-700">
              统一回测引擎
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            基于溢价差的纳指ETF自动切换策略 · 真实回测 + 增强风控
          </p>
        </div>
        <button
          type="button"
          className={primaryButtonClass}
          onClick={handleExecuteTrade}
          disabled={!orderPlan.canTrade || (riskCheck && !riskCheck.passed)}
        >
          <Play className="h-4 w-4" />
          执行模拟交易
        </button>
      </div>

      {/* 风控预警 */}
      {riskCheck && riskCheck.alerts.length > 0 && (
        <Card className="border-l-4 border-l-amber-500 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
            <ShieldCheck className="h-4 w-4" />
            风控检查
            <span className={cx(
              'ml-auto rounded-full px-2 py-0.5 text-xs',
              !riskCheck.passed ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
            )}>
              {riskCheck.passed ? '通过' : '未通过'}
            </span>
          </div>
          <RiskAlerts alerts={riskCheck.alerts} />
        </Card>
      )}

      {/* 核心指标 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="账户总资产"
          value={formatMoney(summary.equity)}
          note={`现金 ${formatMoney(summary.cash)}`}
          Icon={Activity}
        />
        <MetricCard
          label="持仓市值"
          value={formatMoney(summary.marketValue)}
          note={`${summary.positionCount} 个持仓`}
        />
        <MetricCard
          label="净差价"
          value={formatPercent(signal.netSpreadPct)}
          note={`触发线 ${formatPercent(state.strategy.triggerSpreadPct)}`}
          tone={signal.action === 'switch' ? 'emerald' : 'slate'}
        />
        <MetricCard
          label="预估收益"
          value={orderPlan.canTrade ? formatMoney(orderPlan.estimatedCapture) : '--'}
          note={orderPlan.rejectReason || signal.reason}
          tone={orderPlan.canTrade ? 'emerald' : 'slate'}
        />
      </div>

      {/* 交易信号 */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">交易信号</h2>
            <p className="mt-1 text-sm text-slate-500">{signal.reason}</p>
          </div>
          <StatusBadge status={signal.action} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="text-xs font-bold text-slate-400">卖出溢价率</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {formatPercent(signal.sellPremiumPct)}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="text-xs font-bold text-slate-400">买入溢价率</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {formatPercent(signal.buyPremiumPct)}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="text-xs font-bold text-slate-400">原始差价</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {formatPercent(signal.rawSpreadPct)}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="text-xs font-bold text-slate-400">费用缓冲</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {formatPercent(state.strategy.feeBufferPct)}
            </div>
          </div>
        </div>
      </Card>

      {/* 回测 */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">策略回测</h2>
            <p className="mt-1 text-sm text-slate-500">
              使用真实历史数据和持仓追踪
            </p>
          </div>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={handleRunBacktest}
            disabled={backtesting}
          >
            <RefreshCw className={cx('h-4 w-4', backtesting && 'animate-spin')} />
            {backtesting ? '回测中...' : '运行回测'}
          </button>
        </div>

        {backtestResult && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <div className="text-xs font-bold text-slate-400">交易次数</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {backtestResult.summary.trades} 次
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <div className="text-xs font-bold text-slate-400">总收益</div>
              <div className={cx(
                'mt-1 text-lg font-semibold',
                backtestResult.summary.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-500'
              )}>
                {formatMoney(backtestResult.summary.totalProfit)}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <div className="text-xs font-bold text-slate-400">收益率</div>
              <div className={cx(
                'mt-1 text-lg font-semibold',
                backtestResult.summary.totalReturnPct >= 0 ? 'text-emerald-600' : 'text-red-500'
              )}>
                {formatPercent(backtestResult.summary.totalReturnPct)}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <div className="text-xs font-bold text-slate-400">
                胜率
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {formatPercent(backtestResult.summary.winRatePct, 0)}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <div className="text-xs font-bold text-slate-400">最大回撤</div>
              <div className={cx(
                'mt-1 text-lg font-semibold',
                backtestResult.summary.maxDrawdownPct < 0 ? 'text-red-500' : 'text-slate-900'
              )}>
                {formatPercent(backtestResult.summary.maxDrawdownPct)}
              </div>
            </div>
            {backtestResult.summary.sharpeRatio !== undefined && (
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <div className="text-xs font-bold text-slate-400">夏普比率</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  {formatNumber(backtestResult.summary.sharpeRatio, 2)}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 配置预设 */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">策略配置</h2>
            <p className="mt-1 text-sm text-slate-500">选择预设配置或自定义参数</p>
          </div>
          <Settings className="h-5 w-5 text-slate-400" />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {Object.entries(RECOMMENDED_STRATEGY_CONFIGS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              className={cx(
                'rounded-xl border-2 p-4 text-left transition-all',
                activePreset === key
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              )}
              onClick={() => handleApplyPreset(key)}
            >
              <div className="font-bold text-slate-900">{preset.name}</div>
              <div className="mt-2 space-y-1 text-xs text-slate-600">
                <div>触发线: {formatPercent(preset.triggerSpreadPct)}</div>
                <div>费用缓冲: {formatPercent(preset.feeBufferPct)}</div>
                <div>冷却期: {preset.cooldownDays}天</div>
              </div>
              {preset.description && (
                <div className="mt-2 text-xs text-slate-400">{preset.description}</div>
              )}
            </button>
          ))}
        </div>
      </Card>

      {/* 操作按钮 */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          className={subtleButtonClass}
          onClick={handleReset}
        >
          重置为初始状态
        </button>
      </div>
    </div>
  );
}
