// TimeRangeSelector.jsx
//
// 10 + 1 个镜头按钮的 chip-row：
//   今日 / 本周 / 上周 / 本月 / 上月 / 今年YTD / 去年 / 近一年 / 投资以来 / 自定义
// 点「自定义」会展开简易日期范围面板 (两个 native date input + 确定)。
// 移动端横向滚动 (overflow-x-auto)；选中态 = 深色填充。
//
// Props:
//   value          — 当前镜头 key (e.g. 'ytd')
//   onChange       — (nextRange: string) => void
//   customRange    — { from, to } 或 null/undefined
//   onCustomChange — ({ from, to }) => void
//   inceptionEnabled — boolean，false 时 sinceInception 按钮置灰
//   className      — 额外外包层 className

import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../components/experience-ui.jsx';
import { VALID_RANGES } from './rangeUrlSync.js';

const LABELS = {
  today: '今日',
  week: '本周',
  lastWeek: '上周',
  month: '本月',
  lastMonth: '上月',
  ytd: '今年',
  year: '今年',
  lastYear: '去年',
  last365d: '近一年',
  sinceInception: '投资以来',
  custom: '自定义'
};

// 展示顺序（year 是 ytd 的别名，不在按钮里重复出现）
const DISPLAY_ORDER = [
  'today',
  'week',
  'lastWeek',
  'month',
  'lastMonth',
  'ytd',
  'lastYear',
  'last365d',
  'sinceInception',
  'custom'
];

const chipBase = 'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2';
const chipIdle = 'bg-slate-100 text-slate-600 hover:bg-slate-200';
const chipActive = 'bg-slate-900 text-white shadow-sm';
const chipDisabled = 'bg-slate-50 text-slate-300 cursor-not-allowed';

function toIsoOrEmpty(v) {
  if (!v) return '';
  if (typeof v !== 'string') return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

export function TimeRangeSelector({
  value,
  onChange,
  customRange,
  onCustomChange,
  inceptionEnabled = true,
  className = ''
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(() => toIsoOrEmpty(customRange?.from));
  const [draftTo, setDraftTo] = useState(() => toIsoOrEmpty(customRange?.to));
  const pickerRef = useRef(null);

  useEffect(() => {
    setDraftFrom(toIsoOrEmpty(customRange?.from));
    setDraftTo(toIsoOrEmpty(customRange?.to));
  }, [customRange?.from, customRange?.to]);

  // 点击面板外关闭
  useEffect(() => {
    if (!pickerOpen) return undefined;
    function onDocClick(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pickerOpen]);

  const buttons = useMemo(() => DISPLAY_ORDER.filter((key) => VALID_RANGES.includes(key)), []);
  // 选中态判断：ytd 和 year 当作等价
  const activeKey = value === 'year' ? 'ytd' : value;

  const draftValid = !!draftFrom && !!draftTo && draftFrom <= draftTo;
  function commitCustom() {
    if (!draftValid || !onCustomChange) return;
    onCustomChange({ from: draftFrom, to: draftTo });
    setPickerOpen(false);
  }

  return (
    <div className={cx('relative', className)}>
      <div
        role="tablist"
        aria-label="时间镜头"
        className="flex gap-2 overflow-x-auto py-1 -mx-1 px-1 scrollbar-thin"
      >
        {buttons.map((key) => {
          const disabled = key === 'sinceInception' && !inceptionEnabled;
          const isActive = activeKey === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                if (key === 'custom') {
                  setPickerOpen((open) => !open);
                  return;
                }
                onChange?.(key);
              }}
              className={cx(
                chipBase,
                disabled ? chipDisabled : isActive ? chipActive : chipIdle
              )}
            >
              {LABELS[key] || key}
            </button>
          );
        })}
      </div>
      {pickerOpen ? (
        <div
          ref={pickerRef}
          className="absolute right-0 top-full z-20 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg"
        >
          <div className="text-xs font-semibold text-slate-500">自定义区间</div>
          <div className="mt-3 flex flex-col gap-2">
            <label className="flex items-center justify-between gap-3 text-xs text-slate-600">
              <span>从</span>
              <input
                type="date"
                value={draftFrom}
                max={draftTo || undefined}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-slate-200 px-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-xs text-slate-600">
              <span>到</span>
              <input
                type="date"
                value={draftTo}
                min={draftFrom || undefined}
                onChange={(e) => setDraftTo(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-slate-200 px-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!draftValid}
              onClick={commitCustom}
              className={cx(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                draftValid
                  ? 'bg-slate-900 text-white hover:bg-slate-800'
                  : 'bg-slate-100 text-slate-300 cursor-not-allowed'
              )}
            >
              应用
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default TimeRangeSelector;
