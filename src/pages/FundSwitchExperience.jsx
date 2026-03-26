import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency } from '../app/accumulation.js';
import { buildFundSwitchSummary, createEmptyFundSwitchRow, persistFundSwitchState, readFundSwitchState } from '../app/fundSwitch.js';
import { findLatestNasdaqPrice, formatPriceAsOf, loadLatestNasdaqPrices } from '../app/nasdaqPrices.js';
import { MaterialIcon } from '../components/MaterialIcon.jsx';
import { SurfaceCard } from '../components/PageChrome.jsx';

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
      tone: 'warning',
      icon: 'hourglass_top',
      label: '正在识别',
      detail: '正在提取截图中的交易记录，请稍候。'
    };
  }

  if (status === 'error') {
    return {
      tone: 'warning',
      icon: 'error',
      label: '识别失败',
      detail: '请检查截图清晰度，或重新上传交易凭证。'
    };
  }

  if (status === 'warning') {
    return {
      tone: 'warning',
      icon: 'warning',
      label: '已完成智能识别',
      detail: '识别结果已回填，但仍有字段建议人工复核。'
    };
  }

  if (status === 'success') {
    return {
      tone: 'success',
      icon: 'check_circle',
      label: '已完成智能识别',
      detail: '识别结果已回填为可编辑交易数据。'
    };
  }

  return {
    tone: 'neutral',
    icon: 'upload_file',
    label: '待上传交易凭证',
    detail: '支持 PNG / JPG / JPEG / WebP 格式的交易截图。'
  };
}

function buildUploadBadge(fileName) {
  const extension = String(fileName || '').split('.').pop()?.slice(0, 3).toUpperCase();
  return extension || 'IMG';
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
    return {
      className: 'is-positive',
      label: '当前领先'
    };
  }

  if (value < 0) {
    return {
      className: 'is-negative',
      label: '当前落后'
    };
  }

  return {
    className: 'is-neutral',
    label: '基本持平'
  };
}

function buildPriceFieldHelper(snapshot, priceState) {
  if (snapshot) {
    return `已自动同步分钟线现价，现价日期 ${formatPriceAsOf(snapshot)}。`;
  }

  if (priceState.status === 'loading' || priceState.status === 'idle') {
    return '正在同步分钟线现价。';
  }

  if (priceState.status === 'error') {
    return '分钟线现价加载失败，可手动输入。';
  }

  return '未匹配到分钟线现价，可手动输入。';
}

function buildMetricMeta(shares, currentPrice, snapshot) {
  const base = `${shares} 份 × ${Number(currentPrice || 0).toFixed(4)}`;
  return snapshot
    ? `${base} · 现价日期 ${formatPriceAsOf(snapshot)}`
    : `${base} · 手动现价`;
}

function getFundCodeError(code) {
  const value = String(code || '').trim();
  if (!value) {
    return '';
  }

  return FUND_CODE_PATTERN.test(value) ? '' : '基金代码必须是 6 位纯数字，不能填写基金名称。';
}

function buildFieldShellClass(isError, isReadOnly = false) {
  if (isError) {
    return 'field__input-shell is-error';
  }

  if (isReadOnly) {
    return 'field__input-shell is-readonly';
  }

  return 'field__input-shell';
}

