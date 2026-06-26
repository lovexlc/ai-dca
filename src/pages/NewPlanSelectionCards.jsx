import { Card, Field, NumberInput, SelectField, TextInput, cx } from '../components/experience-ui.jsx';
import { EXTRA_SYMBOL_GROUPS, EXTRA_SYMBOL_CODES, findExtraSymbol, isExtraSymbol } from '../app/extraSymbols.js';
import { strategyOptions } from '../app/newPlan.js';
import { SCREENING_CHECKLIST } from '../app/stockScreener.js';

export function NewPlanSelectionCards({
  planStep,
  marketError,
  selectedAssetTypeLabel,
  symbolSearch,
  setSymbolSearch,
  marketEntries,
  filteredMarketEntries,
  state,
  setState,
  selectedFund,
  selectedFundLabel,
  selectedFundCurrency,
  benchmarkNameLabel,
  benchmarkFund,
  benchmarkCurrency,
  extraQuote,
  selectedStrategy,
  activeStrategyLabel,
  selectedStrategyParams,
  frequencyOptions,
  selectedAssetType,
  screeningAnswers,
  setScreeningAnswers,
  screeningResult,
  derivedStageHigh,
  derivedMa120,
  derivedMa200,
  isBasePriceDirtyRef,
  isRiskPriceDirtyRef,
  formatFundPrice,
  formatPercent,
  formatMarketLabel
}) {
  return (
    <>
      <Card className={cx('min-w-0 overflow-hidden', planStep !== 1 && 'hidden')}>
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">第一步</div>
        <div className="mt-1 text-lg font-semibold text-slate-900">选择标的</div>

        {marketError ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            标的数据暂时加载失败：{marketError}
          </div>
        ) : null}

        <div className="mt-6 space-y-5">
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800">
            当前类型：{selectedAssetTypeLabel}
          </div>
          <Field className="min-w-0" label="资产标的" helper="可搜索纳指 ETF，或使用美股快捷分组。">
            <TextInput
              className="mb-3"
              aria-label="搜索标的"
              aria-describedby="new-plan-symbol-help"
              placeholder="搜索代码或名称，例如 QQQ / 513100 / 纳指"
              value={symbolSearch}
              onChange={(event) => setSymbolSearch(event.target.value)}
            />
            <div id="new-plan-symbol-help" className="sr-only">输入代码或名称筛选标的，下方也可使用快捷标的按钮。</div>
            <details className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-slate-500">快捷美股标的</summary>
              <div className="mt-3 space-y-2">
                {EXTRA_SYMBOL_GROUPS.map((group) => (
                  <div key={group.key} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500">{group.label}</span>
                    {group.symbols.map((s) => (
                      <button
                        key={s.code}
                        type="button"
                        onClick={() => {
                          const code = s.code;
                          setState((current) => ({ ...current, symbol: code }));
                        }}
                        className={cx(
                          'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                          state.symbol === s.code
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-600'
                        )}
                        title={s.name}
                      >
                        {s.code}
                      </button>
                    ))}
                    <span className="text-xs text-slate-400">{group.note}</span>
                  </div>
                ))}
              </div>
            </details>
            {marketEntries.length ? (
              <>
                <div className="mb-2 text-xs font-semibold text-slate-400">纳指 ETF 下拉 · {filteredMarketEntries.length}/{marketEntries.length}</div>
                <SelectField
                  className="min-w-0"
                  options={(() => {
                    const opts = filteredMarketEntries.map((entry) => ({
                      label: formatMarketLabel(entry),
                      value: entry.code
                    }));
                    const sym = String(state.symbol || '').trim();
                    if (sym && !opts.some((o) => o.value === sym)) {
                      const extra = findExtraSymbol(sym);
                      opts.unshift({ label: extra ? `${sym} · ${extra.name}（美股快选）` : sym, value: sym });
                    }
                    return opts;
                  })()}
                  value={state.symbol}
                  onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value }))}
                />
              </>
            ) : (
              <NumberInput
                value={state.symbol}
                onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value }))}
              />
            )}
          </Field>

          <div className="hidden" data-step-advanced-fields>
            {selectedFund ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                <div className="font-semibold text-slate-900">{selectedFundLabel}</div>
                <div className="mt-1">当前现价 {formatFundPrice(selectedFund.current_price, selectedFundCurrency)}</div>
                <div className="mt-1">策略参考基准 {benchmarkNameLabel}，{formatFundPrice(benchmarkFund?.current_price, benchmarkCurrency)}</div>
              </div>
            ) : isExtraSymbol(state.symbol) ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                <div className="font-semibold text-slate-900">
                  {state.symbol}·{findExtraSymbol(state.symbol)?.name || ''}
                </div>
                {extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.price > 0 ? (
                  <div className="mt-1">当前现价 {formatFundPrice(extraQuote.price, extraQuote.currency || 'USD')}{extraQuote.asOf ? ` · ${new Date(extraQuote.asOf).toLocaleString('zh-CN', { hour12: false })}` : ''}{extraQuote.asOf ? '' : ''}</div>
                ) : extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.loading ? (
                  <div className="mt-1">正在拉取实时行情…</div>
                ) : extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.error ? (
                  <div className="mt-1 text-rose-700">行情获取失败：{extraQuote.error}；请手动填写下方的「触发价」与「风控价」。</div>
                ) : null}
                <div className="mt-1 text-amber-700">提示：QQQ/SPY/VOO 等宽基指数只买不做 T；Mag7 / TSM 允许 70% 核仓 + 30% T 仓（后续 PR 会自动应用该规则）。</div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-4 text-sm text-indigo-800">
              <div className="font-semibold text-indigo-900">{selectedAssetTypeLabel}模式</div>
              <div className="mt-1">首买跌幅 {formatPercent(selectedStrategyParams.firstBuyDrop, 1)} · 加仓步长 {formatPercent(selectedStrategyParams.stepDrop, 1)} · {selectedStrategyParams.levels} 档</div>
              <div className="mt-1">倍数 {selectedStrategyParams.multipliers.join(' / ')} · 高位投入 {formatPercent(selectedStrategyParams.highLevelRatio * 100, 0)}</div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="总投资额">
                <NumberInput step="0.01" value={state.totalBudget} onChange={(event) => setState((current) => ({ ...current, totalBudget: event.target.value }))} />
              </Field>
              <Field label={selectedStrategy === 'peak-drawdown' ? '阶段高点' : '120日线触发价'}>
                <div className="flex items-center gap-2">
                  <NumberInput className="flex-1" step="0.001" value={state.basePrice} onChange={(event) => { isBasePriceDirtyRef.current = true; setState((current) => ({ ...current, basePrice: event.target.value })); }} />
                  <button type="button" title="重置为系统推荐值" className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" onClick={() => { isBasePriceDirtyRef.current = false; const sym = String(state.symbol || '').trim().toUpperCase(); const usingExtra = EXTRA_SYMBOL_CODES.has(sym) && extraQuote.symbol === sym && extraQuote.price > 0; const next = selectedStrategy === 'peak-drawdown' ? derivedStageHigh : (usingExtra ? extraQuote.price : derivedMa120); setState((current) => ({ ...current, basePrice: Number(next) || 0 })); }}>推荐</button>
                </div>
              </Field>
            </div>

            {selectedStrategy === 'ma120-risk' ? (
              <Field label="200日线风控价" helper="当它足够低于120日线深水层时，会进入最后一档。">
                <div className="flex items-center gap-2">
                  <NumberInput className="flex-1" step="0.001" value={state.riskControlPrice} onChange={(event) => { isRiskPriceDirtyRef.current = true; setState((current) => ({ ...current, riskControlPrice: event.target.value })); }} />
                  <button type="button" title="重置为系统推荐值" className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" onClick={() => { isRiskPriceDirtyRef.current = false; setState((current) => ({ ...current, riskControlPrice: Number(derivedMa200) || 0 })); }}>推荐</button>
                </div>
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
        </div>
      </Card>

      <Card className={cx('min-w-0 overflow-hidden', planStep !== 2 && 'hidden')}>
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">第二步</div>
        <div className="mt-1 text-lg font-semibold text-slate-900">选择策略模板</div>

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
          <div className="mt-2 text-lg font-bold text-indigo-700">{activeStrategyLabel}</div>
          <div className="mt-2 text-sm font-semibold text-slate-700">参考基准 {benchmarkNameLabel}</div>
          <p className="mt-3 text-sm leading-6 text-slate-500">第三步再确认总金额和风险档位；高级价格表默认折叠。</p>
          <div className="mt-4 inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
            首页仅查看策略结果，如需调整请回到本页重新创建
          </div>
        </div>

        {selectedAssetType === 'stock' ? (
          <Card className="mt-5 overflow-hidden border-amber-200 bg-amber-50">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">个股自查</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">基本面 checklist</div>
            <div className="mt-5 grid gap-3">
              {SCREENING_CHECKLIST.map((item) => (
                <label key={item.id} className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-white/80 px-4 py-3 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-amber-600" checked={Boolean(screeningAnswers[item.id])} onChange={(event) => setScreeningAnswers((current) => ({ ...current, [item.id]: event.target.checked }))} />
                  <span>
                    <span className="font-semibold text-slate-900">{item.label}{item.critical ? ' · 关键' : ''}</span>
                    <span className="mt-1 block text-slate-500">{item.description}</span>
                  </span>
                </label>
              ))}
            </div>
            {!screeningResult.passed ? <div className="mt-4 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-amber-800">{screeningResult.message}</div> : null}
          </Card>
        ) : null}
      </Card>
    </>
  );
}
