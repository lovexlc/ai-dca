import { useState } from 'react';
import { Check, MessageSquare } from 'lucide-react';
import { trackFeatureEvent } from '../app/analytics.js';
import { PREMIUM_SURVEY_INTEREST_OPTIONS, PREMIUM_SURVEY_PRICE_OPTIONS } from '../app/premiumSurveyOptions.js';

const STORAGE_KEY = 'aiDcaPremiumSurveyState';
const MAX_INTEREST_SELECTIONS = 7;
const VALID_INTEREST_KEYS = new Set(PREMIUM_SURVEY_INTEREST_OPTIONS.map((option) => option.key));
const VALID_PRICE_KEYS = new Set(PREMIUM_SURVEY_PRICE_OPTIONS.map((option) => option.key));

function readSurveyState() {
  if (typeof window === 'undefined') return { interests: [], price: '', submitted: false };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    const price = String(parsed?.price || '');
    return {
      interests: Array.isArray(parsed?.interests)
        ? parsed.interests.map((item) => String(item || '')).filter((item) => VALID_INTEREST_KEYS.has(item))
        : [],
      price: VALID_PRICE_KEYS.has(price) ? price : '',
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
  const [survey, setSurvey] = useState(() => readSurveyState());

  function toggleInterest(key) {
    const interests = survey.interests.includes(key)
      ? survey.interests.filter((item) => item !== key)
      : [...survey.interests, key].slice(0, MAX_INTEREST_SELECTIONS);
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
    <div className={embedded ? 'mx-auto max-w-4xl px-4 sm:px-6' : 'mx-auto max-w-4xl px-6'}>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black text-slate-900">
          <MessageSquare className="h-4 w-4 text-amber-500" />
          高级功能问卷
        </div>
        <div className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">想优先看到什么</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {PREMIUM_SURVEY_INTEREST_OPTIONS.map((option) => {
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
          {PREMIUM_SURVEY_PRICE_OPTIONS.map((option) => {
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
    </div>
  );
}
