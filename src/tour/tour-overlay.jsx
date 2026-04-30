import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTour } from './tour-engine.jsx';
import '../styles/tour.css';

const HIGHLIGHT_PADDING = 8;
const TOOLTIP_GAP = 14;
const TOOLTIP_WIDTH = 340;
const TOOLTIP_MAX_HEIGHT = 320;
const VIEWPORT_MARGIN = 16;

function getTargetRect(selector) {
  if (!selector || typeof document === 'undefined') return null;
  try {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  } catch (_e) {
    return null;
  }
}

function computeTooltipPosition(targetRect, placement) {
  if (typeof window === 'undefined') return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!targetRect || placement === 'center') {
    return {
      top: Math.max(VIEWPORT_MARGIN, vh / 2 - 140),
      left: Math.max(VIEWPORT_MARGIN, vw / 2 - TOOLTIP_WIDTH / 2),
      mode: 'center'
    };
  }
  const candidates = [
    {
      name: 'right',
      top: Math.min(
        Math.max(VIEWPORT_MARGIN, targetRect.top),
        vh - TOOLTIP_MAX_HEIGHT - VIEWPORT_MARGIN
      ),
      left: targetRect.right + TOOLTIP_GAP,
      fits: targetRect.right + TOOLTIP_GAP + TOOLTIP_WIDTH + VIEWPORT_MARGIN <= vw
    },
    {
      name: 'bottom',
      top: targetRect.bottom + TOOLTIP_GAP,
      left: Math.min(
        Math.max(VIEWPORT_MARGIN, targetRect.left),
        vw - TOOLTIP_WIDTH - VIEWPORT_MARGIN
      ),
      fits: targetRect.bottom + TOOLTIP_GAP + TOOLTIP_MAX_HEIGHT + VIEWPORT_MARGIN <= vh
    },
    {
      name: 'top',
      top: targetRect.top - TOOLTIP_GAP - TOOLTIP_MAX_HEIGHT,
      left: Math.min(
        Math.max(VIEWPORT_MARGIN, targetRect.left),
        vw - TOOLTIP_WIDTH - VIEWPORT_MARGIN
      ),
      fits: targetRect.top - TOOLTIP_GAP - TOOLTIP_MAX_HEIGHT >= VIEWPORT_MARGIN
    },
    {
      name: 'left',
      top: Math.min(
        Math.max(VIEWPORT_MARGIN, targetRect.top),
        vh - TOOLTIP_MAX_HEIGHT - VIEWPORT_MARGIN
      ),
      left: targetRect.left - TOOLTIP_GAP - TOOLTIP_WIDTH,
      fits: targetRect.left - TOOLTIP_GAP - TOOLTIP_WIDTH >= VIEWPORT_MARGIN
    }
  ];
  const fitting = candidates.find((c) => c.fits) || candidates[0];
  return { top: fitting.top, left: fitting.left, mode: fitting.name };
}

export function TourOverlay() {
  const { isActive, currentStep, stepIndex, stepCount, next, prev, close } = useTour();
  const [rect, setRect] = useState(null);
  const [tooltipPos, setTooltipPos] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  const tooltipRef = useRef(null);

  useEffect(() => {
    setRect(null);
    setRetryTick(0);
  }, [stepIndex]);

  useLayoutEffect(() => {
    if (!isActive || !currentStep) return undefined;
    const r = getTargetRect(currentStep.target);
    setRect(r);
    setTooltipPos(computeTooltipPosition(r, currentStep.placement));
    return undefined;
  }, [isActive, currentStep, retryTick]);

  useEffect(() => {
    if (!isActive || !currentStep || !currentStep.target) return undefined;
    if (rect) return undefined;
    if (retryTick > 20) return undefined;
    const t = window.setTimeout(() => setRetryTick((n) => n + 1), 150);
    return () => window.clearTimeout(t);
  }, [isActive, currentStep, rect, retryTick]);

  useEffect(() => {
    if (!isActive || !currentStep) return undefined;
    function update() {
      const r = getTargetRect(currentStep.target);
      setRect(r);
      setTooltipPos(computeTooltipPosition(r, currentStep.placement));
    }
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isActive, currentStep]);

  useEffect(() => {
    if (!isActive) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        close(true);
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        next();
      } else if (e.key === 'ArrowLeft') {
        prev();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive, close, next, prev]);

  if (!isActive || !currentStep) return null;

  const placement = currentStep.placement || 'auto';
  const wantsCenter = placement === 'center' || !currentStep.target || !rect;

  const padded = rect
    ? {
        top: rect.top - HIGHLIGHT_PADDING,
        left: rect.left - HIGHLIGHT_PADDING,
        width: rect.width + HIGHLIGHT_PADDING * 2,
        height: rect.height + HIGHLIGHT_PADDING * 2
      }
    : null;

  const cutoutRects =
    padded && !wantsCenter
      ? [
          { top: 0, left: 0, width: '100%', height: Math.max(0, padded.top) },
          {
            top: padded.top,
            left: 0,
            width: Math.max(0, padded.left),
            height: padded.height
          },
          {
            top: padded.top,
            left: padded.left + padded.width,
            right: 0,
            height: padded.height
          },
          { top: padded.top + padded.height, left: 0, width: '100%', bottom: 0 }
        ]
      : null;

  const highlightStyle = padded
    ? {
        top: padded.top,
        left: padded.left,
        width: padded.width,
        height: padded.height
      }
    : null;

  const tooltipStyle = wantsCenter
    ? {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: TOOLTIP_WIDTH
      }
    : tooltipPos
      ? { top: tooltipPos.top, left: tooltipPos.left, width: TOOLTIP_WIDTH }
      : null;

  const isLast = stepIndex === stepCount - 1;
  const isFirst = stepIndex === 0;
  const progressLabel = `${stepIndex + 1} / ${stepCount}`;

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="新手引导">
      {wantsCenter ? (
        <div className="tour-overlay__dim tour-overlay__dim--full" />
      ) : (
        cutoutRects.map((style, i) => (
          <div key={i} className="tour-overlay__dim" style={style} />
        ))
      )}

      {highlightStyle && !wantsCenter ? (
        <div className="tour-overlay__highlight" style={highlightStyle} />
      ) : null}

      {tooltipStyle ? (
        <div ref={tooltipRef} className="tour-tooltip" style={tooltipStyle}>
          <div className="tour-tooltip__head">
            <div className="tour-tooltip__progress">{progressLabel}</div>
            <button
              type="button"
              className="tour-tooltip__close"
              aria-label="关闭新手引导"
              onClick={() => close(true)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="tour-tooltip__title">{currentStep.title}</div>
          <div className="tour-tooltip__body">{currentStep.body}</div>
          <div className="tour-tooltip__foot">
            <button type="button" className="tour-tooltip__skip" onClick={() => close(true)}>
              跳过
            </button>
            <div className="tour-tooltip__nav">
              <button
                type="button"
                className="tour-tooltip__btn tour-tooltip__btn--ghost"
                onClick={prev}
                disabled={isFirst}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                上一步
              </button>
              <button type="button" className="tour-tooltip__btn" onClick={next}>
                {isLast ? '完成' : '下一步'}
                {!isLast ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : null}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
