import { Bell, ChevronRight, Info, MoreHorizontal, Star } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toFixed(digits) : '—';
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function tone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'is-neutral';
  return number > 0 ? 'is-up' : 'is-down';
}

function findFund(funds, code) {
  return (Array.isArray(funds) ? funds : []).find((fund) => String(fund?.code || '') === String(code || '')) || null;
}

function spreadFor(fromFund, toFund) {
  const from = Number(fromFund?.premiumPct ?? fromFund?.premiumRate);
  const to = Number(toFund?.premiumPct ?? toFund?.premiumRate);
  return Number.isFinite(from) && Number.isFinite(to) ? from - to : null;
}

function FundSide({ fund, code, name, side }) {
  const premium = fund?.premiumPct ?? fund?.premiumRate;
  return (
    <div className={cx('mobile-switch-compare-side', side === 'high' ? 'is-high' : 'is-low')}>
      <div className="mobile-switch-compare-side__label">{side === 'high' ? '高溢价 H（卖出候选）' : '低溢价 L（买入候选）'}</div>
      <div className="mobile-switch-compare-side__identity"><strong>{code || '—'}</strong><span>{name || fund?.name || '—'}</span></div>
      <div className="mobile-switch-compare-side__metrics"><div><span>最新价</span><b>{formatNumber(fund?.latestNav)}</b></div><div><span>溢价率</span><b>{Number.isFinite(Number(premium)) ? formatPercent(premium) : '—'}</b></div></div>
    </div>
  );
}