export function FundSwitchExperience({ links, inPagesDir }) {
  const [state, setState] = useState(() => readFundSwitchState());
  const [ocrState, setOcrState] = useState(() => createOcrState());
  const [showCalculationDetails, setShowCalculationDetails] = useState(false);
  const [priceState, setPriceState] = useState(() => ({
    status: 'idle',
    entries: [],
    error: ''
  }));
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
  const summary = useMemo(() => buildFundSwitchSummary({
    ...state,
    comparison: resolvedComparison
  }), [state, resolvedComparison]);
  const statusMeta = getStatusMeta(ocrState.status);
  const advantageMeta = getAdvantageTone(summary.switchAdvantage);
  const recognizedCount = Math.max(Number(state.recognizedRecords) || 0, summary.recordCount);

  useEffect(() => {
    persistFundSwitchState({
      ...state,
      comparison: resolvedComparison
    }, summary);
  }, [state, resolvedComparison, summary]);

  useEffect(() => {
    let cancelled = false;

    setPriceState((current) => ({
      status: current.entries.length ? 'success' : 'loading',
      entries: current.entries,
      error: ''
    }));

    loadLatestNasdaqPrices({ inPagesDir })
      .then((entries) => {
        if (cancelled) {
          return;
        }

        setPriceState({
          status: 'success',
          entries,
          error: ''
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setPriceState({
          status: 'error',
          entries: [],
          error: error instanceof Error ? error.message : '分钟线现价加载失败。'
        });
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
        [key]: key.includes('Shares') || key.includes('Price') || key === 'switchCost' || key === 'extraCash' || key === 'feeTradeCount'
          ? Number(value) || 0
          : value
      }
    }));
  }

  function updateFeePerTrade(value) {
    setState((current) => ({
      ...current,
      feePerTrade: Number(value) || 0
    }));
  }

  function updateRow(index, key, value) {
    setState((current) => {
      const nextRows = [...current.rows];
      const currentRow = nextRows[index] || createEmptyFundSwitchRow();
      const nextRow = {
        ...currentRow,
        [key]: key === 'buyPrice' || key === 'sellPrice' || key === 'shares' ? Number(value) || 0 : value
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
      return { ...current, rows: nextRows };
    });
  }

  function removeRow(index) {
    setState((current) => {
      const nextRows = current.rows.filter((_, rowIndex) => rowIndex !== index);
      return {
        ...current,
        rows: nextRows.length ? nextRows : [createEmptyFundSwitchRow()]
      };
    });
  }

  function addRow() {
    setState((current) => ({
      ...current,
      rows: [...current.rows, createEmptyFundSwitchRow()],
      recognizedRecords: current.rows.length + 1
    }));
  }

  async function processOcrFile(file) {
    setOcrState(createOcrState({
      status: 'loading',
      progress: 12,
      message: '准备上传截图'
    }));

    try {
      const { recognizeFundSwitchFile } = await import('../app/fundSwitchOcr.js');
      const result = await recognizeFundSwitchFile(file, state.comparison, (progress) => {
        setOcrState((current) => createOcrState({
          ...current,
          ...progress
        }));
      });

      const parsedRows = result.rows.length ? result.rows : [createEmptyFundSwitchRow()];
      setState((current) => ({
        ...current,
        fileName: file.name,
        recognizedRecords: result.recordCount || result.rows.length,
        rows: parsedRows,
        comparison: {
          ...current.comparison,
          ...result.comparison
        }
      }));

      if (result.rows.length) {
        const hasWarnings = Array.isArray(result.warnings) && result.warnings.length > 0;
        setOcrState(createOcrState({
          status: hasWarnings ? 'warning' : 'success',
          progress: 100,
          durationMs: result.durationMs,
          lineCount: result.recordCount || result.rows.length,
          message: hasWarnings
            ? `已提取 ${result.rows.length} 条交易记录，请重点复核提示项。`
            : `提取完成，已解析 ${result.rows.length} 条交易记录。`
        }));
      } else {
        setOcrState(createOcrState({
          status: 'warning',
          progress: 100,
          durationMs: result.durationMs,
          lineCount: 0,
          message: '提取完成，但没有稳定产出可回填的交易记录，请手动确认或补录。'
        }));
      }
    } catch (error) {
      setOcrState(createOcrState({
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : '接口调用失败，请检查截图内容或稍后重试。',
        message: '提取失败'
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
    <div className="fund-switch-page">
      <input
        ref={fileInputRef}
        accept="image/png,image/jpeg,image/jpg,image/webp"
        hidden
        onChange={handleFileInputChange}
        type="file"
      />

      <section className="fund-switch-hero">
        <div className="fund-switch-hero__intro">
          <a className="fund-switch-backlink" href={links?.catalog || './catalog.html'}>
            <MaterialIcon className="fund-switch-backlink__icon" name="west" />
            返回页面目录
          </a>
          <div className="section-eyebrow">基金切换收益助手</div>
          <h1 className="fund-switch-hero__title">基金切换收益助手</h1>
          <p className="fund-switch-hero__subtitle">
            上传交易截图后，系统会先整理成可编辑交易数据，再比较切换前后的真实收益。
          </p>
          <div className="fund-switch-hero__chips">
            <span className={statusMeta.tone === 'warning' ? 'fund-switch-chip is-warning' : statusMeta.tone === 'success' ? 'fund-switch-chip is-success' : 'fund-switch-chip is-neutral'}>
              <MaterialIcon className="fund-switch-chip__icon" filled={statusMeta.tone !== 'neutral'} name={statusMeta.icon} />
              {statusMeta.label}
            </span>
            <span className="fund-switch-chip fund-switch-chip--ghost">
              已同步 {recognizedCount} 条交易记录
            </span>
          </div>
        </div>

        <div className="fund-switch-hero__actions">
          <button className="button-secondary" type="button" onClick={() => setShowCalculationDetails((value) => !value)}>
            <MaterialIcon className="icon-button__icon" name={showCalculationDetails ? 'expand_less' : 'tune'} />
            {showCalculationDetails ? '收起计算参数' : '查看计算参数'}
          </button>
          <button className="button-primary" type="button" onClick={openFilePicker}>
            <MaterialIcon className="icon-button__icon" name="upload_file" />
            上传交易凭证
          </button>
        </div>
      </section>

      <section className="fund-switch-layout">
        <SurfaceCard className="fund-switch-surface fund-switch-upload-card">
          <div className="fund-switch-section-head">
            <div>
              <div className="section-eyebrow">上传与识别</div>
              <h2 className="section-title">交易凭证导入</h2>
            </div>
            <span className="table-note">{ocrState.status === 'idle' ? '待上传' : `${ocrState.progress}%`}</span>
          </div>

          <button
            className={ocrState.status === 'loading' ? 'upload-dropzone is-loading' : 'upload-dropzone'}
            onClick={openFilePicker}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            type="button"
          >
            <div className="upload-dropzone__icon">
              <MaterialIcon className="upload-dropzone__icon-symbol" name={ocrState.status === 'loading' ? 'hourglass_top' : 'cloud_upload'} />
            </div>
            <div className="upload-dropzone__title">点击或拖拽上传交易截图</div>
            <div className="upload-dropzone__copy">支持 PNG / JPG / JPEG / WebP</div>
            <div className="upload-dropzone__hint">{ocrState.message}</div>
          </button>

          <div className="progress-line">
            <div className="progress-line__head">
              <span>识别进度</span>
              <strong>{ocrState.status === 'idle' ? '待上传' : `${ocrState.progress}%`}</strong>
            </div>
            <div className="progress-line__track">
              <div className="progress-line__value" style={{ width: `${ocrState.progress}%` }} />
            </div>
          </div>

          <div className="ocr-file">
            <div className="ocr-file__badge">{buildUploadBadge(ocrState.status === 'idle' ? '' : state.fileName)}</div>
            <div className="ocr-file__body">
              <strong>{ocrState.status === 'idle' ? '暂未上传交易凭证' : state.fileName}</strong>
              <span>
                {ocrState.status === 'error'
                  ? ocrState.error
                  : ocrState.status === 'success' || ocrState.status === 'warning'
                    ? `已回填 ${recognizedCount} 条交易记录，可直接在下方继续修改。`
                    : statusMeta.detail}
              </span>
            </div>
            <MaterialIcon className="ocr-file__check" filled name={statusMeta.icon} />
          </div>

          <div className="fund-switch-upload-stats">
            <div className="fund-switch-stat">
              <span className="fund-switch-stat__label">识别状态</span>
              <strong className="fund-switch-stat__value">{statusMeta.label}</strong>
            </div>
            <div className="fund-switch-stat">
              <span className="fund-switch-stat__label">解析耗时</span>
              <strong className="fund-switch-stat__value">{ocrState.durationMs ? `${ocrState.durationMs} ms` : '等待返回'}</strong>
            </div>
            <div className="fund-switch-stat">
              <span className="fund-switch-stat__label">可回填记录</span>
              <strong className="fund-switch-stat__value">{recognizedCount} 条</strong>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="fund-switch-surface fund-switch-summary-card">
          <div className="fund-switch-section-head">
            <div>
              <div className="section-eyebrow">结论摘要</div>
              <h2 className="section-title">当前切换判断</h2>
            </div>
            <span className={`fund-switch-summary__chip ${advantageMeta.className}`}>{advantageMeta.label}</span>
          </div>

          <div className="fund-switch-summary">
            <div className="fund-switch-summary__main">
              <span className="fund-switch-summary__label">切换额外收益</span>
              <strong className="fund-switch-summary__value">{formatSignedCurrency(summary.switchAdvantage, '¥ ')}</strong>
              <p className="fund-switch-summary__formula">切换后现值 - 不切换现值 - 额外补入现金 - 手续费</p>
            </div>

            <div className="fund-switch-metric-grid">
              <div className="fund-switch-metric">
                <span className="fund-switch-metric__label">不切换现值</span>
                <strong className="fund-switch-metric__value">{formatCurrency(summary.stayValue, '¥ ')}</strong>
                <span className="fund-switch-metric__meta">{buildMetricMeta(summary.comparison.sourceSellShares, summary.comparison.sourceCurrentPrice, sourceSnapshot)}</span>
              </div>
              <div className="fund-switch-metric">
                <span className="fund-switch-metric__label">切换后现值</span>
                <strong className="fund-switch-metric__value">{formatCurrency(summary.switchedValue, '¥ ')}</strong>
                <span className="fund-switch-metric__meta">{buildMetricMeta(summary.comparison.targetBuyShares, summary.comparison.targetCurrentPrice, targetSnapshot)}</span>
              </div>
              <div className="fund-switch-metric">
                <span className="fund-switch-metric__label">当前持仓浮盈</span>
                <strong className="fund-switch-metric__value">{formatSignedCurrency(summary.switchedPositionProfit, '¥ ')}</strong>
                <span className="fund-switch-metric__meta">切换后现值 - 买入总成本 - 手续费</span>
              </div>
              <div className="fund-switch-metric">
                <span className="fund-switch-metric__label">预估处理金额</span>
                <strong className="fund-switch-metric__value">{formatCurrency(summary.processedAmount, '¥ ')}</strong>
                <span className="fund-switch-metric__meta">已识别交易记录对应的累计成交金额</span>
              </div>
            </div>
          </div>
        </SurfaceCard>
      </section>

      <SurfaceCard className="fund-switch-surface fund-switch-data-card">
        <div className="fund-switch-section-head">
          <div>
            <div className="section-eyebrow">交易数据校准</div>
            <h2 className="section-title">交易数据（可编辑）</h2>
          </div>
          <div className="page-header__actions">
            <button className="button-secondary" type="button" onClick={addRow}>
              <MaterialIcon className="icon-button__icon" name="add" />
              新增条目
            </button>
            <button className="button-secondary" type="button" onClick={openFilePicker}>
              <MaterialIcon className="icon-button__icon" name="upload_file" />
              重新上传
            </button>
          </div>
        </div>
        <div className="table-note fund-switch-section-note">
          截图识别完成后，结果会直接回填到这里。你可以继续修改日期、基金代码、交易方向、买入价格、卖出价格和份额。基金代码仅接受 6 位纯数字。
        </div>

        <div className="fund-table-wrap fund-table-wrap--desktop">
          <table className="fund-table">
            <thead>
              <tr>
                <th>日期 (时间)</th>
                <th>基金代码</th>
                <th className="fund-table__type-col">交易类型</th>
                <th>买入价格</th>
                <th>卖出价格</th>
                <th>份额 (股数)</th>
                <th className="fund-table__action">操作</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row, index) => {
                const codeError = getFundCodeError(row.code);
                return (
                <tr key={row.id} className={index % 2 === 1 ? 'is-striped' : ''}>
                  <td>
                    <input type="text" value={row.date} onChange={(event) => updateRow(index, 'date', event.target.value)} />
                  </td>
                  <td>
                    <div className="fund-table__field">
                      <input
                        className={codeError ? 'fund-table__input is-error' : 'fund-table__input'}
                        type="text"
                        value={row.code}
                        onChange={(event) => updateRow(index, 'code', event.target.value)}
                      />
                      {codeError ? <span className="fund-table__cell-note is-error">{codeError}</span> : null}
                    </div>
                  </td>
                  <td className="fund-table__type-col">
                    <select
                      className={row.type === '卖出' ? 'fund-table__type is-sell' : 'fund-table__type is-buy'}
                      value={row.type}
                      onChange={(event) => updateRow(index, 'type', event.target.value)}
                    >
                      <option value="卖出">卖出</option>
                      <option value="买入">买入</option>
                    </select>
                  </td>
                  <td>
                    <input type="number" step="0.0001" value={row.buyPrice} onChange={(event) => updateRow(index, 'buyPrice', event.target.value)} />
                  </td>
                  <td>
                    <input type="number" step="0.0001" value={row.sellPrice} onChange={(event) => updateRow(index, 'sellPrice', event.target.value)} />
                  </td>
                  <td>
                    <input type="number" step="0.01" value={row.shares} onChange={(event) => updateRow(index, 'shares', event.target.value)} />
                  </td>
                  <td className="fund-table__action">
                    <button className="icon-button" type="button" aria-label="删除条目" onClick={() => removeRow(index)}>
                      <MaterialIcon className="icon-button__icon" name="delete_outline" />
                    </button>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>

        <div className="fund-record-list">
          {summary.rows.map((row, index) => {
            const codeError = getFundCodeError(row.code);
            return (
            <div key={row.id} className="fund-record-card">
              <div className="fund-record-card__head">
                <div>
                  <div className="section-eyebrow">第 {index + 1} 条记录</div>
                  <div className="fund-record-card__title">{row.code || '待填写基金代码'}</div>
                </div>
                <button className="icon-button" type="button" aria-label="删除条目" onClick={() => removeRow(index)}>
                  <MaterialIcon className="icon-button__icon" name="delete_outline" />
                </button>
              </div>
              <div className="field-grid">
                <label className="field">
                  <span className="field__label">日期 (时间)</span>
                  <div className="field__input-shell">
                    <input type="text" value={row.date} onChange={(event) => updateRow(index, 'date', event.target.value)} />
                  </div>
                </label>
                <label className="field">
                  <span className="field__label">基金代码</span>
                  <div className={buildFieldShellClass(Boolean(codeError))}>
                    <input type="text" value={row.code} onChange={(event) => updateRow(index, 'code', event.target.value)} />
                  </div>
                  {codeError ? <span className="field__helper is-error">{codeError}</span> : null}
                </label>
                <label className="field">
                  <span className="field__label">交易类型</span>
                  <div className="field__input-shell">
                    <select value={row.type} onChange={(event) => updateRow(index, 'type', event.target.value)}>
                      <option value="卖出">卖出</option>
                      <option value="买入">买入</option>
                    </select>
                  </div>
                </label>
                <label className="field">
                  <span className="field__label">买入价格</span>
                  <div className="field__input-shell">
                    <input type="number" step="0.0001" value={row.buyPrice} onChange={(event) => updateRow(index, 'buyPrice', event.target.value)} />
                  </div>
                </label>
                <label className="field">
                  <span className="field__label">卖出价格</span>
                  <div className="field__input-shell">
                    <input type="number" step="0.0001" value={row.sellPrice} onChange={(event) => updateRow(index, 'sellPrice', event.target.value)} />
                  </div>
                </label>
                <label className="field">
                  <span className="field__label">份额 (股数)</span>
                  <div className="field__input-shell">
                    <input type="number" step="0.01" value={row.shares} onChange={(event) => updateRow(index, 'shares', event.target.value)} />
                  </div>
                </label>
              </div>
            </div>
          );})}
        </div>
      </SurfaceCard>

      <SurfaceCard className="fund-switch-surface fund-switch-logic-card">
        <div className="fund-switch-section-head">
          <div>
            <div className="section-eyebrow">成本与费用</div>
            <h2 className="section-title">计算参数</h2>
          </div>
          <button className="button-secondary" type="button" onClick={() => setShowCalculationDetails((value) => !value)}>
            <MaterialIcon className="icon-button__icon" name={showCalculationDetails ? 'expand_less' : 'expand_more'} />
            {showCalculationDetails ? '收起详细参数' : '展开详细参数'}
          </button>
        </div>

        <div className="fund-switch-logic-summary">
          <div className="fund-switch-logic-pill">
            <span>不切换现值</span>
            <strong>{formatCurrency(summary.stayValue, '¥ ')}</strong>
          </div>
          <div className="fund-switch-logic-pill">
            <span>切换后现值</span>
            <strong>{formatCurrency(summary.switchedValue, '¥ ')}</strong>
          </div>
          <div className="fund-switch-logic-pill">
            <span>手续费合计</span>
            <strong>{formatCurrency(summary.feeTotal, '¥ ')}</strong>
          </div>
          <div className="fund-switch-logic-pill">
            <span>额外补入现金</span>
            <strong>{formatCurrency(summary.comparison.extraCash, '¥ ')}</strong>
          </div>
        </div>

        {showCalculationDetails ? (
          <div className="fund-logic-panel fund-switch-form-panel">
            <div className="field-grid field-grid--2">
              <label className="field">
                <span className="field__label">原基金代码 / 名称</span>
                <div className="field__input-shell">
                  <input type="text" value={summary.comparison.sourceCode} onChange={(event) => updateComparison('sourceCode', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">现基金代码 / 名称</span>
                <div className="field__input-shell">
                  <input type="text" value={summary.comparison.targetCode} onChange={(event) => updateComparison('targetCode', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">原持有份额</span>
                <div className="field__input-shell">
                  <input type="number" step="0.01" value={summary.comparison.sourceSellShares} onChange={(event) => updateComparison('sourceSellShares', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">原基金现价</span>
                <div className={sourceSnapshot ? 'field__input-shell is-readonly' : 'field__input-shell'}>
                  <input
                    type="number"
                    step="0.0001"
                    readOnly={Boolean(sourceSnapshot)}
                    value={summary.comparison.sourceCurrentPrice}
                    onChange={(event) => updateComparison('sourceCurrentPrice', event.target.value)}
                  />
                </div>
                <span className="field__helper">{buildPriceFieldHelper(sourceSnapshot, priceState)}</span>
              </label>
              <label className="field">
                <span className="field__label">现持有份额</span>
                <div className="field__input-shell">
                  <input type="number" step="0.01" value={summary.comparison.targetBuyShares} onChange={(event) => updateComparison('targetBuyShares', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">现基金现价</span>
                <div className={targetSnapshot ? 'field__input-shell is-readonly' : 'field__input-shell'}>
                  <input
                    type="number"
                    step="0.0001"
                    readOnly={Boolean(targetSnapshot)}
                    value={summary.comparison.targetCurrentPrice}
                    onChange={(event) => updateComparison('targetCurrentPrice', event.target.value)}
                  />
                </div>
                <span className="field__helper">{buildPriceFieldHelper(targetSnapshot, priceState)}</span>
              </label>
              <label className="field">
                <span className="field__label">买入总成本</span>
                <div className="field__input-shell">
                  <input type="number" step="0.01" value={summary.comparison.switchCost} onChange={(event) => updateComparison('switchCost', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">额外补入现金</span>
                <div className="field__input-shell">
                  <input type="number" step="0.01" value={summary.comparison.extraCash} onChange={(event) => updateComparison('extraCash', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">单笔手续费</span>
                <div className="field__input-shell">
                  <input type="number" step="0.01" value={summary.feePerTrade} onChange={(event) => updateFeePerTrade(event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">手续费笔数</span>
                <div className="field__input-shell">
                  <input type="number" step="1" value={summary.comparison.feeTradeCount} onChange={(event) => updateComparison('feeTradeCount', event.target.value)} />
                </div>
              </label>
            </div>
          </div>
        ) : null}
      </SurfaceCard>

      <footer className="fund-switch-footer">
        <div className="fund-switch-footer__meta">
          <div>
            <div className="section-eyebrow">识别记录</div>
            <div className="fund-switch-footer__value">{recognizedCount} 条</div>
          </div>
          <div className="fund-switch-footer__divider" />
          <div>
            <div className="section-eyebrow">预估处理金额</div>
            <div className="fund-switch-footer__value">{formatCurrency(summary.processedAmount, '¥ ')}</div>
          </div>
          <div className="fund-switch-footer__divider" />
          <div>
            <div className="section-eyebrow">真实额外收益</div>
            <div className={`fund-switch-footer__value ${advantageMeta.className}`}>{formatSignedCurrency(summary.switchAdvantage, '¥ ')}</div>
          </div>
        </div>
        <div className="fund-switch-footer__actions">
          <button className="button-outline" type="button" onClick={openFilePicker}>重新上传</button>
          <button className="button-primary" type="button">
            确认导入并计算收益
            <MaterialIcon className="icon-button__icon" name="arrow_forward" />
          </button>
        </div>
      </footer>
    </div>
  );
}
