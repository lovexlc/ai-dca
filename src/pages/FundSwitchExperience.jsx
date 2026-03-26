import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, CloudUpload, FileImage, LoaderCircle, Plus, Trash2, Upload } from 'lucide-react';
import { formatCurrency } from '../app/accumulation.js';
import { buildFundSwitchSummary, createEmptyFundSwitchRow, persistFundSwitchState, readFundSwitchState } from '../app/fundSwitch.js';
import { findLatestNasdaqPrice, formatPriceAsOf, loadLatestNasdaqPrices } from '../app/nasdaqPrices.js';
import { Card, Field, NumberInput, PageHero, PageShell, SectionHeading, TextInput, cx, inputClass, primaryButtonClass, secondaryButtonClass, tableInputClass } from '../components/experience-ui.jsx';

const FUND_CODE_PATTERN = /^\d{6}$/;

function createOcrState(overrides = {}) {
  return {
    status: 'idle',
    progress: 0,
    message: '等待上传交易截图。',
    durationMs: 0,
    error: '',
    lineCount: 0,
    ...overrides
  };
}

function getStatusMeta(status) {
  if (status === 'loading') {
    return {
      Icon: LoaderCircle,
      label: '正在识别',
      detail: '正在提取截图中的交易记录，请稍候。',
      colorClass: 'border border-amber-200 bg-amber-50 text-amber-600',
      iconClassName: 'animate-spin'
    };
  }

  if (status === 'error') {
    return {
      Icon: AlertCircle,
      label: '识别失败',
      detail: '请检查截图清晰度，或重新上传交易凭证。',
      colorClass: 'border border-red-200 bg-red-50 text-red-600'
    };
  }

  if (status === 'warning') {
    return {
      Icon: AlertTriangle,
      label: '完成识别 (需复核)',
      detail: '识别结果已回填，但仍有字段建议人工复核。',
      colorClass: 'border border-amber-200 bg-amber-50 text-amber-600'
    };
  }

  if (status === 'success') {
    return {
      Icon: CheckCircle2,
      label: '已完成智能识别',
      detail: '识别结果已成功回填为可编辑交易数据。',
      colorClass: 'border border-emerald-200 bg-emerald-50 text-emerald-600'
    };
  }

  return {
    Icon: Upload,
    label: '待上传截图',
    detail: '支持 PNG / JPG / WebP 格式的交易凭证截图。',
    colorClass: 'border border-slate-200 bg-slate-100 text-slate-600'
  };
}

function formatSignedCurrency(value, prefix = '¥ ') {
  const absoluteValue = formatCurrency(Math.abs(value), prefix);
  if (value > 0) {
    return `+${absoluteValue}`;
  }
  if (value < 0) {
    return `-${absoluteValue}`;
  }
  return absoluteValue;
}

function getAdvantageTone(value) {
  if (value > 0) {
    return { className: 'border border-emerald-200 bg-emerald-50 text-emerald-600', label: '当前领先' };
  }
  if (value < 0) {
    return { className: 'border border-red-200 bg-red-50 text-red-600', label: '当前落后' };
  }
  return { className: 'border border-slate-200 bg-slate-50 text-slate-600', label: '基本持平' };
}

function buildMetricMeta(shares, currentPrice, snapshot) {
  const base = `${shares} 份 × ${Number(currentPrice || 0).toFixed(4)}`;
  return snapshot ? `${base} · 现价日期 ${formatPriceAsOf(snapshot)}` : `${base} · 手动现价`;
}

function getFundCodeError(code) {
  const value = String(code || '').trim();
  if (!value) {
    return '';
  }
  return FUND_CODE_PATTERN.test(value) ? '' : '代码必须是 6 位纯数字。';
}

