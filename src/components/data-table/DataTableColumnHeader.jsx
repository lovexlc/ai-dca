import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, EyeOff, X } from 'lucide-react';
import { cx } from '../experience-ui.jsx';
import { Popover } from './Popover.jsx';

// 受 tablecn data-table-column-header 启发：列头点击 → 下拉菜单
// (Asc / Desc / Reset / Hide)。适配 TanStack Table 的 column API。
export function DataTableColumnHeader({ column, label, align = 'left', className = '' }) {
  const [open, setOpen] = useState(false);
  if (!column.getCanSort() && !column.getCanHide()) {
    return <div className={cx('text-slate-500', className)}>{label}</div>;
  }

  const sorted = column.getIsSorted();
  const Indicator = sorted === 'desc' ? ArrowDown : sorted === 'asc' ? ArrowUp : ChevronsUpDown;
  const indicatorTone = sorted ? 'text-indigo-500' : 'text-slate-400 opacity-0 group-hover:opacity-100';

  const trigger = (
    <span className={cx('inline-flex items-center gap-1.5', align === 'right' && 'flex-row-reverse')}>
      <span>{label}</span>
      <Indicator className={cx('h-3 w-3 transition-opacity', indicatorTone)} />
    </span>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      align={align === 'right' ? 'end' : 'start'}
      contentWidth={140}
      triggerClassName={cx(
        'group -mx-2 inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 transition-colors hover:bg-slate-200/60 focus:outline-none data-[state=open]:bg-slate-200/60',
        sorted && 'text-slate-800',
        className
      )}
    >
      {column.getCanSort() ? (
        <>
          <MenuItem
            checked={sorted === 'asc'}
            onClick={() => { column.toggleSorting(false); setOpen(false); }}
            icon={<ArrowUp className="h-3.5 w-3.5" />}
            label="升序"
          />
          <MenuItem
            checked={sorted === 'desc'}
            onClick={() => { column.toggleSorting(true); setOpen(false); }}
            icon={<ArrowDown className="h-3.5 w-3.5" />}
            label="降序"
          />
          {sorted ? (
            <MenuItem
              onClick={() => { column.clearSorting(); setOpen(false); }}
              icon={<X className="h-3.5 w-3.5" />}
              label="取消排序"
            />
          ) : null}
        </>
      ) : null}
      {column.getCanHide() ? (
        <>
          {column.getCanSort() ? <div className="my-1 h-px bg-slate-100" /> : null}
          <MenuItem
            onClick={() => { column.toggleVisibility(false); setOpen(false); }}
            icon={<EyeOff className="h-3.5 w-3.5" />}
            label="隐藏列"
          />
        </>
      ) : null}
    </Popover>
  );
}

function MenuItem({ checked = false, onClick, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-normal normal-case tracking-normal transition-colors',
        checked ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'
      )}
    >
      <span className="text-slate-500">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}
