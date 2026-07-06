import { ArrowDown, ArrowUp } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { Sparkline } from '../../components/markets/Sparkline.jsx';
import { formatMarketPrice, formatNumber, formatPercent, formatSymbolDisplay } from './marketDisplayUtils.js';

export function IndexCard({ entry, onPick, sparkPoints }) {
  const positive = Number(entry.changePercent) > 0;
  const negative = Number(entry.changePercent) < 0;
  const tone = positive ? 'up' : negative ? 'down' : 'flat';
  const change = Number(entry.change);
  const hasChange = Number.isFinite(change);
  return (
    <button
      type="button"
      onClick={() => onPick && onPick(entry)}
      className="group flex min-h-[112px] w-[140px] min-w-0 shrink-0 snap-start flex-col items-start gap-1 overflow-hidden rounded-xl border border-slate-200/70 bg-white p-2 text-left shadow-sm transition hover:shadow-md sm:w-[152px] lg:w-[160px]"
    >
      <div className="w-full flex items-start justify-between gap-2">
        <div className="line-clamp-2 min-h-[30px] text-[13px] font-semibold leading-tight text-slate-900">{entry.name || formatSymbolDisplay(entry.symbol)}</div>
        <div className="flex flex-col items-end ml-2">
          <span className={cx(
            'text-[11px] font-semibold tabular-nums',
            positive ? 'text-rose-600' : negative ? 'text-emerald-600' : 'text-slate-500'
          )}>{formatPercent(entry.changePercent)}</span>
          <span className={cx(
            'inline-flex h-[16px] w-[16px] items-center justify-center rounded-full text-white mt-1',
            positive ? 'bg-rose-500' : negative ? 'bg-emerald-500' : 'bg-slate-300'
          )}>
            {positive ? <ArrowUp size={10} strokeWidth={2} /> : negative ? <ArrowDown size={10} strokeWidth={2} /> : null}
          </span>
        </div>
      </div>
      <div className="w-full flex items-center justify-between">
        <div className="w-2/3 truncate text-[12px] font-medium leading-tight tabular-nums text-slate-700">{formatMarketPrice(entry.price, entry)}</div>
        {hasChange && (
          <div className="text-[10px] leading-none tabular-nums text-slate-500">({change >= 0 ? '+' : ''}{formatMarketPrice(Math.abs(change), entry)})</div>
        )}
      </div>
      <div className="mt-auto -mx-1 w-[calc(100%+0.5rem)] pt-1">
        <Sparkline points={sparkPoints} width={140} height={36} tone={tone} className="h-[36px] w-full" />
      </div>
    </button>
  );
}

export function SidebarRow({ symbol, name, price, changePercent, sparkPoints, selected = false, onSelect, meta = '', isHeld = false }) {
  const pct = Number(changePercent);
  const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
  const up = pct > 0;
  const textTone = flat ? 'text-[#5f6368]' : up ? 'text-[#a50e0e]' : 'text-[#137333]';
  const ArrowIcon = flat ? null : up ? ArrowUp : ArrowDown;
  const sparkTone = flat ? 'flat' : up ? 'up' : 'down';
  const displaySymbol = formatSymbolDisplay(symbol);
  const showName = name && name !== symbol && name !== displaySymbol;
  const detailText = [showName ? name : '', meta].filter(Boolean).join(' · ');
  return (
    <li className="group relative">
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        data-testid="market-row"
        onClick={() => onSelect?.()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect?.();
          }
        }}
        className={cx(
          'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition hover:bg-[#f1f3f4] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30',
          selected && 'bg-[#e8f0fe] ring-1 ring-[#1a73e8]/25 hover:bg-[#e8f0fe]'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={cx('truncate text-[13px] font-medium leading-tight', isHeld ? 'text-[#a50e0e]' : 'text-[#1f1f1f]')}>{displaySymbol}</span>
            {isHeld ? <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#a50e0e]">持仓</span> : null}
          </div>
          {detailText ? <div className={cx('truncate text-[11px] leading-tight', isHeld ? 'text-rose-700/80' : 'text-[#5f6368]')}>{detailText}</div> : null}
        </div>
        {sparkPoints && sparkPoints.length >= 2 ? (
          <Sparkline points={sparkPoints} width={76} height={28} tone={sparkTone} showFill markLast />
        ) : (
          <div className="h-[28px] w-[76px]" />
        )}
        <div className="flex shrink-0 flex-col items-end leading-tight">
          <div className="text-[13px] font-medium tabular-nums text-[#1f1f1f]">{formatMarketPrice(price, { symbol })}</div>
          <div className={cx('flex items-center gap-0.5 text-[11px] tabular-nums', textTone)}>
            {ArrowIcon ? <ArrowIcon size={10} /> : null}
            <span>{formatPercent(changePercent)}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

export function MobileSidebarRow({ symbol, name, price, changePercent, sparkPoints, selected = false, onSelect, meta = '', isHeld = false }) {
  const pct = Number(changePercent);
  const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
  const up = pct > 0;
  // 统一“涨红跌绿”：上涨用红 (#a50e0e)，下跌用绿 (#137333)。
  const textTone = flat ? 'text-[#5f6368]' : up ? 'text-[#a50e0e]' : 'text-[#137333]';
  const circleBg = flat ? 'bg-[#bdc1c6]' : up ? 'bg-[#a50e0e]' : 'bg-[#137333]';
  const ArrowIcon = flat ? null : up ? ArrowUp : ArrowDown;
  const sparkTone = flat ? 'flat' : up ? 'up' : 'down';
  const displaySymbol = formatSymbolDisplay(symbol);
  const showName = name && name !== symbol && name !== displaySymbol;
  const detailText = [showName ? name : '', meta].filter(Boolean).join(' · ');
  return (
    <li
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-testid="market-row"
      onClick={() => onSelect?.()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={cx(
        'flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-3.5 transition [contain-intrinsic-size:72px] [content-visibility:auto] hover:bg-[#f1f3f4] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30',
        selected && 'bg-[#e8f0fe] ring-1 ring-[#1a73e8]/25 hover:bg-[#e8f0fe]'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cx('truncate text-base font-semibold leading-tight', isHeld ? 'text-[#a50e0e]' : 'text-[#1f1f1f]')}>{displaySymbol}</span>
          {isHeld ? <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#a50e0e]">持仓</span> : null}
        </div>
        {detailText ? <div className={cx('truncate text-sm leading-tight', isHeld ? 'text-rose-700/80' : 'text-[#5f6368]')}>{detailText}</div> : null}
      </div>
      {sparkPoints && sparkPoints.length >= 2 ? (
        <Sparkline points={sparkPoints} width={86} height={32} tone={sparkTone} showFill markLast />
      ) : (
        <div className="h-[32px] w-[86px]" />
      )}
      <div className="flex shrink-0 flex-col items-end gap-0.5 leading-tight">
        <div className="text-base font-medium tabular-nums text-[#1f1f1f]">{formatMarketPrice(price, { symbol })}</div>
        <div className="flex items-center gap-1">
          <span className={cx('text-sm font-medium tabular-nums', textTone)}>{formatPercent(changePercent)}</span>
          {ArrowIcon ? (
            <span className={cx('inline-flex h-5 w-5 items-center justify-center rounded-full text-white', circleBg)}>
              <ArrowIcon size={12} strokeWidth={3} />
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
