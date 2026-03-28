import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Save } from 'lucide-react';
import { formatCurrency, formatPercent } from '../app/accumulation.js';
import { readHomeDashboardState } from '../app/homeDashboard.js';
import { loadLatestNasdaqPrices, loadNasdaqDailySeries } from '../app/nasdaqPrices.js';
import { persistPlanState, readPlanState } from '../app/plan.js';
import { Card, Field, NumberInput, PageHero, PageShell, Pill, SectionHeading, SelectField, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

const frequencyOptions = ['每日', '每周', '每月', '每季'];
const strategyOptions = [
  {
    key: 'ma120-risk',
    label: '均线分层',
    note: 'MA120 主触发 + MA200 风控'
  },
  {
    key: 'peak-drawdown',
    label: '固定回撤',
    note: '按阶段高点固定跌幅 8 档执行'
  }
];
const fixedDrawdownBlueprint = [
  { drawdown: 9, label: '首次建仓' },
  { drawdown: 12.5, label: '第1次加仓' },
  { drawdown: 16, label: '第2次加仓' },
  { drawdown: 19.5, label: '第3次加仓' },
  { drawdown: 23, label: '第4次加仓' },
  { drawdown: 26.5, label: '第5次加仓' },
  { drawdown: 30, label: '第6次加仓' },
  { drawdown: 33.5, label: '第7次加仓，极端档' }
];

function buildMovingAverageValues(bars = [], period = 5) {
  const values = [];
  const closes = [];
  let rollingSum = 0;

  bars.forEach((bar, index) => {
    const close = Number(bar.close) || 0;
    closes.push(close);
    rollingSum += close;

    if (closes.length > period) {
      rollingSum -= closes[index - period];
    }

    values.push(closes.length >= period ? rollingSum / period : rollingSum / closes.length);
  });

  return values;
}

function findLatestFiniteValue(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function buildMovingAverageTemplatePlan(state) {
  const triggerPrice = Math.max(Number(state.basePrice) || 0, 0);
  const fallbackRiskPrice = triggerPrice > 0 ? triggerPrice * 0.85 : 0;
  const explicitRiskPrice = Math.max(Number(state.riskControlPrice) || 0, 0);
  const deepestMaLayerPrice = triggerPrice > 0 ? triggerPrice * 0.9 : 0;
  const usesRiskLayer = explicitRiskPrice > 0 && deepestMaLayerPrice > 0 && explicitRiskPrice < deepestMaLayerPrice;
  const totalBudget = Math.max(Number(state.totalBudget) || 0, 0);
  const cashReservePct = Math.max(Number(state.cashReservePct) || 0, 0);
  const investableCapital = totalBudget * Math.max(0, 1 - cashReservePct / 100);
  const reserveCapital = totalBudget - investableCapital;
  const layers = [
    {
      id: 'ma120-base',
      label: 'MA120 基准',
      signal: '靠近 MA120',
      drawdown: 0,
      weight: 1,
      price: triggerPrice
    },
    {
      id: 'ma120-minus-5',
      label: 'MA120 - 5%',
      signal: '低于 MA120 5%',
      drawdown: 5,
      weight: 1.5,
      price: triggerPrice > 0 ? triggerPrice * 0.95 : 0
    },
    {
      id: 'ma120-minus-10',
      label: 'MA120 - 10%',
      signal: '低于 MA120 10%',
      drawdown: 10,
      weight: 2,
      price: triggerPrice > 0 ? triggerPrice * 0.9 : 0
    },
    usesRiskLayer
      ? {
          id: 'ma200-risk',
          label: 'MA200 风控',
          signal: '跌破 MA200',
          drawdown: triggerPrice > 0 ? Math.max((1 - explicitRiskPrice / triggerPrice) * 100, 0) : 0,
          weight: 2.5,
          price: explicitRiskPrice
        }
      : {
          id: 'deep-defense',
          label: '深水防守',
          signal: explicitRiskPrice > 0 ? 'MA200 仅作风控，不单列加仓' : '低于 MA120 15%',
          drawdown: 15,
          weight: 2.5,
          price: fallbackRiskPrice
        }
  ].filter((layer) => layer.price > 0);
  const totalWeight = layers.reduce((sum, layer) => sum + layer.weight, 0) || 1;
  const normalizedLayers = layers.map((layer, index) => {
    const amount = investableCapital * (layer.weight / totalWeight);
    const shares = layer.price > 0 ? amount / layer.price : 0;
    return {
      ...layer,
      order: index + 1,
      amount,
      shares
    };
  });
  const totalAmount = normalizedLayers.reduce((sum, layer) => sum + layer.amount, 0);
  const totalShares = normalizedLayers.reduce((sum, layer) => sum + layer.shares, 0);

  return {
    mode: 'ma120-risk',
    anchorLabel: 'MA120 触发价',
    anchorPrice: triggerPrice,
    riskLabel: 'MA200 风控价',
    riskPrice: explicitRiskPrice || fallbackRiskPrice,
    investableCapital,
    reserveCapital,
    averageCost: totalShares > 0 ? totalAmount / totalShares : 0,
    totalWeight,
    layers: normalizedLayers,
    layerWeights: normalizedLayers.map((layer) => layer.weight),
    triggerDrops: normalizedLayers.map((layer) => layer.drawdown)
  };
}

function buildFixedDrawdownPlan(state) {
  const peakPrice = Math.max(Number(state.basePrice) || 0, 0);
  const totalBudget = Math.max(Number(state.totalBudget) || 0, 0);
  const cashReservePct = Math.max(Number(state.cashReservePct) || 0, 0);
  const investableCapital = totalBudget * Math.max(0, 1 - cashReservePct / 100);
  const reserveCapital = totalBudget - investableCapital;
  const totalWeight = fixedDrawdownBlueprint.reduce((sum, _, index) => sum + index + 1, 0) || 1;
  const layers = fixedDrawdownBlueprint.map((layer, index) => {
    const weight = index + 1;
    const price = peakPrice > 0 ? peakPrice * (1 - layer.drawdown / 100) : 0;
    const amount = investableCapital * (weight / totalWeight);
    const shares = price > 0 ? amount / price : 0;

    return {
      id: `peak-drawdown-${index + 1}`,
      order: index + 1,
      label: layer.label,
      signal: `较历史高点累计跌幅 ${formatPercent(layer.drawdown, 1)}`,
      drawdown: layer.drawdown,
      weight,
      price,
      amount,
      shares,
      isExtreme: index === fixedDrawdownBlueprint.length - 1
    };
  }).filter((layer) => layer.price > 0);
  const totalAmount = layers.reduce((sum, layer) => sum + layer.amount, 0);
  const totalShares = layers.reduce((sum, layer) => sum + layer.shares, 0);

  return {
    mode: 'peak-drawdown',
    anchorLabel: '阶段高点',
    anchorPrice: peakPrice,
    riskLabel: '极端档',
    riskPrice: layers[layers.length - 1]?.price || 0,
    investableCapital,
    reserveCapital,
    averageCost: totalShares > 0 ? totalAmount / totalShares : 0,
    totalWeight,
    layers,
    layerWeights: layers.map((layer) => layer.weight),
    triggerDrops: layers.map((layer) => layer.drawdown)
  };
}

function formatFundPrice(value) {
  return formatCurrency(value, '¥', 3);
}

export function NewPlanExperience({ links, inPagesDir = false }) {
  const dashboardState = readHomeDashboardState();
  const [state, setState] = useState(() => readPlanState());
  const [marketEntries, setMarketEntries] = useState([]);
  const [marketError, setMarketError] = useState('');
  const [dailySeriesState, setDailySeriesState] = useState({
    code: '',
    bars: [],
    ready: false
  });
  const autoSeedRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    loadLatestNasdaqPrices({ inPagesDir })
      .then((entries) => {
        if (cancelled) {
          return;
        }

        setMarketEntries(entries);
        setMarketError('');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setMarketEntries([]);
        setMarketError(error instanceof Error ? error.message : '标的数据加载失败');
      });

    return () => {
      cancelled = true;
    };
  }, [inPagesDir]);

  useEffect(() => {
    if (!marketEntries.length) {
      return;
    }

    const availableCodes = new Set(marketEntries.map((entry) => entry.code));
    const preferredCode = availableCodes.has(String(state.symbol || '').trim())
      ? String(state.symbol || '').trim()
      : availableCodes.has(String(dashboardState.selectedCode || '').trim())
        ? String(dashboardState.selectedCode || '').trim()
        : marketEntries[0]?.code || '';

    if (preferredCode && preferredCode !== state.symbol) {
      setState((current) => ({ ...current, symbol: preferredCode }));
    }
  }, [dashboardState.selectedCode, marketEntries, state.symbol]);

  const selectedStrategy = state.selectedStrategy || 'ma120-risk';
  const selectedFund = useMemo(
    () => marketEntries.find((entry) => entry.code === state.symbol) || null,
    [marketEntries, state.symbol]
  );

  useEffect(() => {
    if (!selectedFund?.code) {
      setDailySeriesState({
        code: '',
        bars: [],
        ready: false
      });
      return;
    }

    let cancelled = false;
    const nextCode = selectedFund.code;

    setDailySeriesState({
      code: nextCode,
      bars: [],
      ready: false
    });

    loadNasdaqDailySeries(nextCode, { inPagesDir })
      .then((bars) => {
        if (!cancelled) {
          setDailySeriesState({
            code: nextCode,
            bars: Array.isArray(bars) ? bars : [],
            ready: true
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDailySeriesState({
            code: nextCode,
            bars: [],
            ready: true
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [inPagesDir, selectedFund?.code]);

  const selectedDailySeries = useMemo(
    () => (dailySeriesState.code === selectedFund?.code ? dailySeriesState.bars : []),
    [dailySeriesState.bars, dailySeriesState.code, selectedFund?.code]
  );
  const isSelectedDailySeriesReady = !selectedFund?.code || (dailySeriesState.code === selectedFund.code && dailySeriesState.ready);

  const derivedStageHigh = useMemo(() => {
    const values = selectedDailySeries
      .flatMap((bar) => [Number(bar.high) || 0, Number(bar.close) || 0])
      .filter((value) => Number.isFinite(value) && value > 0);

    if (values.length) {
      return Math.max(...values);
    }

    return Number(selectedFund?.current_price) || 0;
  }, [selectedDailySeries, selectedFund]);
  const derivedMa120 = useMemo(
    () => findLatestFiniteValue(buildMovingAverageValues(selectedDailySeries, 120)) || Number(selectedFund?.current_price) || 0,
    [selectedDailySeries, selectedFund]
  );
  const derivedMa200 = useMemo(
    () => findLatestFiniteValue(buildMovingAverageValues(selectedDailySeries, 200)) || (derivedMa120 > 0 ? derivedMa120 * 0.85 : 0),
    [selectedDailySeries, derivedMa120]
  );

  useEffect(() => {
    if (!selectedFund?.code || !isSelectedDailySeriesReady) {
      return;
    }

    const syncKey = `${selectedFund.code}:${selectedStrategy}`;
    if (autoSeedRef.current === syncKey) {
      return;
    }

    setState((current) => ({
      ...current,
      basePrice: selectedStrategy === 'peak-drawdown' ? derivedStageHigh : derivedMa120,
      riskControlPrice: selectedStrategy === 'peak-drawdown' ? current.riskControlPrice : derivedMa200
    }));
    autoSeedRef.current = syncKey;
  }, [derivedMa120, derivedMa200, derivedStageHigh, isSelectedDailySeriesReady, selectedFund?.code, selectedStrategy]);

  const activeStrategy = useMemo(
    () => strategyOptions.find((option) => option.key === selectedStrategy) || strategyOptions[0],
    [selectedStrategy]
  );
  const computed = useMemo(
    () => (selectedStrategy === 'peak-drawdown' ? buildFixedDrawdownPlan(state) : buildMovingAverageTemplatePlan(state)),
    [selectedStrategy, state]
  );

  useEffect(() => {
    persistPlanState({
      ...state,
      selectedStrategy
    }, computed);
  }, [computed, selectedStrategy, state]);

  const strategySummary = selectedStrategy === 'peak-drawdown'
    ? `按阶段高点 ${formatFundPrice(computed.anchorPrice)} 向下拆成 8 档固定回撤。`
    : `按 MA120 触发价 ${formatFundPrice(computed.anchorPrice)} 和 MA200 风控价 ${formatFundPrice(computed.riskPrice)} 生成分层。`;

  return (
    <PageShell>
      <PageHero
        backHref={links.home}
        backLabel="返回策略总览"
        eyebrow="New Strategy Plan"
        title="新建建仓计划"
        description="使用和首页一致的纳指 ETF 标的池，按均线分层或固定回撤模板一次把预算、现金留存和执行计划配置清楚。"
        badges={[
          <Pill key="symbol" tone="indigo">{selectedFund?.code || state.symbol || '未选择标的'}</Pill>,
          <Pill key="strategy" tone="slate">{activeStrategy.label}</Pill>
        ]}
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="min-w-0 space-y-6 lg:col-span-3">
            <Card className="min-w-0 overflow-hidden">
              <SectionHeading eyebrow="Step 01" title="基础设置" description="先确定标的、预算规模和策略锚点，这些输入会直接联动到右侧的成本预览和资金模型。" />

              {marketError ? (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  标的数据暂时加载失败：{marketError}
                </div>
              ) : null}

              <div className="mt-6 space-y-5">
                <Field className="min-w-0" label="资产标的" helper="与首页共用同一套纳指 ETF 标的池。">
                  {marketEntries.length ? (
                    <SelectField
                      className="min-w-0"
                      options={marketEntries.map((entry) => ({
                        label: `${entry.code} · ${entry.name}`,
                        value: entry.code
                      }))}
                      value={state.symbol}
                      onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value }))}
                    />
                  ) : (
                    <NumberInput
                      value={state.symbol}
                      onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value }))}
                    />
                  )}
                </Field>

                {selectedFund ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                    <div className="font-semibold text-slate-900">{selectedFund.name}</div>
                    <div className="mt-1">当前现价 {formatFundPrice(selectedFund.current_price)}</div>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="总投资额">
                    <NumberInput step="0.01" value={state.totalBudget} onChange={(event) => setState((current) => ({ ...current, totalBudget: Number(event.target.value) || 0 }))} />
                  </Field>
                  <Field label={selectedStrategy === 'peak-drawdown' ? '阶段高点' : 'MA120 触发价'}>
                    <NumberInput step="0.001" value={state.basePrice} onChange={(event) => setState((current) => ({ ...current, basePrice: Number(event.target.value) || 0 }))} />
                  </Field>
                </div>

                {selectedStrategy === 'ma120-risk' ? (
                  <Field label="MA200 风控价" helper="当它足够低于 MA120 深水层时，会进入最后一档。">
                    <NumberInput step="0.001" value={state.riskControlPrice} onChange={(event) => setState((current) => ({ ...current, riskControlPrice: Number(event.target.value) || 0 }))} />
                  </Field>
                ) : null}

                <Field
                  label="现金留存比例"
                  rightLabel={formatPercent(state.cashReservePct, 0)}
                  helper="默认留一部分现金给后续补仓，不把预算一次性全部打满。"
                >
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <input className="h-2 w-full accent-indigo-600" max="90" min="0" step="1" type="range" value={state.cashReservePct} onChange={(event) => setState((current) => ({ ...current, cashReservePct: Number(event.target.value) || 0 }))} />
                    <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-400">
                      <span>0%</span>
                      <span>保守</span>
                      <span>90%</span>
                    </div>
                  </div>
                </Field>

                <Field label="执行频率">
                  <SelectField options={frequencyOptions} value={state.frequency} onChange={(event) => setState((current) => ({ ...current, frequency: event.target.value }))} />
                </Field>
              </div>
            </Card>

            <Card className="min-w-0 overflow-hidden">
              <SectionHeading eyebrow="Step 02" title="策略模板" description="这里决定后续分层是按均线执行，还是按历史高点的固定回撤执行。" />

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {strategyOptions.map((option) => (
                  <button
                    key={option.key}
                    className={cx(
                      'rounded-[24px] border px-5 py-5 text-left transition-all',
                      selectedStrategy === option.key
                        ? 'border-indigo-200 bg-indigo-50 shadow-sm shadow-indigo-100'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                    )}
                    type="button"
                    onClick={() => setState((current) => ({ ...current, selectedStrategy: option.key }))}
                  >
                    <div className="text-sm font-semibold text-slate-900">{option.label}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-500">{option.note}</div>
                  </button>
                ))}
              </div>

              <div className="mt-5 rounded-[24px] border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-5">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">当前模板说明</div>
                <div className="mt-2 text-lg font-bold text-indigo-700">{activeStrategy.label}</div>
                <p className="mt-3 text-sm leading-6 text-slate-500">{strategySummary}</p>
              </div>
            </Card>

            <Card className="min-w-0 overflow-hidden">
              <SectionHeading
                eyebrow="Step 03"
                title={selectedStrategy === 'peak-drawdown' ? '固定回撤 8 档' : '均线分层设置'}
                description={selectedStrategy === 'peak-drawdown'
                  ? '档位和跌幅固定，资金按档位序号逐级加大，最后一档是极端回撤位。'
                  : '均线模板会基于 MA120 触发价和 MA200 风控价自动生成 4 档执行层。'}
              />

              <div className="mt-6 space-y-4">
                {computed.layers.map((layer) => (
                  <div key={layer.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-4">
                        <div className={cx('flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold text-white', layer.isExtreme ? 'bg-amber-500' : layer.order === 1 ? 'bg-slate-900' : 'bg-indigo-600')}>
                          {String(layer.order).padStart(2, '0')}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{layer.label}</div>
                          <div className="mt-1 text-sm text-slate-500">{layer.signal}</div>
                        </div>
                      </div>
                      <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                        {selectedStrategy === 'peak-drawdown' ? `序号权重 ${layer.weight}x` : `模板权重 ${layer.weight}x`}
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <Field label="触发价格">
                        <NumberInput className="bg-white text-slate-600" readOnly step="0.001" value={layer.price.toFixed(3)} />
                      </Field>
                      <Field label="累计跌幅">
                        <NumberInput className="bg-white text-slate-600" readOnly step="0.1" value={layer.drawdown} />
                      </Field>
                      <Field label="计划金额">
                        <NumberInput className="bg-white text-slate-600" readOnly step="0.01" value={layer.amount.toFixed(2)} />
                      </Field>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                      <span>预估份额 {layer.shares.toFixed(2)} 份</span>
                      <span className="font-semibold text-slate-900">资金占比 {formatPercent(layer.weight / computed.totalWeight * 100, 1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="min-w-0 space-y-6 lg:col-span-2">
            <Card className="min-w-0 overflow-hidden border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white">
              <SectionHeading eyebrow="Plan Preview" title="策略成本预览" />
              <div className="mt-6 rounded-[24px] border border-white/80 bg-white/90 p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">预估平均成本</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-indigo-700">{formatFundPrice(computed.averageCost)}</div>
                <div className="mt-4 grid gap-3">
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>可投入资金</span>
                    <strong className="text-slate-900">{formatCurrency(computed.investableCapital, '¥ ')}</strong>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>预留现金</span>
                    <strong className="text-slate-900">{formatCurrency(computed.reserveCapital, '¥ ')}</strong>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>{computed.anchorLabel}</span>
                    <strong className="text-slate-900">{formatFundPrice(computed.anchorPrice)}</strong>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-[24px] border border-slate-200 bg-white/80 p-5">
                <div
                  className={cx(
                    selectedStrategy === 'peak-drawdown'
                      ? 'grid grid-cols-4 gap-3 sm:flex sm:min-h-[180px] sm:min-w-max sm:items-end'
                      : 'flex min-h-[180px] items-end gap-3'
                  )}
                >
                  {computed.layers.map((layer) => (
                    <div
                      key={layer.id}
                      className={cx(
                        'flex flex-col items-center gap-3',
                        selectedStrategy === 'peak-drawdown' ? 'min-w-0 sm:w-14' : 'w-14'
                      )}
                    >
                      <div
                        className={cx(
                          'flex w-full items-end justify-center rounded-t-2xl px-2 py-3 text-xs font-bold text-white',
                          layer.isExtreme ? 'bg-amber-500' : layer.order === 1 ? 'bg-slate-900' : 'bg-indigo-600'
                        )}
                        style={{ height: `${Math.max(layer.weight * (selectedStrategy === 'peak-drawdown' ? 14 : 32), 44)}px` }}
                      >
                        {`${layer.weight}x`}
                      </div>
                      <span className="text-center text-[11px] font-semibold text-slate-400">
                        {selectedStrategy === 'peak-drawdown' ? `档位 ${layer.order}` : layer.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card className="min-w-0 overflow-hidden border-emerald-100 bg-emerald-50">
              <div className="font-semibold text-emerald-900">执行建议</div>
              <p className="mt-2 text-sm leading-6 text-emerald-800">
                {selectedStrategy === 'peak-drawdown'
                  ? `当前计划会按 8 档固定回撤执行，首档 ${formatPercent(computed.layers[0]?.drawdown ?? 0, 1)}，极端档 ${formatPercent(computed.layers[computed.layers.length - 1]?.drawdown ?? 0, 1)}。`
                  : `当前计划会按 4 档均线模板执行，先靠近 MA120 建首仓，再在更深位置逐步加大投入。`}
              </p>
            </Card>

            <Card className="min-w-0 overflow-hidden border-amber-200 bg-amber-50">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                <div>
                  <div className="font-semibold text-amber-900">估计备注</div>
                  <p className="mt-2 text-sm leading-6 text-amber-800">
                    {selectedStrategy === 'peak-drawdown'
                      ? '固定回撤模板的跌幅档位不会自动变化，调整阶段高点会整体联动 8 档价格。'
                      : '均线模板下，若 MA200 高于深水层，它只作为风控线提示，不会反向插入加仓顺序。'}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/85 p-4 shadow-[0_-4px_24px_rgba(15,23,42,0.04)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-6 text-sm text-slate-500">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">策略模板</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{activeStrategy.label}</div>
            </div>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">可投入资金</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{formatCurrency(computed.investableCapital, '¥ ')}</div>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a className={cx(secondaryButtonClass, 'w-full sm:w-auto')} href={links.home}>取消</a>
            <a className={cx(primaryButtonClass, 'w-full sm:w-auto')} href={links.home}>
              <Save className="h-4 w-4" />
              确认创建
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
