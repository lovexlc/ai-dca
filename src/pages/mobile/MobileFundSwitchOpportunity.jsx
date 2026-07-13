import { Bell, ChevronRight, Info, MoreHorizontal, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
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

function premiumOf(fund) {
  const value = Number(fund?.premiumPct ?? fund?.premiumRate);
  return Number.isFinite(value) ? value : null;
}

function spreadFromSnapshot(group, candidate, highIsBenchmark) {
  const directSpread = Number(candidate?.spreadVsBenchmarkPct);
  if (Number.isFinite(directSpread)) return highIsBenchmark ? directSpread : -directSpread;
  const benchmarkPremium = Number(group?.benchmarkPremiumPct);
  const candidatePremium = Number(candidate?.premiumPct);
  if (!Number.isFinite(benchmarkPremium) || !Number.isFinite(candidatePremium)) return null;
  return highIsBenchmark ? benchmarkPremium - candidatePremium : candidatePremium - benchmarkPremium;
}

function buildOpportunityPairs(snapshot, signals = [], funds = [], prefs = {}) {
  const pairs = [];
  const seen = new Set();
  const addPair = ({ highCode, highName, highFund, lowCode, lowName, lowFund, spread, candidate = null }) => {
    if (!highCode || !lowCode) return;
    const key = `${highCode}:${lowCode}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({
      from: highCode,
      fromName: highName || highFund?.name || highCode,
      to: lowCode,
      toName: lowName || lowFund?.name || lowCode,
      fromFund: highFund,
      toFund: lowFund,
      spread: Number.isFinite(Number(spread)) ? Number(spread) : spreadFor(highFund, lowFund),
      candidate
    });
  };
  for (const group of (Array.isArray(snapshot?.byBenchmark) ? snapshot.byBenchmark : [])) {
    const benchmarkCode = group?.benchmarkCode || '';
    const benchmarkClass = group?.benchmarkClass || '';
    for (const candidate of (Array.isArray(group?.candidates) ? group.candidates : [])) {
      const candidateCode = candidate?.code || '';
      if (!benchmarkCode || !candidateCode) continue;
      const candidateClass = candidate?.candClass || '';
      const highIsBenchmark = benchmarkClass === 'H' || (benchmarkClass !== 'L' && candidateClass === 'L');
      const highCode = highIsBenchmark ? benchmarkCode : candidateCode;
      const lowCode = highIsBenchmark ? candidateCode : benchmarkCode;
      const highFund = findFund(funds, highCode);
      const lowFund = findFund(funds, lowCode);
      addPair({
        highCode,
        highName: highCode === benchmarkCode ? group.benchmarkName : candidate.name,
        highFund,
        lowCode,
        lowName: lowCode === benchmarkCode ? group.benchmarkName : candidate.name,
        lowFund,
        spread: spreadFromSnapshot(group, candidate, highIsBenchmark),
        candidate
      });
    }
  }
  for (const signal of Array.isArray(signals) ? signals : []) {
    const key = `${signal?.from || ''}:${signal?.to || ''}`;
    if (!signal?.from || !signal?.to || seen.has(key)) continue;
    seen.add(key);
    const fromFund = findFund(funds, signal.from);
    const toFund = findFund(funds, signal.to);
    addPair({
      highCode: signal.from,
      highName: signal.fromName,
      highFund: fromFund,
      lowCode: signal.to,
      lowName: signal.toName,
      lowFund: toFund,
      spread: signal.gapPct ?? spreadFor(fromFund, toFund)
    });
  }

  // Worker 快照不存在或尚未写入候选时，使用页面已经加载的轻量行情做本地降级。
  // 这只负责展示当前组合，不替代 Worker 的推送触发判断。
  const classMap = prefs?.premiumClass && typeof prefs.premiumClass === 'object' ? prefs.premiumClass : {};
  const benchmarkCodes = Array.isArray(prefs?.benchmarkCodes) ? prefs.benchmarkCodes : [];
  const enabledCodes = Array.isArray(prefs?.enabledCodes) ? prefs.enabledCodes : [];
  const pool = Array.from(new Set([...benchmarkCodes, ...enabledCodes]));
  for (const benchmarkCode of benchmarkCodes) {
    const benchmarkClass = classMap[benchmarkCode];
    if (benchmarkClass !== 'H' && benchmarkClass !== 'L') continue;
    const opposite = benchmarkClass === 'H' ? 'L' : 'H';
    const benchmarkFund = findFund(funds, benchmarkCode);
    for (const candidateCode of pool) {
      if (candidateCode === benchmarkCode || classMap[candidateCode] !== opposite) continue;
      const candidateFund = findFund(funds, candidateCode);
      const highIsBenchmark = benchmarkClass === 'H';
      addPair({
        highCode: highIsBenchmark ? benchmarkCode : candidateCode,
        highName: highIsBenchmark ? benchmarkFund?.name : candidateFund?.name,
        highFund: highIsBenchmark ? benchmarkFund : candidateFund,
        lowCode: highIsBenchmark ? candidateCode : benchmarkCode,
        lowName: highIsBenchmark ? candidateFund?.name : benchmarkFund?.name,
        lowFund: highIsBenchmark ? candidateFund : benchmarkFund,
        spread: highIsBenchmark
          ? spreadFor(benchmarkFund, candidateFund)
          : spreadFor(candidateFund, benchmarkFund)
      });
    }
  }
  return pairs.sort((a, b) => {
    const aValue = Number(a.spread);
    const bValue = Number(b.spread);
    if (!Number.isFinite(aValue)) return 1;
    if (!Number.isFinite(bValue)) return -1;
    return Math.abs(bValue) - Math.abs(aValue);
  });
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
  workerSnapshot = null,
  otcSignal,
  prefs,
  navUpdatedHint = '',
  navError = '',
  workerError = '',
  workerConfig,
  onViewPlan,
}) {
  const signalList = Array.isArray(intraSignals) ? intraSignals : [];
  const opportunityPairs = buildOpportunityPairs(workerSnapshot, signalList, fundsWithPremium, prefs);
  const [sortMode, setSortMode] = useState('综合排序');
  const [showAll, setShowAll] = useState(false);
  const orderedPairs = useMemo(() => {
    const next = [...opportunityPairs];
    if (sortMode === '代码排序') return next.sort((a, b) => String(a.from).localeCompare(String(b.from)));
    if (sortMode === '溢价差最大') return next.sort((a, b) => Math.abs(Number(b.spread) || 0) - Math.abs(Number(a.spread) || 0));
    return next;
  }, [opportunityPairs, sortMode]);
  const visiblePairs = showAll ? orderedPairs : orderedPairs.slice(0, 3);
  const primaryPair = opportunityPairs[0] || null;
  const highFund = primaryPair?.fromFund || null;
  const lowFund = primaryPair?.toFund || null;
  const fallbackHolding = benchmarks[0] || null;
  const spread = primaryPair?.spread ?? spreadFor(highFund, lowFund);
  const hasOtcSignal = Boolean(otcSignal?.ready && otcSignal?.triggered);
  const opportunityCount = opportunityPairs.length + (hasOtcSignal ? 1 : 0);
  const threshold = Number(prefs?.arbTargetPct);
  const reminderEnabled = Boolean(workerConfig?.enabled);

  return (
    <div className="mobile-switch-opportunity">
      <div className="mobile-switch-opportunity__title-row">
        <div className="mobile-switch-opportunity__section-title">当前机会 <span>（持有中）</span></div>
        <button type="button" className="mobile-switch-sort-label" aria-label="当前排序" onClick={() => setSortMode((current) => current === '综合排序' ? '溢价差最大' : current === '溢价差最大' ? '代码排序' : '综合排序')}>{sortMode} <ChevronRight size={15} /></button>
      </div>
      <section className="mobile-switch-current-opportunity">
        {primaryPair ? (
          <>
            <div className="mobile-switch-compare-grid">
              <FundSide fund={highFund} code={primaryPair.from} name={primaryPair.fromName} side="high" />
              <div className="mobile-switch-compare-vs">VS</div>
              <FundSide fund={lowFund} code={primaryPair.to} name={primaryPair.toName} side="low" />
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
        {workerError ? <div className="mobile-switch-inline-warning">切换策略数据未连接：{workerError}</div> : null}
        {!workerError && navError ? <div className="mobile-switch-inline-warning">{navError}</div> : null}
      </section>

      <section className="mobile-switch-opportunity-list">
        <div className="mobile-switch-section-heading"><span>推荐切换机会</span><button type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? '收起列表' : '查看全部'} <ChevronRight size={14} /></button></div>
        {visiblePairs.map((pair, index) => {
          const fromFund = pair.fromFund;
          const toFund = pair.toFund;
          const signalSpread = pair.spread;
          return (
            <div className={cx('mobile-switch-opportunity-card', index === 0 && 'is-best')} key={`${pair.from}-${pair.to}-${index}`}>
              {index === 0 ? <div className="mobile-switch-best-badge"><Star size={11} /> 最佳机会</div> : null}
              <div className="mobile-switch-opportunity-card__main">
                <div className="mobile-switch-opportunity-card__fund"><i className="mobile-switch-class-dot is-high">H</i><b>{pair.from || '—'}</b><span>{pair.fromName || '—'}</span><small>溢价率 <em>{Number.isFinite(premiumOf(fromFund)) ? formatPercent(premiumOf(fromFund)) : '—'}</em></small></div>
                <div className="mobile-switch-card-vs">VS</div>
                <div className="mobile-switch-opportunity-card__fund is-low"><i className="mobile-switch-class-dot is-low">L</i><b>{pair.to || '—'}</b><span>{pair.toName || '—'}</span><small>溢价率 <em>{Number.isFinite(premiumOf(toFund)) ? formatPercent(premiumOf(toFund)) : '—'}</em></small></div>
                <div className="mobile-switch-opportunity-card__spread"><span>组合溢价差</span><strong className={tone(signalSpread)}>{Number.isFinite(signalSpread) ? formatPercent(signalSpread) : '—'}</strong><ChevronRight size={18} /></div>
              </div>
              <div className="mobile-switch-opportunity-card__metrics"><span>日高下跌 <b>—</b></span><span>历史水位差 <b>—</b></span><span>成交额 <b>—</b></span><button type="button" onClick={() => onViewPlan?.(pair)}>查看方案</button></div>
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
