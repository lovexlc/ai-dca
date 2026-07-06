import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, TrendingUp } from 'lucide-react';
import { getAvailableScenarios } from '../app/scenarios.js';

const ICON_MAP = {
  TrendingUp
};

/**
 * 场景切换器组件
 * 在顶部栏显示当前场景，并提供下拉菜单切换
 */
export function ScenarioSwitcher({ currentScenario, isAdmin, onSwitch }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const availableScenarios = getAvailableScenarios(isAdmin);
  const IconComponent = ICON_MAP[currentScenario.icon] || TrendingUp;
  const hasOptions = availableScenarios.length > 1;

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
        aria-label="切换使用场景"
        aria-haspopup={hasOptions ? 'menu' : undefined}
        aria-expanded={hasOptions ? open : undefined}
        onClick={() => {
          if (hasOptions) setOpen((value) => !value);
        }}
      >
        <IconComponent className="h-4 w-4" aria-hidden="true" />
        <span className="inline max-w-[4.5rem] truncate sm:max-w-none">{currentScenario.label}</span>
        {hasOptions ? <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" /> : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-full z-[120] mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10"
          role="menu"
          aria-label="选择使用场景"
        >
          {availableScenarios.map((scenario) => {
            const Icon = ICON_MAP[scenario.icon] || TrendingUp;
            const isActive = scenario.key === currentScenario.key;

            return (
              <button
                key={scenario.key}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setOpen(false);
                  if (!isActive) onSwitch(scenario.key);
                }}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{scenario.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{scenario.description}</span>
                </span>
                {isActive ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
