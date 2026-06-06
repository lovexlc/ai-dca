import { useState } from 'react';
import { Check, Crown, MessageSquare, Sparkles } from 'lucide-react';
import { PREMIUM_FEATURES, clearPremiumState, writePremiumState } from '../app/monetization.js';
import { usePremiumState } from '../components/monetization.jsx';
import { trackFeatureEvent } from '../app/analytics.js';

const STORAGE_KEY = 'aiDcaPremiumSurveyState';

const SURVEY_OPTIONS = [
  { key: 'ad_free', label: '少广告 / 无广告' },
  { key: 'advanced_alerts', label: '更强提醒策略' },
  { key: 'ai_research', label: 'AI 复盘分析' },
  { key: 'data_export', label: '导出与备份增强' },
  { key: 'market_tools', label: '行情和切换工具增强' }
];

const PRICE_OPTIONS = [
  { key: 'free_ads', label: '免费 + 广告' },
  { key: 'monthly_low', label: '低价月付' },
  { key: 'yearly', label: '年付' },
  { key: 'one_time', label: '一次性买断' }
];

function readSurveyState() {
  if (typeof window === 'undefined') return { interests: [], price: '', submitted: false };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    return {
      interests: Array.isArray(parsed?.interests) ? parsed.interests.filter(Boolean) : [],
      price: String(parsed?.price || ''),
      submitted: parsed?.submitted === true
    };
  } catch {
    return { interests: [], price: '', submitted: false };
  }
}

function saveSurveyState(next) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function PremiumExperience({ embedded = false }) {
  const premium = usePremiumState();
  const [survey, setSurvey] = useState(() => readSurveyState());

  function unlockPreview() {
    writePremiumState({ unlocked: true, plan: 'preview', source: 'manual-preview' });
    trackFeatureEvent('premium', 'unlock_preview', { wasUnlocked: premium.unlocked });
  }

  function resetPreview() {
    clearPremiumState();
    trackFeatureEvent('premium', 'reset_preview', { wasUnlocked: premium.unlocked, plan: premium.plan || '' });
  }

  function toggleInterest(key) {
    const interests = survey.interests.includes(key)
      ? survey.interests.filter((item) => item !== key)
      : [...survey.interests, key].slice(0, 5);
    const next = { ...survey, interests, submitted: false };
    setSurvey(next);
    saveSurveyState(next);
    trackFeatureEvent('premium', 'survey_interest_toggle', {
      option: key,
      selected: interests.includes(key),
      selectedCount: interests.length
    });
  }

  function choosePrice(key) {
    const next = { ...survey, price: key, submitted: false };
    setSurvey(next);
    saveSurveyState(next);
    trackFeatureEvent('premium', 'survey_price_select', { option: key });
  }

  function submitSurvey() {
    const next = { ...survey, submitted: true };
    setSurvey(next);
    saveSurveyState(next);
    trackFeatureEvent('premium', 'survey_submit', {
      interestOptions: survey.interests,
      interestCount: survey.interests.length,
      priceOption: survey.price || ''
    });
  }

  const canSubmit = survey.interests.length > 0 || survey.price;

  return (
    <div className={embedded ? 'mx-auto max-w-6xl space-y-5 px-4 sm:px-6' : 'mx-auto max-w-6xl space-y-5 px-6'}>
      <section className="overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-indigo-50 p-6 shadow-sm">
        <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
          <Crown className="h-4 w-4" />
          Premium preview
        </div>
        <h1 className="mt-4 text-3xl font-black text-slate-950">高级版功能共创</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">这里先开放高级版入口，用于收集功能优先级反馈。问卷只记录选项，不收集持仓、标的、金额、交易流水等个人投资信息。</p>
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
          <div key={item.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-black text-slate-900">{item.title}</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black text-slate-900">
          <MessageSquare className="h-4 w-4 text-amber-500" />
          高级功能问卷
        </div>
        <div className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">想优先看到什么</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SURVEY_OPTIONS.map((option) => {
            const selected = survey.interests.includes(option.key);
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => toggleInterest(option.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-semibold transition-colors ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                aria-pressed={selected}
              >
                {selected ? <Check className="h-3.5 w-3.5" /> : null}
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">更能接受哪种模式</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PRICE_OPTIONS.map((option) => {
            const selected = survey.price === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => choosePrice(option.key)}
                className={`rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition-colors ${selected ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                aria-pressed={selected}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit}
            onClick={submitSurvey}
          >
            <Check className="h-4 w-4" />
            提交反馈
          </button>
          {survey.submitted ? <span className="text-sm font-semibold text-emerald-600">已记录反馈</span> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
        <div className="text-sm font-black text-slate-800">隐私边界</div>
        <p className="mt-2 leading-6">高级版问卷只记录选择项和页面行为统计，不采集持仓笔数、资产金额、交易明细、基金代码、股票代码或自由文本。</p>
      </section>
    </div>
  );
}
