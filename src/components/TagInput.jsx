import { X } from 'lucide-react';
import { useId, useState } from 'react';

/**
 * TagInput - 标签式输入组件
 * 用于输入和显示ETF代码列表
 */
export function TagInput({ label, placeholder = '输入代码', tags = [], onChange, className }) {
  const inputId = useId();
  const [inputValue, setInputValue] = useState('');

  function addTag() {
    const trimmed = inputValue.trim().toUpperCase();
    if (trimmed && !tags.includes(trimmed)) {
      const newTags = [...tags, trimmed];
      console.log('TagInput onChange:', newTags);
      onChange(newTags);
    }
    setInputValue('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  function handleBlur() {
    addTag();
  }

  function removeTag(tagToRemove) {
    onChange(tags.filter(tag => tag !== tagToRemove));
  }

  return (
    <div className={className}>
      {label && <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700 mb-2">{label}</label>}
      <div className="rounded-xl border-2 border-slate-200 bg-white p-2 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-semibold text-indigo-700"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`移除 ${tag}`}
                className="hover:bg-indigo-200 rounded p-0.5 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          <input
            id={inputId}
            type="text"
            aria-label={label || placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder={tags.length === 0 ? placeholder : ''}
            className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm text-slate-900 placeholder:text-slate-400"
          />
        </div>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">回车或失焦后自动添加</p>
    </div>
  );
}
