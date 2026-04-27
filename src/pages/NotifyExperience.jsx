import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, ChevronDown, ChevronUp, History, RefreshCw, Save, Trash2, Wallet } from 'lucide-react';
import {
  issueNotifyGroupShareCode,
  joinNotifyGroup,
  loadNotifyEvents,
  loadNotifyStatus,
  loadHoldingsNotifyRule,
  saveHoldingsNotifyRule,
  pairAndroidDevice,
  persistNotifyClientConfig,
  readNotifyClientConfig,
  saveNotifySettings,
  syncTradePlanRules,
  unpairAndroidDevice
} from '../app/notifySync.js';
import { aggregateByCode, buildHoldingsNotifyDigest, summarizePortfolio } from '../app/holdingsLedgerCore.js';
import { readLedgerState } from '../app/holdingsLedger.js';
import { showActionToast } from '../app/toast.js';
import {
  Card,
  Field,
  Pill,
  SectionHeading,
  StatCard,
  TextInput,
  cx,
  primaryButtonClass,
  secondaryButtonClass
} from '../components/experience-ui.jsx';
import {
  ANDROID_APK_DOWNLOAD_URL,
  formatEventTimeLabel,
  resolveEventStatusMeta
} from '../app/tradePlansHelpers.js';

// 提醒历史中的「测试通知」仅在展示后 30 分钟内保留，超过后从前端过滤。
const TEST_EVENT_TTL_MS = 30 * 60 * 1000;

function isTestEvent(event = {}) {
  const ruleId = String(event?.ruleId || '').toLowerCase();
  const eventType = String(event?.eventType || event?.type || '').toLowerCase();
  if (ruleId === 'test' || ruleId.startsWith('test:') || ruleId.includes('-test')) return true;
  if (eventType.includes('test')) return true;
  return false;
}

