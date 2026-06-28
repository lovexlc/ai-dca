import { TrendingUp, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem
} from './ui/dropdown-menu.jsx';
import { getAvailableScenarios } from '../app/scenarios.js';

const ICON_MAP = {
  TrendingUp
};

/**
 * 场景切换器组件
 * 在顶部栏显示当前场景，并提供下拉菜单切换
 */
export function ScenarioSwitcher({ currentScenario, isAdmin, onSwitch }) {
  const availableScenarios = getAvailableScenarios(isAdmin);
  const IconComponent = ICON_MAP[currentScenario.icon] || TrendingUp;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
          aria-label="切换使用场景"
        >
          <IconComponent className="w-4 h-4" />
          <span className="inline max-w-[4.5rem] truncate sm:max-w-none">{currentScenario.label}</span>
          <ChevronDown className="w-4 h-4 opacity-60" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>选择使用场景</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {availableScenarios.map((scenario) => {
          const Icon = ICON_MAP[scenario.icon] || TrendingUp;
          const isActive = scenario.key === currentScenario.key;

          return (
            <DropdownMenuCheckboxItem
              key={scenario.key}
              checked={isActive}
              onCheckedChange={() => {
                if (!isActive) {
                  onSwitch(scenario.key);
                }
              }}
              className="flex items-start gap-3 py-2"
            >
              <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="font-medium">{scenario.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {scenario.description}
                </div>
              </div>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
