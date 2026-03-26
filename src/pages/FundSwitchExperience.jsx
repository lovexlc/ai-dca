import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency } from '../app/accumulation.js';
import { buildFundSwitchSummary, createEmptyFundSwitchRow, persistFundSwitchState, readFundSwitchState } from '../app/fundSwitch.js';
import { MaterialIcon } from '../components/MaterialIcon.jsx';
import { StatusBadge, SurfaceCard, WorkspaceShell } from '../components/PageChrome.jsx';

const sidebarItems = [
  { label: 'Dashboard', icon: 'dashboard' },
  { label: 'Fund Analysis', icon: 'analytics' },
  { label: 'Data Import', icon: 'upload_file', active: true },
  { label: 'History', icon: 'history' },
  { label: 'Settings', icon: 'settings' }
];

function createOcrState(overrides = {}) {
  return {
    status: 'idle',
    progress: 0,
    message: '等待上传交易截图，前端会调用 /api/ocr，由 Cloudflare Worker 转发给 Gemini。',
    durationMs: 0,
    error: '',
    lineCount: 0,
    ...overrides
  };
}

function getStatusBadgeProps(status) {
  if (status === 'loading') {
    return { tone: 'warning', icon: 'hourglass_top', label: 'Gemini 处理中' };
  }

  if (status === 'error') {
    return { tone: 'warning', icon: 'error', label: 'OCR 识别失败' };
  }

  if (status === 'warning') {
    return { tone: 'warning', icon: 'warning', label: 'OCR 完成，需人工确认' };
  }

  if (status === 'success') {
    return { tone: 'success', icon: 'check_circle', label: '识别成功，请确认数据' };
  }

  return { tone: 'warning', icon: 'upload_file', label: '等待上传交易截图' };
}

function buildUploadBadge(fileName) {
  const extension = String(fileName || '').split('.').pop()?.slice(0, 3).toUpperCase();
  return extension || 'IMG';
}

