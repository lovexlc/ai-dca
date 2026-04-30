import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TOUR_STEPS, TOUR_STORAGE_KEY } from './tour-steps.js';

const TourContext = createContext(null);

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error('useTour must be used inside <TourProvider>');
  }
  return ctx;
}

function readCompleted() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === 'true';
  } catch (_e) {
    return false;
  }
}

function writeCompleted(value) {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    } else {
      window.localStorage.removeItem(TOUR_STORAGE_KEY);
    }
  } catch (_e) {
    // 静默忽略 storage 错误（隐私模式 / 配额等）
  }
}

/**
 * TourProvider：管理新手引导的全局状态。
 * - 首次访问（localStorage 未记录）会延迟 700ms 自动开启，等首屏 lazy chunk 稳定。
 * - 切换 step 时若 step 指定了 tab 且与 currentTab 不一致，会调用 navigateToTab。
 * - 关闭 / 走完后写入 completed 标记；用户也可以从 launcher 主动 restart。
 */
export function TourProvider({ children, steps = TOUR_STEPS, navigateToTab, currentTab }) {
  const [stepIndex, setStepIndex] = useState(-1); // -1 = 不显示
  const isActive = stepIndex >= 0 && stepIndex < steps.length;
  const currentStep = isActive ? steps[stepIndex] : null;
  const startTimerRef = useRef(null);

  // 首访自动启动
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (readCompleted()) return undefined;
    startTimerRef.current = window.setTimeout(() => {
      setStepIndex(0);
    }, 700);
    return () => {
      if (startTimerRef.current) {
        window.clearTimeout(startTimerRef.current);
      }
    };
    // 仅在 mount 时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // step 改变时若需要切换 tab，主动切
  useEffect(() => {
    if (!isActive || !currentStep || !currentStep.tab) return;
    if (currentTab !== currentStep.tab && typeof navigateToTab === 'function') {
      navigateToTab(currentStep.tab);
    }
  }, [stepIndex, isActive, currentStep, currentTab, navigateToTab]);

  const start = useCallback(() => {
    setStepIndex(0);
  }, []);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i < 0) return 0;
      if (i + 1 >= steps.length) {
        writeCompleted(true);
        return -1;
      }
      return i + 1;
    });
  }, [steps.length]);

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const close = useCallback((markCompleted = true) => {
    if (markCompleted) writeCompleted(true);
    setStepIndex(-1);
  }, []);

  const restart = useCallback(() => {
    writeCompleted(false);
    setStepIndex(0);
  }, []);

  const value = useMemo(
    () => ({
      isActive,
      stepIndex,
      stepCount: steps.length,
      currentStep,
      steps,
      start,
      next,
      prev,
      close,
      restart
    }),
    [isActive, stepIndex, steps, currentStep, start, next, prev, close, restart]
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
