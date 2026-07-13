import { ChevronRight, Info, Star } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';

function signedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function formatPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toFixed(4) : '—';
}

function tone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'is-neutral';
  return number > 0 ? 'is-up' : 'is-down';
}

export function MobileFundSwitchOpportunity({
  benchmarks = [],
  intraSignals = [],
  otcSignal,
  prefs,
  navUpdatedHint = '',
  navError = '',
}) {
  const holding = benchmarks[0] || null;
  const signalList = Array.isArray(intraSignals) ? intraSignals : [];
  const hasOtcSignal = Boolean(otcSignal?.ready && otcSignal?.triggered);
  const opportunityCount = signalList.length + (hasOtcSignal ? 1 : 0);
  const hasCurrentQuote = Number(holding?.latestNav) > 0;
  const premium = holding?.premiumPct ?? holding?.premiumRate;
  const threshold = Number(prefs?.arbTargetPct);

  return (
    <div className="mobile-switch-opportunity">
      <div className="mobile-switch-opportunity__toolbar">
        <div className="mobile-switch-opportunity__toolbar-title">推荐机会</div>
        <button type="button" className="mobile-switch-sort-label" aria-label="当前排序">综合排序 <ChevronRight size={13} /></button>
      </div>

      <section className="mobile-switch-card mobile-switch-holding-card">
        <div className="mobile-switch-card__eyebrow">当前持仓</div>
        {holding ? (
          <div className="mobile-switch-holding-card__row">
            <div className="mobile-switch-fund-title">
              <span className="mobile-switch-fund-pill">纳指100</span>
              <strong>{holding.code} · {holding.name || '—'}</strong>
            </div>
            <span className="mobile-switch-status-pill">持有</span>
          </div>
        ) : <div className="mobile-switch-empty-line">—</div>}
        <div className="mobile-switch-metric-grid mobile-switch-metric-grid--four">
          <div><span>最新价</span><b>{formatPrice(holding?.latestNav)}</b></div>
          <div><span>溢价率</span><b className={tone(premium)}>{hasCurrentQuote && Number.isFinite(Number(premium)) ? signedPercent(premium) : '—'}</b></div>
          <div><span>历史水位</span><b>—</b></div>
          <div><span>更新时间</span><b>{navUpdatedHint ? navUpdatedHint.replace('NAV 最新日期 ', '') : '—'}</b></div>
        </div>
      </section>

      <section className="mobile-switch-card mobile-switch-overview-card">
        <div className="mobile-switch-section-title">机会概览 <Info size={13} /></div>
        <div className="mobile-switch-metric-grid mobile-switch-metric-grid--four">
          <div><span>组合溢价差 (H-L)</span><b className="is-up">—</b></div>
          <div><span>历史分位 (近年)</span><b>—</b></div>
          <div><span>预计切换优势</span><b>{opportunityCount && Number.isFinite(threshold) ? `≥ ${threshold.toFixed(2)}%` : '—'}</b></div>
          <div><span>符合规则的机会</span><b>{opportunityCount}</b></div>
        </div>
        {navError ? <div className="mobile-switch-inline-warning">{navError}</div> : null}
      </section>

      <section className="mobile-switch-opportunity-list">
        <div className="mobile-switch-section-title">推荐切换机会 <span>{opportunityCount} 条</span></div>
        {signalList.map((signal, index) => (
          <div className="mobile-switch-opportunity-card" key={`${signal.kind}-${signal.from}-${signal.to}-${index}`}>
            <div className="mobile-switch-opportunity-card__topline">
              <span className={cx('mobile-switch-rule-pill', signal.kind === 'A' ? 'is-red' : 'is-green')}>规则 {signal.kind}</span>
              <span className="mobile-switch-opportunity-card__rank">推荐 {index + 1}</span>
            </div>
            <div className="mobile-switch-opportunity-card__funds">
              <div><b>{signal.from || '—'}</b><span>{signal.fromName || '—'}</span></div>
              <ChevronRight size={18} />
              <div><b>{signal.to || '—'}</b><span>{signal.toName || '—'}</span></div>
            </div>
            <div className="mobile-switch-opportunity-card__summary">
              <span>组合溢价差</span><strong>—</strong>
              <span>日高下跌</span><strong>—</strong>
              <span>历史水位</span><strong>—</strong>
            </div>
          </div>
        ))}
        {hasOtcSignal ? (
          <div className="mobile-switch-opportunity-card">
            <div className="mobile-switch-opportunity-card__topline"><span className="mobile-switch-rule-pill is-purple">场外机会</span><span className="mobile-switch-opportunity-card__rank">推荐</span></div>
            <div className="mobile-switch-opportunity-card__funds"><div><b>{otcSignal.benchCode || '—'}</b><span>{otcSignal.benchName || '—'}</span></div><ChevronRight size={18} /><div><b>{otcSignal.lowestCode || '—'}</b><span>{otcSignal.lowestName || '—'}</span></div></div>
            <div className="mobile-switch-opportunity-card__summary"><span>信号等级</span><strong>{otcSignal.level || '—'}</strong><span>组合溢价差</span><strong>—</strong></div>
          </div>
        ) : null}
        {!opportunityCount ? <div className="mobile-switch-empty-card">暂无符合条件的切换机会</div> : null}
      </section>


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
