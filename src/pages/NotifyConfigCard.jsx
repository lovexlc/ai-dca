import {
  Bell, CheckCircle2, Laptop, Loader2, LogIn, Mail, MessageCircle,
  Save, Send, ShieldCheck, Smartphone, Trash2, Wifi, WifiOff
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { FeatureHelp } from '../components/FeatureHelp.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog.jsx';
import { Field, TextInput, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';
import { persistNotifyClientConfig, saveNotifySettings } from '../app/notifySync.js';
import { showActionToast } from '../app/toast.js';

const CHANNEL_META = {
  ios: { label: 'iOS', dialogTitle: '管理 iOS Bark', description: '通过系统推送接收通知', icon: Smartphone, iconClass: 'bg-slate-50 text-slate-900' },
  serverchan3: { label: 'Android', dialogTitle: '管理 Android 通知', description: '通过系统推送接收通知', icon: MessageCircle, iconClass: 'bg-emerald-50 text-emerald-600' },
  pc: { label: 'PC', dialogTitle: '管理 PC 浏览器通知', description: '通过浏览器推送通知', icon: Laptop, iconClass: 'bg-indigo-50 text-indigo-600' },
  email: { label: 'Email', dialogTitle: '管理 Email 通知', description: '通过邮箱接收通知（支持 QQ、163、Gmail 等）', icon: Mail, iconClass: 'bg-amber-50 text-amber-600' }
};
const dangerButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50';

function StatusDot({ connected, warning = false }) {
  return <span className={cx('h-2 w-2 rounded-full', connected ? 'bg-emerald-500' : warning ? 'bg-amber-400' : 'bg-slate-300')} />;
}
function PanelTitle({ icon: Icon, title, description, connected, status }) {
  return <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="h-5 w-5" /></span><div><h3 className="text-base font-bold text-slate-900">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div></div><span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}><StatusDot connected={connected} />{status}</span></div>;
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
  const [removingChannel, setRemovingChannel] = useState('');
  const [removeError, setRemoveError] = useState('');

  const platformTabs = Array.isArray(availablePlatforms) && availablePlatforms.length ? availablePlatforms : [['ios', 'iOS'], ['serverchan3', 'Android'], ['pc', 'PC'], ['email', 'Email']];
  const serverConnected = Boolean(serverChan3Configured || notifySetup?.serverChan3?.configured);
  const emailVerified = Boolean(emailSetup?.verified);
  const emailEnabled = Boolean(emailVerified && emailSetup?.enabled);
  const emailMaskedAddress = String(emailSetup?.maskedAddress || '').trim();
  const pcConnected = Boolean(webNotifySupported && webNotifyPermission === 'granted' && webNotifyEnabled);
  const cooldown = Math.max(0, Math.ceil(Number(emailCodeCooldownSeconds) || 0));
  const cooldownLabel = `${String(Math.floor(cooldown / 60)).padStart(2, '0')}:${String(cooldown % 60).padStart(2, '0')}`;
  const cards = platformTabs.map(([key]) => {
    const meta = CHANNEL_META[key] || { label: key, dialogTitle: `管理 ${key}`, description: '消息推送通道', icon: Bell, iconClass: 'bg-slate-100 text-slate-600' };
    let connected = key === 'ios' ? Boolean(barkConfigured) : key === 'serverchan3' ? serverConnected : key === 'email' ? emailEnabled : key === 'pc' ? pcConnected : false;
    const warning = key === 'email' ? emailVerified && !emailEnabled : key === 'pc' ? webNotifyPermission === 'granted' && !webNotifyEnabled : false;
    const status = key === 'pc' && !webNotifySupported ? '不可用' : connected ? '已连接' : warning ? '已关闭' : '未连接';
    return { key, ...meta, connected, warning, status };
  });
  const activeChannel = cards.find((channel) => channel.key === notifyPlatform) || cards[0];
  const hasBarkInput = Boolean(String(notifyConfig.barkDeviceKey || '').trim());
  const hasUid = Boolean(String(notifyConfig.serverChan3Uid || '').trim());
  const hasSendKey = Boolean(String(notifyConfig.serverChan3SendKey || '').trim());

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('section') === 'config') {
      setConfigCollapsed?.(false); setDialogOpen(true);
    }
  }, [setConfigCollapsed]);

  function openChannel(key) { setNotifyPlatform(key); setConfigCollapsed?.(false); setDialogOpen(true); setRemoveError(''); }
  function handleDialogChange(open) { setDialogOpen(open); if (!open) setConfigCollapsed?.(true); }

  async function removeChannel(channel) {
    const label = channel === 'bark' ? 'iOS Bark' : 'Android Server酱³';
    if (!window.confirm(`确定移除 ${label} 吗？移除后该渠道将不再接收通知。`)) return;
    setRemovingChannel(channel); setRemoveError('');
    try {
      await saveNotifySettings(channel === 'bark' ? { barkDeviceKey: '' } : { serverChan3: {} });
      if (channel === 'bark') {
        persistNotifyClientConfig({ barkDeviceKey: '', _skipTrack: true });
        setNotifyConfig((current) => ({ ...current, barkDeviceKey: '' }));
      } else {
        persistNotifyClientConfig({ serverChan3Uid: '', serverChan3SendKey: '', _hasServerChan3: false, _skipTrack: true });
        setNotifyConfig((current) => ({ ...current, serverChan3Uid: '', serverChan3SendKey: '' }));
      }
      showActionToast(`已移除 ${label}`, 'success');
      setDialogOpen(false);
      window.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} 移除失败`;
      setRemoveError(message);
      showActionToast(`移除 ${label}`, 'error', { description: message });
    } finally { setRemovingChannel(''); }
  }

  const actionRow = (children, remove) => <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">{children}{remove}</div>;
  return <section data-scroll-card="true" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-col gap-3 px-5 pb-2 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6"><div><h2 className="text-lg font-bold text-slate-950">通知渠道</h2><p className="mt-1 text-sm text-slate-500">点击渠道卡片进行设置和管理，支持多平台同时接收重要通知。</p></div><FeatureHelp title="如何设置通知渠道？" content="点击渠道卡片后可配置、测试、关闭或移除通知渠道。" /></div>
    <div className="grid gap-4 p-5 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">{cards.map((channel) => { const Icon = channel.icon; return <button key={channel.key} type="button" className="group flex min-h-[156px] w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm" onClick={() => openChannel(channel.key)}><span className="flex items-start gap-3"><span className={cx('flex h-11 w-11 items-center justify-center rounded-xl', channel.iconClass)}><Icon className="h-5 w-5" /></span><span><span className="block text-sm font-bold text-slate-900">{channel.label}</span><span className="mt-1 flex items-center gap-1.5 text-xs"><StatusDot connected={channel.connected} warning={channel.warning} />{channel.status}</span></span></span><span className="mt-3 flex-1 text-xs leading-5 text-slate-500">{channel.description}</span><span className="mt-3 inline-flex min-h-9 w-fit items-center rounded-lg border border-indigo-200 px-4 text-xs font-semibold text-indigo-600">{channel.connected || channel.warning ? '管理' : '去设置'}</span></button>; })}</div>
    <Dialog open={dialogOpen} onOpenChange={handleDialogChange}><DialogContent className="max-h-[88dvh] overflow-y-auto p-0 sm:max-w-2xl" overlayClassName="bg-slate-950/45 backdrop-blur-[2px]"><DialogHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-5 pr-12 text-left sm:px-6"><DialogTitle>{activeChannel?.dialogTitle || '管理通知渠道'}</DialogTitle><DialogDescription>{activeChannel?.description}</DialogDescription></DialogHeader><div className="space-y-4 px-5 pb-6 sm:px-6">
      {!isLoggedIn ? <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>登录后才能管理通知渠道。</span><button type="button" className="inline-flex items-center gap-2 font-semibold" onClick={onLogin}><LogIn className="h-4 w-4" />登录</button></div> : null}
      {notifyError || removeError ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{removeError || notifyError}</div> : null}
      {notifyMessage ? <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{notifyMessage}</div> : null}
      <fieldset disabled={!isLoggedIn} className="min-w-0 disabled:opacity-70">
        {notifyPlatform === 'ios' ? <div className="space-y-4"><PanelTitle icon={Smartphone} title="连接 iOS Bark" description="粘贴 Bark 完整链接或 Device Key。" connected={Boolean(barkConfigured)} status={barkConfigured ? '已连接' : '待配置'} /><div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"><Field label="Bark Device Key"><TextInput value={notifyConfig.barkDeviceKey} placeholder="https://api.day.app/xxxxx" onChange={(e) => setNotifyConfig((c) => ({ ...c, barkDeviceKey: e.target.value }))} /></Field>{actionRow(<><button className={primaryButtonClass} type="button" onClick={handleSaveNotifyConfig} disabled={isSavingSettings || !hasBarkInput}><Save className="h-4 w-4" />保存并连接</button><button className={secondaryButtonClass} type="button" onClick={handleTestBarkNotify} disabled={isTestingBarkNotify || !hasBarkInput}><Send className="h-4 w-4" />发送测试</button></>, barkConfigured ? <button className={dangerButtonClass} type="button" onClick={() => removeChannel('bark')} disabled={Boolean(removingChannel)}>{removingChannel === 'bark' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}移除 iOS Bark</button> : null)}</div></div> : null}
        {notifyPlatform === 'serverchan3' ? <div className="space-y-4"><PanelTitle icon={MessageCircle} title="连接 Server酱³" description="填写 UID 和 SendKey，用于 Android 与微信渠道提醒。" connected={serverConnected} status={serverConnected ? '已连接' : '待配置'} /><div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="UID"><TextInput value={notifyConfig.serverChan3Uid} onChange={(e) => setNotifyConfig((c) => ({ ...c, serverChan3Uid: e.target.value }))} /></Field><Field label="SendKey"><TextInput value={notifyConfig.serverChan3SendKey} placeholder={serverConnected ? '已保存，可留空' : 'Server酱³ SendKey'} onChange={(e) => setNotifyConfig((c) => ({ ...c, serverChan3SendKey: e.target.value }))} /></Field></div>{actionRow(<><button className={primaryButtonClass} type="button" onClick={handleSaveServerChan3Config} disabled={isSavingSettings || !hasUid}><Save className="h-4 w-4" />保存并连接</button><button className={secondaryButtonClass} type="button" onClick={handleTestServerChan3Notify} disabled={isTestingServerChan3Notify || !(hasUid && (serverConnected || hasSendKey))}><Send className="h-4 w-4" />发送测试</button></>, serverConnected ? <button className={dangerButtonClass} type="button" onClick={() => removeChannel('serverchan3')} disabled={Boolean(removingChannel)}>{removingChannel === 'serverchan3' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}移除 Android 通知</button> : null)}</div></div> : null}
        {notifyPlatform === 'email' ? <div className="space-y-4"><PanelTitle icon={Mail} title="连接 Email" description="验证码通过后，通知只会发往已验证地址。" connected={emailEnabled} status={emailEnabled ? '已连接' : emailVerified ? '已关闭' : '待配置'} /><div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">{emailMaskedAddress ? <div className="mb-4 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm"><ShieldCheck className="h-4 w-4 text-emerald-500" />当前绑定：{emailMaskedAddress}</div> : null}{!emailVerified || isChangingEmail ? <><div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><Field label="邮箱地址"><TextInput type="email" value={emailDraft} onChange={(e) => { setEmailDraft?.(e.target.value); setEmailCode?.(''); }} /></Field><button className={secondaryButtonClass} type="button" onClick={handleSendEmailCode} disabled={!String(emailDraft).trim() || isSendingEmailCode || cooldown > 0}>{cooldown > 0 ? `${cooldownLabel} 后重发` : '发送验证码'}</button></div><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><Field label="6 位验证码"><TextInput value={emailCode} maxLength={6} onChange={(e) => setEmailCode?.(e.target.value.replace(/\D/g, '').slice(0, 6))} /></Field><button className={primaryButtonClass} type="button" onClick={handleVerifyEmail} disabled={!/^\d{6}$/.test(String(emailCode)) || isVerifyingEmail}><ShieldCheck className="h-4 w-4" />验证并开启</button></div></> : null}{emailVerified ? actionRow(<><button className={secondaryButtonClass} type="button" onClick={handleChangeEmail}>更换邮箱</button><button className={emailEnabled ? dangerButtonClass : secondaryButtonClass} type="button" onClick={handleToggleEmailEnabled} disabled={isTogglingEmail}>{emailEnabled ? '关闭邮件提醒' : '开启邮件提醒'}</button><button className={secondaryButtonClass} type="button" onClick={handleTestEmailNotify} disabled={!emailEnabled || isTestingEmail}><Send className="h-4 w-4" />发送测试邮件</button></>) : null}</div></div> : null}
        {notifyPlatform === 'pc' ? <div className="space-y-4"><PanelTitle icon={Laptop} title="连接 PC 浏览器" description="授权当前浏览器显示桌面通知。" connected={pcConnected} status={pcConnected ? '已连接' : '待授权'} /><div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-white p-3 text-xs">浏览器能力<div className="mt-1 font-semibold">{webNotifySupported ? '支持通知' : '不支持'}</div></div><div className="rounded-lg bg-white p-3 text-xs">系统权限<div className="mt-1 font-semibold">{webNotifyPermission === 'granted' ? '已授权' : '未授权'}</div></div><div className="rounded-lg bg-white p-3 text-xs">实时连接<div className="mt-1 flex items-center gap-1 font-semibold">{notifyWsStatus === 'connected' ? <Wifi className="h-4 w-4 text-emerald-500" /> : <WifiOff className="h-4 w-4" />}{notifyWsStatus === 'connected' ? '已连接' : '未连接'}</div></div></div>{actionRow(<><button className={primaryButtonClass} type="button" onClick={handleRequestWebNotifyPermission} disabled={!webNotifySupported || webNotifyPermission === 'granted'}>授权浏览器通知</button><button className={webNotifyEnabled ? dangerButtonClass : secondaryButtonClass} type="button" onClick={handleToggleWebNotifyEnabled} disabled={webNotifyPermission !== 'granted'}>{webNotifyEnabled ? '关闭 PC 通知' : '开启 PC 通知'}</button><button className={secondaryButtonClass} type="button" onClick={handleSendLocalWebNotifyTest} disabled={webNotifyPermission !== 'granted'}><Send className="h-4 w-4" />发送测试</button></>) }{pcPermissionReason ? <p className="mt-3 text-xs text-slate-500">{pcPermissionReason}</p> : null}{pcTestDisabledReason ? <p className="mt-2 text-xs text-amber-700">{pcTestDisabledReason}</p> : null}{pairedWebWsDevices.length ? <p className="mt-2 text-xs text-slate-500">已配对 {pairedWebWsDevices.length} 个 Web 设备。</p> : null}</div></div> : null}
      </fieldset>
    </div></DialogContent></Dialog>
  </section>;
}
