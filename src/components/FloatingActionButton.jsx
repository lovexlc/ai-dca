// FloatingActionButton.jsx
// 右下角悬浮操作按钮 (FAB)，点击展开显示多个操作选项

import { useState, useRef, useEffect } from 'react';
import { Plus, X, ScanLine } from 'lucide-react';
import { cx } from './experience-ui.jsx';

export function FloatingActionButton({ actions = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const fabRef = useRef(null);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event) {
      if (fabRef.current && !fabRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  if (!actions || actions.length === 0) return null;

  return (
    <div ref={fabRef} className="fixed bottom-6 right-6 z-50 sm:hidden">
      {/* 展开的操作列表 */}
      {isOpen && (
        <div className="mb-3 flex flex-col gap-2">
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                action.onClick?.();
                setIsOpen(false);
              }}
              className={cx(
                'flex items-center gap-3 rounded-full px-4 py-3 text-sm font-medium shadow-lg transition-all',
                'bg-white text-slate-700 hover:bg-slate-50 active:scale-95',
                'animate-in fade-in slide-in-from-bottom-2',
              )}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {action.icon && <action.icon className="h-5 w-5" strokeWidth={1.75} />}
              <span className="whitespace-nowrap">{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 主按钮 */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? '关闭' : '添加'}
        className={cx(
          'flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all',
          'bg-rose-500 text-white hover:bg-rose-600 active:scale-95',
          isOpen && 'rotate-45'
        )}
      >
        {isOpen ? (
          <X className="h-6 w-6" strokeWidth={2.5} />
        ) : (
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        )}
      </button>
    </div>
  );
}

export default FloatingActionButton;
