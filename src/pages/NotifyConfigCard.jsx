import {
  Bell,
  CheckCircle2,
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
import { useEffect, useState } from 'react';
import { FeatureHelp } from '../components/FeatureHelp.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog.jsx';
import { Field, TextInput, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

const CHANNEL_META = {
  ios: { label: 'iOS', dialogTitle: '管理 iOS Bark', description: '通过系统推送接收通知', icon: Smartphone, iconClass: 'bg-slate-50 text-slate-900' },
  serverchan3: { label: 'Android', dialogTitle: '管理 Android 通知', description: '通过系统推送接收通知', icon: MessageCircle, iconClass: 'bg-emerald-50 text-emerald-600' },
  pc: { label: 'PC', dialogTitle: '管理 PC 浏览器通知', description: '通过浏览器推送通知', icon: Laptop, iconClass: 'bg-indigo-50 text-indigo-600' },
  email: { label: 'Email', dialogTitle: '管理 Email 通知', description: '通过邮箱接收通知（支持 QQ、163、Gmail 等）', icon: Mail, iconClass: 'bg-amber-50 text-amber-600' }
};

function StatusDot({ connected, warning = false }) {
  return <span className={cx('h-2 w-2 rounded-full', connected ? 'bg-emerald-500' : warning ? 'bg-amber-400' : 'bg-slate-300')} />;
}

function PanelTitle({ icon: Icon, title, description, connected, status }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="h-5 w-5" /></span>
        <div><h3 className="text-base font-bold text-slate-900">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>
      </div>
      <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}><StatusDot connected={connected} />{status}</span>
    </div>
  );
}

