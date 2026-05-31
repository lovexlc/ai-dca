import { Maximize2, Minimize2 } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';

export function ListExpandButton({ expanded = false, onClick, className = '' }) {
  const Icon = expanded ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      aria-label={expanded ? '缩小列表' : '放大列表'}
      title={expanded ? '缩小列表' : '放大列表'}
      onClick={onClick}
      className={cx('inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1f1f1f]', className)}
    >
      <Icon size={19} strokeWidth={2.2} />
    </button>
  );
}
