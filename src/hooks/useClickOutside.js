import { useEffect } from 'react';

/**
 * 通用的点击外部关闭 Hook
 *
 * @param {React.RefObject} ref - 容器的 ref
 * @param {Function} handler - 点击外部时的回调函数
 * @param {boolean} enabled - 是否启用（默认 true）
 *
 * @example
 * const containerRef = useRef(null);
 * useClickOutside(containerRef, () => setOpen(false), open);
 */
export function useClickOutside(ref, handler, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        handler(event);
      }
    };

    // 使用 capture 阶段拦截，防止事件穿透到下层元素
    document.addEventListener('click', handleClickOutside, true);
    return () => document.removeEventListener('click', handleClickOutside, true);
  }, [ref, handler, enabled]);
}