export function MobileFundSwitchOpportunity({
  benchmarks = [],
  fundsWithPremium = [],
  intraSignals = [],
  otcSignal,
  prefs,
  navUpdatedHint = '',
  navError = '',
  workerConfig,
}) {
  const signalList = Array.isArray(intraSignals) ? intraSignals : [];
  const primarySignal = signalList[0] || null;
  const highFund = findFund(fundsWithPremium, primarySignal?.from);
  const lowFund = findFund(fundsWithPremium, primarySignal?.to);
  const fallbackHolding = benchmarks[0] || null;
  const spread = spreadFor(highFund, lowFund);
  const hasOtcSignal = Boolean(otcSignal?.ready && otcSignal?.triggered);
  const opportunityCount = signalList.length + (hasOtcSignal ? 1 : 0);
  const threshold = Number(prefs?.arbTargetPct);
  const reminderEnabled = Boolean(workerConfig?.enabled);

  return (
    <div className="mobile-switch-opportunity">
      <div className="mobile-switch-opportunity__title-row">
        <div className="mobile-switch-opportunity__section-title">当前机会 <span>（持有中）</span></div>
        <button type="button" className="mobile-switch-sort-label" aria-label="当前排序">综合排序 <ChevronRight size={15} /></button>
      </div>
      <section className="mobile-switch-current-opportunity">
        {primarySignal ? (
          <>
            <div className="mobile-switch-compare-grid">
              <FundSide fund={highFund} code={primarySignal.from} name={primarySignal.fromName} side="high" />
              <div className="mobile-switch-compare-vs">VS</div>
              <FundSide fund={lowFund} code={primarySignal.to} name={primarySignal.toName} side="low" />
            </div>
            <div className="mobile-switch-spread-panel">
              <div>组合溢价差（H - L） <Info size={13} /></div>
              <strong className={tone(spread)}>{Number.isFinite(spread) ? formatPercent(spread) : '—'}</strong>
              <span>切换优势预估 {Number.isFinite(threshold) && Number.isFinite(spread) ? formatPercent(spread - threshold) : '—'}（未考虑手续费）</span>
            </div>
          </>
        ) : (
          <div className="mobile-switch-empty-card">暂无当前切换机会</div>
        )}
      </section>

      <section className="mobile-switch-overview-section">
        <div className="mobile-switch-section-heading">机会概览 <ChevronRight size={17} /></div>
        <div className="mobile-switch-overview-grid">
          <div><span>组合溢价差</span><b className={tone(spread)}>{Number.isFinite(spread) ? formatPercent(spread) : '—'}</b><small>{Number.isFinite(spread) ? '越大越好' : '—'}</small></div>
          <div><span>历史分位（近1年）</span><b>—</b><small>—</small></div>
          <div><span>预计切换优势</span><b className="is-purple">{Number.isFinite(spread) && Number.isFinite(threshold) ? formatPercent(spread - threshold) : '—'}</b><small>未考虑手续费</small></div>
          <div><span>符合规则的机会</span><b className="is-purple">{opportunityCount || '—'}</b><small>{opportunityCount ? '共 18 组' : '—'}</small></div>
        </div>
        {navError ? <div className="mobile-switch-inline-warning">{navError}</div> : null}
      </section>

      <section className="mobile-switch-opportunity-list">
        <div className="mobile-switch-section-heading"><span>推荐切换机会</span><button type="button" disabled>查看全部 <ChevronRight size={14} /></button></div>
        {signalList.map((signal, index) => {
          const fromFund = findFund(fundsWithPremium, signal.from);
          const toFund = findFund(fundsWithPremium, signal.to);
          const signalSpread = spreadFor(fromFund, toFund);
          return (
            <div className={cx('mobile-switch-opportunity-card', index === 0 && 'is-best')} key={`${signal.kind}-${signal.from}-${signal.to}-${index}`}>
              {index === 0 ? <div className="mobile-switch-best-badge"><Star size={11} /> 最佳机会</div> : null}
              <div className="mobile-switch-opportunity-card__main">
                <div className="mobile-switch-opportunity-card__fund"><i className="mobile-switch-class-dot is-high">H</i><b>{signal.from || '—'}</b><span>{signal.fromName || '—'}</span><small>溢价率 <em>{Number.isFinite(Number(fromFund?.premiumPct)) ? formatPercent(fromFund.premiumPct) : '—'}</em></small></div>
                <div className="mobile-switch-card-vs">VS</div>
                <div className="mobile-switch-opportunity-card__fund is-low"><i className="mobile-switch-class-dot is-low">L</i><b>{signal.to || '—'}</b><span>{signal.toName || '—'}</span><small>溢价率 <em>{Number.isFinite(Number(toFund?.premiumPct)) ? formatPercent(toFund.premiumPct) : '—'}</em></small></div>
                <div className="mobile-switch-opportunity-card__spread"><span>组合溢价差</span><strong className={tone(signalSpread)}>{Number.isFinite(signalSpread) ? formatPercent(signalSpread) : '—'}</strong><ChevronRight size={18} /></div>
              </div>
              <div className="mobile-switch-opportunity-card__metrics"><span>日高下跌 <b>—</b></span><span>历史水位差 <b>—</b></span><span>成交额 <b>—</b></span><button type="button" disabled>查看方案</button></div>
            </div>
          );
        })}
        {hasOtcSignal ? <div className="mobile-switch-opportunity-card"><div className="mobile-switch-opportunity-card__main"><div className="mobile-switch-opportunity-card__fund"><i className="mobile-switch-class-dot is-high">H</i><b>{otcSignal.benchCode || '—'}</b><span>{otcSignal.benchName || '—'}</span></div><div className="mobile-switch-card-vs">VS</div><div className="mobile-switch-opportunity-card__fund is-low"><i className="mobile-switch-class-dot is-low">L</i><b>{otcSignal.lowestCode || '—'}</b><span>{otcSignal.lowestName || '—'}</span></div><div className="mobile-switch-opportunity-card__spread"><span>组合溢价差</span><strong>—</strong><ChevronRight size={18} /></div></div></div> : null}
        {!opportunityCount ? <div className="mobile-switch-empty-card">暂无符合条件的切换机会</div> : null}
      </section>

      {reminderEnabled ? <section className="mobile-switch-reminder-card"><Bell size={27} /><div><strong>智能提醒已开启</strong><span>当组合溢价差 ≥ {Number.isFinite(threshold) ? `${threshold.toFixed(2)}%` : '—'} 时提醒我</span></div><ChevronRight size={18} /></section> : null}
      {!reminderEnabled && fallbackHolding ? <div className="mobile-switch-reminder-placeholder" aria-hidden="true" /> : null}
      {navUpdatedHint ? <div className="mobile-switch-updated-hint">{navUpdatedHint}</div> : null}
    </div>
  );
}

export function MobileFundSwitchEmpty({ title, description, onBack }) {
  return (
    <div className="mobile-switch-empty-page">
      <div className="mobile-switch-empty-page__icon"><Star size={22} /></div>
      <div className="mobile-switch-empty-page__title">{title}</div>
      <div className="mobile-switch-empty-page__description">{description}</div>
      <button type="button" onClick={onBack}>查看推荐机会</button>
    </div>
  );
}
