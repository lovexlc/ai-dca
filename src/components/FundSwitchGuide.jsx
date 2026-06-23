import { useState } from 'react';
import { X, HelpCircle, TrendingUp, RefreshCw, Link2 } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';

const GUIDE_DISMISSED_KEY = 'fundSwitch:guideDismissed';

/**
 * 转换分析引导教程组件
 * 首次使用时显示，帮助用户理解如何使用转换分析功能
 */
export function FundSwitchGuide({ onDismiss }) {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      icon: TrendingUp,
      title: '什么是基金转换？',
      content: '基金转换是指将持有的一只基金转换为同一基金公司管理的另一只基金，通常费率更低，且资金到账更快。'
    },
    {
      icon: RefreshCw,
      title: '如何分析转换收益？',
      content: '输入当前持有的基金代码，系统会自动计算转换到其他基金的预期收益、费率对比和历史表现。'
    },
    {
      icon: Link2,
      title: '转换链是什么？',
      content: '转换链展示了可以相互转换的基金组合。例如：513050 ↔ 159941 ↔ 513100，可以在这些基金之间低成本切换。'
    }
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleDismiss();
    }
  };

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(GUIDE_DISMISSED_KEY, 'true');
      } catch (_error) {
        // Ignore
      }
    }
    onDismiss?.();
  };

  const step = steps[currentStep];
  const Icon = step.icon;

  return (
    <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-blue-100 p-2.5">
            <Icon className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">{step.title}</h3>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                {currentStep + 1}/{steps.length}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-slate-600">{step.content}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="关闭引导"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex gap-1.5">
          {steps.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentStep(idx)}
              className={cx(
                'h-1.5 rounded-full transition-all',
                idx === currentStep ? 'w-6 bg-blue-500' : 'w-1.5 bg-slate-300 hover:bg-slate-400'
              )}
              aria-label={`跳转到步骤 ${idx + 1}`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          {currentStep > 0 && (
            <button
              type="button"
              onClick={() => setCurrentStep(currentStep - 1)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              上一步
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-600"
          >
            {currentStep < steps.length - 1 ? '下一步' : '开始使用'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 检查是否应该显示引导教程
 */
export function shouldShowFundSwitchGuide() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(GUIDE_DISMISSED_KEY) !== 'true';
  } catch (_error) {
    return false;
  }
}

/**
 * 重置引导教程状态（用于测试或重新显示）
 */
export function resetFundSwitchGuide() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GUIDE_DISMISSED_KEY);
  } catch (_error) {
    // Ignore
  }
}

/**
 * 转换分析快速提示卡片（精简版，用于页面顶部）
 */
export function FundSwitchQuickTip() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <HelpCircle className="h-5 w-5 flex-shrink-0 text-slate-400" />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium text-slate-700">💡 使用提示</p>
        <p className="text-sm leading-relaxed text-slate-600">
          输入当前持有的基金代码，系统会自动分析转换收益。切换"转换链"可查看多个基金之间的转换关系。
        </p>
      </div>
    </div>
  );
}
