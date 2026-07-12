import { ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react';
import { ANALYSIS_COLUMNS, MARKET_COLUMN_DEFINITIONS } from '../marketColumns.js';

export function ColumnSettingsSheet({
  open,
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
  if (!open) return null;
  const available = Object.values(MARKET_COLUMN_DEFINITIONS);
  const isAvailable = (column) => !Array.isArray(availableColumnIds) || availableColumnIds.includes(column.id);
  const order = columnOrder.length ? columnOrder : available.map((column) => column.id);
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
      : cardAnalysisColumns.length < 3 ? [...cardAnalysisColumns, id] : cardAnalysisColumns;
    onCardAnalysisChange?.(next);
  };
  return (
    <div className="market-sheet-backdrop" role="dialog" aria-modal="true" aria-label="列设置" onMouseDown={onClose}>
      <section className="market-column-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="market-sheet-header"><div><h2>列设置</h2><p>卡片和表格共用同一套行情字段</p></div><button type="button" onClick={onClose} aria-label="关闭列设置"><X size={18} /></button></div>
        <div className="market-column-list">
          {available.map((column) => (
            <div key={column.id} className="market-column-list__row">
              <label><input type="checkbox" checked={columns.includes(column.id)} disabled={column.base || !isAvailable(column)} onChange={() => toggle(column.id)} /><span>{column.label}</span><small>{column.base ? '基础' : !isAvailable(column) ? '当前列表不可用' : column.dynamic ? '有能力时提供' : '可选'}</small></label>
              <span className="market-column-list__order"><input aria-label={`${column.label}列宽`} type="number" min="56" max="360" value={columnSizing[column.id] || ''} placeholder="宽度" onChange={(event) => setWidth(column.id, event.target.value)} /><button type="button" aria-label={`上移${column.label}`} onClick={() => move(column.id, -1)} disabled={order.indexOf(column.id) <= 0}><ChevronUp size={14} /></button><button type="button" aria-label={`下移${column.label}`} onClick={() => move(column.id, 1)} disabled={order.indexOf(column.id) < 0 || order.indexOf(column.id) >= order.length - 1}><ChevronDown size={14} /></button></span>
            </div>
          ))}
        </div>
        <div className="market-card-analysis-settings">
          <div className="market-card-analysis-settings__title"><strong>卡片分析指标</strong><span>最多选择 3 项</span></div>
          <div className="market-card-analysis-settings__grid">{ANALYSIS_COLUMNS.filter((column) => column.card).map((column) => <label key={column.id}><input type="checkbox" checked={cardAnalysisColumns.includes(column.id)} onChange={() => toggleCardMetric(column.id)} /><span>{column.label}</span></label>)}</div>
          <label className="market-card-analysis-settings__trend"><input type="checkbox" checked={showTrend} onChange={(event) => onTrendChange?.(event.target.checked)} /><span>显示趋势图</span></label>
        </div>
        <button type="button" className="market-sheet-reset" onClick={onReset}><RotateCcw size={14} />恢复默认配置</button>
      </section>
    </div>
  );
}
