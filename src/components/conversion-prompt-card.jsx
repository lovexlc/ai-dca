import { ShieldCheck, X } from 'lucide-react';
import { acceptConversionPrompt, dismissConversionPrompt } from '../app/conversionPrompts.js';
import { openAccountAuth } from '../app/accountAuthEvents.js';
import { cx } from './experience-ui.jsx';

export function ConversionPromptCard({ prompt, onClose }) {
  if (!prompt) return null;

  function handleAccept() {
    acceptConversionPrompt(prompt);
    openAccountAuth({
      mode: 'register',
      source: 'conversion_prompt',
      trigger: prompt.trigger
    });
    onClose?.();
  }

  function handleDismiss() {
    dismissConversionPrompt(prompt);
    onClose?.();
  }

  return (
    <div className="fixed bottom-5 left-4 right-4 z-[115] sm:left-auto sm:right-6 sm:w-[24rem]" role="dialog" aria-live="polite" aria-label="保存数据提示">
      <div className="rounded-lg border border-indigo-200 bg-white p-4 text-slate-900 shadow-2xl shadow-slate-900/15">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-950">{prompt.title}</div>
            <div className="mt-1 text-sm leading-6 text-slate-600">{prompt.description}</div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭保存提示"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex h-9 items-center rounded-full px-3 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            {prompt.secondaryLabel || '稍后'}
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className={cx(
              'inline-flex h-9 items-center justify-center rounded-full bg-indigo-600 px-4 text-xs font-bold text-white shadow-sm transition',
              'hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300'
            )}
          >
            {prompt.ctaLabel || '注册并保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
