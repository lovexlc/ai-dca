import { useEffect } from 'react';

/**
 * 通用的点击外部关闭 Hook
 *
 * @param {React.RefObject} ref - 容器的 ref
 * @param {Function} handler - 点击外部时的回调函数
 * @param {boolean|Object} options - 是否启用（默认 true），或 { enabled, stopPropagation }
 *
 * @example
 * const containerRef = useRef(null);
 * useClickOutside(containerRef, () => setOpen(false), open);
 */
export function useClickOutside(ref, handler, options = true) {
  const enabled = typeof options === 'object' ? options.enabled !== false : options;
  const stopPropagation = typeof options === 'object' ? Boolean(options.stopPropagation) : false;

  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        if (stopPropagation) {
          event.preventDefault();
          event.stopPropagation();
        }
        handler(event);
      }
    };

    document.addEventListener('click', handleClickOutside, true);
    return () => document.removeEventListener('click', handleClickOutside, true);
  }, [ref, handler, enabled, stopPropagation]);
}
