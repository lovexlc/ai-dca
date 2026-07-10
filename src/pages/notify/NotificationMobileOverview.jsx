import { Bell, CheckCircle2, ChevronRight, CloudUpload, Send, Server, ShieldCheck, Smartphone } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';

function OverviewCard({ icon: Icon, title, description, status, meta, onClick, children }) {
  return (
    <button type="button" className="notify-mobile-overview__card" onClick={onClick}>
      <span className="notify-mobile-overview__icon"><Icon className="h-7 w-7" aria-hidden="true" /></span>
      <span className="notify-mobile-overview__card-copy"><span className="notify-mobile-overview__card-title">{title}</span><span className="notify-mobile-overview__card-desc">{description}</span>{status ? <span className={cx('notify-mobile-overview__status', status.tone === 'success' ? 'is-success' : 'is-muted')}>{status.label}</span> : null}{children}</span>
      <span className="notify-mobile-overview__card-side">{meta ? <span>{meta}</span> : null}<ChevronRight className="h-5 w-5" aria-hidden="true" /></span>
    </button>
  );
}

export function NotificationMobileOverview({
  availablePlatforms = [],
  barkConfigured = false,
  serverChan3Configured = false,
  pcConfigured = false,
  marketAlerts = [],
  holdingAlerts = [],
  tradePlans = [],
  dcaPlans = [],
  holdingsRule,
  switchConfig,
  onOpenConfig,
  onOpenRules,
  onSyncRules,
  onOpenTestDialog,
  syncing = false,
}) {
  const configured = [barkConfigured, serverChan3Configured, pcConfigured].filter(Boolean).length;
  const totalChannels = Math.max(availablePlatforms.length, 1);
  const tradeCount = tradePlans.filter((plan) => plan.notify?.enabled).length + dcaPlans.filter((plan) => plan.notify?.enabled).length;
  const holdingsCount = holdingsRule?.enabled ? 1 : 0;
  const switchCount = Array.isArray(switchConfig?.rules) ? switchConfig.rules.filter((rule) => rule?.enabled !== false).length : 0;
  const totalRules = marketAlerts.length + holdingAlerts.length + tradeCount + holdingsCount + switchCount;
  const enabledRules = marketAlerts.filter((item) => item.enabled).length + holdingAlerts.filter((item) => item.enabled).length + tradeCount + holdingsCount + (switchConfig?.enabled ? switchCount : 0);

  return (
    <div className="notify-mobile-overview lg:hidden">
      <section className="notify-mobile-overview__hero">
        <div><div className="notify-mobile-overview__eyebrow">通知渠道状态</div><div className="notify-mobile-overview__count">{configured} <span>/ {totalChannels}</span></div><div className="notify-mobile-overview__hero-note"><span>已配置</span><span>全部可用</span></div></div>
        <div className="notify-mobile-overview__check"><CheckCircle2 className="h-12 w-12" aria-hidden="true" /></div>
        <div className="notify-mobile-overview__hero-divider" />
        <div className="notify-mobile-overview__hero-channels"><div><Server className="h-7 w-7" aria-hidden="true" /><span>Server酱³</span><b>{serverChan3Configured ? '已配置' : '未配置'}</b></div><div><Smartphone className="h-7 w-7" aria-hidden="true" /><span>{pcConfigured ? 'PC 浏览器' : 'Android 推送'}</span><b>{(pcConfigured || serverChan3Configured) ? '已配置' : '未配置'}</b></div></div>
      </section>

      <OverviewCard icon={Server} title="Server酱³" description="通过 Server 酱³ 推送重要通知到指定渠道" status={{ label: serverChan3Configured ? '可发送' : '待配置', tone: serverChan3Configured ? 'success' : 'muted' }} meta={serverChan3Configured ? '已配置' : '配置'} onClick={onOpenConfig} />
      <OverviewCard icon={Bell} title="消息推送配置" description="配置推送内容、优先级与接收条件" meta={barkConfigured || serverChan3Configured || pcConfigured ? '已配置' : '配置'} onClick={onOpenConfig} />
      <OverviewCard icon={ShieldCheck} title="通知规则管理" description="管理触发条件与通知策略" meta={`${enabledRules} / ${totalRules || 0} 已启用`} onClick={onOpenRules}>
        <span className="notify-mobile-overview__stats"><span>持仓提醒 <b>{holdingAlerts.length + holdingsCount}</b></span><span>交易提醒 <b>{tradeCount}</b></span><span>账户提醒 <b>{switchCount}</b></span><span>系统通知 <b>{marketAlerts.length}</b></span></span>
      </OverviewCard>
      <section className="notify-mobile-overview__sync">
        <div className="notify-mobile-overview__sync-head"><span className="notify-mobile-overview__icon"><CloudUpload className="h-7 w-7" aria-hidden="true" /></span><span><b>规则同步与测试</b><small>同步规则到云端，或发送测试通知验证配置</small></span></div>
        <div className="notify-mobile-overview__sync-actions"><button type="button" className="notify-mobile-overview__secondary" onClick={onOpenTestDialog}><Send className="h-4 w-4" aria-hidden="true" />发送测试通知</button><button type="button" className="notify-mobile-overview__primary" onClick={onSyncRules} disabled={syncing}><CloudUpload className="h-4 w-4" aria-hidden="true" />{syncing ? '同步中' : '同步到云端'}</button></div>
      </section>
    </div>
  );
}