export function FundSwitchExperience({ links, inPagesDir }) {
  const [state, setState] = useState(() => readFundSwitchState());
  const [ocrState, setOcrState] = useState(() => createOcrState());
  const [showCalculationDetails, setShowCalculationDetails] = useState(false);
  const [priceState, setPriceState] = useState(() => ({ status: 'idle', entries: [], error: '' }));
  const fileInputRef = useRef(null);

  const sourceSnapshot = useMemo(
    () => findLatestNasdaqPrice(priceState.entries, state.comparison?.sourceCode),
    [priceState.entries, state.comparison?.sourceCode]
  );
  const targetSnapshot = useMemo(
    () => findLatestNasdaqPrice(priceState.entries, state.comparison?.targetCode),
    [priceState.entries, state.comparison?.targetCode]
  );

  const resolvedComparison = useMemo(() => ({
    ...state.comparison,
    sourceCurrentPrice: Number(sourceSnapshot?.current_price) || Number(state.comparison?.sourceCurrentPrice) || 0,
    targetCurrentPrice: Number(targetSnapshot?.current_price) || Number(state.comparison?.targetCurrentPrice) || 0
  }), [state.comparison, sourceSnapshot, targetSnapshot]);

  const summary = useMemo(() => buildFundSwitchSummary({ ...state, comparison: resolvedComparison }), [state, resolvedComparison]);
  const statusMeta = getStatusMeta(ocrState.status);
  const advantageMeta = getAdvantageTone(summary.switchAdvantage);
  const recognizedCount = summary.recordCount;

  useEffect(() => {
    persistFundSwitchState({ ...state, comparison: resolvedComparison }, summary);
  }, [state, resolvedComparison, summary]);

  useEffect(() => {
    let cancelled = false;
    setPriceState((current) => ({ status: current.entries.length ? 'success' : 'loading', entries: current.entries, error: '' }));

    loadLatestNasdaqPrices({ inPagesDir })
      .then((entries) => {
        if (cancelled) {
          return;
        }
        setPriceState({ status: 'success', entries, error: '' });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setPriceState({ status: 'error', entries: [], error: error instanceof Error ? error.message : '加载失败。' });
      });

    return () => {
      cancelled = true;
    };
  }, [inPagesDir]);

  function updateComparison(key, value) {
    setState((current) => ({
      ...current,
      comparison: {
        ...current.comparison,
        [key]: ['sourceSellShares', 'sourceCurrentPrice', 'targetBuyShares', 'targetCurrentPrice', 'switchCost', 'extraCash', 'feeTradeCount'].includes(key)
          ? Number(value) || 0
          : value
      }
    }));
  }

  function updateFeePerTrade(value) {
    setState((current) => ({ ...current, feePerTrade: Number(value) || 0 }));
  }

  function updateRow(index, key, value) {
    setState((current) => {
      const nextRows = [...current.rows];
      const currentRow = nextRows[index] || createEmptyFundSwitchRow();
      const nextRow = {
        ...currentRow,
        [key]: ['buyPrice', 'sellPrice', 'shares'].includes(key) ? Number(value) || 0 : value
      };

      if (key === 'type') {
        const nextType = value === '卖出' ? '卖出' : '买入';
        const previousActivePrice = currentRow.type === '卖出' ? Number(currentRow.sellPrice) || 0 : Number(currentRow.buyPrice) || 0;
        nextRow.type = nextType;
        if (nextType === '买入' && !nextRow.buyPrice && previousActivePrice) {
          nextRow.buyPrice = previousActivePrice;
        }
        if (nextType === '卖出' && !nextRow.sellPrice && previousActivePrice) {
          nextRow.sellPrice = previousActivePrice;
        }
      }

      nextRows[index] = nextRow;
      return { ...current, rows: nextRows, recognizedRecords: nextRows.length };
    });
  }

  function removeRow(index) {
    setState((current) => {
      const nextRows = current.rows.filter((_, rowIndex) => rowIndex !== index);
      const safeRows = nextRows.length ? nextRows : [createEmptyFundSwitchRow()];
      return { ...current, rows: safeRows, recognizedRecords: safeRows.length };
    });
  }

  function addRow() {
    setState((current) => {
      const nextRows = [...current.rows, createEmptyFundSwitchRow()];
      return {
        ...current,
        rows: nextRows,
        recognizedRecords: nextRows.length
      };
    });
  }

  async function processOcrFile(file) {
    setOcrState(createOcrState({ status: 'loading', progress: 12, message: '准备上传截图' }));
    try {
      const { recognizeFundSwitchFile } = await import('../app/fundSwitchOcr.js');
      const result = await recognizeFundSwitchFile(file, state.comparison, (progress) => {
        setOcrState((current) => createOcrState({ ...current, ...progress }));
      });

      const parsedRows = result.rows.length ? result.rows : [createEmptyFundSwitchRow()];
      setState((current) => ({
        ...current,
        fileName: file.name,
        recognizedRecords: result.recordCount || parsedRows.length,
        rows: parsedRows,
        comparison: { ...current.comparison, ...result.comparison }
      }));

      if (result.rows.length) {
        const hasWarnings = Array.isArray(result.warnings) && result.warnings.length > 0;
        setOcrState(createOcrState({
          status: hasWarnings ? 'warning' : 'success',
          progress: 100,
          durationMs: result.durationMs,
          lineCount: result.recordCount || result.rows.length,
          message: hasWarnings ? `已提取 ${result.rows.length} 条记录，请复核。` : `提取完成，已解析 ${result.rows.length} 条记录。`
        }));
      } else {
        setOcrState(createOcrState({
          status: 'warning',
          progress: 100,
          durationMs: result.durationMs,
          lineCount: 0,
          message: '未能解析出记录。'
        }));
      }
    } catch (error) {
      setOcrState(createOcrState({
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : '提取失败',
        message: '服务异常'
      }));
    }
  }

  function handleFileInputChange(event) {
    const file = event.target.files?.[0];
    if (file) {
      void processOcrFile(file);
    }
    event.target.value = '';
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void processOcrFile(file);
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  return (
    <PageShell>
      <input ref={fileInputRef} accept="image/*" hidden onChange={handleFileInputChange} type="file" />

      <PageHero
        backHref={links.catalog || './catalog.html'}
        backLabel="返回页面目录"
        eyebrow="Fund Switch Assistant"
        title="基金切换收益助手"
        description="上传交易截图后，系统会智能识别整理成可编辑交易数据，自动比较切换前后的真实收益情况。"
        badges={[
          <span key="status" className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', statusMeta.colorClass)}>
            <statusMeta.Icon className={cx('h-4 w-4', statusMeta.iconClassName)} />
            {statusMeta.label}
          </span>,
          <span key="count" className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
            已同步 {recognizedCount} 条记录
          </span>
        ]}
        actions={
          <button className={primaryButtonClass} type="button" onClick={openFilePicker}>
            <Upload className="h-4 w-4" />
            上传截图
          </button>
        }
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="flex flex-col lg:col-span-2">
            <SectionHeading eyebrow="OCR Import" title="交易凭证导入" description={statusMeta.detail} />

            <button
              className={cx(
                'mt-6 flex min-h-[220px] flex-1 flex-col items-center justify-center rounded-[24px] border-2 border-dashed p-6 transition-all',
                ocrState.status === 'loading' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-indigo-400 hover:bg-slate-50'
              )}
              onClick={openFilePicker}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              type="button"
            >
              {ocrState.status === 'loading' ? (
                <LoaderCircle className="mb-3 h-10 w-10 animate-spin text-indigo-500" />
              ) : (
                <CloudUpload className="mb-3 h-10 w-10 text-slate-400" />
              )}
              <div className="font-semibold text-slate-700">点击或拖拽上传截图</div>
              <div className="mt-1 text-xs text-slate-500">支持 PNG, JPG, WebP 格式</div>
              {ocrState.status === 'idle' ? null : (
                <div className="mt-4 w-full max-w-xs">
                  <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>识别进度</span>
                    <span className="text-indigo-600">{ocrState.progress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${ocrState.progress}%` }} />
                  </div>
                </div>
              )}
            </button>

            {(ocrState.status !== 'idle' || state.fileName) && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <FileImage className="h-8 w-8 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-700">{state.fileName || '未命名文件'}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{ocrState.message}</div>
                  {ocrState.error ? <div className="mt-2 text-xs text-red-500">{ocrState.error}</div> : null}
                  {priceState.status === 'error' ? <div className="mt-2 text-xs text-amber-600">{priceState.error}</div> : null}
                </div>
              </div>
            )}
          </Card>

          <Card className="lg:col-span-3">
            <SectionHeading
              eyebrow="Conclusion"
              title="当前切换判断"
              action={<span className={cx('rounded-full px-3 py-1 text-xs font-bold', advantageMeta.className)}>{advantageMeta.label}</span>}
            />

            <div className="relative mt-6 overflow-hidden rounded-[24px] border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-6 shadow-sm">
              <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-indigo-500/10 blur-2xl" />
              <div className="text-sm font-semibold text-indigo-900/60">切换额外收益 (元)</div>
              <div className="mt-2 text-4xl font-extrabold tracking-tight text-indigo-600">{formatSignedCurrency(summary.switchAdvantage, '')}</div>
              <p className="mt-3 text-xs font-medium text-indigo-900/40">真实额外收益 = 切换后现值 - 不切换现值 - 额外补入现金 - 手续费</p>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-500">不切换现值</div>
                <div className="mt-1 text-xl font-bold text-slate-800">{formatCurrency(summary.stayValue, '¥ ')}</div>
                <div className="mt-1 truncate text-[10px] text-slate-400">{buildMetricMeta(summary.comparison.sourceSellShares, summary.comparison.sourceCurrentPrice, sourceSnapshot)}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-500">切换后现值</div>
                <div className="mt-1 text-xl font-bold text-slate-800">{formatCurrency(summary.switchedValue, '¥ ')}</div>
                <div className="mt-1 truncate text-[10px] text-slate-400">{buildMetricMeta(summary.comparison.targetBuyShares, summary.comparison.targetCurrentPrice, targetSnapshot)}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-500">现持仓浮盈</div>
                <div className={cx('mt-1 text-xl font-bold', summary.switchedPositionProfit >= 0 ? 'text-emerald-600' : 'text-red-500')}>
                  {formatSignedCurrency(summary.switchedPositionProfit, '¥ ')}
                </div>
                <div className="mt-1 text-[10px] text-slate-400">现值 - 成本 - 手续费</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-500">预估处理金额</div>
                <div className="mt-1 text-xl font-bold text-slate-800">{formatCurrency(summary.processedAmount, '¥ ')}</div>
                <div className="mt-1 text-[10px] text-slate-400">已识别记录累计成交额</div>
              </div>
            </div>
          </Card>
        </div>

        <Card className="overflow-hidden p-0">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 bg-white p-6 sm:flex-row sm:items-center">
            <SectionHeading
              eyebrow="Editable Data"
              title="交易数据明细"
              description="截图识别完成后自动回填，可以在此继续修正错误。基金代码为 6 位纯数字。"
            />
            <div className="flex items-center gap-3">
              <button className={secondaryButtonClass} type="button" onClick={openFilePicker}>
                <Upload className="h-4 w-4" />
                重新上传
              </button>
              <button className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100" type="button" onClick={addRow}>
                <Plus className="h-4 w-4" />
                新增条目
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-semibold">日期</th>
                  <th className="px-6 py-4 font-semibold">基金代码</th>
                  <th className="px-6 py-4 font-semibold">交易类型</th>
                  <th className="px-6 py-4 font-semibold">价格</th>
                  <th className="px-6 py-4 font-semibold">份额 (股数)</th>
                  <th className="w-16 px-6 py-4 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {summary.rows.map((row, index) => {
                  const codeError = getFundCodeError(row.code);
                  return (
                    <tr key={row.id} className="group transition-colors hover:bg-slate-50/50">
                      <td className="px-6 py-3">
                        <input className={cx(tableInputClass, 'w-36')} placeholder="YYYY-MM-DD" value={row.date} onChange={(event) => updateRow(index, 'date', event.target.value)} />
                      </td>
                      <td className="px-6 py-3">
                        <div className="relative">
                          <input
                            className={cx(
                              tableInputClass,
                              'w-32',
                              codeError ? 'border-red-300 text-red-900 focus:border-red-500' : 'border-transparent'
                            )}
                            placeholder="纯数字代码"
                            value={row.code}
                            onChange={(event) => updateRow(index, 'code', event.target.value)}
                          />
                          {codeError ? <div className="absolute left-0 top-10 z-10 rounded bg-red-600 px-2 py-1 text-[10px] text-white shadow-sm">{codeError}</div> : null}
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <select
                          className={cx(
                            'rounded-lg border px-3 py-2 pr-8 text-sm font-semibold outline-none transition-all',
                            row.type === '卖出'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                          )}
                          value={row.type}
                          onChange={(event) => updateRow(index, 'type', event.target.value)}
                        >
                          <option value="卖出">卖出</option>
                          <option value="买入">买入</option>
                        </select>
                      </td>
                      <td className="px-6 py-3">
                        <input className={cx(tableInputClass, 'w-28')} step="0.0001" type="number" placeholder="0.0000" value={row.price} onChange={(event) => updateRow(index, row.type === '卖出' ? 'sellPrice' : 'buyPrice', event.target.value)} />
                      </td>
                      <td className="px-6 py-3">
                        <input className={cx(tableInputClass, 'w-32')} step="0.01" type="number" placeholder="0.00" value={row.shares} onChange={(event) => updateRow(index, 'shares', event.target.value)} />
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button className="rounded-lg p-2 text-slate-400 opacity-0 transition-colors group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 focus:opacity-100" type="button" onClick={() => removeRow(index)} title="删除记录">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex cursor-pointer items-center justify-between border-b border-slate-200 bg-slate-50 p-6 transition-colors hover:bg-slate-100" onClick={() => setShowCalculationDetails((current) => !current)}>
            <SectionHeading eyebrow="Parameters" title="计算详细参数预设" description="需要人工校准时，再展开修改原持仓、目标仓位和手续费参数。" />
            <button className="flex items-center gap-2 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-800" type="button">
              {showCalculationDetails ? '收起面板' : '展开修改'}
              {showCalculationDetails ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>

          {showCalculationDetails ? (
            <div className="space-y-8 bg-white p-6">
              <div className="grid gap-8 md:grid-cols-2">
                <div className="space-y-4">
                  <h3 className="border-b border-slate-100 pb-2 font-bold text-slate-700">原持有方案 (不切换)</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="基金代码">
                      <TextInput value={summary.comparison.sourceCode} onChange={(event) => updateComparison('sourceCode', event.target.value)} placeholder="如 159660" />
                    </Field>
                    <Field label="持有份额">
                      <NumberInput step="0.01" value={summary.comparison.sourceSellShares} onChange={(event) => updateComparison('sourceSellShares', event.target.value)} />
                    </Field>
                    <Field
                      className="md:col-span-2"
                      label="当前计算单价"
                      helper={sourceSnapshot ? `(已同步 ${sourceSnapshot.time_key?.slice(11, 16)} 实时行情)` : '手动输入'}
                    >
                      <input
                        className={cx(inputClass, sourceSnapshot ? 'cursor-default border-indigo-200 bg-indigo-50 font-bold text-indigo-700' : '')}
                        type="number"
                        step="0.0001"
                        readOnly={Boolean(sourceSnapshot)}
                        value={summary.comparison.sourceCurrentPrice}
                        onChange={(event) => updateComparison('sourceCurrentPrice', event.target.value)}
                      />
                    </Field>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="border-b border-indigo-100 pb-2 font-bold text-indigo-700">目标切换方案</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="目标基金代码">
                      <TextInput value={summary.comparison.targetCode} onChange={(event) => updateComparison('targetCode', event.target.value)} placeholder="如 513100" />
                    </Field>
                    <Field label="换入份额">
                      <NumberInput step="0.01" value={summary.comparison.targetBuyShares} onChange={(event) => updateComparison('targetBuyShares', event.target.value)} />
                    </Field>
                    <Field
                      className="md:col-span-2"
                      label="当前计算单价"
                      helper={targetSnapshot ? `(已同步 ${targetSnapshot.time_key?.slice(11, 16)} 实时行情)` : '手动输入'}
                    >
                      <input
                        className={cx(inputClass, targetSnapshot ? 'cursor-default border-indigo-200 bg-indigo-50 font-bold text-indigo-700' : '')}
                        type="number"
                        step="0.0001"
                        readOnly={Boolean(targetSnapshot)}
                        value={summary.comparison.targetCurrentPrice}
                        onChange={(event) => updateComparison('targetCurrentPrice', event.target.value)}
                      />
                    </Field>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-6">
                <SectionHeading eyebrow="Cost Adjustments" title="切换成本调整项" />
                <div className="mt-5 grid gap-6 md:grid-cols-3">
                  <label className="block rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <span className="block text-sm font-bold text-slate-700">额外补入现金 (元)</span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">卖出所得不足以全部买入目标份额时，使用的额外场外资金。将从收益中扣除。</span>
                    <input className="mt-3 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="0.01" value={summary.comparison.extraCash} onChange={(event) => updateComparison('extraCash', event.target.value)} />
                  </label>

                  <label className="block rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <span className="block text-sm font-bold text-slate-700">目标仓位原始成本 (元)</span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">用于计算切换后目标仓位的累计浮盈，不影响切换对比结论。</span>
                    <input className="mt-3 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="0.01" value={summary.comparison.switchCost} onChange={(event) => updateComparison('switchCost', event.target.value)} />
                  </label>

                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <span className="block text-sm font-bold text-slate-700">预估交易手续费 (元)</span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">此项加总会从总收益中扣除。</span>
                    <div className="mt-3 flex items-center gap-2">
                      <input className="h-11 w-20 rounded-lg border border-slate-200 bg-white px-2 text-center font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="0.01" placeholder="单笔" value={summary.feePerTrade} onChange={(event) => updateFeePerTrade(event.target.value)} />
                      <span className="text-xs font-bold text-slate-400">×</span>
                      <div className="relative flex-1">
                        <input className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="1" value={summary.comparison.feeTradeCount} onChange={(event) => updateComparison('feeTradeCount', event.target.value)} />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">笔</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/80 p-4 shadow-[0_-4px_24px_rgba(0,0,0,0.04)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="hidden items-center gap-6 sm:flex">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">识别条目</div>
              <div className="mt-1 text-sm font-extrabold text-slate-700">{recognizedCount}</div>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">当前额外收益</div>
              <div className={cx('mt-1 text-sm font-extrabold', summary.switchAdvantage >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                {formatSignedCurrency(summary.switchAdvantage, '¥ ')}
              </div>
            </div>
          </div>

          <div className="flex w-full items-center gap-3 sm:w-auto">
            <button className={cx(secondaryButtonClass, 'flex-1 sm:flex-none')} type="button" onClick={openFilePicker}>
              重新上传
            </button>
            <button className={cx(primaryButtonClass, 'flex-1 sm:flex-none')} type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              确认数据与收益
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
