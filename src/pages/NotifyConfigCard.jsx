import { Bell, ChevronDown, ChevronUp, ExternalLink, Laptop, Loader2, Save, Send, Wifi, WifiOff } from 'lucide-react';
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
      ['pc', 'PC 浏览器']
    ];
  const pcTabAvailable = platformTabs.some(([key]) => key === 'pc');
  const isServerChan3Configured = Boolean(summary?.serverChan3Configured || serverChan3Configured || notifySetup?.serverChan3?.configured);
  const serverChan3StatusLabel = isServerChan3Configured ? '已配置' : '未配置';
  const hasAnyChannel = Boolean(barkConfigured || isServerChan3Configured || webNotifyEnabled);
  const hasBarkInput = Boolean(String(notifyConfig.barkDeviceKey || '').trim());
  const hasServerChan3Uid = Boolean(String(notifyConfig.serverChan3Uid || '').trim());
  const hasServerChan3SendKey = Boolean(String(notifyConfig.serverChan3SendKey || '').trim());
  const canUseServerChan3Input = hasServerChan3Uid && (isServerChan3Configured || hasServerChan3SendKey);
  const serverChan3InputEmpty = !isServerChan3Configured && !hasServerChan3Uid && !hasServerChan3SendKey;
  const barkInputEmpty = !barkConfigured && !hasBarkInput;

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
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <Pill tone={hasAnyChannel ? 'emerald' : 'slate'}>
              {summary.channelStatus}
            </Pill>
            {isConfigCollapsed
              ? <ChevronDown className="h-5 w-5 text-slate-400" />
              : <ChevronUp className="h-5 w-5 text-slate-400" />}
          </div>
        </button>
        {isConfigCollapsed ? null : (
          <div className="flex w-full items-center justify-center gap-1 rounded-2xl bg-slate-100 p-1 lg:inline-flex lg:w-auto lg:justify-start" role="tablist" aria-label="通知平台">
            {platformTabs.map(([key, label]) => (
              <button
                key={key}
                className={cx(
                  'flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-colors lg:flex-none',
                  notifyPlatform === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
                type="button"
                role="tab"
                aria-selected={notifyPlatform === key}
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
              {pcTabAvailable ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">PC 实时通道</div>
                  <div className="mt-2 text-sm font-semibold text-slate-700">{pairedWebWsDevices.length} 个</div>
                </div>
              ) : null}
            </div>
            <div className="mt-4 rounded-2xl bg-slate-950 px-4 py-3 font-mono text-xs text-slate-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">浏览器 uniqId</div>
              <div className="mt-2 break-all">{notifyConfig.notifyClientId}</div>
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
            {notifyPlatform === 'serverchan3' ? (
              <div className="space-y-4" role="tabpanel" id="notify-panel">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-base font-bold text-slate-900">Server酱³ 推送设置</h3>
                  <FeatureHelp
                    topic="android-notify"
                    hintText="还没填？点这里看怎么获取 UID / SendKey"
                    hintActive={serverChan3InputEmpty}
                  />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Server酱³ 系统通知</div>
                    </div>
                    <Pill tone={isServerChan3Configured ? 'emerald' : hasServerChan3Uid ? 'amber' : 'slate'}>
                      {serverChan3StatusLabel}
                    </Pill>
                  </div>
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                    安卓端使用 Server酱³ 时，先打开客户端下载地址安装客户端，再进入安卓配置设置地址获取 SendKey。
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <a
                      className="flex min-h-20 items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50"
                      href="https://sc3.ft07.com/client"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">安卓客户端下载地址</span>
                        <span className="mt-2 block break-all text-sm font-semibold text-slate-700">https://sc3.ft07.com/client</span>
                      </span>
                      <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                    </a>
                    <a
                      className="flex min-h-20 items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50"
                      href="https://sc3.ft07.com/sendkey"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">安卓配置设置地址</span>
                        <span className="mt-2 block break-all text-sm font-semibold text-slate-700">https://sc3.ft07.com/sendkey</span>
                      </span>
                      <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                    </a>
                  </div>
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                    Server酱³ 属于第三方通知服务，目前无需付费；请仔细甄别来源，不要随意泄漏 UID 或 SendKey。
                  </div>
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
                    <Field label="Server酱³ UID">
                      <TextInput
                        value={notifyConfig.serverChan3Uid || ''}
                        placeholder="uid"
                        onChange={(event) => setNotifyConfig((current) => ({ ...current, serverChan3Uid: event.target.value }))}
                      />
                    </Field>
                    <Field label="Server酱³ SendKey">
                      <TextInput
                        type="password"
                        value={notifyConfig.serverChan3SendKey || ''}
                        placeholder="粘贴 SendKey"
                        autoComplete="off"
                        onChange={(event) => setNotifyConfig((current) => ({ ...current, serverChan3SendKey: event.target.value }))}
                      />
                    </Field>
                    <div className="flex flex-col gap-1">
                      <button
                        className={cx(primaryButtonClass, 'w-full')}
                        type="button"
                        onClick={handleSaveServerChan3Config}
                        disabled={isSavingSettings || !canUseServerChan3Input}
                      >
                        <Save className="h-4 w-4" />
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
                  </div>
                  {notifySetup?.serverChan3?.configured ? (
                    <div className="mt-3 text-xs text-slate-500">
                      云端已保存：{notifySetup.serverChan3.uid} / {notifySetup.serverChan3.sendKeyMasked || '已隐藏'}
                    </div>
                  ) : null}
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
                      <div className="text-sm font-semibold text-slate-900">实时推送通道</div>
                      <div className="mt-0.5 text-xs text-slate-500">通过 WebSocket 长连接接收通知，无需轮询</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {notifyWsStatus === 'connected' ? (
                        <>
                          <Wifi className="h-4 w-4 text-emerald-500" />
                          <span className="text-xs font-semibold text-emerald-600">已连接</span>
                        </>
                      ) : notifyWsStatus === 'connecting' || notifyWsStatus === 'reconnecting' ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                          <span className="text-xs font-semibold text-amber-600">连接中</span>
                        </>
                      ) : notifyWsStatus === 'fallback' ? (
                        <>
                          <WifiOff className="h-4 w-4 text-slate-400" />
                          <span className="text-xs font-semibold text-slate-500">轮询模式</span>
                        </>
                      ) : (
                        <>
                          <WifiOff className="h-4 w-4 text-slate-300" />
                          <span className="text-xs font-semibold text-slate-400">未启用</span>
                        </>
                      )}
                    </div>
                  </div>
                  {pairedWebWsDevices.length ? (
                    <div className="mt-3 space-y-3">
                      {pairedWebWsDevices.map((registration) => (
                        <div key={registration.id} className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-slate-900">{registration.deviceName || 'WebSocket 浏览器通道'}</div>
                            <Pill tone="emerald">WebSocket 已绑定</Pill>
                          </div>
                          <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                            <div>通道 ID: {registration.deviceInstallationId || registration.id || '--'}</div>
                            <div>Token: {registration.tokenMasked || '--'}</div>
                            <div>绑定时间: {formatEventTimeLabel(registration.updatedAt || registration.createdAt)}</div>
                            <div>配对状态: {registration.pairedToCurrentClient ? '当前浏览器已绑定' : '未绑定'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="min-w-0 pr-2">
                      <div className="text-sm font-semibold text-slate-900">启用通知推送</div>
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
                      aria-label="启用 PC 通知推送"
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
                <div className="flex items-center gap-1.5">
                  <h3 className="text-base font-bold text-slate-900">iOS Bark 配置</h3>
                  <FeatureHelp
                    topic="ios-notify"
                    hintText="未填写通知链接，点击查看介绍"
                    hintActive={barkInputEmpty}
                    hintDelayMs={0}
                  />
                </div>
                <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                  <Field label="Bark 链接或 Device Key">
                    <TextInput
                      value={notifyConfig.barkDeviceKey}
                      onChange={(event) => setNotifyConfig((current) => ({ ...current, barkDeviceKey: event.target.value }))}
                    />
                  </Field>
                  <div className="flex flex-col gap-1">
                    <button className={cx(primaryButtonClass, 'w-full')} type="button" onClick={handleSaveNotifyConfig} disabled={isSavingSettings || !hasBarkInput}>
                      <Save className="h-4 w-4" />
                      {isSavingSettings ? '正在保存 Bark 配置' : '保存 Bark 配置'}
                    </button>
                    <button
                      className={cx(secondaryButtonClass, 'w-full')}
                      type="button"
                      onClick={handleTestBarkNotify}
                      disabled={isSavingSettings || isTestingBarkNotify || !hasBarkInput}
                      title={hasBarkInput ? undefined : '粘贴 Bark 链接或 Device Key 后可测试'}
                    >
                      {isTestingBarkNotify ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {isTestingBarkNotify ? '正在发送测试' : '消息推送测试'}
                    </button>
                    {hasBarkInput ? null : <span className="text-xs text-slate-400">粘贴 Bark 链接或 Device Key 后可保存和测试</span>}
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
