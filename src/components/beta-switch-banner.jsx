import { useState } from 'react';
import { dismissBetaBanner, enableBeta, isBetaBannerDismissed } from '../app/betaEnvironment.js';

/**
 * BetaSwitchBanner - 正式版顶部的 beta 入口条。
 * 只在网页 app 页面渲染（由入口处的 canSwitch 判断），用户可切换或永久关闭。
 */
export function BetaSwitchBanner() {
  const [hidden, setHidden] = useState(() => isBetaBannerDismissed());

  if (hidden) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
      <span className="rounded-full bg-amber-200 px-2 py-0.5 font-bold">BETA</span>
      <span>小程序版网页体验已上线，可随时切回正式版。</span>
      <button
        type="button"
        onClick={() => enableBeta()}
        className="rounded-full bg-amber-600 px-3 py-1 font-semibold text-white transition-colors hover:bg-amber-700"
      >
        切换到 beta 版
      </button>
      <button
        type="button"
        onClick={() => {
          dismissBetaBanner();
          setHidden(true);
        }}
        className="rounded-full px-2 py-1 font-medium text-amber-700 transition-colors hover:bg-amber-100"
      >
        不再显示
      </button>
    </div>
  );
}

export default BetaSwitchBanner;
