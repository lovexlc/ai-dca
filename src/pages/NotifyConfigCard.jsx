import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Laptop,
  Loader2,
  LogIn,
  Mail,
  MessageCircle,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useEffect } from 'react';
import { FeatureHelp } from '../components/FeatureHelp.jsx';
import {
  Card,
  Field,
  Pill,
  TextInput,
  cx,
  primaryButtonClass,
  secondaryButtonClass
} from '../components/experience-ui.jsx';

const CHANNEL_META = {
  ios: {
    label: 'iOS Bark',
    shortLabel: 'iOS',
    description: '适合 iPhone 的即时推送',
    icon: Smartphone,
    iconClass: 'bg-sky-50 text-sky-600'
  },
  serverchan3: {
    label: 'Server酱³',
    shortLabel: 'Android',
    description: 'Android / 微信消息通道',
    icon: MessageCircle,
    iconClass: 'bg-emerald-50 text-emerald-600'
  },
  email: {
    label: 'Email',
    shortLabel: 'Email',
    description: '验证邮箱后接收提醒',
    icon: Mail,
    iconClass: 'bg-amber-50 text-amber-600'
  },
  pc: {
    label: 'PC 浏览器',
    shortLabel: 'PC',
    description: '当前浏览器桌面通知',
    icon: Laptop,
    iconClass: 'bg-violet-50 text-violet-600'
  }
};

function ChannelPanelHeader({ icon: Icon, title, description, status, tone = 'slate' }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      <Pill tone={tone}>{status}</Pill>
    </div>
  );
}

