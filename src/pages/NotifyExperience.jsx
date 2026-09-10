import './notify/notificationRebindFetch.js';
import { NotifyConfigCard } from './NotifyConfigCard.jsx';
import { NotifyHistoryCard } from './NotifyHistoryCard.jsx';
import { NotifyRulesCard } from './NotifyRulesCard.jsx';
import { NotifySyncAndTestCard } from './NotifySyncAndTestCard.jsx';
import { NotifyTestDialog } from './NotifyTestDialog.jsx';
import { StatCard, cx } from '../components/experience-ui.jsx';
import { AlertRuleDialog } from '../components/AlertRuleDialog.jsx';
import { useNotifyExperience } from './notify/useNotifyExperience.js';

export function NotifyExperience({ embedded = false }) {
  const {
    availablePlatforms,
    pcFeaturesAvailable,
    serverChan3Configured,
    barkConfigured,
    pcConfigured,
    summary,
    configCardProps,
    rulesCardProps,
    syncAndTestCardProps,
    historyCardProps,
    alertDialogProps,
    testDialogProps
  } = useNotifyExperience({ embedded });

  return (
    <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <div className={cx('grid gap-4', pcFeaturesAvailable ? 'md:grid-cols-3' : 'sm:grid-cols-2')}>
        <StatCard accent="indigo" eyebrow="通道状态" value={summary.channelStatus} note={summary.channelNote} />
        {availablePlatforms.some(([key]) => key === 'serverchan3') && serverChan3Configured ? (
          <StatCard eyebrow="Server酱³" value="已配置" note="用于 Android 系统通知推送" />
        ) : null}
        {availablePlatforms.some(([key]) => key === 'ios') && barkConfigured ? (
          <StatCard eyebrow="iOS Bark" value="已配置" note="在 iOS tab 填入 Bark device key" />
        ) : null}
      </div>
      <div className="space-y-6">
        <NotifyConfigCard {...configCardProps} />
        <NotifyRulesCard {...rulesCardProps} />
        <NotifySyncAndTestCard {...syncAndTestCardProps} />
        <NotifyHistoryCard {...historyCardProps} />
      </div>
      <AlertRuleDialog {...alertDialogProps} />
      <NotifyTestDialog {...testDialogProps} />
    </div>
  );
}
