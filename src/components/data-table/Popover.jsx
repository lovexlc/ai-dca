import { useEffect, useRef } from 'react';
import { cx } from '../experience-ui.jsx';

// 轻量 popover：受控开关 + 点击外部 / Esc 自动关闭。
// 不引入 Radix，只依赖 React + 现有的 Tailwind。
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'start',
  contentClassName = '',
  triggerClassName = '',
  contentWidth = 240,
}) {
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) onOpenChange(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const contentStyle = { minWidth: contentWidth };

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        className={triggerClassName}
        onClick={() => onOpenChange(!open)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="dialog"
          style={contentStyle}
          className={cx(
            'absolute top-full z-40 mt-1 rounded-lg border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-black/5 outline-none',
            align === 'end' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0',
            contentClassName
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
