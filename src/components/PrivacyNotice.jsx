import { useEffect, useState } from 'react';
import { Info, ShieldCheck } from 'lucide-react';
import {
  getAnalyticsOptOut,
  isAnalyticsCollectionDisabled,
  isDoNotTrackEnabled,
  setAnalyticsOptOut
} from '../app/analytics.js';
import { cx, secondaryButtonClass, subtleButtonClass } from './experience-ui.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from './ui/dialog.jsx';

function readPrivacyState() {
  return {
    optedOut: getAnalyticsOptOut(),
    dnt: isDoNotTrackEnabled(),
    disabled: isAnalyticsCollectionDisabled()
  };
}

export function PrivacyNotice({ compact = false } = {}) {
  const [state, setState] = useState(() => readPrivacyState());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const enabled = !state.disabled;
  const locked = state.dnt;

  useEffect(() => {
    function syncState() {
      setState(readPrivacyState());
    }
    window.addEventListener('analytics:opt-out-changed', syncState);
    window.addEventListener('storage', syncState);
    return () => {
      window.removeEventListener('analytics:opt-out-changed', syncState);
      window.removeEventListener('storage', syncState);
    };
  }, []);

  function handleToggle(nextEnabled) {
    if (locked) return;
    setAnalyticsOptOut(!nextEnabled);
    setState(readPrivacyState());
  }

  const statusText = locked
    ? '浏览器 Do Not Track 已开启'
    : enabled
      ? '轻量使用统计已开启'
      : '轻量使用统计已关闭';

  return (
    <div className={cx('rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600', compact && 'bg-white')}>
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-bold text-slate-800">隐私与数据采集</div>
          <div className="mt-1 leading-5 text-slate-500">{statusText}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={locked}
          onClick={() => handleToggle(!enabled)}
          className={cx(
            'inline-flex h-8 min-w-[6.5rem] items-center gap-2 rounded-full border px-2.5 text-xs font-bold transition',
            enabled
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-white text-slate-500',
            locked && 'cursor-not-allowed opacity-60'
          )}
          title={locked ? '浏览器 DNT 已开启，统计保持关闭' : undefined}
        >
          <span className={cx('relative h-4 w-7 rounded-full transition', enabled ? 'bg-emerald-500' : 'bg-slate-300')}>
            <span className={cx('absolute top-0.5 h-3 w-3 rounded-full bg-white transition', enabled ? 'left-3.5' : 'left-0.5')} />
          </span>
          {enabled ? '已开启' : '已关闭'}
        </button>
        <button
          type="button"
          className={cx(compact ? subtleButtonClass : secondaryButtonClass, 'h-8 px-2.5 text-xs')}
          onClick={() => setDetailsOpen(true)}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          查看数据说明
        </button>
      </div>

      {locked ? (
        <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-2 leading-5 text-amber-700">
          已尊重浏览器 DNT 设置，页面不会生成或上报新的统计事件。
        </div>
      ) : null}

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="z-[160] max-h-[88vh] overflow-y-auto border-slate-200 bg-white text-slate-900 sm:max-w-lg">
          <DialogTitle className="text-base font-bold text-slate-950">隐私与数据采集说明</DialogTitle>
          <DialogDescription className="text-sm leading-6 text-slate-500">
            这些统计只用于了解功能使用情况、排查错误和改进页面体验。
          </DialogDescription>

          <div className="space-y-4 text-sm leading-6 text-slate-600">
            <div>
              <div className="font-bold text-slate-900">会采集</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>页面访问、按钮操作、功能结果等轻量事件。</li>
                <li>当前路径、tab、hash、登录用户 ID/用户名，以及随机 visitorId/sessionId。</li>
                <li>粗化后的浏览器/系统族、设备类型、语言、时区、在线状态和 PWA 展示状态。</li>
              </ul>
            </div>

            <div>
              <div className="font-bold text-slate-900">不会采集</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>登录密码、安全密码、token、SendKey、原始文本内容或完整链接。</li>
                <li>完整 userAgent、屏幕尺寸、设备像素比、CPU/内存、网络类型、平台和语言列表。</li>
                <li>金额、价格、股数等敏感业务字段会在事件元数据中被过滤。</li>
              </ul>
            </div>

            <div>
              <div className="font-bold text-slate-900">关闭后</div>
              <p className="mt-2">
                关闭开关或启用浏览器 Do Not Track 后，页面不会生成新的 visitorId/sessionId，也不会写入或上报新的统计事件。
                已保存的本地业务数据和云同步功能不受影响。
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
