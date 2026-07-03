import { useEffect, useState } from 'react';
import { loadSwitchConfigFromWorker, readSwitchConfigCache } from '../../app/switchStrategySync.js';

export function useSwitchNotifyRules(clientId = '') {
  const [switchConfig, setSwitchConfig] = useState(() => readSwitchConfigCache());

  useEffect(() => {
    let cancelled = false;
    async function loadSwitchRules() {
      try {
        const config = await loadSwitchConfigFromWorker();
        if (!cancelled) setSwitchConfig(config);
      } catch {
        // 保留本地缓存；通知规则管理不因切换配置接口失败而不可用。
      }
    }
    loadSwitchRules();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return switchConfig;
}
