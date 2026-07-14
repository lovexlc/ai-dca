import { Check, RotateCcw, Save, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { getMarketFilterGroups, matchesMarketFilters } from '../marketListFilters.js';

export function MarketFilterBuilderSheet({ open, filters = [], isOtc = false, rows = null, resultCount = 0, onApply, onSaveGroup, onClose }) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => { if (open) setDraft(filters); }, [open, filters]);
  const draftResultCount = useMemo(
    () => Array.isArray(rows) ? rows.filter((row) => matchesMarketFilters(row, draft)).length : resultCount,
    [draft, resultCount, rows]
  );
  if (!open || typeof document === 'undefined') return null;
  const selected = new Map(draft.map((filter) => [`${filter.id}:${filter.value}`, filter]));
  const toggle = (id, value) => {
    const key = `${id}:${value}`;
    const next = draft.filter((filter) => `${filter.id}:${filter.value}` !== key);
    if (next.length === draft.length) next.push({ id, value });
    return next;
  };
  const isSelected = (id, value) => selected.has(`${id}:${value}`);
  const handleToggle = (id, value) => {
    const next = toggle(id, value);
    setDraft(next);
  };
  const clear = () => setDraft([]);
  return createPortal(
    <div className="market-sheet-backdrop" role="dialog" aria-modal="true" aria-label="筛选条件" onMouseDown={onClose}>
      <section className="market-filter-sheet market-filter-builder-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="market-sheet-header"><div><h2>筛选条件</h2><p>按条件筛选当前行情分组</p></div><button type="button" onClick={onClose} aria-label="关闭筛选"><X size={18} /></button></div>
        <div className="market-filter-builder-sheet__body">{getMarketFilterGroups({ isOtc }).map((group) => <section className="market-filter-group" key={group.id}><h3>{group.label}</h3><div className="market-filter-options">{group.options.map(([value, label]) => <button type="button" key={value} className={isSelected(group.id, value) ? 'is-active' : ''} onClick={() => handleToggle(group.id, value)}>{label}</button>)}</div></section>)}</div>
        <div className="market-filter-builder-sheet__footer"><button type="button" onClick={clear}><RotateCcw size={14} />重置</button><button type="button" onClick={() => onSaveGroup?.(draft)}><Save size={14} />保存为分组</button><button type="button" className="is-primary" onClick={() => onApply?.({ draft, close: true })}><Check size={14} />查看结果（{draftResultCount}）</button></div>
      </section>
    </div>,
    document.body,
  );
}
