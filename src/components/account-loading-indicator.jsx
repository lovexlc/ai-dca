// 账号操作的全局加载指示器：列表加载 / 保存 / 删除 共用一套提示。
// 用户主动触发的操作立即显示；纯后台轮询（60s）延迟显示，避免无意义闪烁。
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import { getAccountLoadingSnapshot, subscribeAccountLoading } from '../app/accountLoadingState.js';

const BACKGROUND_DELAY_MS = 600;

export function AccountLoadingIndicator() {
  const snapshot = useSyncExternalStore(subscribeAccountLoading, getAccountLoadingSnapshot, getAccountLoadingSnapshot);
  const [backgroundVisible, setBackgroundVisible] = useState(false);
  const backgroundOnly = snapshot.backgroundBusy && !snapshot.userBusy;

  useEffect(() => {
    if (!backgroundOnly) {
      setBackgroundVisible(false);
      return undefined;
    }
    const timer = setTimeout(() => setBackgroundVisible(true), BACKGROUND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [backgroundOnly]);

  if (!snapshot.userBusy && !backgroundVisible) return null;

  const text = snapshot.userBusy
    ? snapshot.label || '正在处理账号数据'
    : '账号数据同步中…';

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-[130] flex justify-center px-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-lg backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/95 dark:text-slate-100">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <span>
          {text}
          {snapshot.counts.total > 1 ? ` · ${snapshot.counts.total} 项` : ''}
        </span>
      </div>
    </div>
  );
}

export default AccountLoadingIndicator;
