import { ArrowRight, Bell, ChevronDown, ChevronUp, Laptop, Save, Send, Trash2 } from 'lucide-react';
import { ANDROID_APK_DOWNLOAD_URL, formatEventTimeLabel } from '../app/tradePlansHelpers.js';
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
  androidConfigured,
  notifyPlatform,
  setNotifyPlatform,
  notifyError,
  notifyMessage,
  notifyConfig,
  setNotifyConfig,
  androidPairingCode,
  setAndroidPairingCode,
  isPairingAndroid,
  pairedAndroidDevices,
  androidSetup,
  unpairingRegistrationId,
  handlePairAndroidCode,
  handleUnpairAndroidRegistration,
  handleSaveNotifyConfig,
  handleSaveServerChan3Config,
  isSavingSettings,
  webNotifySupported,
  webNotifyPermission,
  webNotifyEnabled,
  pcPermissionReason,
  pcTestDisabledReason,
  handleRequestWebNotifyPermission,
  handleSendLocalWebNotifyTest,
  handleToggleWebNotifyEnabled
}) {
  const serverChan3Configured = Boolean(summary?.serverChan3Configured || androidSetup?.serverChan3?.configured);
  const androidDeviceCount = Number(summary?.androidDeviceCount ?? pairedAndroidDevices.length + (serverChan3Configured ? 1 : 0));
  const serverChan3StatusLabel = serverChan3Configured ? '已配置' : '未配置';

  return (
    <Card className="min-w-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
        <button
          type="button"
          aria-label={isConfigCollapsed ? '展开通知接入配置' : '收起通知接入配置'}
          aria-expanded={!isConfigCollapsed}
          onClick={() => setConfigCollapsed((prev) => !prev)}
          className="flex w-full min-w-0 items-start gap-3 text-left lg:flex-1"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">通知接入</div>
            <div className="mt-1 text-base font-bold text-slate-900 sm:text-lg">消息推送配置</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">
              {isConfigCollapsed
                ? summary.channelNote
                : '统一管理 iOS Bark、Android Server酱³，以及多浏览器共享通知组。旧版 Android 设备配对入口保留兼容。'}
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
          <div className="flex w-full items-center justify-center gap-1 rounded-2xl bg-slate-100 p-1 lg:inline-flex lg:w-auto lg:justify-start" role="tablist" aria-label="通知平台">
            {[
              ['ios', 'iOS'],
              ['android', 'Android'],
              ['pc', 'PC 浏览器']
            ].map(([key, label]) => (
              <button
                key={key}
                className={cx(
                  'flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-colors lg:flex-none',
                  notifyPlatform === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
                type="button"
                role="tab"
                aria-selected={notifyPlatform === key}
                aria-pressed={notifyPlatform === key}
                aria-controls="notify-panel"
                onClick={() => setNotifyPlatform(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {isConfigCollapsed ? null : (
        <>
          {notifyPlatform === 'android' ? (
            <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
              旧版 Android App 下载地址：
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
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">当前浏览器</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">推送终端身份</div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">浏览器标签</div>
                <div className="mt-2 text-sm font-semibold text-slate-700">{notifyConfig.notifyClientLabel}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Android 推送设备</div>
                <div className="mt-2 text-sm font-semibold text-slate-700">{androidDeviceCount} 台</div>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-slate-950 px-4 py-3 font-mono text-xs text-slate-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">浏览器 uniqId</div>
              <div className="mt-2 break-all">{notifyConfig.notifyClientId}</div>
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
            {notifyPlatform === 'android' ? (
              <div className="space-y-4" role="tabpanel" id="notify-panel">
                <h3 className="text-base font-bold text-slate-900">Android 推送设置</h3>
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">Server酱³ Android 推送</div>
                    <Pill tone={serverChan3Configured ? 'emerald' : 'slate'}>
                      {serverChan3StatusLabel}
                    </Pill>
                  </div>
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
                    <Field label="Server酱³ UID" helper="例如接口域名里的 uid：<uid>.push.ft07.com">
                      <TextInput
                        value={notifyConfig.serverChan3Uid || ''}
                        placeholder="uid"
                        onChange={(event) => setNotifyConfig((current) => ({ ...current, serverChan3Uid: event.target.value }))}
                      />
                    </Field>
                    <Field label="Server酱³ SendKey" helper="保存后仅在本机 localStorage 保留明文，服务端状态只回显掩码。">
                      <TextInput
                        value={notifyConfig.serverChan3SendKey || ''}
                        placeholder="sendkey"
                        onChange={(event) => setNotifyConfig((current) => ({ ...current, serverChan3SendKey: event.target.value }))}
                      />
                    </Field>
                    <div className="flex flex-col gap-1">
                      <button
                        className={primaryButtonClass}
                        type="button"
                        onClick={handleSaveServerChan3Config}
                        disabled={isSavingSettings || !String(notifyConfig.serverChan3Uid || '').trim() || !String(notifyConfig.serverChan3SendKey || '').trim()}
                      >
                        <Save className="h-4 w-4" />
                        {isSavingSettings ? '正在保存' : '保存 Server酱³'}
                      </button>
                    </div>
                  </div>
                  {androidSetup?.serverChan3?.configured ? (
                    <div className="mt-3 text-xs text-slate-500">
                      云端已保存：{androidSetup.serverChan3.uid} / {androidSetup.serverChan3.sendKeyMasked || '已隐藏'}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-5 py-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">旧版 Android App 兼容入口</div>
                    <Pill tone="slate">旧版</Pill>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                    <Field label="Android 设备 ID / 测试 URL" helper="仅用于保留旧 App 设备；粘贴设备 ID 或完整测试 URL 后会自动识别。">
                      <TextInput
                        value={androidPairingCode}
                        placeholder="粘贴完整测试 URL 或 android- 开头 ID"
                        onChange={(event) => setAndroidPairingCode(event.target.value)}
                      />
                    </Field>
                    <div className="flex flex-col gap-1">
                      <button className={secondaryButtonClass} type="button" onClick={handlePairAndroidCode} disabled={isPairingAndroid || !androidPairingCode.trim()}>
                        <Save className="h-4 w-4" />
                        {isPairingAndroid ? '正在绑定旧版设备' : '绑定旧版设备'}
                      </button>
                      {androidPairingCode.trim() ? null : <span className="text-xs text-slate-400">旧 App 链接或 ID 可继续绑定</span>}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">当前 Android 推送设备</div>
                    <Pill tone={androidDeviceCount ? 'emerald' : 'slate'}>
                      {androidDeviceCount ? `${androidDeviceCount} 台可用` : '未配置'}
                    </Pill>
                  </div>
                  {serverChan3Configured ? (
                    <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">Server酱³ Android</div>
                        <Pill tone="emerald">已配置</Pill>
                      </div>
                      <div className="mt-2 text-sm text-slate-500">
                        {androidSetup?.serverChan3?.uid ? `UID: ${androidSetup.serverChan3.uid}` : 'Server酱³ Android 推送通道'}
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                        <div>通道类型: Server酱³</div>
                        <div>SendKey: {androidSetup?.serverChan3?.sendKeyMasked || '已隐藏'}</div>
                      </div>
                    </div>
                  ) : null}
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
                                {unpairingRegistrationId === registration.id ? '正在解绑' : '解绑设备'}
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 text-sm text-slate-500">{registration.packageName || androidSetup?.gcmPackageName || '未记录包名'}</div>
                          <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                            <div>Android uniqId: {registration.deviceInstallationId || registration.id || '--'}</div>
                            <div>Token: {registration.tokenMasked || '--'}</div>
                            <div>绑定时间: {formatEventTimeLabel(registration.updatedAt || registration.createdAt)}</div>
                            <div>最近校验: {formatEventTimeLabel(registration.lastCheckedAt)}</div>
                            <div>配对状态: {registration.pairedToCurrentClient ? '当前浏览器已绑定' : '未绑定'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : serverChan3Configured ? null : (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
                      <div className="text-sm font-semibold text-slate-900">未绑定旧版 Android App 设备</div>
                      <div className="mt-1 text-xs text-slate-400">旧版设备 ID / 测试 URL 入口保留兼容；新配置请使用 Server酱³。</div>
                    </div>
                  )}
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
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        支持 Chrome / Edge / Brave / Arc 等 Chromium 系浏览器。在本浏览器打开此页面时，按 30 秒间隔检查最新事件并弹出桌面通知；浏览器关闭后不工作，如需后台推送请同时启用 iOS Bark 或 Android。
                      </p>
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
                      disabled={!webNotifySupported || webNotifyPermission === 'granted' || webNotifyPermission === 'denied'}
                      title={pcPermissionReason || undefined}
                    >
                      <Bell className="h-4 w-4" />
                      {webNotifyPermission === 'granted' ? '已授权浏览器通知' : '授权浏览器通知'}
                    </button>
                    <button
                      className={secondaryButtonClass}
                      type="button"
                      onClick={handleSendLocalWebNotifyTest}
                      disabled={!webNotifySupported || webNotifyPermission !== 'granted'}
                      title={pcTestDisabledReason || undefined}
                    >
                      <Send className="h-4 w-4" />
                      发送本地测试通知
                    </button>
                  </div>
                  {(pcPermissionReason || pcTestDisabledReason) ? (
                    <div className="mt-3 text-xs text-slate-500">
                      {pcTestDisabledReason || pcPermissionReason}
                    </div>
                  ) : null}
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="min-w-0 pr-2">
                      <div className="text-sm font-semibold text-slate-900">启用前台轮询</div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        开启后，本浏览器每 30 秒检查一次最新事件，命中即弹桌面通知。仅在页面打开时工作。
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleToggleWebNotifyEnabled}
                      disabled={!webNotifySupported || webNotifyPermission !== 'granted'}
                      title={pcTestDisabledReason || undefined}
                      className={cx(
                        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        webNotifyEnabled ? 'bg-emerald-500' : 'bg-slate-300'
                      )}
                      aria-pressed={webNotifyEnabled}
                      aria-label="启用 PC 前台轮询"
                    >
                      <span
                        className={cx(
                          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                          webNotifyEnabled ? 'translate-x-5' : 'translate-x-0.5'
                        )}
                      />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div role="tabpanel" id="notify-panel">
                <h3 className="text-base font-bold text-slate-900">iOS Bark 配置</h3>
                <div className="mt-4 text-sm font-semibold text-slate-900">iOS Bark 链接或 Device Key</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  可以粘贴完整 Bark 链接，例如 https://api.day.app/xxx/推送内容；系统会自动提取 Device Key。
                </p>
                <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                  <Field label="Bark 链接或 Device Key" helper="不用手动截取，复制 Bark 里显示的完整链接也可以。">
                    <TextInput
                      value={notifyConfig.barkDeviceKey}
                      onChange={(event) => setNotifyConfig((current) => ({ ...current, barkDeviceKey: event.target.value }))}
                    />
                  </Field>
                  <div className="flex flex-col gap-1">
                    <button className={primaryButtonClass} type="button" onClick={handleSaveNotifyConfig} disabled={isSavingSettings || !notifyConfig.barkDeviceKey.trim()}>
                      <Save className="h-4 w-4" />
                      {isSavingSettings ? '正在保存 Bark 配置' : '保存 Bark 配置'}
                    </button>
                    {notifyConfig.barkDeviceKey.trim() ? null : <span className="text-xs text-slate-400">粘贴 Bark 链接或 Device Key 后可保存</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
