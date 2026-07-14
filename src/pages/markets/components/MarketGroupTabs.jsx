import { MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';

export function MarketGroupTabs({ groups = [], activeGroupId = '', onSelect, onCreate, onRename, onDelete }) {
  const [actionGroup, setActionGroup] = useState(null);
  return (
    <>
      <div className="market-group-tabs" role="tablist" aria-label="行情分组">
        {groups.map((group) => (
          <span className="market-group-tab-wrap" key={group.id}>
            <button type="button" role="tab" aria-selected={group.id === activeGroupId} className={group.id === activeGroupId ? 'is-active' : ''} onClick={() => onSelect?.(group.id)}>{group.name}</button>
            {!group.isSystem ? (
              <button type="button" className="market-group-tab-menu" aria-label={`${group.name}分组操作`} title="分组操作" onClick={() => setActionGroup(group)}><MoreHorizontal size={14} /></button>
            ) : null}
          </span>
        ))}
        <button type="button" className="market-group-tabs__add" aria-label="新建行情分组" onClick={onCreate}><Plus size={15} /></button>
      </div>
      {actionGroup && typeof document !== 'undefined' ? createPortal(
        <div className="market-group-action-backdrop" role="dialog" aria-modal="true" aria-label={`${actionGroup.name}分组操作`} onMouseDown={() => setActionGroup(null)}>
          <section className="market-group-action-sheet" onMouseDown={(event) => event.stopPropagation()}>
            <div className="market-group-action-sheet__header"><strong>{actionGroup.name}</strong><button type="button" aria-label="关闭分组操作" onClick={() => setActionGroup(null)}><X size={17} /></button></div>
            <button type="button" onClick={() => { setActionGroup(null); onRename?.(actionGroup); }}><Pencil size={16} />重命名</button>
            <button type="button" className="is-danger" onClick={() => { setActionGroup(null); onDelete?.(actionGroup); }}><Trash2 size={16} />删除分组</button>
          </section>
        </div>,
        document.body
      ) : null}
    </>
  );
}
