// 4 大通知渠道的账号级连接状态 + PC 浏览器通知的本地动作。
// ChannelsView 与新建/编辑弹窗共用同一份状态，避免两处逻辑漂移。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadNotifyStatus } from '../../app/notifySync.js';
import {
  getWebNotifyState,
  persistWebNotifyConfig,
  readWebNotifyConfig,
  requestWebNotifyPermission,
  showLocalWebNotification
} from '../../app/webNotifyClient.js';

function readPcState() {
  const state = getWebNotifyState();
  return {
    supported: Boolean(state.supported),
    permission: String(state.permission || 'default'),
    enabled: Boolean(readWebNotifyConfig().pcEnabled)
  };
}

export function useSwitchChannelStatus() {
  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pc, setPc] = useState(() => (typeof window === 'undefined' ? { supported: false, permission: 'default', enabled: false } : readPcState()));

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const status = await loadNotifyStatus();
      setRemote(status);
    } catch (loadError) {
      setRemote(null);
      setError(loadError?.message || '通知状态读取失败');
    } finally {
      setPc(readPcState());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const requestPermission = useCallback(async () => {
    const permission = await requestWebNotifyPermission();
    if (permission === 'granted') persistWebNotifyConfig({ pcEnabled: true });
    setPc(readPcState());
    return permission;
  }, []);

  const toggleEnabled = useCallback(() => {
    const current = readWebNotifyConfig();
    persistWebNotifyConfig({ pcEnabled: !current.pcEnabled });
    setPc(readPcState());
  }, []);

  const sendTest = useCallback(() => {
    const result = showLocalWebNotification({
      title: '基金切换测试通知',
      body: '这是一条本地测试通知，用于确认 PC 浏览器可以收到切换提醒。',
      tag: `switch-board-test-${Date.now()}`
    });
    return Boolean(result);
  }, []);

  const connected = useMemo(() => {
    const email = remote?.setup?.email || {};
    return {
      ios: Boolean(remote?.configured?.bark),
      serverchan3: Boolean(remote?.configured?.serverChan3),
      pc: Boolean(pc.supported && pc.permission === 'granted' && pc.enabled),
      email: Boolean(email.verified && email.enabled)
    };
  }, [remote, pc]);

  const detail = useMemo(() => {
    const email = remote?.setup?.email || {};
    return {
      emailMaskedAddress: String(email.maskedAddress || ''),
      emailVerified: Boolean(email.verified),
      emailEnabled: Boolean(email.enabled),
      serverChan3Uid: String(remote?.setup?.serverChan3?.uid || ''),
      barkConfigured: Boolean(remote?.configured?.bark)
    };
  }, [remote]);

  return { connected, detail, pc, loading, error, refresh, requestPermission, toggleEnabled, sendTest };
}
