import { MoreHorizontal, Plus } from 'lucide-react';

export function MarketGroupTabs({ groups = [], activeGroupId = '', onSelect, onCreate, onRename, onDelete }) {
  return (
    <div className="market-group-tabs" role="tablist" aria-label="行情分组">
      {groups.map((group) => (
        <span className="market-group-tab-wrap" key={group.id}>
          <button type="button" role="tab" aria-selected={group.id === activeGroupId} className={group.id === activeGroupId ? 'is-active' : ''} onClick={() => onSelect?.(group.id)}>{group.name}</button>
          {!group.isSystem ? (
            <button type="button" className="market-group-tab-menu" aria-label={`${group.name}分组操作`} title="分组操作" onClick={() => {
              const action = window.prompt('输入 rename 重命名，输入 delete 删除该分组', '');
              if (action === 'rename') onRename?.(group);
              if (action === 'delete') onDelete?.(group);
            }}><MoreHorizontal size={14} /></button>
          ) : null}
        </span>
      ))}
      <button type="button" className="market-group-tabs__add" aria-label="新建行情分组" onClick={onCreate}><Plus size={15} /></button>
    </div>
  );
}
