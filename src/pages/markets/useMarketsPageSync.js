import { useEffect } from 'react';
import { BACKUP_APPLIED_EVENT } from '../../app/webdavBackup.js';
import { loadWatchlist } from '../../app/marketsApi.js';

// Markets 页的环境 / 同步监听副作用：移动端断点 + 账号云同步恢复后重读自选清单。
// 抽到独立 hook 以控制 MarketsExperience 编排文件体量（见 scripts/check_refactor_guard.mjs 预算）。
export function useMarketsPageSync({ setIsMobile, setWatch }) {
  // 响应式：监听移动端断点。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 1023px)');
    const h = () => setIsMobile(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', h) : mq.removeListener(h); };
  }, [setIsMobile]);

  // 账号云同步恢复后重新读取自选清单（restore/merge 直接写 localStorage，不会触发本页 state 更新）。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onBackupApplied(event) {
      const keys = Array.isArray(event?.detail?.keys) ? event.detail.keys : [];
      if (keys.length && !keys.includes('markets:watchlist:v1')) return;
      setWatch(loadWatchlist());
    }
    window.addEventListener(BACKUP_APPLIED_EVENT, onBackupApplied);
    return () => window.removeEventListener(BACKUP_APPLIED_EVENT, onBackupApplied);
  }, [setWatch]);
}
