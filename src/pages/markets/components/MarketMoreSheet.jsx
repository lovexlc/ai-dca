import { Bell, Download, ExternalLink, Info, LayoutGrid, Star, X } from 'lucide-react';
import { createPortal } from 'react-dom';

const ACTIONS = [
  { id: 'export', label: '导出数据', icon: Download },
  { id: 'favorites', label: '自选管理', icon: Star },
  { id: 'alerts', label: '提醒管理', icon: Bell },
  { id: 'explain', label: '指标说明', icon: Info },
  { id: 'share', label: '分享页面', icon: ExternalLink },
  { id: 'view', label: '切换视图', icon: LayoutGrid },
];

export function MarketMoreSheet({ open, onClose, onAction }) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="market-sheet-backdrop market-more-backdrop" role="dialog" aria-modal="true" aria-label="更多行情功能" onMouseDown={onClose}>
      <section className="market-more-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="market-more-sheet__header"><h2>更多</h2><button type="button" onClick={onClose} aria-label="关闭更多功能"><X size={18} /></button></div>
        <div className="market-more-sheet__grid">
          {ACTIONS.map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} onClick={() => onAction?.(id)}>
              <span><Icon size={20} /></span>
              <b>{label}</b>
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );

}
