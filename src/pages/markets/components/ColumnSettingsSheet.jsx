import { ChevronDown, ChevronUp, GripVertical, Plus, RotateCcw } from 'lucide-react';
import { createPortal } from 'react-dom';
import { CARD_METRIC_COLUMNS, MARKET_COLUMN_DEFINITIONS } from '../marketColumns.js';

export function ColumnSettingsSheet({
  open,
  desktop = false,
  columns = [],
  columnOrder = [],
  columnSizing = {},
  cardAnalysisColumns = [],
  showTrend = true,
  availableColumnIds,
  onChange,
  onOrderChange,
  onSizingChange,
  onCardAnalysisChange,
  onTrendChange,
  onReset,
  onClose,
}) {
  if (!open || typeof document === 'undefined') return null;
  const available = Object.values(MARKET_COLUMN_DEFINITIONS);
  const isAvailable = (column) => !Array.isArray(availableColumnIds) || availableColumnIds.includes(column.id);
  const tableColumns = available.filter(isAvailable);
  const order = columnOrder.length ? columnOrder : available.map((column) => column.id);
  const availableMetrics = CARD_METRIC_COLUMNS.filter(isAvailable);
  const selectedMetrics = cardAnalysisColumns.map((id) => MARKET_COLUMN_DEFINITIONS[id]).filter(Boolean);
  const moreMetrics = availableMetrics.filter((column) => !cardAnalysisColumns.includes(column.id));

  const toggle = (id) => {
    const next = columns.includes(id) ? columns.filter((item) => item !== id) : [...columns, id];
    onChange?.(next);
  };
  const setWidth = (id, value) => {
    const width = Math.max(56, Math.min(360, Number(value) || 96));
    onSizingChange?.({ ...columnSizing, [id]: width });
  };
  const move = (id, direction) => {
    const index = order.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const next = [...order];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onOrderChange?.(next);
  };
  const toggleCardMetric = (id) => {
    const next = cardAnalysisColumns.includes(id)
      ? cardAnalysisColumns.filter((item) => item !== id)
      : cardAnalysisColumns.length < 6 ? [...cardAnalysisColumns, id] : cardAnalysisColumns;
    onCardAnalysisChange?.(next);
  };
  const moveCardMetric = (id, direction) => {
    const index = cardAnalysisColumns.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= cardAnalysisColumns.length) return;
    const next = [...cardAnalysisColumns];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onCardAnalysisChange?.(next);
  };

  return createPortal(
    <div className="market-sheet-backdrop" role="dialog" aria-modal="true" aria-label="自定义卡片内容" onMouseDown={onClose}>
      <section className="market-column-sheet market-card-custom-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="market-card-custom-sheet__header">
          <button type="button" onClick={onClose}>取消</button>
          <div><h2>{desktop ? '列设置' : '自定义卡片内容'}</h2><p>{desktop ? '固定显示、调整顺序并配置列宽' : '最新价与今日涨跌固定展示'}</p></div>
          <button type="button" className="is-primary" onClick={onClose}>完成</button>
        </div>

        <div className="market-card-custom-sheet__summary">
          <span>已选 {cardAnalysisColumns.length}/6（最多 6 项）</span>
          <button type="button" onClick={onReset}><RotateCcw size={13} />重置</button>
        </div>

        <section className="market-card-custom-sheet__section">
          <h3>显示指标</h3>
          <div className="market-card-custom-sheet__selected">
            {selectedMetrics.length ? selectedMetrics.map((column, index) => (
              <div key={column.id} className="market-card-custom-sheet__selected-row">
                <GripVertical size={15} aria-hidden="true" />
                <label><input type="checkbox" checked onChange={() => toggleCardMetric(column.id)} /><span>{column.label}</span></label>
                <div>
                  <button type="button" aria-label={`上移${column.label}`} onClick={() => moveCardMetric(column.id, -1)} disabled={index === 0}><ChevronUp size={14} /></button>
                  <button type="button" aria-label={`下移${column.label}`} onClick={() => moveCardMetric(column.id, 1)} disabled={index === selectedMetrics.length - 1}><ChevronDown size={14} /></button>
                </div>
              </div>
            )) : <p className="market-card-custom-sheet__empty">尚未选择分析指标</p>}
          </div>
        </section>

        <section className="market-card-custom-sheet__section">
          <h3>更多指标 <span>点击添加</span></h3>
          <div className="market-card-custom-sheet__more">
            {moreMetrics.map((column) => (
              <button type="button" key={column.id} onClick={() => toggleCardMetric(column.id)} disabled={cardAnalysisColumns.length >= 6}>
                <Plus size={13} />{column.label}
              </button>
            ))}
          </div>
        </section>

        <label className="market-card-analysis-settings__trend"><input type="checkbox" checked={showTrend} onChange={(event) => onTrendChange?.(event.target.checked)} /><span>有可用轻量趋势数据时显示趋势图</span></label>

        <details className="market-card-custom-sheet__table-fields" open={desktop}>
          <summary>表格显示字段 <span>{columns.length} 项</span></summary>
          <div className="market-column-list">
            {tableColumns.map((column) => (
              <div key={column.id} className="market-column-list__row">
                <label><input type="checkbox" checked={columns.includes(column.id)} disabled={column.base} onChange={() => toggle(column.id)} /><span>{column.label}</span><small>{column.base ? '基础' : column.dynamic ? '有能力时提供' : '可选'}</small></label>
                <span className="market-column-list__order"><input aria-label={`${column.label}列宽`} type="number" min="56" max="360" value={columnSizing[column.id] || ''} placeholder="宽度" onChange={(event) => setWidth(column.id, event.target.value)} /><button type="button" aria-label={`上移${column.label}`} onClick={() => move(column.id, -1)} disabled={order.indexOf(column.id) <= 0}><ChevronUp size={14} /></button><button type="button" aria-label={`下移${column.label}`} onClick={() => move(column.id, 1)} disabled={order.indexOf(column.id) < 0 || order.indexOf(column.id) >= order.length - 1}><ChevronDown size={14} /></button></span>
              </div>
            ))}
          </div>
        </details>
      </section>
    </div>,
    document.body
  );
}