export function NotifyConfigCard(props) {
  const {
    setConfigCollapsed, barkConfigured, serverChan3Configured,
    emailSetup = {}, emailDraft = '', setEmailDraft, emailCode = '', setEmailCode,
    notifyPlatform, setNotifyPlatform, availablePlatforms, notifyError, notifyMessage,
    notifyConfig, setNotifyConfig, pairedWebWsDevices = [], notifySetup,
    handleSaveNotifyConfig, handleSaveServerChan3Config, handleTestBarkNotify,
    handleTestServerChan3Notify, handleSendEmailCode, handleVerifyEmail,
    handleChangeEmail, handleToggleEmailEnabled, handleTestEmailNotify,
    isChangingEmail = false, isSendingEmailCode = false, isVerifyingEmail = false,
    isTogglingEmail = false, isTestingEmail = false, emailCodeCooldownSeconds = 0,
    isSavingSettings, isTestingBarkNotify = false, isTestingServerChan3Notify = false,
    webNotifySupported, webNotifyPermission, webNotifyEnabled, pcPermissionReason,
    pcTestDisabledReason, handleRequestWebNotifyPermission, handleSendLocalWebNotifyTest,
    handleToggleWebNotifyEnabled, notifyWsStatus = 'idle', isLoggedIn = true, onLogin
  } = props;
  const [dialogOpen, setDialogOpen] = useState(false);

  const platformTabs = Array.isArray(availablePlatforms) && availablePlatforms.length
    ? availablePlatforms : [['ios', 'iOS'], ['serverchan3', 'Android'], ['pc', 'PC'], ['email', 'Email']];
  const serverConnected = Boolean(serverChan3Configured || notifySetup?.serverChan3?.configured);
  const emailVerified = Boolean(emailSetup?.verified);
  const emailEnabled = Boolean(emailVerified && emailSetup?.enabled);
  const emailMaskedAddress = String(emailSetup?.maskedAddress || '').trim();
  const pcConnected = Boolean(webNotifySupported && webNotifyPermission === 'granted' && webNotifyEnabled);
  const cooldown = Math.max(0, Math.ceil(Number(emailCodeCooldownSeconds) || 0));
  const cooldownLabel = `${String(Math.floor(cooldown / 60)).padStart(2, '0')}:${String(cooldown % 60).padStart(2, '0')}`;

  const cards = platformTabs.map(([key]) => {
    const meta = CHANNEL_META[key] || { label: key, dialogTitle: `管理 ${key}`, description: '消息推送通道', icon: Bell, iconClass: 'bg-slate-100 text-slate-600' };
    let connected = false;
    let status = '未连接';
    let warning = false;
    if (key === 'ios') connected = Boolean(barkConfigured);
    if (key === 'serverchan3') connected = serverConnected;
    if (key === 'email') { connected = emailEnabled; warning = emailVerified && !emailEnabled; status = connected ? '已连接' : warning ? '已关闭' : '未连接'; }
    if (key === 'pc') { connected = pcConnected; warning = webNotifyPermission === 'granted' && !webNotifyEnabled; status = !webNotifySupported ? '不可用' : connected ? '已连接' : warning ? '已关闭' : '未连接'; }
    if (connected) status = '已连接';
    return { key, ...meta, connected, warning, status };
  });
  const activeChannel = cards.find((channel) => channel.key === notifyPlatform) || cards[0];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('section') === 'config') {
      setConfigCollapsed?.(false);
      setDialogOpen(true);
    }
  }, [setConfigCollapsed]);

  function openChannel(key) {
    setNotifyPlatform(key);
    setConfigCollapsed?.(false);
    setDialogOpen(true);
  }

  function handleDialogChange(open) {
    setDialogOpen(open);
    if (!open) setConfigCollapsed?.(true);
  }

  const hasBarkInput = Boolean(String(notifyConfig.barkDeviceKey || '').trim());
  const hasUid = Boolean(String(notifyConfig.serverChan3Uid || '').trim());
  const hasSendKey = Boolean(String(notifyConfig.serverChan3SendKey || '').trim());
  const canUseServerChan = hasUid && (serverConnected || hasSendKey);
  const emailStatus = emailEnabled ? '已连接' : emailVerified ? '已关闭' : '待配置';

  return (
    <section data-scroll-card="true" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 px-5 pb-2 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div><h2 className="text-lg font-bold text-slate-950">通知渠道</h2><p className="mt-1 text-sm text-slate-500">点击渠道卡片进行设置和管理，支持多平台同时接收重要通知。</p></div>
        <FeatureHelp title="如何设置通知渠道？" content="点击任意渠道卡片后，会在弹窗中完成配置、开关管理和发送测试。" />
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-2 sm:px-6 xl:grid-cols-4" aria-label="通知渠道">
        {cards.map((channel) => {
          const Icon = channel.icon;
          return (
            <button key={channel.key} type="button" className="group flex min-h-[156px] w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300" onClick={() => openChannel(channel.key)} aria-label={`${channel.connected || channel.warning ? '管理' : '设置'} ${channel.label} 通知`}>
              <span className="flex items-start gap-3">
                <span className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', channel.iconClass)}><Icon className="h-5 w-5" /></span>
                <span className="min-w-0"><span className="block text-sm font-bold text-slate-900">{channel.label}</span><span className="mt-1 flex items-center gap-1.5 text-xs"><StatusDot connected={channel.connected} warning={channel.warning} /><span className={channel.connected ? 'text-emerald-600' : channel.warning ? 'text-amber-600' : 'text-slate-500'}>{channel.status}</span></span></span>
              </span>
              <span className="mt-3 flex-1 text-xs leading-5 text-slate-500">{channel.description}</span>
              <span className="mt-3 inline-flex min-h-9 w-fit items-center justify-center rounded-lg border border-indigo-200 px-4 text-xs font-semibold text-indigo-600 transition-colors group-hover:bg-indigo-50">{channel.connected || channel.warning ? '管理' : '去设置'}</span>
            </button>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto p-0 sm:max-w-2xl" overlayClassName="bg-slate-950/45 backdrop-blur-[2px]">
          <DialogHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-5 pr-12 text-left sm:px-6">
            <DialogTitle>{activeChannel?.dialogTitle || '管理通知渠道'}</DialogTitle>
            <DialogDescription>{activeChannel?.description || '设置通知接收方式'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 pb-6 sm:px-6">
            {!isLoggedIn ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>登录后才能保存通知渠道，配置会在设备间同步。</span><button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 font-semibold" onClick={onLogin}><LogIn className="h-4 w-4" />登录账户</button></div> : null}
            {notifyError ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{notifyError}</div> : null}
            {notifyMessage ? <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="mt-0.5 h-4 w-4" />{notifyMessage}</div> : null}

            <fieldset disabled={!isLoggedIn} className="min-w-0 disabled:opacity-70">
              {notifyPlatform === 'ios' ? <div className="space-y-4"><PanelTitle icon={Smartphone} title="连接 iOS Bark" description="粘贴 Bark 完整链接或 Device Key。" connected={Boolean(barkConfigured)} status={barkConfigured ? '已连接' : '待配置'} /><div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"><Field label="Bark Device Key" helper="可直接粘贴 Bark App 提供的完整推送链接。"><TextInput value={notifyConfig.barkDeviceKey} placeholder="https://api.day.app/xxxxx" onChange={(event) => setNotifyConfig((current) => ({ ...current, barkDeviceKey: event.target.value }))} /></Field><div className="mt-4 flex flex-col gap-3 sm:flex-row"><button className={primaryButtonClass} type="button" onClick={handleSaveNotifyConfig} disabled={isSavingSettings || !hasBarkInput}>{isSavingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存并连接</button><button className={secondaryButtonClass} type="button" onClick={handleTestBarkNotify} disabled={isTestingBarkNotify || !hasBarkInput}><Send className="h-4 w-4" />发送测试</button></div></div></div> : null}

              {notifyPlatform === 'serverchan3' ? <div className="space-y-4"><PanelTitle icon={MessageCircle} title="连接 Server酱³" description="填写 UID 和 SendKey，用于 Android 与微信渠道提醒。" connected={serverConnected} status={serverConnected ? '已连接' : '待配置'} /><div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="UID"><TextInput value={notifyConfig.serverChan3Uid} placeholder="Server酱³ UID" onChange={(event) => setNotifyConfig((current) => ({ ...current, serverChan3Uid: event.target.value }))} /></Field><Field label="SendKey"><TextInput value={notifyConfig.serverChan3SendKey} placeholder={serverConnected ? '已保存，可留空' : 'Server酱³ SendKey'} onChange={(event) => setNotifyConfig((current) => ({ ...current, serverChan3SendKey: event.target.value }))} /></Field></div><div className="mt-4 flex flex-col gap-3 sm:flex-row"><button className={primaryButtonClass} type="button" onClick={handleSaveServerChan3Config} disabled={isSavingSettings || !hasUid}><Save className="h-4 w-4" />保存并连接</button><button className={secondaryButtonClass} type="button" onClick={handleTestServerChan3Notify} disabled={isTestingServerChan3Notify || !canUseServerChan}><Send className="h-4 w-4" />发送测试</button></div></div></div> : null}

              {notifyPlatform === 'email' ? <div className="space-y-4"><PanelTitle icon={Mail} title="连接 Email" description="验证码通过后，通知只会发往已验证地址。" connected={emailEnabled} status={emailStatus} /><div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">{emailMaskedAddress ? <div className="mb-4 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200"><ShieldCheck className="h-4 w-4 text-emerald-500" />当前绑定：{emailMaskedAddress}</div> : null}{!emailVerified || isChangingEmail ? <><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><Field label="邮箱地址"><TextInput type="email" value={emailDraft} placeholder="name@example.com" onChange={(event) => { setEmailDraft?.(event.target.value); setEmailCode?.(''); }} /></Field><button className={secondaryButtonClass} type="button" onClick={handleSendEmailCode} disabled={!String(emailDraft).trim() || isSendingEmailCode || cooldown > 0}>{isSendingEmailCode ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{cooldown > 0 ? `${cooldownLabel} 后重发` : '发送验证码'}</button></div><div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><Field label="6 位验证码"><TextInput inputMode="numeric" value={emailCode} maxLength={6} placeholder="000000" onChange={(event) => setEmailCode?.(event.target.value.replace(/\D/g, '').slice(0, 6))} /></Field><button className={primaryButtonClass} type="button" onClick={handleVerifyEmail} disabled={!/^\d{6}$/.test(String(emailCode)) || isVerifyingEmail}><ShieldCheck className="h-4 w-4" />验证并开启</button></div></> : null}{emailVerified ? <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap"><button className={secondaryButtonClass} type="button" onClick={handleChangeEmail}>更换邮箱</button><button className={secondaryButtonClass} type="button" onClick={handleToggleEmailEnabled} disabled={isTogglingEmail}>{emailEnabled ? '关闭邮件提醒' : '开启邮件提醒'}</button><button className={secondaryButtonClass} type="button" onClick={handleTestEmailNotify} disabled={!emailEnabled || isTestingEmail}><Send className="h-4 w-4" />发送测试邮件</button></div> : null}</div></div> : null}

              {notifyPlatform === 'pc' ? <div className="space-y-4"><PanelTitle icon={Laptop} title="连接 PC 浏览器" description="授权当前浏览器显示桌面通知，并保持实时连接。" connected={pcConnected} status={!webNotifySupported ? '不可用' : pcConnected ? '已连接' : '待授权'} /><div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-white p-3 text-xs text-slate-500 ring-1 ring-slate-200">浏览器能力<div className="mt-1 font-semibold text-slate-800">{webNotifySupported ? '支持通知' : '不支持'}</div></div><div className="rounded-lg bg-white p-3 text-xs text-slate-500 ring-1 ring-slate-200">系统权限<div className="mt-1 font-semibold text-slate-800">{webNotifyPermission === 'granted' ? '已授权' : webNotifyPermission === 'denied' ? '已拒绝' : '未授权'}</div></div><div className="rounded-lg bg-white p-3 text-xs text-slate-500 ring-1 ring-slate-200">实时连接<div className="mt-1 flex items-center gap-1.5 font-semibold text-slate-800">{notifyWsStatus === 'connected' ? <Wifi className="h-4 w-4 text-emerald-500" /> : <WifiOff className="h-4 w-4" />}{notifyWsStatus === 'connected' ? '已连接' : '未连接'}</div></div></div><div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap"><button className={primaryButtonClass} type="button" onClick={handleRequestWebNotifyPermission} disabled={!webNotifySupported || webNotifyPermission === 'granted'}>授权浏览器通知</button><button className={secondaryButtonClass} type="button" onClick={handleToggleWebNotifyEnabled} disabled={webNotifyPermission !== 'granted'}>{webNotifyEnabled ? '关闭 PC 通知' : '开启 PC 通知'}</button><button className={secondaryButtonClass} type="button" onClick={handleSendLocalWebNotifyTest} disabled={webNotifyPermission !== 'granted'}><Send className="h-4 w-4" />发送测试</button></div>{pcPermissionReason ? <p className="mt-3 text-xs text-slate-500">{pcPermissionReason}</p> : null}{pcTestDisabledReason ? <p className="mt-2 text-xs text-amber-700">{pcTestDisabledReason}</p> : null}{pairedWebWsDevices.length ? <p className="mt-2 text-xs text-slate-500">已配对 {pairedWebWsDevices.length} 个 Web 设备。</p> : null}</div></div> : null}
            </fieldset>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
