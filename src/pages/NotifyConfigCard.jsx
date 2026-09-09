import { Bell, ChevronDown, ChevronUp, ExternalLink, Laptop, Loader2, Mail, Save, Send, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { formatEventTimeLabel } from '../app/tradePlansHelpers.js';
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
  handleToggleEmailEnabled,
  handleTestEmailNotify,
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
  notifyWsStatus = 'idle'
}) {
  const platformTabs = Array.isArray(availablePlatforms) && availablePlatforms.length
    ? availablePlatforms
    : [
      ['ios', 'iOS'],
      ['serverchan3', 'Andriod'],
      ['pc', 'PC 浏览器'],
      ['email', 'Email']
    ];
  const pcTabAvailable = platformTabs.some(([key]) => key === 'pc');
  const isServerChan3Configured = Boolean(summary?.serverChan3Configured || serverChan3Configured || notifySetup?.serverChan3?.configured);
  const serverChan3StatusLabel = isServerChan3Configured ? '已配置' : '未配置';
  const hasAnyChannel = Boolean(barkConfigured || isServerChan3Configured || webNotifyEnabled || emailConfigured);
  const hasBarkInput = Boolean(String(notifyConfig.barkDeviceKey || '').trim());
  const hasServerChan3Uid = Boolean(String(notifyConfig.serverChan3Uid || '').trim());
  const hasServerChan3SendKey = Boolean(String(notifyConfig.serverChan3SendKey || '').trim());
  const canUseServerChan3Input = hasServerChan3Uid && (isServerChan3Configured || hasServerChan3SendKey);
  const serverChan3InputEmpty = !isServerChan3Configured && !hasServerChan3Uid && !hasServerChan3SendKey;
  const barkInputEmpty = !barkConfigured && !hasBarkInput;
  const emailVerified = Boolean(emailSetup?.verified);
  const emailEnabled = Boolean(emailSetup?.verified && emailSetup?.enabled);
  const emailMaskedAddress = String(emailSetup?.maskedAddress || '').trim();
  const emailStatusLabel = emailEnabled ? '已验证并开启' : emailVerified ? '已验证，已关闭' : emailMaskedAddress ? '待验证' : '未绑定';
  const emailStatusTone = emailEnabled ? 'emerald' : emailVerified || emailMaskedAddress ? 'amber' : 'slate';
  const normalizedEmailCodeCooldownSeconds = Math.max(0, Math.ceil(Number(emailCodeCooldownSeconds) || 0));
  const emailCodeCooldownActive = normalizedEmailCodeCooldownSeconds > 0;
  const emailCodeCooldownLabel = `${String(Math.floor(normalizedEmailCodeCooldownSeconds / 60)).padStart(2, '0')}:${String(normalizedEmailCodeCooldownSeconds % 60).padStart(2, '0')}`;
  const canSendEmailCode = Boolean(String(emailDraft || '').trim()) && !isSendingEmailCode && !isVerifyingEmail && !emailCodeCooldownActive;
  const canVerifyEmail = Boolean(String(emailDraft || '').trim() && /^\d{6}$/.test(String(emailCode || '').trim())) && !isVerifyingEmail;

  return (
    <Card className="min-w-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
        <button
          type="button"
          aria-label={isConfigCollapsed ? '展开通知接入配置' : '收起通知接入配置'}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          onClick={() => setConfigCollapsed?.((current) => !current)}
        >
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Bell className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">消息推送配置</h2>
              <Pill tone={hasAnyChannel ? 'emerald' : 'slate'}>{hasAnyChannel ? '已接入' : '待配置'}</Pill>
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-500">配置用于接收策略触发、持仓提醒和系统通知。</p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2 self-start lg:self-auto">
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            onClick={() => setConfigCollapsed?.((current) => !current)}
          >
            {isConfigCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            {isConfigCollapsed ? '展开配置' : '收起配置'}
          </button>
        </div>
      </div>

      {!isConfigCollapsed ? (
        <div className="mt-6 space-y-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-slate-100 pb-3" role="tablist" aria-label="通知平台">
            {platformTabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={notifyPlatform === key}
                className={cx(
                  'rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
                  notifyPlatform === key ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                )}
                onClick={() => setNotifyPlatform(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {notifyPlatform === 'ios' ? (
            <div className="space-y-4" role="tabpanel" id="notify-panel">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-indigo-500" />
                <h3 className="text-base font-bold text-slate-900">iOS Bark</h3>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
                <Field label="Bark Device Key">
                  <TextInput
                    value={notifyConfig.barkDeviceKey}
                    placeholder="例如：https://api.day.app/xxxxx"
                    onChange={(event) => setNotifyConfig((current) => ({ ...current, barkDeviceKey: event.target.value }))}
                  />
                </Field>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    className={primaryButtonClass}
                    type="button"
                    onClick={handleSaveNotifyConfig}
                    disabled={isSavingSettings || barkInputEmpty}
                  >
                    {isSavingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isSavingSettings ? '正在保存' : '保存 Bark'}
                  </button>
                  <button
                    className={secondaryButtonClass}
                    type="button"
                    onClick={handleTestBarkNotify}
                    disabled={isSavingSettings || isTestingBarkNotify || barkInputEmpty}
                  >
                    {isTestingBarkNotify ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {isTestingBarkNotify ? '正在发送测试' : '消息推送测试'}
                  </button>
                </div>
                {barkConfigured ? (
                  <div className="mt-3 text-xs text-slate-500">云端已保存 Bark 配置。</div>
                ) : null}
              </div>
            </div>
          ) : notifyPlatform === 'serverchan3' ? (
            <div className="space-y-4" role="tabpanel" id="notify-panel">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-indigo-500" />
                <h3 className="text-base font-bold text-slate-900">Server酱³ Android</h3>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Server酱³ 配置</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">填写 UID 和 SendKey 后保存，用于 Android / 微信渠道提醒。</div>
                  </div>
                  <Pill tone={isServerChan3Configured ? 'emerald' : 'slate'}>{serverChan3StatusLabel}</Pill>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
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
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    className={primaryButtonClass}
                    type="button"
                    onClick={handleSaveServerChan3Config}
                    disabled={isSavingSettings || serverChan3InputEmpty || !hasServerChan3Uid}
                  >
                    {isSavingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isSavingSettings ? '正在保存' : '保存 Server酱³'}
                  </button>
                  <button
                    className={cx(secondaryButtonClass, 'w-full')}
                    type="button"
                    onClick={handleTestServerChan3Notify}
                    disabled={isSavingSettings || isTestingServerChan3Notify || !canUseServerChan3Input}
                    title={canUseServerChan3Input ? undefined : '填写 UID 和 SendKey 后可测试'}
                  >
                    {isTestingServerChan3Notify ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {isTestingServerChan3Notify ? '正在发送测试' : '消息推送测试'}
                  </button>
                </div>
                {notifySetup?.serverChan3?.configured ? (
                  <div className="mt-3 text-xs text-slate-500">
                    云端已保存：{notifySetup.serverChan3.uid} / {notifySetup.serverChan3.sendKeyMasked || '已隐藏'}
                  </div>
                ) : null}
              </div>
            </div>
          ) : notifyPlatform === 'email' ? (
            <div className="space-y-4" role="tabpanel" id="notify-panel">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-indigo-500" />
                <h3 className="text-base font-bold text-slate-900">Email 邮箱提醒</h3>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">邮箱验证码绑定</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">验证码通过后才能接收策略提醒。业务通知只会发送到服务端已验证邮箱。</div>
                  </div>
                  <Pill tone={emailStatusTone}>{emailStatusLabel}</Pill>
                </div>

                {emailMaskedAddress ? (
                  <div className="mt-4 flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    <span>服务端绑定：{emailMaskedAddress}</span>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
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
                    className={cx(
                      secondaryButtonClass,
                      'w-full',
                      emailCodeCooldownActive ? 'disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:opacity-100' : ''
                    )}
                    type="button"
                    onClick={handleSendEmailCode}
                    disabled={!canSendEmailCode}
                  >
                    {isSendingEmailCode ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {isSendingEmailCode
                      ? '正在发送'
                      : emailCodeCooldownActive
                        ? `${emailCodeCooldownLabel} 后可重发`
                        : '发送验证码'}
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
                  <button
                    className={cx(primaryButtonClass, 'w-full')}
                    type="button"
                    onClick={handleVerifyEmail}
                    disabled={!canVerifyEmail}
                  >
                    {isVerifyingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    {isVerifyingEmail ? '正在验证' : '验证并开启'}
                  </button>
                </div>

                {emailVerified ? (
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      className={secondaryButtonClass}
                      type="button"
                      onClick={handleToggleEmailEnabled}
                      disabled={isTogglingEmail}
                    >
                      {isTogglingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {emailEnabled ? '关闭邮件提醒' : '重新开启邮件提醒'}
                    </button>
                    <button
                      className={secondaryButtonClass}
                      type="button"
                      onClick={handleTestEmailNotify}
                      disabled={!emailEnabled || isTestingEmail}
                    >
                      {isTestingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {isTestingEmail ? '正在发送测试' : '发送测试邮件'}
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                  为防止滥发，验证码有发送频率限制；更换邮箱地址后必须重新验证。
                </div>
              </div>
            </div>
          ) : notifyPlatform === 'pc' ? (
            <div className="space-y-4" role="tabpanel" id="notify-panel">
              <h3 className="text-base font-bold text-slate-900">PC 浏览器通知</h3>
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
                <div className="flex items-start gap-3">
                  <Laptop className="mt-1 h-5 w-5 text-indigo-500" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">PC 浏览器桌面通知</div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">浏览器支持</div>
                    <div className="mt-2 text-sm font-semibold text-slate-700">
                      {webNotifySupported ? '✓ 支持' : '× 不支持 Notification API'}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">通知权限</div>
                    <div className="mt-2 text-sm font-semibold text-slate-700">
                      {webNotifyPermission === 'granted'
                        ? '✓ 已授权'
                        : webNotifyPermission === 'denied'
                        ? '× 已拒绝（请到浏览器站点设置中开启）'
                        : '⚠ 未授权'}
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    className={primaryButtonClass}
                    type="button"
                    onClick={handleRequestWebNotifyPermission}
                    disabled={!webNotifySupported || webNotifyPermission === 'granted'}
                  >
                    {webNotifyPermission === 'granted' ? '已授权浏览器通知' : '授权浏览器通知'}
                  </button>
                  <button
                    className={secondaryButtonClass}
                    type="button"
                    onClick={handleSendLocalWebNotifyTest}
                    disabled={!webNotifySupported || webNotifyPermission !== 'granted'}
                  >
                    发送本地测试通知
                  </button>
                  <button
                    className={secondaryButtonClass}
                    type="button"
                    onClick={handleToggleWebNotifyEnabled}
                    disabled={!webNotifySupported || webNotifyPermission !== 'granted'}
                  >
                    {webNotifyEnabled ? '关闭 PC 通知' : '开启 PC 通知'}
                  </button>
                </div>
                {pcPermissionReason ? <div className="mt-3 text-xs text-slate-500">{pcPermissionReason}</div> : null}
                {pcTestDisabledReason ? <div className="mt-2 text-xs text-amber-700">{pcTestDisabledReason}</div> : null}
                <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <div className="flex flex-wrap items-center gap-2">
                    {notifyWsStatus === 'connected' ? <Wifi className="h-4 w-4 text-emerald-500" /> : <WifiOff className="h-4 w-4 text-slate-400" />}
                    <span>WebSocket：{notifyWsStatus === 'connected' ? '已连接' : notifyWsStatus === 'connecting' ? '连接中' : '未连接'}</span>
                  </div>
                  {pairedWebWsDevices.length ? (
                    <div className="mt-2 text-xs text-slate-500">已配对设备：{pairedWebWsDevices.length}</div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {notifyError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{notifyError}</div>
          ) : null}
          {notifyMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notifyMessage}</div>
          ) : null}

          <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <div className="min-w-0">通知配置保存在当前登录账号下。</div>
            <FeatureHelp
              title="消息推送说明"
              content="可分别配置 iOS Bark、Server酱³、Email 和 PC 浏览器通知。建议至少保留一个稳定通道用于策略提醒。"
            />
          </div>
        </div>
      ) : null}
    </Card>
  );
}
