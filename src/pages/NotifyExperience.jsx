import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, Send, Wallet } from 'lucide-react';
import {
  loadNotifyEvents,
  loadNotifyStatus,
  loadHoldingsNotifyRule,
  saveHoldingsNotifyRule,
  mergeNotifyStatusIntoClientConfig,
  persistNotifyClientConfig,
  readNotifyClientConfig,
  saveNotifySettings,
  sendNotifyTest,
  syncTradePlanRules
} from '../app/notifySync.js';
import {
  getWebNotifyState,
  persistWebNotifyConfig,
  readWebNotifyConfig,
  requestWebNotifyPermission,
  showLocalWebNotification
} from '../app/webNotifyClient.js';
import { aggregateByCode, buildHoldingsNotifyDigest, summarizePortfolio } from '../app/holdingsLedgerCore.js';
import { readLedgerState } from '../app/holdingsLedger.js';
import { showActionToast } from '../app/toast.js';
import { trackActionResult, trackAnalyticsEvent, trackFeatureEvent } from '../app/analytics.js';
import { NotifyConfigCard } from './NotifyConfigCard.jsx';
import { NotifyHistoryCard } from './NotifyHistoryCard.jsx';
import {
  Card,
  Pill,
  StatCard,
  cx,
  secondaryButtonClass
} from '../components/experience-ui.jsx';
import {
  formatEventTimeLabel,
  resolveEventStatusMeta
} from '../app/tradePlansHelpers.js';
import { parseBarkInput } from '../app/notifyParsers.js';
import { getVisibleNotifyEvents, humanizeNotifyError } from './notifyHistoryHelpers.js';

