import { Bell, ChevronRight } from 'lucide-react';
import { Sparkline } from '../markets/Sparkline.jsx';
import {
  formatMarketPrice,
  formatPercent,
  formatPremiumPercent,
  formatSignedPercent,
  formatSymbolDisplay,
  resolveMarketUpdatedAt,
} from '../../pages/markets/marketDisplayUtils.js';
import { resolveCloseHighDrawdown, resolveDayHighDrawdown } from '../../pages/markets/marketHighDrawdown.js';
import { cx } from '../experience-ui.jsx';

const FALLBACK_CARD_METRICS = ['premium', 'historicalPercentile', 'return1w', 'return1m'];

function formatMissing(value) {
  return value === '--' || value == null || value === '' ? '—' : value;
}

function formatUpdateLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(5);
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return raw;
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(timestamp)).replace(/\//g, '-');
  } catch {
    return raw;
  }
}

function metricTone(value, { neutral = false } = {}) {
  if (neutral) return 'is-neutral';
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) < 0.0001) return 'is-neutral';
  return number > 0 ? 'is-up' : 'is-down';
}

function resolveCardMetric(row, id, displayChange) {
  if (id === 'changePercent') {
    return { label: '今日涨跌幅', value: formatMissing(formatPercent(row?.changePercent)), tone: metricTone(row?.changePercent) };
  }
  if (id === 'change') {
    return { label: '今日涨跌额', value: displayChange, tone: metricTone(row?.change) };
  }
  if (id === 'premium') {
    const value = row?.premiumPercent ?? row?.premium_rate;
    return { label: '溢价率', value: formatMissing(formatPremiumPercent(row)), tone: metricTone(value) };
  }
  if (id === 'highDrawdown') {
    const value = resolveDayHighDrawdown(row)?.drawdownPct;
    return { label: '日高下跌', value: value == null ? '—' : formatSignedPercent(value), tone: metricTone(value) };
  }
  if (id === 'closeHighDrawdown') {
    const value = resolveCloseHighDrawdown(row)?.drawdownPct;
    return { label: '历史高点', value: value == null ? '—' : formatSignedPercent(value), tone: metricTone(value) };
  }
  if (id === 'historicalPercentile') {
    const value = Number(row?.historicalPercentile);
    return { label: '历史水位', value: Number.isFinite(value) ? `${value.toFixed(2)}%` : '—', tone: 'is-neutral' };
  }
  if (id === 'currentYearPercent') {
    const value = row?.currentYearPercent ?? row?.ytdReturn;
    return { label: '今年以来', value: value == null ? '—' : formatSignedPercent(value), tone: metricTone(value) };
  }
  if (id.startsWith('return')) {
    const labels = {
      return1w: '近1周',
      return1m: '近1月',
      return3m: '近3月',
      return6m: '近6月',
      return1y: '近1年',
      returnBase: '成立以来',
    };
    const value = row?.[id];
    return { label: labels[id] || id, value: value == null ? '—' : formatSignedPercent(value), tone: metricTone(value) };
  }
  if (id === 'limit') {
    return { label: '申购限额', value: row?.fundLimit?.maxPurchasePerDay ? String(row.fundLimit.maxPurchasePerDay) : '—', tone: 'is-neutral' };
  }
  return { label: id, value: row?.[id] == null ? '—' : String(row[id]), tone: 'is-neutral' };
}

export function MarketWatchlistCard({
  row,
  kline,
  selected = false,
  onClick,
  columns = [],
  cardAnalysisColumns = [],
  showTrend = true,
}) {
  const changePercent = Number(row?.changePercent);
  const changeTone = metricTone(changePercent);
  const isOtc = row?.kind === 'otc' || row?.fundKind === 'otc';
  const numericPrice = Number(row?.price);
  const numericChange = Number(row?.change);
  const displayPrice = Number.isFinite(numericPrice)
    ? (isOtc ? numericPrice.toFixed(4) : formatMarketPrice(numericPrice, row))
    : '—';
  const displayChange = Number.isFinite(numericChange)
    ? `${numericChange > 0 ? '+' : ''}${isOtc ? numericChange.toFixed(4) : formatMarketPrice(numericChange, row)}`
    : '—';
  const visible = new Set(columns.length ? columns : ['kind', 'symbol', 'name', 'price', 'changePercent', 'change', 'updatedAt', 'isHeld', 'alert']);
  const metricIds = Array.from(new Set(cardAnalysisColumns.length ? cardAnalysisColumns : FALLBACK_CARD_METRICS)).slice(0, 6);
  const metrics = metricIds.map((id) => ({ id, ...resolveCardMetric(row, id, displayChange) }));
  const updateLabel = formatUpdateLabel(resolveMarketUpdatedAt(row));
  const displayName = row?.name || formatSymbolDisplay(row?.symbol);
  const symbol = formatSymbolDisplay(row?.symbol);
  const hasTrend = showTrend && Array.isArray(kline) && kline.length > 1;

  return (
    <button
      type="button"
      className={cx('market-mobile-card', selected && 'is-selected')}
      data-market-symbol={row?.symbol || undefined}
      onClick={() => onClick?.(row)}
      aria-pressed={selected}
      aria-label={`查看 ${displayName} ${symbol} 行情详情`}
    >
      <span className="market-mobile-card__header">
        <span className="market-mobile-card__badges">
          {visible.has('kind') ? <span className="market-mobile-card__kind">{isOtc ? '场外基金' : '场内 ETF'}</span> : null}
          {visible.has('symbol') ? <span className="market-mobile-card__symbol type-data">{symbol}</span> : null}
          {visible.has('isHeld') && row?.isHeld ? <span className="market-mobile-card__held">持仓</span> : null}
          {visible.has('isFavorite') && row?.isFavorite ? <span className="market-mobile-card__favorite">自选</span> : null}
        </span>
        <span className="market-mobile-card__actions" aria-hidden="true">
          {visible.has('alert') ? <Bell size={15} /> : null}
          <ChevronRight size={16} />
        </span>
      </span>

      <span className="market-mobile-card__main">
        <span className="market-mobile-card__identity">
          {visible.has('name') ? <strong title={displayName}>{displayName}</strong> : null}
          {visible.has('price') ? <b className="market-mobile-card__price">{displayPrice}</b> : null}
        </span>
        <span className="market-mobile-card__quote">
          <span className={cx('market-mobile-card__change', changeTone)}>
            {visible.has('change') ? <b>{displayChange}</b> : null}
            {visible.has('changePercent') ? <b>{formatMissing(formatPercent(row?.changePercent))}</b> : null}
          </span>
          {hasTrend ? <Sparkline points={kline} width={74} height={24} tone={changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat'} showFill markLast /> : null}
        </span>
      </span>

      {metrics.length ? (
        <span className="market-mobile-card__metrics" aria-label="行情分析指标">
          {metrics.map((metric) => (
            <span key={metric.id}>
              <small>{metric.label}</small>
              <b className={metric.tone}>{metric.value}</b>
            </span>
          ))}
        </span>
      ) : null}

      {visible.has('updatedAt') ? <span className="market-mobile-card__updated">更新时间&nbsp;&nbsp;{updateLabel}</span> : null}
    </button>
  );
}
