import { ChevronDown, ChevronUp, GripVertical, Plus, RotateCcw } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  CARD_METRIC_COLUMNS,
  DEFAULT_CARD_ANALYSIS_COLUMNS,
  DEFAULT_MARKET_COLUMNS,
  MARKET_COLUMN_DEFINITIONS,
  normalizeColumnOrder,
} from '../marketColumns.js';

export function ColumnSettingsSheet({
  open,
  desktop = false,
  columns = [],
  columnOrder = [],
  columnSizing = {},
  cardAnalysisColumns = [],
  showTrend = true,
  availableColumnIds,
  desktopView = 'table',
  onChange,
  onOrderChange,
  onSizingChange,
  onCardAnalysisChange,
  onTrendChange,
  onApply,
  onClose,
}) {
  const [draftColumns, setDraftColumns] = useState(columns);
  const [draftColumnOrder, setDraftColumnOrder] = useState(columnOrder);
  const [draftColumnSizing, setDraftColumnSizing] = useState(columnSizing);
  const [draftCardAnalysisColumns, setDraftCardAnalysisColumns] = useState(cardAnalysisColumns);
  const [draftShowTrend, setDraftShowTrend] = useState(showTrend);
  const wasOpenRef = useRef(false);

  useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      setDraftColumns(columns);
      setDraftColumnOrder(columnOrder);
      setDraftColumnSizing(columnSizing);
      setDraftCardAnalysisColumns(cardAnalysisColumns);
      setDraftShowTrend(showTrend);
    }
    wasOpenRef.current = open;
  }, [open, columns, columnOrder, columnSizing, cardAnalysisColumns, showTrend]);

  if (!open || typeof document === 'undefined') return null;
  const available = Object.values(MARKET_COLUMN_DEFINITIONS);
  const isAvailable = (column) => !Array.isArray(availableColumnIds) || availableColumnIds.includes(column.id);
  const tableColumns = available.filter(isAvailable);
  const order = draftColumnOrder.length ? draftColumnOrder : available.map((column) => column.id);
  const availableMetrics = CARD_METRIC_COLUMNS.filter(isAvailable);
  const selectedMetrics = draftCardAnalysisColumns.map((id) => MARKET_COLUMN_DEFINITIONS[id]).filter(Boolean);
  const moreMetrics = availableMetrics.filter((column) => !draftCardAnalysisColumns.includes(column.id));

  const cardSettingsVisible = !desktop || desktopView === 'cards';
  const toggle = (id) => {
    const next = draftColumns.includes(id) ? draftColumns.filter((item) => item !== id) : [...draftColumns, id];
    setDraftColumns(next);
  };
  const setWidth = (id, value) => {
    const width = Math.max(56, Math.min(360, Number(value) || 96));
    setDraftColumnSizing((current) => ({ ...current, [id]: width }));
  };
  const move = (id, direction) => {
    const index = order.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const next = [...order];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setDraftColumnOrder(next);
  };
  const toggleCardMetric = (id) => {
    const next = draftCardAnalysisColumns.includes(id)
      ? draftCardAnalysisColumns.filter((item) => item !== id)
      : draftCardAnalysisColumns.length < 6 ? [...draftCardAnalysisColumns, id] : draftCardAnalysisColumns;
    setDraftCardAnalysisColumns(next);
  };
  const moveCardMetric = (id, direction) => {
    const index = draftCardAnalysisColumns.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= draftCardAnalysisColumns.length) return;
    const next = [...draftCardAnalysisColumns];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setDraftCardAnalysisColumns(next);
  };
  const reset = () => {
    const availableIds = new Set(tableColumns.map((column) => column.id));
    setDraftColumns(DEFAULT_MARKET_COLUMNS.filter((id) => availableIds.has(id)));
    setDraftColumnOrder(normalizeColumnOrder(DEFAULT_MARKET_COLUMNS).filter((id) => availableIds.has(id)));
    setDraftColumnSizing({});
    setDraftCardAnalysisColumns(DEFAULT_CARD_ANALYSIS_COLUMNS.filter((id) => availableIds.has(id)));
    if (!cardSettingsVisible) return;
    setDraftShowTrend(true);
  };
  const complete = () => {
    const next = {
      columns: draftColumns,
      columnOrder: draftColumnOrder,
      columnSizing: draftColumnSizing,
      cardAnalysisColumns: draftCardAnalysisColumns,
      showTrend: draftShowTrend,
    };
    if (onApply) {
      onApply(next);
    } else {
      onChange?.(next.columns);
      onOrderChange?.(next.columnOrder);
      onSizingChange?.(next.columnSizing);
      onCardAnalysisChange?.(next.cardAnalysisColumns);
      onTrendChange?.(next.showTrend);
    }
    onClose?.();
  };

  return createPortal(
    <div className="market-sheet-backdrop" role="dialog" aria-modal="true" aria-label={desktop ? '列设置' : '自定义卡片内容'} onMouseDown={onClose}>
      <section className="market-column-sheet market-card-custom-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="market-card-custom-sheet__header">
          <button type="button" onClick={onClose}>取消</button>
          <div><h2>{desktop ? '列设置' : '自定义卡片内容'}</h2><p>{desktop ? '固定显示、调整顺序并配置列宽' : '最新价与今日涨跌固定展示'}</p></div>
          <button type="button" className="is-primary" onClick={complete}>完成</button>
        </div>

        <div className="market-card-custom-sheet__summary">
          <span>{cardSettingsVisible ? `已选 ${draftCardAnalysisColumns.length}/6（最多 6 项）` : '当前为表格视图，请使用表格显示字段'}</span>
          <button type="button" onClick={reset}><RotateCcw size={13} />重置</button>
        </div>

        <div className={cardSettingsVisible ? '' : 'hidden'}>
        <section className="market-card-custom-sheet__section">
          <h3>{desktop ? '卡片指标' : '显示指标'}</h3>
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
          <h3>更多卡片指标 <span>点击添加</span></h3>
          <div className="market-card-custom-sheet__more">
            {moreMetrics.map((column) => (
              <button type="button" key={column.id} onClick={() => toggleCardMetric(column.id)} disabled={draftCardAnalysisColumns.length >= 6}>
                <Plus size={13} />{column.label}
              </button>
            ))}
          </div>
        </section>

        <label className="market-card-analysis-settings__trend"><input type="checkbox" checked={draftShowTrend} onChange={(event) => setDraftShowTrend(event.target.checked)} /><span>有可用轻量趋势数据时显示趋势图</span></label>

        </div>
        <details className="market-card-custom-sheet__table-fields" open={desktop}>
          <summary>表格显示字段 <span>{draftColumns.length} 项</span></summary>
          <div className="market-column-list">
            {tableColumns.map((column) => (
              <div key={column.id} className="market-column-list__row">
                <label><input type="checkbox" checked={draftColumns.includes(column.id)} disabled={column.base} onChange={() => toggle(column.id)} /><span>{column.label}</span><small>{column.base ? '基础' : column.dynamic ? '有能力时提供' : '可选'}</small></label>
                <span className="market-column-list__order"><input aria-label={`${column.label}列宽`} type="number" min="56" max="360" value={draftColumnSizing[column.id] || ''} placeholder="宽度" onChange={(event) => setWidth(column.id, event.target.value)} /><button type="button" aria-label={`上移${column.label}`} onClick={() => move(column.id, -1)} disabled={order.indexOf(column.id) <= 0}><ChevronUp size={14} /></button><button type="button" aria-label={`下移${column.label}`} onClick={() => move(column.id, 1)} disabled={order.indexOf(column.id) < 0 || order.indexOf(column.id) >= order.length - 1}><ChevronDown size={14} /></button></span>
              </div>
            ))}
          </div>
        </details>
      </section>
    </div>,
    document.body
  );
}
