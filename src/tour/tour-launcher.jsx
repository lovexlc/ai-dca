import { Compass } from 'lucide-react';
import { useTour } from './tour-engine.jsx';

/**
 * 右下角浮动「新手引导」按钮，点击重启 tour。
 * tour 进行中隐藏，避免与 overlay 重叠。
 */
export function TourLauncher() {
  const { isActive, restart } = useTour();
  if (isActive) return null;
  return (
    <button
      type="button"
      className="tour-launcher"
      onClick={restart}
      aria-label="打开新手引导"
    >
      <Compass className="h-4 w-4" aria-hidden="true" />
      <span className="tour-launcher__label">新手引导</span>
    </button>
  );
}