export function NotifyConfigCard({
  isConfigCollapsed,
  setConfigCollapsed,
  summary,
  barkConfigured,
  serverChan3Configured,
  emailConfigured = false,
  emailSetup = {},
  emailDraft = '',
  setEmailDraft,
  emailCode = '',
  setEmailCode,
  notifyPlatform,
  setNotifyPlatform,
  availablePlatforms,
  notifyError,
  notifyMessage,
  notifyConfig,
  setNotifyConfig,
  pairedWebWsDevices = [],
  notifySetup,
  handleSaveNotifyConfig,
  handleSaveServerChan3Config,
  handleTestBarkNotify,
  handleTestServerChan3Notify,
  handleSendEmailCode,
  handleVerifyEmail,
  handleChangeEmail,
  handleToggleEmailEnabled,
  handleTestEmailNotify,
  isChangingEmail = false,
  isSendingEmailCode = false,
  isVerifyingEmail = false,
  isTogglingEmail = false,
  isTestingEmail = false,
  emailCodeCooldownSeconds = 0,
  isSavingSettings,
  isTestingBarkNotify = false,
  isTestingServerChan3Notify = false,
  webNotifySupported,
  webNotifyPermission,
  webNotifyEnabled,
  pcPermissionReason,
  pcTestDisabledReason,
  handleRequestWebNotifyPermission,
  handleSendLocalWebNotifyTest,
  handleToggleWebNotifyEnabled,
  notifyWsStatus = 'idle',
  isLoggedIn = true,
  onLogin
}) {
  const platformTabs = Array.isArray(availablePlatforms) && availablePlatforms.length
    ? availablePlatforms
    : [
      ['ios', 'iOS'],
      ['serverchan3', 'Android'],
      ['pc', 'PC 浏览器'],
      ['email', 'Email']
    ];
  const isServerChan3Configured = Boolean(summary?.serverChan3Configured || serverChan3Configured || notifySetup?.serverChan3?.configured);
  const hasBarkInput = Boolean(String(notifyConfig.barkDeviceKey || '').trim());
  const hasServerChan3Uid = Boolean(String(notifyConfig.serverChan3Uid || '').trim());
  const hasServerChan3SendKey = Boolean(String(notifyConfig.serverChan3SendKey || '').trim());
  const canUseServerChan3Input = hasServerChan3Uid && (isServerChan3Configured || hasServerChan3SendKey);
  const serverChan3InputEmpty = !isServerChan3Configured && !hasServerChan3Uid && !hasServerChan3SendKey;
  const barkInputEmpty = !barkConfigured && !hasBarkInput;
  const emailVerified = Boolean(emailSetup?.verified);
  const emailEnabled = Boolean(emailSetup?.verified && emailSetup?.enabled);
  const emailMaskedAddress = String(emailSetup?.maskedAddress || '').trim();
  const emailStatusLabel = emailEnabled ? '已连接' : emailVerified ? '已关闭' : emailMaskedAddress ? '待验证' : '待配置';
  const emailStatusTone = emailEnabled ? 'emerald' : emailVerified || emailMaskedAddress ? 'amber' : 'slate';
  const normalizedEmailCodeCooldownSeconds = Math.max(0, Math.ceil(Number(emailCodeCooldownSeconds) || 0));
  const emailCodeCooldownActive = normalizedEmailCodeCooldownSeconds > 0;
  const emailCodeCooldownLabel = `${String(Math.floor(normalizedEmailCodeCooldownSeconds / 60)).padStart(2, '0')}:${String(normalizedEmailCodeCooldownSeconds % 60).padStart(2, '0')}`;
  const canSendEmailCode = Boolean(String(emailDraft || '').trim()) && !isSendingEmailCode && !isVerifyingEmail && !emailCodeCooldownActive;
  const canVerifyEmail = Boolean(String(emailDraft || '').trim() && /^\d{6}$/.test(String(emailCode || '').trim())) && !isVerifyingEmail;
  const showEmailBindingForm = !emailVerified || isChangingEmail;
  const pcConnected = Boolean(webNotifySupported && webNotifyPermission === 'granted' && webNotifyEnabled);

  const channelCards = platformTabs.map(([key]) => {
    const meta = CHANNEL_META[key] || {
      label: key,
      shortLabel: key,
      description: '消息推送通道',
      icon: Bell,
      iconClass: 'bg-slate-100 text-slate-600'
    };
    let connected = false;
    let status = '待配置';
    let statusTone = 'slate';
    if (key === 'ios') {
      connected = Boolean(barkConfigured);
      status = connected ? '已连接' : '待配置';
      statusTone = connected ? 'emerald' : 'slate';
    } else if (key === 'serverchan3') {
      connected = isServerChan3Configured;
      status = connected ? '已连接' : '待配置';
      statusTone = connected ? 'emerald' : 'slate';
    } else if (key === 'email') {
      connected = emailEnabled;
      status = emailStatusLabel;
      statusTone = emailStatusTone;
    } else if (key === 'pc') {
      connected = pcConnected;
      status = !webNotifySupported
        ? '不可用'
        : connected
          ? '已连接'
          : webNotifyPermission === 'granted'
            ? '已关闭'
            : '待授权';
      statusTone = connected ? 'emerald' : webNotifyPermission === 'granted' ? 'amber' : 'slate';
    }
    return { key, ...meta, connected, status, statusTone };
  });
  const connectedChannelCount = channelCards.filter((channel) => channel.connected).length;
  const hasAnyChannel = connectedChannelCount > 0;
  const connectionProgress = channelCards.length ? Math.round((connectedChannelCount / channelCards.length) * 100) : 0;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const section = new URLSearchParams(window.location.search).get('section');
    if (section === 'config') setConfigCollapsed?.(false);
  }, [setConfigCollapsed]);

  function selectChannel(key) {
    setNotifyPlatform(key);
    setConfigCollapsed?.(false);
  }

  return (
    <Card className="min-w-0 overflow-hidden !p-0 sm:!p-0">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-lg font-bold text-slate-950">通知渠道</h2>
          <p className="mt-1 text-sm text-slate-500">选择并管理你希望接收通知的渠道，支持多平台同时接收。</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className={cx('h-2 w-2 rounded-full', hasAnyChannel ? 'bg-emerald-500' : 'bg-slate-300')} />
          <span>{connectedChannelCount} / {channelCards.length} 个渠道已连接</span>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4" role="tablist" aria-label="通知渠道">
        {channelCards.map((channel) => {
          const Icon = channel.icon;
          const selected = notifyPlatform === channel.key;
          return (
            <button
              key={channel.key}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="notify-channel-panel"
              className={cx(
                'group flex min-w-0 items-center gap-3 rounded-xl border px-4 py-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
                selected
                  ? 'border-indigo-300 bg-indigo-50/30 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-indigo-200'
              )}
              onClick={() => selectChannel(channel.key)}
            >
              <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', channel.iconClass)}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{channel.shortLabel}</span>
                  <span className={cx(
                    'h-2 w-2 shrink-0 rounded-full',
                    channel.connected ? 'bg-emerald-500' : channel.statusTone === 'amber' ? 'bg-amber-400' : 'bg-slate-300'
                  )} />
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500">{channel.status}</span>
              </span>
            </button>
          );
        })}
      </div>

      {!isConfigCollapsed ? (
        <div id="notify-channel-panel" role="tabpanel" className="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
          {!isLoggedIn ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <div>
                <div className="font-semibold">登录后才能保存通知渠道</div>
                <div className="mt-0.5 text-xs text-rose-600">登录后配置会归属到账号，并在不同设备间保持一致。</div>
              </div>
              <button
                type="button"
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                onClick={onLogin}
              >
                <LogIn className="h-4 w-4" />
                登录账户
              </button>
            </div>
          ) : null}

          {notifyError ? (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{notifyError}</div>
          ) : null}
          {notifyMessage ? (
            <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{notifyMessage}</span>
            </div>
          ) : null}

          <fieldset disabled={!isLoggedIn} className="min-w-0 disabled:opacity-70">
            {notifyPlatform === 'ios' ? (
              <div className="space-y-5">
                <ChannelPanelHeader
                  icon={Smartphone}
                  title="连接 iOS Bark"
                  description="粘贴 Bark 完整链接或 Device Key，保存后即可接收策略和持仓提醒。"
                  status={barkConfigured ? '已连接' : '待配置'}
                  tone={barkConfigured ? 'emerald' : 'slate'}
                />
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
                  <Field label="Bark Device Key" helper="可直接粘贴 Bark App 提供的完整推送链接。">
                    <TextInput
                      value={notifyConfig.barkDeviceKey}
                      placeholder="例如：https://api.day.app/xxxxx"
                      onChange={(event) => setNotifyConfig((current) => ({ ...current, barkDeviceKey: event.target.value }))}
                    />
                  </Field>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <button className={primaryButtonClass} type="button" onClick={handleSaveNotifyConfig} disabled={isSavingSettings || barkInputEmpty}>
                      {isSavingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {isSavingSettings ? '正在保存' : barkConfigured ? '更新 Bark' : '保存并连接'}
                    </button>
                    <button className={secondaryButtonClass} type="button" onClick={handleTestBarkNotify} disabled={isSavingSettings || isTestingBarkNotify || barkInputEmpty}>
                      {isTestingBarkNotify ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {isTestingBarkNotify ? '正在发送' : '发送测试'}
                    </button>
                  </div>
                </div>
              </div>
            ) : notifyPlatform === 'serverchan3' ? (
              <div className="space-y-5">
                <ChannelPanelHeader
                  icon={MessageCircle}
                  title="连接 Server酱³"
                  description="填写 UID 和 SendKey，用于 Android 客户端与微信渠道提醒。"
                  status={isServerChan3Configured ? '已连接' : '待配置'}
                  tone={isServerChan3Configured ? 'emerald' : 'slate'}
                />
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <Field label="UID">
                      <TextInput
                        value={notifyConfig.serverChan3Uid}
                        placeholder="Server酱³ UID"
                        onChange={(event) => setNotifyConfig((current) => ({ ...current, serverChan3Uid: event.target.value }))}
                      />
                    </Field>
                    <Field label="SendKey">
                      <TextInput
                        value={notifyConfig.serverChan3SendKey}
                        placeholder={isServerChan3Configured ? '已保存，可留空保持不变' : 'Server酱³ SendKey'}
                        onChange={(event) => setNotifyConfig((current) => ({ ...current, serverChan3SendKey: event.target.value }))}
                      />
                    </Field>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <button className={primaryButtonClass} type="button" onClick={handleSaveServerChan3Config} disabled={isSavingSettings || serverChan3InputEmpty || !hasServerChan3Uid}>
                      {isSavingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {isSavingSettings ? '正在保存' : isServerChan3Configured ? '更新配置' : '保存并连接'}
                    </button>
                    <button className={secondaryButtonClass} type="button" onClick={handleTestServerChan3Notify} disabled={isSavingSettings || isTestingServerChan3Notify || !canUseServerChan3Input} title={canUseServerChan3Input ? undefined : '填写 UID 和 SendKey 后可测试'}>
                      {isTestingServerChan3Notify ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {isTestingServerChan3Notify ? '正在发送' : '发送测试'}
                    </button>
                  </div>
                  {notifySetup?.serverChan3?.configured ? (
                    <div className="mt-4 rounded-xl bg-white px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
                      云端已保存：{notifySetup.serverChan3.uid} / {notifySetup.serverChan3.sendKeyMasked || '已隐藏'}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : notifyPlatform === 'email' ? (
              <div className="space-y-5">
                <ChannelPanelHeader
                  icon={Mail}
                  title="连接 Email"
                  description="邮箱验证码通过后，业务通知只会发往服务端已验证地址。"
                  status={emailStatusLabel}
                  tone={emailStatusTone}
                />
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
                  {emailMaskedAddress ? (
                    <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                      <span>当前绑定：{emailMaskedAddress}</span>
                    </div>
                  ) : null}

                  {showEmailBindingForm ? (
                    <div className={emailMaskedAddress ? 'mt-4' : ''}>
                      {isChangingEmail ? (
                        <div className="mb-3 text-xs font-medium text-indigo-600">验证新邮箱后，将自动替换当前绑定地址。</div>
                      ) : null}
                      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                        <Field label="邮箱地址">
                          <TextInput
                            type="email"
                            value={emailDraft}
                            placeholder="name@example.com"
                            autoComplete="email"
                            onChange={(event) => {
                              setEmailDraft?.(event.target.value);
                              setEmailCode?.('');
                            }}
                          />
                        </Field>
                        <button
                          className={cx(secondaryButtonClass, 'w-full', emailCodeCooldownActive ? 'disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100' : '')}
                          type="button"
                          onClick={handleSendEmailCode}
                          disabled={!canSendEmailCode}
                        >
                          {isSendingEmailCode ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          {isSendingEmailCode ? '正在发送' : emailCodeCooldownActive ? `${emailCodeCooldownLabel} 后可重发` : '发送验证码'}
                        </button>
                      </div>
                      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                        <Field label="6 位验证码">
                          <TextInput
                            inputMode="numeric"
                            value={emailCode}
                            placeholder="000000"
                            maxLength={6}
                            autoComplete="one-time-code"
                            onChange={(event) => setEmailCode?.(event.target.value.replace(/\D/g, '').slice(0, 6))}
                          />
                        </Field>
                        <button className={cx(primaryButtonClass, 'w-full')} type="button" onClick={handleVerifyEmail} disabled={!canVerifyEmail}>
                          {isVerifyingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                          {isVerifyingEmail ? '正在验证' : isChangingEmail ? '验证并更换' : '验证并开启'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {emailVerified ? (
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                      <button className={secondaryButtonClass} type="button" onClick={handleChangeEmail} disabled={isChangingEmail || isTogglingEmail || isTestingEmail}>
                        更换邮箱
                      </button>
                      <button className={secondaryButtonClass} type="button" onClick={handleToggleEmailEnabled} disabled={isTogglingEmail}>
                        {isTogglingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {emailEnabled ? '关闭邮件提醒' : '重新开启邮件提醒'}
                      </button>
                      <button className={secondaryButtonClass} type="button" onClick={handleTestEmailNotify} disabled={!emailEnabled || isTestingEmail}>
                        {isTestingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {isTestingEmail ? '正在发送' : '发送测试邮件'}
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                    验证码 10 分钟内有效，并有发送频率限制；更换地址必须重新验证。
                  </div>
                </div>
              </div>
            ) : notifyPlatform === 'pc' ? (
              <div className="space-y-5">
                <ChannelPanelHeader
                  icon={Laptop}
                  title="连接 PC 浏览器"
                  description="授权当前浏览器显示桌面通知，并保持 WebSocket 在线。"
                  status={!webNotifySupported ? '不可用' : pcConnected ? '已连接' : webNotifyPermission === 'granted' ? '已关闭' : '待授权'}
                  tone={pcConnected ? 'emerald' : webNotifyPermission === 'granted' ? 'amber' : 'slate'}
                />
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
                      <div className="text-[11px] font-semibold text-slate-400">浏览器能力</div>
                      <div className="mt-1 text-sm font-semibold text-slate-800">{webNotifySupported ? '支持通知' : '不支持'}</div>
                    </div>
                    <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
                      <div className="text-[11px] font-semibold text-slate-400">系统权限</div>
                      <div className="mt-1 text-sm font-semibold text-slate-800">{webNotifyPermission === 'granted' ? '已授权' : webNotifyPermission === 'denied' ? '已拒绝' : '未授权'}</div>
                    </div>
                    <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
                      <div className="text-[11px] font-semibold text-slate-400">实时连接</div>
                      <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                        {notifyWsStatus === 'connected' ? <Wifi className="h-3.5 w-3.5 text-emerald-500" /> : <WifiOff className="h-3.5 w-3.5 text-slate-400" />}
                        {notifyWsStatus === 'connected' ? '已连接' : notifyWsStatus === 'connecting' ? '连接中' : '未连接'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <button className={primaryButtonClass} type="button" onClick={handleRequestWebNotifyPermission} disabled={!webNotifySupported || webNotifyPermission === 'granted'}>
                      {webNotifyPermission === 'granted' ? '浏览器已授权' : '授权浏览器通知'}
                    </button>
                    <button className={secondaryButtonClass} type="button" onClick={handleToggleWebNotifyEnabled} disabled={!webNotifySupported || webNotifyPermission !== 'granted'}>
                      {webNotifyEnabled ? '关闭 PC 通知' : '开启 PC 通知'}
                    </button>
                    <button className={secondaryButtonClass} type="button" onClick={handleSendLocalWebNotifyTest} disabled={!webNotifySupported || webNotifyPermission !== 'granted'}>
                      <Send className="h-4 w-4" />发送本地测试
                    </button>
                  </div>
                  {pcPermissionReason ? <div className="mt-3 text-xs text-slate-500">{pcPermissionReason}</div> : null}
                  {pcTestDisabledReason ? <div className="mt-2 text-xs text-amber-700">{pcTestDisabledReason}</div> : null}
                  {pairedWebWsDevices.length ? <div className="mt-2 text-xs text-slate-500">当前账号已配对 {pairedWebWsDevices.length} 个 Web 设备。</div> : null}
                </div>
              </div>
            ) : null}
          </fieldset>

          <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <div className="min-w-0">建议至少保留一个稳定渠道；测试成功后再启用业务规则。</div>
            <FeatureHelp
              title="消息推送说明"
              content="可分别配置 iOS Bark、Server酱³、Email 和 PC 浏览器通知。配置属于当前登录账号，切换设备后仍可读取。"
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 px-4 py-3 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50"
          onClick={() => setConfigCollapsed?.(false)}
        >
          <ChevronDown className="h-4 w-4" />
          选择上方渠道继续管理
        </button>
      )}
    </Card>
  );
}
