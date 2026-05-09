import { useState } from 'react';
import { Check, Settings2 } from 'lucide-react';
import { cx } from '../experience-ui.jsx';
import { Popover } from './Popover.jsx';

// 受 tablecn data-table-view-options 启发：列可见性切换。
export function DataTableViewOptions({ table, triggerClassName = '' }) {
  const [open, setOpen] = useState(false);
  const columns = table.getAllLeafColumns().filter(
    (col) => typeof col.accessorFn !== 'undefined' && col.getCanHide()
  );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={(
        <span className="inline-flex items-center gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          <span>列</span>
        </span>
      )}
      align="end"
      contentWidth={200}
      triggerClassName={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus:outline-none',
        triggerClassName
      )}
    >
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">显示列</div>
      <div className="max-h-72 overflow-y-auto">
        {columns.map((column) => {
          const checked = column.getIsVisible();
          const meta = column.columnDef.meta || {};
          const label = meta.label || column.id;
          return (
            <button
              key={column.id}
              type="button"
              onClick={() => column.toggleVisibility(!checked)}
              className={cx(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                checked ? 'text-slate-800 hover:bg-slate-100' : 'text-slate-500 hover:bg-slate-100'
              )}
            >
              <span
                className={cx(
                  'inline-flex h-4 w-4 items-center justify-center rounded border',
                  checked ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300 bg-white'
                )}
              >
                {checked ? <Check className="h-3 w-3" /> : null}
              </span>
              <span className="flex-1 truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
