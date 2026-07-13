import { Check, RotateCcw, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { DEFAULT_MARKET_SORTING, MARKET_SECONDARY_SORT_OPTIONS, MARKET_SORT_OPTIONS, normalizeMarketSorting } from '../marketListSorting.js';

const optionLabel = (options, id) => options.find(([value]) => value === id)?.[1] || '默认顺序';

export function MarketSortSheet({ open, sorting, onApply, onClose }) {
  const [draft, setDraft] = useState(normalizeMarketSorting(sorting));
  useEffect(() => { if (open) setDraft(normalizeMarketSorting(sorting)); }, [open, sorting]);
  if (!open || typeof document === 'undefined') return null;
  const primary = draft[0] || DEFAULT_MARKET_SORTING[0];
  const secondary = draft[1] || { id: '', desc: true };
  const setPrimary = (id) => setDraft([{ id, desc: primary.desc }, ...(secondary.id && secondary.id !== id ? [{ ...secondary }] : [])]);
  const setSecondary = (id) => setDraft([{ ...primary }, ...(id && id !== primary.id ? [{ id, desc: primary.desc }] : [])]);
  const setDirection = (desc) => setDraft([{ ...primary, desc }, ...(secondary.id ? [{ ...secondary, desc }] : [])]);

  return createPortal(
    <div className="market-sheet-backdrop" role="dialog" aria-modal="true" aria-label="排序条件" onMouseDown={onClose}>
      <section className="market-filter-sheet market-sort-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="market-sheet-header"><div><h2>排序</h2><p>设置当前分组的排序方式</p></div><button type="button" onClick={onClose} aria-label="关闭排序"><X size={18} /></button></div>
        <div className="market-sort-sheet__section"><h3>排序字段</h3><div className="market-sort-options">{MARKET_SORT_OPTIONS.map(([id, label]) => <button type="button" key={id} className={primary.id === id ? 'is-active' : ''} onClick={() => setPrimary(id)}>{label}</button>)}</div></div>
        <div className="market-sort-sheet__section"><h3>排序方向</h3><div className="market-sort-options market-sort-options--two">{[['desc', '降序'], ['asc', '升序']].map(([id, label]) => <button type="button" key={id} className={(primary.desc ? id === 'desc' : id === 'asc') ? 'is-active' : ''} onClick={() => setDirection(id === 'desc')}>{label}</button>)}</div></div>
        <div className="market-sort-sheet__section"><h3>次级排序</h3><div className="market-sort-options">{MARKET_SECONDARY_SORT_OPTIONS.map(([id, label]) => <button type="button" key={label} className={(secondary.id || '') === id ? 'is-active' : ''} onClick={() => setSecondary(id)}>{label}</button>)}</div></div>
        <div className="market-sheet-actions"><button type="button" onClick={() => onApply?.({ draft: DEFAULT_MARKET_SORTING.map((item) => ({ ...item })), close: true })}><RotateCcw size={14} />重置</button><button type="button" className="is-primary" onClick={() => onApply?.({ draft, close: true })}><Check size={14} />应用</button></div>
        <p className="market-sort-sheet__summary">当前：{optionLabel(MARKET_SORT_OPTIONS, primary.id)} · {primary.desc ? '降序' : '升序'} · 次级{optionLabel(MARKET_SECONDARY_SORT_OPTIONS, secondary.id)}</p>
      </section>
    </div>,
    document.body,
  );
}
