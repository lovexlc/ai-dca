import { Check, X } from 'lucide-react';
import { createPortal } from 'react-dom';

export function MarketFilterBuilderSheet({ open, filters = [], onChange, onSaveGroup, onClose }) {
  if (!open || typeof document === 'undefined') return null;
  const get = (id) => filters.find((item) => item.id === id)?.value || '';
  const set = (id, value) => {
    const next = filters.filter((item) => item.id !== id);
    if (value !== '') next.push({ id, value });
    onChange?.(next);
  };
  return createPortal(
    <div className="market-sheet-backdrop" role="dialog" aria-modal="true" aria-label="筛选条件" onMouseDown={onClose}>
      <section className="market-filter-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="market-sheet-header"><div><h2>筛选条件</h2><p>保存后会成为当前行情分组的专属条件</p></div><button type="button" onClick={onClose} aria-label="关闭筛选"><X size={18} /></button></div>
        <label>基金类型<select value={get('kind')} onChange={(event) => set('kind', event.target.value)}><option value="">全部</option><option value="exchange">场内 ETF</option><option value="otc">场外基金</option></select></label>
        <label>持仓状态<select value={get('isHeld')} onChange={(event) => set('isHeld', event.target.value)}><option value="">不限</option><option value="true">仅持仓</option><option value="false">未持仓</option></select></label>
        <label>涨跌幅下限<input type="number" value={get('changePercentMin')} onChange={(event) => set('changePercentMin', event.target.value)} placeholder="例如 -5" /></label>
        <div className="market-sheet-actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="is-primary" onClick={() => { onSaveGroup?.(); onClose?.(); }}><Check size={14} />保存筛选</button></div>
      </section>
    </div>,
    document.body
  );
}
