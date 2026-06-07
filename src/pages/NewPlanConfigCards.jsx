import { Card, Field, NumberInput, SectionHeading, SelectField, TextInput, cx } from '../components/experience-ui.jsx';
import { AlertTriangle, CheckCircle2, History } from 'lucide-react';
import { EXTRA_SYMBOL_CODES, findExtraSymbol, isExtraSymbol } from '../app/extraSymbols.js';

export function NewPlanConfigCards({
  planStep,
  selectedStrategy,
  activeStrategyLabel,
  computed,
  selectedFund,
  selectedFundLabel,
  selectedFundCurrency,
  benchmarkNameLabel,
  benchmarkFund,
  benchmarkCurrency,
  extraQuote,
  state,
  setState,
  selectedAssetTypeLabel,
  selectedStrategyParams,
  selectedFrequencyLabel,
  frequencyOptions,
  selectedInstrumentCurrency,
  customDrawdown,
  setCustomDrawdown,
  isBasePriceDirtyRef,
  isRiskPriceDirtyRef,
  derivedStageHigh,
  derivedMa120,
  derivedMa200,
  formatFundPrice,
  formatPercent,
  formatCurrency,
  isEditing = false,
  planChangeSummary = [],
  planValidation = { blocking: [], warnings: [] },
  isNameDirtyRef
}) {
  const blockingChecks = Array.isArray(planValidation?.blocking) ? planValidation.blocking : [];
  const warningChecks = Array.isArray(planValidation?.warnings) ? planValidation.warnings : [];

  return (
    <>
      <Card className={cx('min-w-0 overflow-hidden', planStep !== 3 && 'hidden')}>
        <SectionHeading
          eyebrow="第三步"
          title={selectedStrategy === 'peak-drawdown' ? `固定回撤 ${computed.layers.length} 档` : '均线分层设置'}
        />

        <div className="mt-6 space-y-5">
          {selectedFund ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              <div className="font-semibold text-slate-900">{selectedFundLabel}</div>
              <div className="mt-1">当前现价 {formatFundPrice(selectedFund.current_price, selectedFundCurrency)}</div>
              {selectedStrategy === 'peak-drawdown' ? (
                <div className="mt-1">固定回撤参考标的最高价 {formatFundPrice(derivedStageHigh, selectedFundCurrency)}</div>
              ) : (
                <div className="mt-1">策略参考基准 {benchmarkNameLabel}，{formatFundPrice(benchmarkFund?.current_price, benchmarkCurrency)}</div>
              )}
            </div>
          ) : isExtraSymbol(state.symbol) ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
              <div className="font-semibold text-slate-900">{state.symbol}·{findExtraSymbol(state.symbol)?.name || ''}</div>
              {extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.price > 0 ? (
                <div className="mt-1">当前现价 {formatFundPrice(extraQuote.price, extraQuote.currency || 'USD')}{extraQuote.asOf ? ` · ${new Date(extraQuote.asOf).toLocaleString('zh-CN', { hour12: false })}` : ''}</div>
              ) : extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.loading ? (
                <div className="mt-1">正在拉取实时行情…</div>
              ) : extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.error ? (
                <div className="mt-1 text-rose-700">行情获取失败：{extraQuote.error}；请手动填写下方价格。</div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-4 text-sm text-indigo-800">
            <div className="font-semibold text-indigo-900">{selectedAssetTypeLabel}模式</div>
            <div className="mt-1">首买跌幅 {formatPercent(selectedStrategyParams.firstBuyDrop, 1)} · 加仓步长 {formatPercent(selectedStrategyParams.stepDrop, 1)} · {selectedStrategyParams.levels} 档</div>
            <div className="mt-1">倍数 {selectedStrategyParams.multipliers.join(' / ')} · 高位投入 {formatPercent(selectedStrategyParams.highLevelRatio * 100, 0)}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="总投资额">
              <NumberInput step="0.01" value={state.totalBudget} onChange={(event) => setState((current) => ({ ...current, totalBudget: Number(event.target.value) || 0 }))} />
            </Field>
            <Field label="执行频率">
              <SelectField options={frequencyOptions} value={state.frequency} onChange={(event) => setState((current) => ({ ...current, frequency: event.target.value }))} />
            </Field>
          </div>

          <Field label="现金留存比例" rightLabel={formatPercent(state.cashReservePct, 0)}>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <input aria-label="现金留存比例" className="h-2 w-full accent-indigo-600" max="90" min="0" step="1" type="range" value={state.cashReservePct} onChange={(event) => setState((current) => ({ ...current, cashReservePct: Number(event.target.value) || 0 }))} />
            </div>
          </Field>

          {selectedStrategy === 'peak-drawdown' ? (
            <details className="rounded-[24px] border border-indigo-200 bg-indigo-50/40 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-indigo-700">高级自定义固定回撤参数</summary>
              <div className="mt-4 space-y-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
                  <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={customDrawdown.enabled} onChange={(event) => setCustomDrawdown((current) => ({ ...current, enabled: event.target.checked }))} />
                  开启自定义参数（关闭则使用系统推荐档位）
                </label>
                <div className={cx('grid gap-4 md:grid-cols-2', !customDrawdown.enabled && 'pointer-events-none opacity-50')}>
                  <Field label="建仓总档数" rightLabel={`${customDrawdown.levels} 档`} helper="范围 4 ~ 10 档">
                    <input type="range" min="4" max="10" step="1" className="h-2 w-full accent-indigo-600" value={customDrawdown.levels} onChange={(event) => setCustomDrawdown((current) => ({ ...current, levels: Number(event.target.value) || 6 }))} />
                  </Field>
                  <Field label="首档下跌触发" rightLabel={`-${customDrawdown.firstDrop}%`} helper="范围 -5% ~ -15%">
                    <input type="range" min="5" max="15" step="1" className="h-2 w-full accent-indigo-600" value={customDrawdown.firstDrop} onChange={(event) => setCustomDrawdown((current) => ({ ...current, firstDrop: Number(event.target.value) || 10 }))} />
                  </Field>
                  <Field label="阶梯步长" rightLabel={`-${customDrawdown.stepDrop}%`} helper="范围 -2% ~ -8%">
                    <input type="range" min="2" max="8" step="1" className="h-2 w-full accent-indigo-600" value={customDrawdown.stepDrop} onChange={(event) => setCustomDrawdown((current) => ({ ...current, stepDrop: Number(event.target.value) || 5 }))} />
                  </Field>
                  <Field label="倍数模式" helper="递增：每档递加；固定：每档同倍">
                    <SelectField options={[{ label: '递增 (1.0x → 2.0x)', value: 'increment' }, { label: '固定 (1.0x)', value: 'fixed' }]} value={customDrawdown.multiplierMode} onChange={(event) => setCustomDrawdown((current) => ({ ...current, multiplierMode: event.target.value }))} />
                  </Field>
                </div>
                {customDrawdown.enabled ? (
                  <div className="rounded-2xl border border-indigo-100 bg-white px-4 py-3 text-xs text-slate-600">
                    当前生成 <strong className="text-indigo-700">{computed.layers.length}</strong> 档：首档 -{customDrawdown.firstDrop}%，每档增加 {customDrawdown.stepDrop}%跌幅；倍数 {customDrawdown.multiplierMode === 'fixed' ? '每档同 1.0x' : `1.0x → ${(1 + 0.5 * (customDrawdown.levels - 1)).toFixed(1)}x`}。右侧预览图与下方档位表会实时联动。
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          <details className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">高级价格表</summary>
            <div className="mt-5 space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={selectedStrategy === 'peak-drawdown' ? '阶段高点' : '120日线触发价'}>
                  <div className="flex items-center gap-2">
                    <NumberInput className="flex-1" step="0.001" value={Number(state.basePrice || 0).toFixed(3)} onChange={(event) => { isBasePriceDirtyRef.current = true; setState((current) => ({ ...current, basePrice: Number(event.target.value) || 0 })); }} />
                    <button type="button" title="重置为系统推荐值" className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" onClick={() => { isBasePriceDirtyRef.current = false; const sym = String(state.symbol || '').trim().toUpperCase(); const usingExtra = EXTRA_SYMBOL_CODES.has(sym) && extraQuote.symbol === sym && extraQuote.price > 0; const next = selectedStrategy === 'peak-drawdown' ? derivedStageHigh : (usingExtra ? extraQuote.price : derivedMa120); setState((current) => ({ ...current, basePrice: Number(next) || 0 })); }}>推荐</button>
                  </div>
                </Field>
                {selectedStrategy === 'ma120-risk' ? (
                  <Field label="200日线风控价" helper="当它足够低于120日线深水层时，会进入最后一档。">
                    <div className="flex items-center gap-2">
                      <NumberInput className="flex-1" step="0.001" value={Number(state.riskControlPrice || 0).toFixed(3)} onChange={(event) => { isRiskPriceDirtyRef.current = true; setState((current) => ({ ...current, riskControlPrice: Number(event.target.value) || 0 })); }} />
                      <button type="button" title="重置为系统推荐值" className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" onClick={() => { isRiskPriceDirtyRef.current = false; setState((current) => ({ ...current, riskControlPrice: Number(derivedMa200) || 0 })); }}>推荐</button>
                    </div>
                  </Field>
                ) : null}
              </div>

              <div className="space-y-4">
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
                        {selectedStrategy === 'peak-drawdown' ? `策略倍数 ${layer.weight}x` : `模板权重 ${layer.weight}x`}
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
            </div>
          </details>
        </div>
      </Card>

      <Card className={cx('min-w-0 overflow-hidden', planStep !== 4 && 'hidden')}>
        <SectionHeading eyebrow="第四步" title="确认策略配置" />
        <div className="mt-5 space-y-5">
          <Field label="策略名称" helper="创建后会出现在交易计划列表中；系统会根据标的与策略自动生成推荐名称。">
            <div className="flex items-center gap-2">
              <TextInput
                className="flex-1"
                placeholder="例如：513100 固定回撤计划"
                value={state.name || ''}
                onChange={(event) => { isNameDirtyRef.current = true; setState((current) => ({ ...current, name: event.target.value })); }}
              />
              <button type="button" title="重新使用系统推荐名称" className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" onClick={() => { isNameDirtyRef.current = false; setState((current) => ({ ...current, name: '' })); }}>推荐</button>
            </div>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">投资标的</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{selectedFundLabel}</div>
              <div className="mt-1 text-xs text-slate-500">参考基准 {benchmarkNameLabel}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">模板 / 频率</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{activeStrategyLabel}</div>
              <div className="mt-1 text-xs text-slate-500">{selectedFrequencyLabel}</div>
            </div>
          </div>

          <div className={cx('rounded-2xl border px-4 py-4', blockingChecks.length ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50')}>
            <div className="flex items-start gap-3">
              {blockingChecks.length ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              )}
              <div className="min-w-0">
                <div className={cx('text-sm font-bold', blockingChecks.length ? 'text-rose-900' : 'text-emerald-900')}>保存前检查</div>
                <div className={cx('mt-1 text-sm', blockingChecks.length ? 'text-rose-700' : 'text-emerald-700')}>
                  {blockingChecks.length ? '仍有关键参数需要补全，保存时会跳回对应步骤。' : '核心参数已完整，可以保存计划并同步提醒规则。'}
                </div>
              </div>
            </div>
            {blockingChecks.length ? (
              <ul className="mt-3 space-y-2 text-sm text-rose-700">
                {blockingChecks.map((item) => (
                  <li key={`${item.step}-${item.message}`}>第 {item.step} 步：{item.message}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {warningChecks.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-amber-900">建议确认</div>
                  <ul className="mt-2 space-y-2 text-sm text-amber-800">
                    {warningChecks.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}

          {isEditing ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
              <div className="flex items-start gap-3">
                <History className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900">本次变更</div>
                  <div className="mt-1 text-sm text-slate-500">
                    {planChangeSummary.length ? '保存后会替换这些关键配置，并重新同步提醒规则。' : '关键参数未变化，保存会刷新提醒规则。'}
                  </div>
                </div>
              </div>
              {planChangeSummary.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {planChangeSummary.map((item) => (
                    <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">{item}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900">档位确认明细</div>
            <div className="divide-y divide-slate-100 sm:hidden">
              {computed.layers.map((layer) => {
                const capitalRatio = formatPercent((computed.totalWeight ? layer.weight / computed.totalWeight : 0) * 100, 1);
                return (
                  <div key={layer.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900">{layer.label}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatFundPrice(layer.price, selectedInstrumentCurrency)} · {formatPercent(layer.drawdown, 1)}</div>
                      </div>
                      <div className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{capitalRatio}</div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <div className="font-semibold text-slate-400">计划金额</div>
                        <div className="mt-1 font-bold text-slate-900">{formatCurrency(layer.amount, '¥ ')}</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <div className="font-semibold text-slate-400">预估份额</div>
                        <div className="mt-1 font-bold text-slate-900">{layer.shares.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-[560px] text-left text-sm whitespace-nowrap">
                <thead className="bg-white text-[11px] uppercase tracking-[0.16em] text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-bold">档位</th>
                    <th className="px-4 py-3 font-bold">触发价</th>
                    <th className="px-4 py-3 font-bold">累计跌幅</th>
                    <th className="px-4 py-3 font-bold">计划金额</th>
                    <th className="px-4 py-3 font-bold">资金比例</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-600">
                  {computed.layers.map((layer) => (
                    <tr key={layer.id} className="hover:bg-indigo-50/40">
                      <td className="px-4 py-3 font-semibold text-slate-900">{layer.label}</td>
                      <td className="px-4 py-3 font-mono">{formatFundPrice(layer.price, selectedInstrumentCurrency)}</td>
                      <td className="px-4 py-3">{formatPercent(layer.drawdown, 1)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{formatCurrency(layer.amount, '¥ ')}</td>
                      <td className="px-4 py-3">{formatPercent((computed.totalWeight ? layer.weight / computed.totalWeight : 0) * 100, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
