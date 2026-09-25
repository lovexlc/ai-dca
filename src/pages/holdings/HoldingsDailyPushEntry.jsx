// HoldingsDailyPushEntry.jsx
//
// 持仓页顶部的「每日收盘推送」入口：
// - variant="pill"：桌面端，总资产同行右侧的胶囊
// - variant="card"：移动端，KPI 下方的整宽卡片
// 与通知 Tab 的 holdings-rule 共用同一份服务端状态。

import { Bell } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';

function PushSwitch({ enabled, saving }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
        enabled ? 'bg-emerald-600' : 'bg-slate-200'
      )}
    >
      <span
        className={cx(
          'absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow transition-transform',
          enabled && 'translate-x-4',
          saving && 'animate-pulse'
        )}
      />
    </span>
  );
}

export function HoldingsDailyPushEntry({
  variant = 'pill',
  enabled = false,
  loading = false,
  saving = false,
  loggedIn = false,
  toggle
}) {
  const busy = loading || saving;
  const handleClick = () => {
    if (busy || typeof toggle !== 'function') return;
    toggle(!enabled);
  };
  const label = enabled ? '关闭每日收盘推送' : '开启每日收盘推送';

  if (variant === 'card') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label={label}
        title={label}
        className={cx(
          'flex w-full items-center gap-3 rounded-2xl border bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors active:bg-slate-50',
          enabled ? 'border-emerald-300' : 'border-slate-200/70 hover:border-slate-300',
          busy && 'opacity-60'
        )}
      >
        <span
          className={cx(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            enabled ? 'bg-emerald-100' : 'bg-rose-50'
          )}
        >
          <Bell className={cx('h-5 w-5', enabled ? 'text-emerald-600' : 'text-rose-500')} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">每日收盘推送</span>
          <span className="block truncate text-xs text-slate-500">
            {loggedIn ? '收盘后推送持仓收益' : '登录后可开启收盘推送'}
          </span>
        </span>
        <PushSwitch enabled={enabled} saving={saving} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors',
        enabled
          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
        busy && 'opacity-60'
      )}
    >
      <Bell className="h-3.5 w-3.5" />
      <span>每日收盘推送</span>
      <span className="hidden text-slate-400 xl:inline">{loggedIn ? '收盘后推送持仓收益' : '登录后可开启'}</span>
      <PushSwitch enabled={enabled} saving={saving} />
    </button>
  );
}
