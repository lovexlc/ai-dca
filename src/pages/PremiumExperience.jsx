import { Crown, Sparkles } from 'lucide-react';
import { PREMIUM_FEATURES, clearPremiumState, readPremiumState, writePremiumState } from '../app/monetization.js';
import { usePremiumState } from '../components/monetization.jsx';

export function PremiumExperience({ embedded = false }) {
  const premium = usePremiumState();

  function unlockPreview() {
    writePremiumState({ unlocked: true, plan: 'preview', source: 'manual-preview' });
  }

  function resetPreview() {
    clearPremiumState();
  }

  return (
    <div className={embedded ? 'mx-auto max-w-6xl space-y-5 px-4 sm:px-6' : 'mx-auto max-w-6xl space-y-5 px-6'}>
      <section className="overflow-hidden rounded-[2rem] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-indigo-50 p-6 shadow-sm">
        <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
          <Crown className="h-4 w-4" />
          Premium reserved
        </div>
        <h1 className="mt-4 text-3xl font-black text-slate-950">高级版与付费能力预留</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">当前页面先预留高级功能入口、无干扰体验和更多额度的付费说明。后续接入应用内购买或服务端订阅校验后，只需要替换本地预览解锁逻辑。</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-sm active:bg-slate-800" onClick={unlockPreview}>
            <Sparkles className="h-4 w-4" />
            预览解锁高级版
          </button>
          <button type="button" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm" onClick={resetPreview}>恢复免费版</button>
        </div>
        <div className="mt-4 text-xs text-slate-500">当前状态：{premium.unlocked ? `高级版已解锁 · ${premium.plan || 'premium'}` : '免费版'}</div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {PREMIUM_FEATURES.map((item) => (
          <div key={item.key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-black text-slate-900">{item.title}</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
          </div>
        ))}
      </section>

      <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
        <div className="text-sm font-black text-slate-800">支付接入预留</div>
        <p className="mt-2 leading-6">APK 里后续可接 Google Play Billing。国内分发可接你自己的服务端订单、支付宝或微信支付，然后把订阅状态写入服务端并同步到本地。</p>
      </section>
    </div>
  );
}
