import { cx } from '../../components/experience-ui.jsx';

export function buildNotifyConfigHint({ barkConfigured, serverChan3Configured, pcConfigured }) {
  if (!barkConfigured && !serverChan3Configured && !pcConfigured) {
    return '💡 建议至少配置一个通知渠道。如同时配置手机端（iOS Bark 或 Server酱³）和 PC 端，确保不会错过提醒。';
  }
  if (!barkConfigured && !serverChan3Configured) {
    return '💡 当前仅配置了 PC 端通知，关闭浏览器后将无法收到提醒。建议配置手机端通知渠道。';
  }
  if (barkConfigured && !serverChan3Configured) {
    return '💡 如需在 Android 端接收通知，请配置 Server酱³。';
  }
  if (!barkConfigured && serverChan3Configured) {
    return '💡 如需在 iOS 端接收通知，请配置 Bark device key。';
  }
  if (!pcConfigured && (barkConfigured || serverChan3Configured)) {
    return '💡 如需在 PC 浏览器接收通知，请授权桌面通知权限。';
  }
  return null;
}

export function NotifyConfigHint({ barkConfigured, serverChan3Configured, pcConfigured, visible }) {
  if (!visible) return null;
  const hint = buildNotifyConfigHint({ barkConfigured, serverChan3Configured, pcConfigured });
  if (!hint) return null;
  return (
    <div className={cx('rounded-xl border border-[var(--a-200)] bg-[var(--bg-100)] px-4 py-3 text-xs text-[var(--fg-700)]')}>
      {hint}
    </div>
  );
}
