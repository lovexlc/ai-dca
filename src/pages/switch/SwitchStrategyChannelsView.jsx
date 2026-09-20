import { Bell, Laptop, Loader2, Mail, MessageCircle, RefreshCw, Send, Smartphone } from 'lucide-react';
import { cx, primaryButtonClass, secondaryButtonClass } from '../../components/experience-ui.jsx';
import { SWITCH_CHANNEL_DEFS } from './switchBoardModel.js';
import { useSwitchChannelStatus } from './useSwitchChannelStatus.js';

const CHANNEL_ICONS = { ios: Smartphone, serverchan3: MessageCircle, pc: Laptop, email: Mail };
const CHANNEL_ICON_CLASSES = {
  ios: 'bg-slate-100 text-slate-900',
  serverchan3: 'bg-emerald-50 text-emerald-600',
  pc: 'bg-indigo-50 text-indigo-600',
  email: 'bg-amber-50 text-amber-600'
};

function notifySettingsHref(inPagesDir) {
  const homeHref = inPagesDir ? '../home.html' : './home.html';
  return `${homeHref}?tab=notify&section=config`;
}

// 通知渠道管理中心：4 大渠道的连接状态与入口。
// 连接凭据仍由「通知管理」页统一维护，这里负责状态汇总 + PC 浏览器本地授权/测试。
export function SwitchStrategyChannelsView({ inPagesDir = false } = {}) {
  const { connected, detail, pc, loading, error, refresh, requestPermission, toggleEnabled, sendTest } = useSwitchChannelStatus();
  const settingsHref = notifySettingsHref(inPagesDir);

  function describe(key) {
    if (key === 'email') {
      if (connected.email) return `已绑定 ${detail.emailMaskedAddress || '验证邮箱'}`;
      if (detail.emailVerified) return '已验证但提醒已关闭';
      return '验证邮箱后即可接收邮件提醒';
    }
    if (key === 'pc') {
      if (!pc.supported) return '当前浏览器不支持桌面通知';
      if (pc.permission !== 'granted') return '需要先授权浏览器通知权限';
      return pc.enabled ? '浏览器桌面通知已开启' : '已授权，但 PC 通知处于关闭状态';
    }
    if (key === 'serverchan3') {
      return connected.serverchan3 ? `Server酱³ UID ${detail.serverChan3Uid || '已保存'}` : '填写 Server酱³ UID 与 SendKey 后启用';
    }
    return connected.ios ? 'Bark Device Key 已保存' : '粘贴 Bark 链接或 Device Key 后启用';
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-black text-slate-950">通知渠道</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">渠道连接为账号级配置，切换方案可在弹窗中按需选择要推送的渠道。</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading} className={cx(secondaryButtonClass, 'shrink-0')}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新状态
        </button>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-5 text-amber-800">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SWITCH_CHANNEL_DEFS.map((channel) => {
          const Icon = CHANNEL_ICONS[channel.key] || Bell;
          const isConnected = Boolean(connected[channel.key]);
          const highlight = channel.key === 'serverchan3' && isConnected;
          return (
            <article
              key={channel.key}
              className={cx(
                'flex min-w-0 flex-col rounded-2xl border bg-white p-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]',
                highlight ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200'
              )}
            >
              <div className="flex items-start gap-2.5">
                <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', CHANNEL_ICON_CLASSES[channel.key] || 'bg-slate-100 text-slate-600')}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-slate-950">{channel.label}</div>
                  <span className="mt-1 inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-bold">
                    <span className={cx('h-1.5 w-1.5 rounded-full', isConnected ? 'bg-emerald-500' : 'bg-slate-300')} />
                    <span className={isConnected ? 'text-emerald-700' : 'text-slate-500'}>{isConnected ? '已连接' : '未连接'}</span>
                  </span>
                </div>
              </div>

              <p className="mt-2.5 flex-1 text-xs leading-5 text-slate-500">{describe(channel.key)}</p>

              {channel.key === 'pc' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {pc.permission !== 'granted' ? (
                    <button type="button" onClick={requestPermission} disabled={!pc.supported} className={cx(primaryButtonClass, 'min-h-10 px-3 text-xs')}>
                      授权通知
                    </button>
                  ) : (
                    <button type="button" onClick={toggleEnabled} className={cx(secondaryButtonClass, 'min-h-10 px-3 text-xs')}>
                      {pc.enabled ? '关闭 PC 通知' : '开启 PC 通知'}
                    </button>
                  )}
                  <button type="button" onClick={sendTest} disabled={pc.permission !== 'granted'} className={cx(secondaryButtonClass, 'min-h-10 px-3 text-xs')}>
                    <Send className="h-3.5 w-3.5" />
                    测试推送
                  </button>
                </div>
              ) : (
                <a href={settingsHref} className={cx(isConnected ? secondaryButtonClass : primaryButtonClass, 'mt-3 min-h-10 w-fit px-3 text-xs')}>
                  {isConnected ? '管理连接' : '去设置'}
                </a>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default SwitchStrategyChannelsView;
