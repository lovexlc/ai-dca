import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, CalendarClock, Save, Trash2 } from 'lucide-react';
import {
  issueNotifyGroupShareCode,
  joinNotifyGroup,
  loadNotifyEvents,
  loadNotifyStatus,
  pairAndroidDevice,
  persistNotifyClientConfig,
  readNotifyClientConfig,
  saveNotifySettings,
  unpairAndroidDevice
} from '../app/notifySync.js';
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

// 通知中心：把原本散落在《交易计划》tab 里的推送通道配置（iOS Bark、Android 配对、
// 共享组生成/加入、设备列表）抽到独立 tab。其他 tab 只通过 readNotifyClientConfig
// 读取已配置好的 clientId 来发送通知，配置入口只在这里。
export function NotifyExperience({ embedded = false }) {
  const [notifyStatus, setNotifyStatus] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
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
      groupMemberCount: notifyGroupMemberCount,
      recentEventCount: recentEvents.length
    };
  }, [barkConfigured, androidConfigured, pairedAndroidDevices.length, notifyGroupMemberCount, recentEvents.length]);

  useEffect(() => {
    let cancelled = false;
    async function refreshNotifyPanel() {
      try {
        const [statusPayload, eventsPayload] = await Promise.all([
          loadNotifyStatus(notifyConfig.notifyClientId),
          loadNotifyEvents()
        ]);
        if (cancelled) return;
        setNotifyStatus(statusPayload);
        setRecentEvents(Array.isArray(eventsPayload?.events) ? eventsPayload.events : []);
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

  async function refreshNotifyData() {
    const [statusPayload, eventsPayload] = await Promise.all([
      loadNotifyStatus(notifyConfig.notifyClientId),
      loadNotifyEvents()
    ]);
    setNotifyStatus(statusPayload);
    setRecentEvents(Array.isArray(eventsPayload?.events) ? eventsPayload.events : []);
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

  function renderConfigCard() {
    return (
      <Card className="min-w-0">
        <SectionHeading
          eyebrow="通知接入"
          title="消息推送配置"
          description="统一管理 iOS Bark、Android 设备配对，以及多浏览器共享通知组。其他 tab 触发通知时复用这里的配置。"
          action={
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
          }
        />
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
      </Card>
    );
  }

  function renderHistoryCard() {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <CalendarClock className="h-4 w-4 text-slate-400" />
          提醒历史
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          展示最近触发的测试通知和规则提醒。每次触发会更新这里，方便核对推送是否到达。
        </p>
        <div className="mt-4 space-y-3">
          {recentEvents.length
            ? recentEvents.slice(0, 6).map((item) => {
                const statusMeta = resolveEventStatusMeta(item.status);
                return (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 text-sm font-semibold text-slate-800">{item.summary || item.title || '提醒记录'}</div>
                      <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">{item.body || item.title || '当前没有更多提醒内容。'}</div>
                    <div className="mt-2 text-xs text-slate-400">{formatEventTimeLabel(item.createdAt)}</div>
                  </div>
                );
              })
            : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
                目前还没有提醒记录。触发测试通知或规则提醒后，这里会展示实际通知内容。
              </div>
            )}
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
            统一管理推送通道与共享组。各 tab 的提醒（如交易计划、定投、加仓计划）都会复用这里配置的 iOS / Android 接入。
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard accent="indigo" eyebrow="通道状态" value={summary.channelStatus} note={summary.channelNote} />
        <StatCard eyebrow="共享组成员" value={`${summary.groupMemberCount || 0} 个浏览器`} note="加入同一共享组的浏览器都会收到提醒" />
        <StatCard eyebrow="已关联 Android" value={`${summary.androidDeviceCount} 台`} note="在 Android tab 添加 / 解绑设备" />
        <StatCard eyebrow="提醒历史" value={`${summary.recentEventCount} 条`} note="最近触发的测试通知和规则提醒" />
      </div>

      <div className="space-y-6 lg:hidden">
        {renderConfigCard()}
        {renderHistoryCard()}
      </div>

      <div className="hidden items-start gap-6 lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.9fr)]">
        <div className="min-w-0 space-y-6">{renderConfigCard()}</div>
        <div className="min-w-0 space-y-6 lg:sticky lg:top-4">{renderHistoryCard()}</div>
      </div>
    </div>
  );
}
