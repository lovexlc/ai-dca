import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { clearWorkspaceReturn, readWorkspaceReturn } from '../app/workspaceReturn.js';
import { cx } from './experience-ui.jsx';

export function WorkspaceReturnBar({ currentTab, className = '' }) {
  const [workspaceReturn, setWorkspaceReturn] = useState(() => readWorkspaceReturn(currentTab));
  if (!workspaceReturn?.tab) return null;

  function handleClick() {
    const target = workspaceReturn;
    clearWorkspaceReturn();
    setWorkspaceReturn(null);
    window.dispatchEvent(new CustomEvent('workspace:navigate', {
      detail: {
        tab: target.tab,
        hash: target.hash || '',
        search: target.search || '',
        recordReturn: false,
      }
    }));
  }

  return (
    <div className={cx('flex', className)}>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
      >
        <ArrowLeft className="h-4 w-4" />
        返回{workspaceReturn.label || '上一页'}
      </button>
    </div>
  );
}