export function NotifyExperience({ embedded = false }) {
  const [notifyStatus, setNotifyStatus] = useState(null);
  const [notifyError, setNotifyError] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [notifyPlatform, setNotifyPlatform] = useState('ios');
  const [notifyConfig, setNotifyConfig] = useState(() => {
    const persistedConfig = readNotifyClientConfig();
    return {
      barkDeviceKey: persistedConfig.barkDeviceKey || '',
      serverChan3Uid: persistedConfig.serverChan3Uid || '',
      serverChan3SendKey: persistedConfig.serverChan3SendKey || '',
      notifyClientId: persistedConfig.notifyClientId || '',
      notifyClientLabel: persistedConfig.notifyClientLabel || ''
    };
  });
  const [holdingsRule, setHoldingsRule] = useState({ enabled: false, digest: null, updatedAt: '' });
  const [isSavingHoldingsRule, setIsSavingHoldingsRule] = useState(false);
  const [isSyncingHoldingsDigest, setIsSyncingHoldingsDigest] = useState(false);
  const [isTestingHoldingsNotify, setIsTestingHoldingsNotify] = useState(false);
  // 提醒历史与规则同步：从各 tab 合并到本页，避免交易计划中心重复采点。
  const [notifyEvents, setNotifyEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [eventsLastSyncedAt, setEventsLastSyncedAt] = useState('');
  // 仅用于驱动 30 分钟后重新过滤测试通知的重渲染。
  const [eventsTick, setEventsTick] = useState(0);
  const [isSyncingRules, setIsSyncingRules] = useState(false);
  const [rulesLastSyncedAt, setRulesLastSyncedAt] = useState('');
  // 「消息推送配置」默认在检测到已配置（Bark / Server酱³ / PC 任意一项）后自动收起，
  // 点击卡片头部可手动展开。null 表示尚未从远端收到 status，默认保持展开。
  const [configCollapsed, setConfigCollapsed] = useState(null);
  // 「提醒策略」内的多条策略默认全部收起，点击标题切换展开。
  // 取值：'rules' | 'holdings' | null。同时只展开一条，避免页面过长。
  const [expandedStrategy, setExpandedStrategy] = useState(null);
  // WebSocket 实时通道状态（由 entry-screen.jsx 通过自定义事件更新）
  const [notifyWsStatus, setNotifyWsStatus] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.__aiDcaNotifyWsStatus || 'idle';
    }
    return 'idle';
  });
  // PC 浏览器前台通知（方案 A）：仅在页面打开时弹桌面 Notification。
  // 开关 webNotifyEnabled 写到 localStorage，由 entry-screen.jsx 启动的全局 poller 读取。
  const [webNotifySupported, setWebNotifySupported] = useState(() => getWebNotifyState().supported);
  const [webNotifyPermission, setWebNotifyPermission] = useState(() => getWebNotifyState().permission);
  const [webNotifyEnabled, setWebNotifyEnabled] = useState(() => Boolean(readWebNotifyConfig().pcEnabled));

  function buildLatestHoldingsDigest() {
    try {
      const ledger = readLedgerState();
      const aggregates = aggregateByCode(ledger?.transactions || [], ledger?.snapshotsByCode || {});
      const summary = summarizePortfolio(aggregates);
      return buildHoldingsNotifyDigest({ aggregates, summary });
    } catch {
      return null;
    }
  }

  const notifySetup = notifyStatus?.setup || null;
  const currentClientRegistrations = Array.isArray(notifySetup?.webWsCurrentClientRegistrations)
    ? notifySetup.webWsCurrentClientRegistrations
    : [];
  const pairedWebWsDevices = currentClientRegistrations.filter((registration) => (
    registration?.isWebClient || String(registration?.deviceInstallationId || registration?.id || '').startsWith('web-ws:')
  ));
  const barkConfigured = Boolean(notifyStatus?.configured?.bark);
  const serverChan3Configured = Boolean(notifyStatus?.configured?.serverChan3 || notifySetup?.serverChan3?.configured);
  const pcConfigured = Boolean(webNotifySupported && webNotifyPermission === 'granted' && webNotifyEnabled);
  const notifyMeta = () => ({
    embedded,
    platformTab: notifyPlatform,
    barkConfigured,
    serverChan3Configured,
    pcConfigured,
    webNotifySupported,
    webNotifyPermission,
    webNotifyEnabled,
    wsStatus: notifyWsStatus,
    holdingsRuleEnabled: Boolean(holdingsRule.enabled),
    visibleEventCount: visibleEvents.length,
    pairedWebWsCount: pairedWebWsDevices.length
  });

  const summary = useMemo(() => {
    const channelLabels = [];
    if (barkConfigured) channelLabels.push('iOS Bark');
    if (serverChan3Configured) channelLabels.push('Server酱³');
    if (pcConfigured) {
      channelLabels.push('PC 浏览器');
    }
    return {
      channelStatus: channelLabels.length ? '已配置' : '未配置',
      channelNote: channelLabels.length
        ? `${channelLabels.join(' / ')} 可发送`
        : '请先配置 iOS Bark、Server酱³，或授权 PC 浏览器通知',
      serverChan3Configured
    };
  }, [barkConfigured, pcConfigured, serverChan3Configured]);

  async function handleRequestWebNotifyPermission() {
    const startedAt = Date.now();
    trackFeatureEvent('notify', 'pc_permission_request_start', notifyMeta());
    const result = await requestWebNotifyPermission();
    setWebNotifyPermission(result);
    setWebNotifySupported(getWebNotifyState().supported);
    if (result === 'granted') {
      // 首次授权后默认启用轮询，省一步用户操作
      persistWebNotifyConfig({ pcEnabled: true });
      setWebNotifyEnabled(true);
      showActionToast({ tone: 'positive', message: '已授权 PC 桌面通知，前台轮询已自动启用。' });
    } else if (result === 'denied') {
      showActionToast({ tone: 'negative', message: '浏览器已拒绝通知。请到地址栏 🔒 → 通知 → 允许后重试。' });
    }
    trackActionResult('notify', 'pc_permission_request', result === 'granted' ? 'success' : result === 'denied' ? 'denied' : 'dismissed', {
      ...notifyMeta(),
      result,
      durationMs: Date.now() - startedAt
    });
  }

  function handleSendLocalWebNotifyTest() {
    const note = showLocalWebNotification({
      title: 'AI-DCA 测试通知',
      body: '这是一条本地桌面测试通知，证明当前浏览器可以收到 PC 通知。',
      tag: 'pc-test'
    });
    if (!note) {
      showActionToast({ tone: 'negative', message: '未能弹出通知，请先完成浏览器授权。' });
    }
    trackActionResult('notify', 'pc_local_test', note ? 'success' : 'error', notifyMeta());
  }

  function handleToggleWebNotifyEnabled() {
    const next = !webNotifyEnabled;
    persistWebNotifyConfig({ pcEnabled: next });
    setWebNotifyEnabled(next);
    trackFeatureEvent('notify', 'pc_toggle', {
      ...notifyMeta(),
      enabled: next
    });
    if (next) {
      trackAnalyticsEvent('notify_enabled', {
        hasBark: barkConfigured,
        clientId: notifyConfig.notifyClientId,
        platforms: ['pc']
      });
    }
  }

  useEffect(() => {
    window.addEventListener('notify:test-pc', handleSendLocalWebNotifyTest);
    return () => window.removeEventListener('notify:test-pc', handleSendLocalWebNotifyTest);
  }, [webNotifySupported, webNotifyPermission]);

  // 监听 WS 连接状态变化（由 entry-screen.jsx 的 CustomEvent 派发）
  useEffect(() => {
    function handleWsStatusChange(event) {
      const newStatus = event?.detail?.status;
      if (newStatus) {
        setNotifyWsStatus(newStatus);
      }
    }
    window.addEventListener('ai-dca-notify-ws-status', handleWsStatusChange);
    // 初始化时同步一次当前状态
    if (typeof window !== 'undefined' && window.__aiDcaNotifyWsStatus) {
      setNotifyWsStatus(window.__aiDcaNotifyWsStatus);
    }
    return () => window.removeEventListener('ai-dca-notify-ws-status', handleWsStatusChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshNotifyPanel() {
      try {
        const statusPayload = await loadNotifyStatus(notifyConfig.notifyClientId);
        if (cancelled) return;
        setNotifyStatus(statusPayload);
        const mergedConfig = mergeNotifyStatusIntoClientConfig(statusPayload, readNotifyClientConfig());
        setNotifyConfig((current) => ({
          ...current,
          barkDeviceKey: current.barkDeviceKey || mergedConfig.barkDeviceKey || '',
          serverChan3Uid: current.serverChan3Uid || mergedConfig.serverChan3Uid || '',
          serverChan3SendKey: current.serverChan3SendKey || ''
        }));
        setNotifyError('');
      } catch (error) {
        if (cancelled) return;
        setNotifyError(humanizeNotifyError(error));
      }
    }
    refreshNotifyPanel();
    return () => {
      cancelled = true;
    };
  }, [notifyConfig.notifyClientId]);

  useEffect(() => {
    let cancelled = false;
    async function loadRule() {
      try {
        const payload = await loadHoldingsNotifyRule();
        if (cancelled) return;
        setHoldingsRule({
          enabled: Boolean(payload?.enabled),
          digest: payload?.digest || null,
          updatedAt: String(payload?.updatedAt || '')
        });
      } catch {
        // 静默：未配置与服务不可用都以「未启用」状态呈现。
      }
    }
    loadRule();
    return () => {
      cancelled = true;
    };
  }, [notifyConfig.notifyClientId]);

  // 首次拿到远端 status 后，若已配置任意一个推送通道，默认收起《消息推送配置》。
  // 之后由用户手动切换展开/收起，不再被远端覆盖。
  useEffect(() => {
    if (configCollapsed !== null || !notifyStatus) return;
    setConfigCollapsed(barkConfigured || serverChan3Configured || pcConfigured);
  }, [notifyStatus, barkConfigured, serverChan3Configured, pcConfigured, configCollapsed]);
  const isConfigCollapsed = configCollapsed === true;
  const pcPermissionReason = !webNotifySupported
    ? '当前浏览器不支持 Notification API'
    : webNotifyPermission === 'granted'
    ? '浏览器通知已授权'
    : webNotifyPermission === 'denied'
    ? '请到浏览器站点设置中允许通知'
    : '';
  const pcTestDisabledReason = !webNotifySupported
    ? '当前浏览器不支持 Notification API'
    : webNotifyPermission !== 'granted'
    ? '需先授权浏览器通知'
    : '';

  // 首次进入页面拉取提醒历史。后续手动同步 / 发出测试通知后主动重新拉取。
  useEffect(() => {
    let cancelled = false;
    async function fetchEvents() {
      setEventsLoading(true);
      setEventsError('');
      try {
        const payload = await loadNotifyEvents(notifyConfig.notifyClientId);
        if (cancelled) return;
        const list = Array.isArray(payload?.events) ? payload.events : [];
        setNotifyEvents(list);
        setEventsLastSyncedAt(new Date().toISOString());
      } catch (error) {
        if (cancelled) return;
        setEventsError(humanizeNotifyError(error));
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    }
    fetchEvents();
    return () => {
      cancelled = true;
    };
  }, [notifyConfig.notifyClientId]);

  // 每 60 秒推进 tick，让超过 30 分钟的测试通知从列表中自动消失。
  useEffect(() => {
    const timer = window.setInterval(() => {
      setEventsTick((value) => value + 1);
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 按 30 分钟 TTL 过滤测试通知，其他事件原样保留。
  // 依赖 eventsTick 是为了让定时器触发重评估。
  const visibleEvents = useMemo(() => getVisibleNotifyEvents(notifyEvents, eventsTick), [notifyEvents, eventsTick]);

  async function refreshNotifyEvents() {
    setEventsLoading(true);
    setEventsError('');
    const startedAt = Date.now();
    trackFeatureEvent('notify', 'events_refresh_start', notifyMeta());
    try {
      const payload = await loadNotifyEvents(notifyConfig.notifyClientId);
      const list = Array.isArray(payload?.events) ? payload.events : [];
      setNotifyEvents(list);
      setEventsLastSyncedAt(new Date().toISOString());
      trackActionResult('notify', 'events_refresh', 'success', {
        ...notifyMeta(),
        eventCount: list.length,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      setEventsError(humanizeNotifyError(error));
      trackActionResult('notify', 'events_refresh', 'error', {
        ...notifyMeta(),
        durationMs: Date.now() - startedAt,
        errorMessage: error?.message || ''
      });
    } finally {
      setEventsLoading(false);
    }
  }

  async function refreshNotifyData({ serverChan3Fallback = null } = {}) {
    const statusPayload = await loadNotifyStatus(notifyConfig.notifyClientId);
    const fallbackConfigured = Boolean(serverChan3Fallback?.configured || (serverChan3Fallback?.uid && serverChan3Fallback?.sendKeyMasked));
    const nextStatus = fallbackConfigured && !statusPayload?.setup?.serverChan3?.configured
      ? {
        ...statusPayload,
        configured: {
          ...(statusPayload?.configured || {}),
          serverChan3: true
        },
        setup: {
          ...(statusPayload?.setup || {}),
          serverChan3: {
            ...(statusPayload?.setup?.serverChan3 || {}),
            ...serverChan3Fallback,
            configured: true
          }
        }
      }
      : statusPayload;
    setNotifyStatus(nextStatus);
    const mergedConfig = mergeNotifyStatusIntoClientConfig(nextStatus, notifyConfig);
    setNotifyConfig((current) => ({
      ...current,
      barkDeviceKey: current.barkDeviceKey || mergedConfig.barkDeviceKey || '',
      serverChan3Uid: current.serverChan3Uid || mergedConfig.serverChan3Uid || '',
      serverChan3SendKey: current.serverChan3SendKey || ''
    }));
    setNotifyError('');
  }

  async function handleSaveNotifyConfig() {
    setIsSavingSettings(true);
    setNotifyError('');
    setNotifyMessage('');
    const startedAt = Date.now();
    trackFeatureEvent('notify', 'bark_save_start', {
      ...notifyMeta(),
      inputLength: String(notifyConfig.barkDeviceKey || '').length
    });
    try {
      const parsedBarkKey = parseBarkInput(notifyConfig.barkDeviceKey);
      if (!parsedBarkKey) {
        throw new Error('请粘贴 Bark 完整链接或 Device Key');
      }
      await saveNotifySettings({ barkDeviceKey: parsedBarkKey });
      persistNotifyClientConfig({
        barkDeviceKey: parsedBarkKey,
        _hasServerChan3: serverChan3Configured,
        _hasPC: webNotifySupported && webNotifyPermission === 'granted' && webNotifyEnabled
      });
      setNotifyConfig((current) => ({ ...current, barkDeviceKey: parsedBarkKey }));
      await refreshNotifyData();
      setNotifyMessage('Bark 配置已保存。');
      showActionToast('保存 Bark 配置', 'success');
      trackActionResult('notify', 'bark_save', 'success', {
        ...notifyMeta(),
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '通知配置保存失败';
      setNotifyError(message);
      showActionToast('保存 Bark 配置', 'error', { description: message });
      trackActionResult('notify', 'bark_save', 'error', {
        ...notifyMeta(),
        durationMs: Date.now() - startedAt,
        errorMessage: message
      });
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleSaveServerChan3Config() {
    setIsSavingSettings(true);
    setNotifyError('');
    setNotifyMessage('');
    const startedAt = Date.now();
    trackFeatureEvent('notify', 'serverchan3_save_start', {
      ...notifyMeta(),
      hasUid: Boolean(notifyConfig.serverChan3Uid),
      hasSendKey: Boolean(notifyConfig.serverChan3SendKey)
    });
    try {
      const uid = String(notifyConfig.serverChan3Uid || '').trim();
      const sendKey = String(notifyConfig.serverChan3SendKey || '').trim();
      if (!uid || (!sendKey && !serverChan3Configured)) {
        throw new Error('请填写 Server酱³ UID 和 SendKey');
      }
      const savedSettings = await saveNotifySettings({
        clientId: notifyConfig.notifyClientId,
        clientLabel: notifyConfig.notifyClientLabel,
        serverChan3: sendKey ? { uid, sendKey } : { uid },
        barkDeviceKey: notifyConfig.barkDeviceKey
      });
      const savedServerChan3 = savedSettings?.setup?.serverChan3 || {
        uid,
        sendKeyMasked: sendKey ? `${sendKey.slice(0, 6)}...${sendKey.slice(-4)}` : '',
        configured: true
      };
      persistNotifyClientConfig({
        notifyClientId: notifyConfig.notifyClientId,
        notifyClientLabel: notifyConfig.notifyClientLabel,
        serverChan3Uid: uid,
        ...(sendKey ? { serverChan3SendKey: sendKey } : {}),
        barkDeviceKey: notifyConfig.barkDeviceKey,
        _hasServerChan3: true,
        _hasPC: webNotifySupported && webNotifyPermission === 'granted' && webNotifyEnabled
      });
      setNotifyConfig((current) => ({ ...current, serverChan3Uid: uid, ...(sendKey ? { serverChan3SendKey: sendKey } : {}) }));
      setNotifyStatus((current) => ({
        ...(current || {}),
        configured: {
          ...(current?.configured || {}),
          serverChan3: true
        },
        setup: {
          ...(current?.setup || {}),
          serverChan3: savedServerChan3
        }
      }));
      await refreshNotifyData({ serverChan3Fallback: savedServerChan3 });
      setNotifyMessage('Server酱³ 推送配置已保存。');
      showActionToast('保存 Server酱³ 配置', 'success');
      trackActionResult('notify', 'serverchan3_save', 'success', {
        ...notifyMeta(),
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Server酱³ 配置保存失败';
      setNotifyError(message);
      showActionToast('保存 Server酱³ 配置', 'error', { description: message });
      trackActionResult('notify', 'serverchan3_save', 'error', {
        ...notifyMeta(),
        durationMs: Date.now() - startedAt,
        errorMessage: message
      });
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleToggleHoldingsRule(nextEnabled) {
    setIsSavingHoldingsRule(true);
    setNotifyError('');
    setNotifyMessage('');
    const startedAt = Date.now();
    trackFeatureEvent('notify', 'holdings_rule_toggle_start', {
      ...notifyMeta(),
      nextEnabled
    });
    try {
      const digest = buildLatestHoldingsDigest();
      const payload = await saveHoldingsNotifyRule({ enabled: nextEnabled, digest });
      setHoldingsRule({
        enabled: Boolean(payload?.enabled),
        digest: payload?.digest || digest || null,
        updatedAt: String(payload?.updatedAt || new Date().toISOString())
      });
      setNotifyMessage(nextEnabled ? '持仓当日收益提醒已启用。' : '持仓当日收益提醒已关闭。');
      showActionToast(nextEnabled ? '启用持仓提醒' : '关闭持仓提醒', 'success');
      trackActionResult('notify', 'holdings_rule_toggle', 'success', {
        ...notifyMeta(),
        nextEnabled,
        hasDigest: Boolean(digest),
        digestItemCount: Array.isArray(digest?.items) ? digest.items.length : 0,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存持仓通知规则失败';
      setNotifyError(message);
      showActionToast('保存持仓提醒', 'error', { description: message });
      trackActionResult('notify', 'holdings_rule_toggle', 'error', {
        ...notifyMeta(),
        nextEnabled,
        durationMs: Date.now() - startedAt,
        errorMessage: message
      });
    } finally {
      setIsSavingHoldingsRule(false);
    }
  }

  async function handleSyncHoldingsDigest() {
    setIsSyncingHoldingsDigest(true);
    setNotifyError('');
    setNotifyMessage('');
    const startedAt = Date.now();
    trackFeatureEvent('notify', 'holdings_digest_sync_start', notifyMeta());
    try {
      const digest = buildLatestHoldingsDigest();
      const payload = await saveHoldingsNotifyRule({ enabled: holdingsRule.enabled, digest });
      setHoldingsRule({
        enabled: Boolean(payload?.enabled),
        digest: payload?.digest || digest || null,
        updatedAt: String(payload?.updatedAt || new Date().toISOString())
      });
      setNotifyMessage('持仓快照已同步。');
      showActionToast('同步持仓快照', 'success');
      trackActionResult('notify', 'holdings_digest_sync', 'success', {
        ...notifyMeta(),
        hasDigest: Boolean(digest),
        digestItemCount: Array.isArray(digest?.items) ? digest.items.length : 0,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步持仓快照失败';
      setNotifyError(message);
      showActionToast('同步持仓快照', 'error', { description: message });
      trackActionResult('notify', 'holdings_digest_sync', 'error', {
        ...notifyMeta(),
        durationMs: Date.now() - startedAt,
        errorMessage: message
      });
    } finally {
      setIsSyncingHoldingsDigest(false);
    }
  }

  // 发送一条「持仓总览」样式的测试推送，用于验证推送通道与文案。
  async function handleTestHoldingsNotify() {
    setIsTestingHoldingsNotify(true);
    setNotifyError('');
    setNotifyMessage('');
    const startedAt = Date.now();
    trackFeatureEvent('notify', 'holdings_test_start', notifyMeta());
    try {
      const eventId = `holdings-test-${Date.now()}`;
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const dateLabel = `${yy}-${mm}-${dd}`;
      await sendNotifyTest({
        clientId: notifyConfig.notifyClientId,
        eventId,
        eventType: 'holdings-daily-return',
        ruleId: 'holdings-daily-test',
        symbol: '持仓总览',
        strategyName: '持仓当日收益',
        title: `[持仓总览] ${dateLabel} 当日收益 +0.16%`,
        summary: `当日加权收益率 +0.16%`,
        body: `今日加权收益率 +0.16%。这是一条测试通知，用于校验推送通道是否可用。`,
        triggerCondition: '手动测试'
      });
      setNotifyMessage('测试通知已发送。');
      showActionToast('测试通知', 'success', {
        description: '已发送「持仓总览」样式的测试推送。'
      });
      trackActionResult('notify', 'holdings_test', 'success', {
        ...notifyMeta(),
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '测试通知发送失败';
      setNotifyError(message);
      showActionToast('测试通知', 'error', { description: message });
      trackActionResult('notify', 'holdings_test', 'error', {
        ...notifyMeta(),
        durationMs: Date.now() - startedAt,
        errorMessage: message
      });
    } finally {
      setIsTestingHoldingsNotify(false);
    }
  }

  async function handleSyncRules() {
    setIsSyncingRules(true);
    setNotifyError('');
    setNotifyMessage('');
    const startedAt = Date.now();
    trackFeatureEvent('notify', 'trade_rules_sync_start', notifyMeta());
    try {
      await syncTradePlanRules();
      setRulesLastSyncedAt(new Date().toISOString());
      setNotifyMessage('交易计划与定投规则已同步到云端。');
      showActionToast('同步通知规则', 'success');
      // 同步后遵便重新拉取一次提醒历史，避免进页后才发现有新记录。
      await refreshNotifyEvents();
      trackActionResult('notify', 'trade_rules_sync', 'success', {
        ...notifyMeta(),
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '通知规则同步失败';
      setNotifyError(message);
      showActionToast('同步通知规则', 'error', { description: message });
      trackActionResult('notify', 'trade_rules_sync', 'error', {
        ...notifyMeta(),
        durationMs: Date.now() - startedAt,
        errorMessage: message
      });
    } finally {
      setIsSyncingRules(false);
    }
  }

  function renderConfigCard() {
    return (
      <NotifyConfigCard
        isConfigCollapsed={isConfigCollapsed}
        setConfigCollapsed={setConfigCollapsed}
        summary={summary}
        barkConfigured={barkConfigured}
        serverChan3Configured={serverChan3Configured}
        notifyPlatform={notifyPlatform}
        setNotifyPlatform={setNotifyPlatform}
        notifyError={notifyError}
        notifyMessage={notifyMessage}
        notifyConfig={notifyConfig}
        setNotifyConfig={setNotifyConfig}
        pairedWebWsDevices={pairedWebWsDevices}
        notifySetup={notifySetup}
        handleSaveNotifyConfig={handleSaveNotifyConfig}
        handleSaveServerChan3Config={handleSaveServerChan3Config}
        isSavingSettings={isSavingSettings}
        webNotifySupported={webNotifySupported}
        webNotifyPermission={webNotifyPermission}
        webNotifyEnabled={webNotifyEnabled}
        pcPermissionReason={pcPermissionReason}
        pcTestDisabledReason={pcTestDisabledReason}
        handleRequestWebNotifyPermission={handleRequestWebNotifyPermission}
        handleSendLocalWebNotifyTest={handleSendLocalWebNotifyTest}
        handleToggleWebNotifyEnabled={handleToggleWebNotifyEnabled}
        notifyWsStatus={notifyWsStatus}
      />
    );
  }

  // 「提醒策略」：将原本独立的「交易计划规则同步」与「持仓当日收益提醒」合并为一张可折叠卡片。
  // 每条默认收起，点击头部切换展开 / 收起，同时只展开一条。
  function renderStrategyCard() {
    const rulesLastSyncedLabel = rulesLastSyncedAt
      ? formatEventTimeLabel(rulesLastSyncedAt)
      : '本次会话尚未同步';
    const holdingsEnabled = Boolean(holdingsRule.enabled);
    const items = [
      {
        key: 'rules',
        icon: <RefreshCw className="h-4 w-4 text-indigo-500" />,
        title: '交易计划规则同步',
        subtitle: `上次同步：${rulesLastSyncedLabel}`,
        pill: null,
        body: renderSyncRulesBody()
      },
      {
        key: 'holdings',
        icon: <Wallet className="h-4 w-4 text-emerald-500" />,
        title: '持仓当日收益提醒',
        subtitle: '北京时间 15:30 推场内；20:30 / 21:30 推全仓总览',
        pill: holdingsEnabled
          ? { tone: 'emerald', label: '已启用' }
          : { tone: 'slate', label: '未启用' },
        body: renderHoldingsRuleBody()
      }
    ];
    return (
      <Card>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Strategies</div>
        <div className="mt-1 text-base font-bold text-slate-900 sm:text-lg">提醒策略 · {items.length} 条</div>
        <div className="mt-4 space-y-3">
          {items.map((item) => {
            const expanded = expandedStrategy === item.key;
            return (
              <div key={item.key} className="rounded-2xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setExpandedStrategy(expanded ? null : item.key)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  aria-expanded={expanded}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {item.icon}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-800">{item.title}</div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">{item.subtitle}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.pill ? <Pill tone={item.pill.tone}>{item.pill.label}</Pill> : null}
                    {expanded
                      ? <ChevronUp className="h-4 w-4 text-slate-400" />
                      : <ChevronDown className="h-4 w-4 text-slate-400" />}
                  </div>
                </button>
                {expanded ? (
                  <div className="border-t border-slate-100 px-4 py-4">
                    {item.body}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  function renderSyncRulesBody() {
    const lastSyncedLabel = rulesLastSyncedAt
      ? formatEventTimeLabel(rulesLastSyncedAt)
      : '本次会话尚未同步';
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs leading-5 text-slate-500">
            将本机交易计划与定投规则同步到云端。交易计划中心修改后会自动同步，这里只是手动补同步入口。
          </p>
          <p className="mt-1 text-xs text-slate-400">上次同步：{lastSyncedLabel}</p>
        </div>
        <button
          type="button"
          className={cx(secondaryButtonClass, isSyncingRules && 'cursor-not-allowed opacity-60')}
          onClick={handleSyncRules}
          disabled={isSyncingRules}
        >
          <RefreshCw className="h-4 w-4" />
          {isSyncingRules ? '正在同步' : '同步通知规则'}
        </button>
      </div>
    );
  }

  function renderHoldingsRuleBody() {
    const digest = holdingsRule.digest || null;
    const exchangeCount = Array.isArray(digest?.exchange) ? digest.exchange.length : 0;
    const otcCount = Array.isArray(digest?.otc) ? digest.otc.length : 0;
    const totalWeight = [...(digest?.exchange || []), ...(digest?.otc || [])]
      .reduce((sum, entry) => sum + (Number(entry?.weight) || 0), 0);
    const updatedLabel = holdingsRule.updatedAt
      ? formatEventTimeLabel(holdingsRule.updatedAt)
      : '尚未同步';
    const generatedLabel = digest?.generatedAt
      ? formatEventTimeLabel(digest.generatedAt)
      : '尚未同步';
    const hasDigest = exchangeCount + otcCount > 0;
    const isToggleBusy = isSavingHoldingsRule;

    return (
      <div>
        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            checked={Boolean(holdingsRule.enabled)}
            disabled={isToggleBusy}
            onChange={(event) => handleToggleHoldingsRule(event.target.checked)}
          />
          <div className="min-w-0 text-sm leading-6 text-slate-700">
            <div className="font-semibold text-slate-800">启用持仓当日收益推送</div>
            <div className="mt-1 text-xs text-slate-500">
              仅同步代码与组合权重到云端，不会上传份额、成本或金额。关闭后云端不再推送。
            </div>
          </div>
        </label>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
            <div className="text-xs text-slate-500">场内持仓</div>
            <div className="mt-1 text-base font-semibold text-slate-900">{exchangeCount} 只</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
            <div className="text-xs text-slate-500">场外持仓</div>
            <div className="mt-1 text-base font-semibold text-slate-900">{otcCount} 只</div>
          </div>
        </div>

        <div className="mt-3 text-xs leading-6 text-slate-500">
          <div>快照生成时间：{generatedLabel}</div>
          <div>云端保存时间：{updatedLabel}</div>
          <div>覆盖权重：{(totalWeight * 100).toFixed(2)}%</div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={cx(secondaryButtonClass, isSyncingHoldingsDigest && 'cursor-not-allowed opacity-60')}
            onClick={handleSyncHoldingsDigest}
            disabled={isSyncingHoldingsDigest}
          >
            <RefreshCw className="h-4 w-4" />
            {isSyncingHoldingsDigest ? '正在同步快照' : '立即同步快照'}
          </button>
          <button
            type="button"
            className={cx(secondaryButtonClass, isTestingHoldingsNotify && 'cursor-not-allowed opacity-60')}
            onClick={handleTestHoldingsNotify}
            disabled={isTestingHoldingsNotify}
          >
            <Send className="h-4 w-4" />
            {isTestingHoldingsNotify ? '正在发送测试' : '消息测试'}
          </button>
          {!hasDigest ? (
            <span className="text-xs text-amber-600">
              当前云端未保存持仓快照，点击「立即同步快照」后才会调度推送。
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard accent="indigo" eyebrow="通道状态" value={summary.channelStatus} note={summary.channelNote} />
        <StatCard eyebrow="Server酱³" value={serverChan3Configured ? '已配置' : '未配置'} note="用于跨平台系统通知推送" />
        <StatCard eyebrow="iOS Bark" value={barkConfigured ? '已配置' : '未配置'} note="在 iOS tab 填入 Bark device key" />
      </div>

      <div className="space-y-6">
        {renderConfigCard()}
        {renderStrategyCard()}
        <NotifyHistoryCard
          visibleEvents={visibleEvents}
          eventsLoading={eventsLoading}
          eventsError={eventsError}
          eventsLastSyncedAt={eventsLastSyncedAt}
          refreshNotifyEvents={refreshNotifyEvents}
          formatEventTimeLabel={formatEventTimeLabel}
          resolveEventStatusMeta={resolveEventStatusMeta}
        />
      </div>
    </div>
  );
}