// 通知中心：把原本散落在《交易计划》tab 里的推送通道配置（iOS Bark、Android 配对、
// 共享组生成/加入、设备列表）抽到独立 tab。其他 tab 只通过 readNotifyClientConfig
// 读取已配置好的 clientId 来发送通知，配置入口只在这里。
export function NotifyExperience({ embedded = false }) {
  const [notifyStatus, setNotifyStatus] = useState(null);
  const [notifyError, setNotifyError] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isPairingAndroid, setIsPairingAndroid] = useState(false);
  const [unpairingRegistrationId, setUnpairingRegistrationId] = useState('');
  const [isIssuingNotifyGroupShareCode, setIsIssuingNotifyGroupShareCode] = useState(false);
  const [isJoiningNotifyGroup, setIsJoiningNotifyGroup] = useState(false);
  const [notifyPlatform, setNotifyPlatform] = useState('ios');
  const [androidPairingCode, setAndroidPairingCode] = useState('');
  const [notifyGroupShareCode, setNotifyGroupShareCode] = useState('');
  const [notifyGroupShareExpiresAt, setNotifyGroupShareExpiresAt] = useState('');
  const [notifyGroupJoinCode, setNotifyGroupJoinCode] = useState('');
  const [notifyConfig, setNotifyConfig] = useState(() => {
    const persistedConfig = readNotifyClientConfig();
    return {
      barkDeviceKey: persistedConfig.barkDeviceKey || '',
      notifyClientId: persistedConfig.notifyClientId || '',
      notifyClientLabel: persistedConfig.notifyClientLabel || ''
    };
  });
  const [holdingsRule, setHoldingsRule] = useState({ enabled: false, digest: null, updatedAt: '' });
  const [isSavingHoldingsRule, setIsSavingHoldingsRule] = useState(false);
  const [isSyncingHoldingsDigest, setIsSyncingHoldingsDigest] = useState(false);
  // 提醒历史与规则同步：从各 tab 合并到本页，避免交易计划中心重复采点。
  const [notifyEvents, setNotifyEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [eventsLastSyncedAt, setEventsLastSyncedAt] = useState('');
  // 仅用于驱动 30 分钟后重新过滤测试通知的重渲染。
  const [eventsTick, setEventsTick] = useState(0);
  const [isSyncingRules, setIsSyncingRules] = useState(false);
  const [rulesLastSyncedAt, setRulesLastSyncedAt] = useState('');
  // 「消息推送配置」默认在检测到已配置（iOS Bark 或 Android 任意一项）后自动收起，
  // 点击卡片头部可手动展开。null 表示尚未从远端收到 status，默认保持展开。
  const [configCollapsed, setConfigCollapsed] = useState(null);

  function buildLatestHoldingsDigest() {
    try {
      const ledger = readLedgerState();
      const aggregates = aggregateByCode(ledger?.transactions || [], ledger?.snapshotsByCode || {});
      const summary = summarizePortfolio(aggregates);
      return buildHoldingsNotifyDigest({ aggregates, summary });
    } catch (_error) {
      return null;
    }
  }

  const androidSetup = notifyStatus?.setup || null;
  const pairedAndroidDevices = Array.isArray(androidSetup?.gcmCurrentClientRegistrations)
    ? androidSetup.gcmCurrentClientRegistrations
    : [];
  const notifyGroupId = String(androidSetup?.notifyGroupId || notifyConfig.notifyClientId || '').trim();
  const notifyGroupMemberCount = Math.max(
    Number(androidSetup?.notifyGroupMemberCount) || 0,
    notifyGroupId ? 1 : 0
  );
  const barkConfigured = Boolean(notifyStatus?.configured?.bark);
  const androidConfigured = pairedAndroidDevices.length > 0;
  const shouldShowAndroidOnboarding = pairedAndroidDevices.length === 0;

  const summary = useMemo(() => {
    const channelLabels = [];
    if (barkConfigured) channelLabels.push('iOS Bark');
    if (androidConfigured) channelLabels.push('Android');
    return {
      channelStatus: channelLabels.length ? '已配置' : '未配置',
      channelNote: channelLabels.length
        ? `${channelLabels.join(' / ')} 可发送`
        : '请先配置 iOS Bark 或绑定 Android 设备',
      androidDeviceCount: pairedAndroidDevices.length,
      groupMemberCount: notifyGroupMemberCount
    };
  }, [barkConfigured, androidConfigured, pairedAndroidDevices.length, notifyGroupMemberCount]);

  useEffect(() => {
    let cancelled = false;
    async function refreshNotifyPanel() {
      try {
        const statusPayload = await loadNotifyStatus(notifyConfig.notifyClientId);
        if (cancelled) return;
        setNotifyStatus(statusPayload);
        setNotifyConfig((current) => ({
          ...current,
          barkDeviceKey: current.barkDeviceKey || statusPayload?.setup?.barkDeviceKey || ''
        }));
        setNotifyError('');
      } catch (error) {
        if (cancelled) return;
        setNotifyError(error instanceof Error ? error.message : '通知服务暂时不可用');
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
      } catch (_error) {
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
    setConfigCollapsed(barkConfigured || androidConfigured);
  }, [notifyStatus, barkConfigured, androidConfigured, configCollapsed]);
  const isConfigCollapsed = configCollapsed === true;

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
        setEventsError(error instanceof Error ? error.message : '提醒历史加载失败');
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
  const visibleEvents = useMemo(() => {
    const now = Date.now();
    return notifyEvents.filter((event) => {
      if (!isTestEvent(event)) return true;
      const createdAt = Date.parse(String(event?.createdAt || ''));
      if (!Number.isFinite(createdAt)) return false;
      return now - createdAt <= TEST_EVENT_TTL_MS;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifyEvents, eventsTick]);

  async function refreshNotifyEvents() {
    setEventsLoading(true);
    setEventsError('');
    try {
      const payload = await loadNotifyEvents(notifyConfig.notifyClientId);
      const list = Array.isArray(payload?.events) ? payload.events : [];
      setNotifyEvents(list);
      setEventsLastSyncedAt(new Date().toISOString());
    } catch (error) {
      setEventsError(error instanceof Error ? error.message : '提醒历史加载失败');
    } finally {
      setEventsLoading(false);
    }
  }

  async function refreshNotifyData() {
    const statusPayload = await loadNotifyStatus(notifyConfig.notifyClientId);
    setNotifyStatus(statusPayload);
    setNotifyConfig((current) => ({
      ...current,
      barkDeviceKey: current.barkDeviceKey || statusPayload?.setup?.barkDeviceKey || ''
    }));
    setNotifyError('');
  }

  async function handleSaveNotifyConfig() {
    setIsSavingSettings(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await saveNotifySettings({ barkDeviceKey: notifyConfig.barkDeviceKey });
      persistNotifyClientConfig({ barkDeviceKey: notifyConfig.barkDeviceKey });
      await refreshNotifyData();
      setNotifyMessage('Bark 配置已保存。');
      showActionToast('保存 Bark 配置', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '通知配置保存失败';
      setNotifyError(message);
      showActionToast('保存 Bark 配置', 'error', { description: message });
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handlePairAndroidCode() {
    setIsPairingAndroid(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await pairAndroidDevice({
        pairingCode: androidPairingCode,
        clientId: notifyConfig.notifyClientId,
        clientName: notifyConfig.notifyClientLabel
      });
      persistNotifyClientConfig({
        notifyClientId: notifyConfig.notifyClientId,
        notifyClientLabel: notifyConfig.notifyClientLabel
      });
      setAndroidPairingCode('');
      await refreshNotifyData();
      setNotifyMessage('Android 设备已绑定到当前共享组。');
      showActionToast('绑定 Android 设备', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Android 设备绑定失败';
      setNotifyError(message);
      showActionToast('绑定 Android 设备', 'error', { description: message });
    } finally {
      setIsPairingAndroid(false);
    }
  }

  async function handleUnpairAndroidRegistration(registrationId = '') {
    if (!registrationId) return;
    setUnpairingRegistrationId(registrationId);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await unpairAndroidDevice({
        registrationId,
        clientId: notifyConfig.notifyClientId
      });
      await refreshNotifyData();
      setNotifyMessage('Android 设备已从当前共享组解绑，组内浏览器都会停止共享这台设备。');
      showActionToast('解绑共享组 Android', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Android 设备解绑失败';
      setNotifyError(message);
      showActionToast('解绑共享组 Android', 'error', { description: message });
    } finally {
      setUnpairingRegistrationId('');
    }
  }

  async function handleIssueNotifyGroupShareCode() {
    setIsIssuingNotifyGroupShareCode(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      const payload = await issueNotifyGroupShareCode({
        clientId: notifyConfig.notifyClientId,
        clientLabel: notifyConfig.notifyClientLabel
      });
      setNotifyGroupShareCode(String(payload?.shareGroup?.code || '').trim());
      setNotifyGroupShareExpiresAt(String(payload?.shareGroup?.expiresAt || '').trim());
      await refreshNotifyData();
      setNotifyMessage('通知共享码已生成，可在其他浏览器加入当前共享组。');
      showActionToast('生成通知共享码', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成通知共享码失败';
      setNotifyError(message);
      showActionToast('生成通知共享码', 'error', { description: message });
    } finally {
      setIsIssuingNotifyGroupShareCode(false);
    }
  }

  async function handleJoinNotifyGroup() {
    setIsJoiningNotifyGroup(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await joinNotifyGroup({
        shareCode: notifyGroupJoinCode,
        clientId: notifyConfig.notifyClientId,
        clientLabel: notifyConfig.notifyClientLabel
      });
      setNotifyGroupJoinCode('');
      setNotifyGroupShareCode('');
      setNotifyGroupShareExpiresAt('');
      await refreshNotifyData();
      setNotifyMessage('当前浏览器已加入通知共享组，可直接复用同组 Android 设备。');
      showActionToast('加入通知共享组', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '加入通知共享组失败';
      setNotifyError(message);
      showActionToast('加入通知共享组', 'error', { description: message });
    } finally {
      setIsJoiningNotifyGroup(false);
    }
  }

  async function handleToggleHoldingsRule(nextEnabled) {
    setIsSavingHoldingsRule(true);
    setNotifyError('');
    setNotifyMessage('');
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
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存持仓通知规则失败';
      setNotifyError(message);
      showActionToast('保存持仓提醒', 'error', { description: message });
    } finally {
      setIsSavingHoldingsRule(false);
    }
  }

  async function handleSyncHoldingsDigest() {
    setIsSyncingHoldingsDigest(true);
    setNotifyError('');
    setNotifyMessage('');
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
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步持仓快照失败';
      setNotifyError(message);
      showActionToast('同步持仓快照', 'error', { description: message });
    } finally {
      setIsSyncingHoldingsDigest(false);
    }
  }

  async function handleSyncRules() {
    setIsSyncingRules(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await syncTradePlanRules();
      setRulesLastSyncedAt(new Date().toISOString());
      setNotifyMessage('交易计划与定投规则已同步到云端。');
      showActionToast('同步通知规则', 'success');
      // 同步后遵便重新拉取一次提醒历史，避免进页后才发现有新记录。
      await refreshNotifyEvents();
    } catch (error) {
      const message = error instanceof Error ? error.message : '通知规则同步失败';
      setNotifyError(message);
      showActionToast('同步通知规则', 'error', { description: message });
    } finally {
      setIsSyncingRules(false);
    }
  }

  function renderConfigCard() {
    return (
      <Card className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => setConfigCollapsed((prev) => !prev)}
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">通知接入</div>
              <div className="mt-1 text-base font-bold text-slate-900 sm:text-lg">消息推送配置</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                {isConfigCollapsed
                  ? summary.channelNote
                  : '统一管理 iOS Bark、Android 设备配对，以及多浏览器共享通知组。其他 tab 触发通知时复用这里的配置。'}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-1">
              <Pill tone={(barkConfigured || androidConfigured) ? 'emerald' : 'slate'}>
                {summary.channelStatus}
              </Pill>
              {isConfigCollapsed
                ? <ChevronDown className="h-5 w-5 text-slate-400" />
                : <ChevronUp className="h-5 w-5 text-slate-400" />}
            </div>
          </button>
          {isConfigCollapsed ? null : (
            <div className="inline-flex items-center gap-1 rounded-2xl bg-slate-100 p-1">
              <button
                className={cx(
                  'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                  notifyPlatform === 'ios' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
                type="button"
                onClick={() => setNotifyPlatform('ios')}
              >
                iOS
              </button>
              <button
                className={cx(
                  'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                  notifyPlatform === 'android' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
                type="button"
                onClick={() => setNotifyPlatform('android')}
              >
                Android
              </button>
            </div>
          )}
        </div>
        {isConfigCollapsed ? null : (
        <>
        {notifyPlatform === 'android' ? (
          <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
            APK 下载地址：
            <a
              className="ml-1 inline-flex items-center gap-1 font-semibold underline underline-offset-4"
              href={ANDROID_APK_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
            >
              {ANDROID_APK_DOWNLOAD_URL}
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        ) : null}
        {notifyError ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {notifyError}
          </div>
        ) : null}
        {notifyMessage ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notifyMessage}
          </div>
        ) : null}
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
          {notifyPlatform === 'android' ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
                <div className="text-sm font-semibold text-slate-900">当前浏览器与通知共享组</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">浏览器标签</div>
                    <div className="mt-2 text-sm font-semibold text-slate-700">{notifyConfig.notifyClientLabel}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">共享组成员</div>
                    <div className="mt-2 text-sm font-semibold text-slate-700">{notifyGroupMemberCount || '--'} 个浏览器</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">已关联设备</div>
                    <div className="mt-2 text-sm font-semibold text-slate-700">{pairedAndroidDevices.length} 台</div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-950 px-4 py-3 font-mono text-xs text-slate-100">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">浏览器 uniqId</div>
                    <div className="mt-2">{notifyConfig.notifyClientId}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-950 px-4 py-3 font-mono text-xs text-slate-100">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">通知共享组 ID</div>
                    <div className="mt-2">{notifyGroupId || '--'}</div>
                  </div>
                </div>
                {shouldShowAndroidOnboarding ? (
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                    <Field label="加入通知共享组">
                      <TextInput
                        value={notifyGroupJoinCode}
                        placeholder="输入另一台浏览器生成的 8 位共享码"
                        onChange={(event) => setNotifyGroupJoinCode(String(event.target.value || '').replace(/\s+/g, '').toUpperCase())}
                      />
                    </Field>
                    <button className={primaryButtonClass} type="button" onClick={handleJoinNotifyGroup}>
                      <Save className="h-4 w-4" />
                      {isJoiningNotifyGroup ? '正在加入共享组' : '加入共享组'}
                    </button>
                  </div>
                ) : null}
                <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">通知共享码</div>
                      <div className="mt-2 font-mono text-lg font-semibold text-slate-900">{notifyGroupShareCode || '--------'}</div>
                      <div className="mt-2 text-xs text-slate-500">
                        {notifyGroupShareExpiresAt ? `有效期至 ${formatEventTimeLabel(notifyGroupShareExpiresAt)}` : '生成后可在其他浏览器加入当前共享组'}
                      </div>
                    </div>
                    <button className={secondaryButtonClass} type="button" onClick={handleIssueNotifyGroupShareCode}>
                      {isIssuingNotifyGroupShareCode ? '正在生成共享码' : '生成共享码'}
                    </button>
                  </div>
                </div>
              </div>

              {shouldShowAndroidOnboarding ? (
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                  <Field label="Android 配对码">
                    <TextInput
                      value={androidPairingCode}
                      placeholder="在 Android app 中查看 8 位配对码"
                      onChange={(event) => setAndroidPairingCode(String(event.target.value || '').replace(/\s+/g, '').toUpperCase())}
                    />
                  </Field>
                  <button className={primaryButtonClass} type="button" onClick={handlePairAndroidCode}>
                    <Save className="h-4 w-4" />
                    {isPairingAndroid ? '正在绑定 Android 设备' : '绑定 Android 设备'}
                  </button>
                </div>
              ) : null}

              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">当前共享组已关联的 Android 设备</div>
                  <Pill tone={pairedAndroidDevices.length ? 'emerald' : 'slate'}>
                    {pairedAndroidDevices.length ? `${pairedAndroidDevices.length} 台已关联` : '未关联'}
                  </Pill>
                </div>
                {pairedAndroidDevices.length ? (
                  <div className="mt-4 space-y-3">
                    {pairedAndroidDevices.map((registration) => (
                      <div key={registration.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-900">{registration.deviceName || 'Android Device'}</div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Pill tone={registration.lastCheckStatus === 'validated' ? 'emerald' : 'slate'}>
                              {registration.lastCheckStatus === 'validated' ? 'FCM 已校验' : registration.lastCheckStatus || '待校验'}
                            </Pill>
                            <button
                              className={cx(
                                secondaryButtonClass,
                                'border-rose-200 bg-white px-3 text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60'
                              )}
                              type="button"
                              disabled={unpairingRegistrationId === registration.id}
                              onClick={() => handleUnpairAndroidRegistration(registration.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                              {unpairingRegistrationId === registration.id ? '正在解绑' : '解绑共享组'}
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-slate-500">{registration.packageName || androidSetup?.gcmPackageName || '未记录包名'}</div>
                        <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                          <div>Android uniqId: {registration.deviceInstallationId || registration.id || '--'}</div>
                          <div>Token: {registration.tokenMasked || '--'}</div>
                          <div>绑定时间: {formatEventTimeLabel(registration.updatedAt || registration.createdAt)}</div>
                          <div>最近校验: {formatEventTimeLabel(registration.lastCheckedAt)}</div>
                          <div>配对状态: {registration.pairedToCurrentClient ? '当前共享组已绑定' : '未绑定'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-slate-500">
                    当前共享组还没有关联 Android 设备。先打开 Android app，拿到配对码，再回到这里完成绑定。
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="text-sm font-semibold text-slate-900">iOS Bark Key</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                当前仅保留 iOS 的 Bark 推送接入。填入设备 Key 后，可继续用于测试通知和规则提醒。
              </p>
              <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                <Field label="Bark 设备 Key">
                  <TextInput
                    value={notifyConfig.barkDeviceKey}
                    onChange={(event) => setNotifyConfig((current) => ({ ...current, barkDeviceKey: event.target.value }))}
                  />
                </Field>
                <button className={primaryButtonClass} type="button" onClick={handleSaveNotifyConfig}>
                  <Save className="h-4 w-4" />
                  {isSavingSettings ? '正在保存 Bark 配置' : '保存 Bark 配置'}
                </button>
              </div>
            </>
          )}
        </div>
        </>
        )}
      </Card>
    );
  }

  function renderHoldingsRuleCard() {
    return _renderHoldingsRuleCardImpl();
  }

  function renderSyncRulesCard() {
    const lastSyncedLabel = rulesLastSyncedAt
      ? formatEventTimeLabel(rulesLastSyncedAt)
      : '本次会话尚未同步';
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">规则同步</div>
            <div className="mt-1 text-base font-bold text-slate-900 sm:text-lg">提醒规则同步</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
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
      </Card>
    );
  }

  function renderHistoryCard() {
    const eventsLastSyncedLabel = eventsLastSyncedAt
      ? formatEventTimeLabel(eventsLastSyncedAt)
      : '尚未拉取';
    const showEmpty = !eventsLoading && !eventsError && visibleEvents.length === 0;
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              <History className="h-3.5 w-3.5 text-slate-400" />
              提醒历史
            </div>
            <div className="mt-1 text-base font-bold text-slate-900 sm:text-lg">最近推送记录</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              集中展示交易计划与定投提醒的推送记录。测试通知仅保留 30 分钟，超过后从列表中自动移除。
            </p>
            <p className="mt-1 text-xs text-slate-400">上次拉取：{eventsLastSyncedLabel}</p>
          </div>
          <button
            type="button"
            className={cx(secondaryButtonClass, eventsLoading && 'cursor-not-allowed opacity-60')}
            onClick={refreshNotifyEvents}
            disabled={eventsLoading}
          >
            <RefreshCw className="h-4 w-4" />
            {eventsLoading ? '正在加载' : '刷新历史'}
          </button>
        </div>
        {eventsError ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {eventsError}
          </div>
        ) : null}
        {showEmpty ? (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            暂无推送记录。发出测试通知或等待交易计划规则触发后可在此查看。
          </p>
        ) : null}
        {visibleEvents.length ? (
          <ul className="mt-4 space-y-2">
            {visibleEvents.map((event, index) => {
              const statusKey = String(event?.status || '').trim();
              const meta = resolveEventStatusMeta
                ? resolveEventStatusMeta(statusKey)
                : { tone: statusKey === 'delivered' ? 'emerald' : 'rose', label: statusKey || '未知' };
              const timeLabel = formatEventTimeLabel(event?.createdAt);
              const title = String(event?.title || event?.summary || event?.eventType || '未命名事件');
              const summary = String(event?.summary || event?.body || '');
              const ruleId = String(event?.ruleId || '').trim();
              const key = `${event?.id || ''}-${event?.createdAt || ''}-${index}`;
              return (
                <li key={key} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 text-sm font-semibold text-slate-800">{title}</div>
                    <div className="flex items-center gap-2">
                      <Pill tone={meta?.tone || 'slate'}>{meta?.label || event?.status || '未知'}</Pill>
                      <span className="text-xs text-slate-400">{timeLabel}</span>
                    </div>
                  </div>
                  {summary ? (
                    <p className="mt-1 text-xs leading-5 text-slate-500">{summary}</p>
                  ) : null}
                  {ruleId ? (
                    <p className="mt-1 text-[11px] text-slate-400">规则标识：{ruleId}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>
    );
  }

  function _renderHoldingsRuleCardImpl() {
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
      <Card>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Wallet className="h-4 w-4 text-emerald-500" />
          持仓当日收益提醒
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          北京时间 15:30 推送场内当日收益；20:30 推送场外，未成功时 21:30 兜底；同日内只发一次。
        </p>

        <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
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
          {!hasDigest ? (
            <span className="text-xs text-amber-600">
              当前云端未保存持仓快照，点击「立即同步快照」后才会调度推送。
            </span>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Notifications</div>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
            <Bell className="h-6 w-6 text-indigo-500" />
            通知设置
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            统一管理推送通道、共享组、提醒历史与持仓提醒规则。各 tab 的提醒（交易计划、定投、加仓计划等）都会复用这里配置的 iOS / Android 接入，并在本页查看推送记录。
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard accent="indigo" eyebrow="通道状态" value={summary.channelStatus} note={summary.channelNote} />
        <StatCard eyebrow="共享组成员" value={`${summary.groupMemberCount || 0} 个浏览器`} note="加入同一共享组的浏览器都会收到提醒" />
        <StatCard eyebrow="已关联 Android" value={`${summary.androidDeviceCount} 台`} note="在 Android tab 添加 / 解绑设备" />
      </div>

      <div className="space-y-6">
        {renderConfigCard()}
        {renderSyncRulesCard()}
        {renderHistoryCard()}
        {renderHoldingsRuleCard()}
      </div>
    </div>
  );
}