export function FundSwitchExperience({ screen, links }) {
  const [state, setState] = useState(() => readFundSwitchState());
  const [ocrState, setOcrState] = useState(() => createOcrState());
  const [ocrPreview, setOcrPreview] = useState([]);
  const fileInputRef = useRef(null);
  const summary = useMemo(() => buildFundSwitchSummary(state), [state]);
  const workspaceTabs = [
    { key: 'dataProcess', label: 'Data Processing', href: links.fundSwitch },
    { key: 'yieldCalc', label: 'Yield Calculation', href: links.fundSwitch }
  ];
  const badge = getStatusBadgeProps(ocrState.status);

  useEffect(() => {
    persistFundSwitchState(state, summary);
  }, [state, summary]);

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
      nextRows[index] = {
        ...nextRows[index],
        [key]: key === 'price' || key === 'shares' ? Number(value) || 0 : value
      };

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
    setOcrPreview([]);
    setOcrState(createOcrState({
      status: 'loading',
      progress: 12,
      message: '准备上传到 /api/ocr'
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
      setOcrPreview(result.previewLines);

      if (result.rows.length) {
        const hasWarnings = Array.isArray(result.warnings) && result.warnings.length > 0;
        setOcrState(createOcrState({
          status: hasWarnings ? 'warning' : 'success',
          progress: 100,
          durationMs: result.durationMs,
          lineCount: result.recordCount || result.rows.length,
          message: hasWarnings
            ? `Gemini 已提取 ${result.rows.length} 条交易记录，请重点复核提示项。`
            : `Gemini 提取完成，已解析 ${result.rows.length} 条交易记录。`
        }));
      } else {
        setOcrState(createOcrState({
          status: 'warning',
          progress: 100,
          durationMs: result.durationMs,
          lineCount: 0,
          message: 'Gemini 已完成提取，但没有稳定产出可回填的交易记录，请手动确认或补录。'
        }));
      }
    } catch (error) {
      setOcrState(createOcrState({
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : '/api/ocr 调用失败，请检查 Worker、Secret 或上传更清晰的截图后重试。',
        message: 'Gemini 提取失败'
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
    <WorkspaceShell
      activeTab="yieldCalc"
      brand="Fund Switch Assistant"
      brandHref={links.fundSwitch}
      tabs={workspaceTabs}
      headerRight={
        <>
          <label className="toolbar-search" aria-label="Search data">
            <MaterialIcon className="toolbar-search__icon" name="search" />
            <input placeholder="Search data..." type="text" />
          </label>
          <button className="icon-button" type="button">
            <MaterialIcon className="icon-button__icon" name="notifications" />
          </button>
          <button className="icon-button" type="button">
            <MaterialIcon className="icon-button__icon" name="help_outline" />
          </button>
        </>
      }
      sidebar={
        <>
          <div className="sidebar-block">
            <div className="sidebar-brand-card__title">Financial Architect</div>
            <div className="sidebar-brand-card__meta">Fund Switch Assistant</div>
          </div>
          <div className="sidebar-menu">
            {sidebarItems.map((item) => (
              <a key={item.label} className={item.active ? 'sidebar-menu__item is-active' : 'sidebar-menu__item'} href={item.active ? links.fundSwitch : links.catalog}>
                <MaterialIcon className="sidebar-menu__icon" name={item.icon} />
                <span>{item.label}</span>
              </a>
            ))}
          </div>
          <div className="sidebar-footer">
            <div className="sidebar-block">
              <div className="sidebar-brand-card" style={{ padding: 0, boxShadow: 'none', background: 'transparent' }}>
                <div className="avatar">JD</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>User Profile</div>
                  <div className="sidebar-brand-card__meta">Premium Member</div>
                </div>
              </div>
            </div>
          </div>
        </>
      }
    >
      <section className="page-header">
        <div>
          <h1 className="page-title page-title--compact">基金切换收益助手</h1>
          <p className="page-subtitle">通过 Cloudflare Worker 中转 Gemini 识别交易截图，并自动回填切换收益计算参数。</p>
        </div>
        <StatusBadge icon={badge.icon} tone={badge.tone}>{badge.label}</StatusBadge>
      </section>

      <section className="fund-switch-grid">
        <div className="card-grid">
          <SurfaceCard>
            <input
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/jpg,image/webp"
              hidden
              onChange={handleFileInputChange}
              type="file"
            />
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
              <div className="upload-dropzone__copy">支持 PNG / JPG / JPEG / WebP，图片会发送到站点同源的 /api/ocr，由 Cloudflare Worker 调用 Gemini。</div>
              <div className="upload-dropzone__hint">{ocrState.message}</div>
            </button>
          </SurfaceCard>

          <SurfaceCard className="surface-card--tight">
            <div className="section-header">
              <div>
                <div className="section-eyebrow">OCR 识别状态</div>
                <h2 className="section-title">OCR 识别状态</h2>
              </div>
              <div className="table-note">
                {ocrState.status === 'idle' ? '待开始' : `${ocrState.progress}%`}
              </div>
            </div>
            <div className="progress-line" style={{ marginTop: 0 }}>
              <div className="progress-line__track">
                <div className="progress-line__value" style={{ width: `${ocrState.progress}%` }} />
              </div>
            </div>
            <div className="ocr-file">
              <div className="ocr-file__badge">{buildUploadBadge(ocrState.status === 'idle' ? '' : state.fileName)}</div>
              <div className="ocr-file__body">
                <strong>{ocrState.status === 'idle' ? '未上传图片' : state.fileName}</strong>
                <span>
                  {ocrState.status === 'error'
                    ? ocrState.error
                    : ocrState.status === 'success' || ocrState.status === 'warning'
                      ? `返回 ${Math.max(ocrState.lineCount, 0)} 条可回填记录，当前表单已同步 ${Math.max(state.recognizedRecords, 0)} 条交易记录`
                      : '上传后会自动尝试提取日期、基金名称、买卖方向、单价和份额'}
                </span>
              </div>
              <MaterialIcon className="ocr-file__check" filled name={ocrState.status === 'error' ? 'error' : ocrState.status === 'loading' ? 'hourglass_top' : 'check_circle'} />
            </div>
            {ocrPreview.length ? (
              <div className="ocr-preview">
                {ocrPreview.map((line) => (
                  <div key={line} className="ocr-preview__line">{line}</div>
                ))}
              </div>
            ) : null}
          </SurfaceCard>

          <div className="summary-tile summary-tile--blue">
            <div className="section-eyebrow">模型提取引擎</div>
            <div className="section-title" style={{ color: 'inherit', marginTop: 4 }}>模型提取引擎</div>
            <p className="promo-card__copy">自动剔除手续费影响，精准对齐切换前后的份额价值差异。</p>
            <div className="summary-lines summary-lines--compact">
              <div className="summary-lines__row">
                <span>不切换现值</span>
                <strong>{formatCurrency(summary.stayValue, '¥ ')}</strong>
              </div>
              <div className="summary-lines__row">
                <span>切换后现值</span>
                <strong>{formatCurrency(summary.switchedValue, '¥ ')}</strong>
              </div>
              <div className="summary-lines__row">
                <span>接口耗时</span>
                <strong>{ocrState.durationMs ? `${ocrState.durationMs} ms` : '等待 /api/ocr'}</strong>
              </div>
            </div>
            <div className="promo-card__action">
              <button className="button-secondary" type="button">查看计算逻辑</button>
            </div>
          </div>

          <SurfaceCard className="surface-card--tight">
            <div className="section-header">
              <div>
                <div className="section-eyebrow">收益计算参数</div>
                <h2 className="section-title">切换收益比较</h2>
              </div>
            </div>
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
                <div className="field__input-shell">
                  <input type="number" step="0.0001" value={summary.comparison.sourceCurrentPrice} onChange={(event) => updateComparison('sourceCurrentPrice', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">现持有份额</span>
                <div className="field__input-shell">
                  <input type="number" step="0.01" value={summary.comparison.targetBuyShares} onChange={(event) => updateComparison('targetBuyShares', event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span className="field__label">现基金现价</span>
                <div className="field__input-shell">
                  <input type="number" step="0.0001" value={summary.comparison.targetCurrentPrice} onChange={(event) => updateComparison('targetCurrentPrice', event.target.value)} />
                </div>
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
          </SurfaceCard>

          <SurfaceCard className="surface-card--tight fund-result-card">
            <div className="section-header">
              <div>
                <div className="section-eyebrow">结果输出</div>
                <h2 className="section-title">收益助手结论</h2>
              </div>
            </div>
            <div className="result-grid">
              <div className="result-tile">
                <span className="result-tile__label">不切换现在价值</span>
                <strong className="result-tile__value">{formatCurrency(summary.stayValue, '¥ ')}</strong>
                <span className="result-tile__meta">{summary.comparison.sourceSellShares} 份 × {summary.comparison.sourceCurrentPrice.toFixed(4)}</span>
              </div>
              <div className="result-tile">
                <span className="result-tile__label">切换后现在价值</span>
                <strong className="result-tile__value">{formatCurrency(summary.switchedValue, '¥ ')}</strong>
                <span className="result-tile__meta">{summary.comparison.targetBuyShares} 份 × {summary.comparison.targetCurrentPrice.toFixed(4)}</span>
              </div>
              <div className="result-tile result-tile--accent">
                <span className="result-tile__label">当前持仓浮盈</span>
                <strong className="result-tile__value">{formatCurrency(summary.switchedPositionProfit, '¥ ')}</strong>
                <span className="result-tile__meta">切换后现值 - 买入总成本 - 手续费</span>
              </div>
              <div className={summary.switchAdvantage >= 0 ? 'result-tile result-tile--success' : 'result-tile result-tile--warning'}>
                <span className="result-tile__label">切换额外收益</span>
                <strong className="result-tile__value">{formatCurrency(summary.switchAdvantage, '¥ ')}</strong>
                <span className="result-tile__meta">切换后现值 - 不切换现值 - 补现金 - 手续费</span>
              </div>
            </div>
          </SurfaceCard>
        </div>

        <SurfaceCard className="fund-table-card">
          <div className="section-header">
            <div>
              <div className="section-eyebrow">持仓明细确认</div>
              <h2 className="section-title">持仓明细确认</h2>
            </div>
            <div className="page-header__actions">
              <button className="button-secondary" type="button" onClick={addRow}>
                <MaterialIcon className="icon-button__icon" name="add" />
                新增记录
              </button>
              <button className="button-secondary" type="button">
                <MaterialIcon className="icon-button__icon" name="download" />
                导出模板
              </button>
            </div>
          </div>
          <div className="fund-table-wrap">
            <table className="fund-table">
              <thead>
                <tr>
                  <th>日期 (时间)</th>
                  <th>基金代码</th>
                  <th>交易类型</th>
                  <th>单价 (价格)</th>
                  <th>份额 (股数)</th>
                  <th className="fund-table__action">操作</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 1 ? 'is-striped' : ''}>
                    <td>
                      <input type="text" value={row.date} onChange={(event) => updateRow(index, 'date', event.target.value)} />
                    </td>
                    <td>
                      <input type="text" value={row.code} onChange={(event) => updateRow(index, 'code', event.target.value)} />
                    </td>
                    <td>
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
                      <input type="number" step="0.0001" value={row.price} onChange={(event) => updateRow(index, 'price', event.target.value)} />
                    </td>
                    <td>
                      <input type="number" step="0.01" value={row.shares} onChange={(event) => updateRow(index, 'shares', event.target.value)} />
                    </td>
                    <td className="fund-table__action">
                      <button className="icon-button" type="button" onClick={() => removeRow(index)}>
                        <MaterialIcon className="icon-button__icon" name="delete_outline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      </section>

      <footer className="fund-footer">
        <div className="fund-footer__meta">
          <div>
            <div className="section-eyebrow">汇总记录</div>
            <div className="fund-footer__value">{summary.recordCount} 条识别记录</div>
          </div>
          <div className="fund-footer__divider" />
          <div>
            <div className="section-eyebrow">预估处理金额</div>
            <div className="fund-footer__value fund-footer__value--primary">{formatCurrency(summary.processedAmount, '¥ ')}</div>
          </div>
          <div className="fund-footer__divider" />
          <div>
            <div className="section-eyebrow">真实额外收益</div>
            <div className={summary.switchAdvantage >= 0 ? 'fund-footer__value fund-footer__value--success' : 'fund-footer__value fund-footer__value--warning'}>
              {formatCurrency(summary.switchAdvantage, '¥ ')}
            </div>
          </div>
        </div>
        <div className="fund-footer__actions">
          <button className="button-outline" type="button" onClick={() => setOcrPreview([])}>取消导入</button>
          <button className="button-primary" type="button">
            确认导入并计算收益
            <MaterialIcon className="icon-button__icon" name="arrow_forward" />
          </button>
        </div>
      </footer>
    </WorkspaceShell>
  );
}
