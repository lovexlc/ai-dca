import { RotateCcw, X } from 'lucide-react';
import { MARKET_COLUMN_DEFINITIONS } from '../marketGroups.js';

export function ColumnSettingsSheet({ open, columns = [], onChange, onReset, onClose }) {
  if (!open) return null;
  const available = Object.values(MARKET_COLUMN_DEFINITIONS);
  const toggle = (id) => {
    const next = columns.includes(id) ? columns.filter((item) => item !== id) : [...columns, id];
    onChange?.(next);
  };
  return (
    <div className="market-sheet-backdrop" role="dialog" aria-modal="true" aria-label="列设置" onMouseDown={onClose}>
      <section className="market-column-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="market-sheet-header"><div><h2>列设置</h2><p>选择卡片和表格需要展示的字段</p></div><button type="button" onClick={onClose} aria-label="关闭列设置"><X size={18} /></button></div>
        <div className="market-column-list">{available.map((column) => <label key={column.id}><input type="checkbox" checked={columns.includes(column.id)} disabled={column.base} onChange={() => toggle(column.id)} /><span>{column.label}</span><small>{column.base ? '基础' : column.dynamic ? '有数据时出现' : '可选'}</small></label>)}</div>
        <button type="button" className="market-sheet-reset" onClick={onReset}><RotateCcw size={14} />恢复默认列</button>
      </section>
    </div>
  );
}
