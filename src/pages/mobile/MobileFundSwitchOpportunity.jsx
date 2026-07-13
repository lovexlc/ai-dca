import {
  Bell,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  SlidersHorizontal,
  Sparkles,
  Star,
  Target,
  Zap
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cx } from '../../components/experience-ui.jsx';

const SWITCH_WATCHLIST_KEY = 'aiDcaSwitchWatchlist';

function normalizeWatchEntry(entry = {}) {
  const from = String(entry?.from || entry?.fromCode || '').trim();
  const to = String(entry?.to || entry?.toCode || '').trim();
  if (!from || !to) return null;
  return {
    id: String(entry?.id || `${from}:${to}`).trim(),
    from,
    fromName: String(entry?.fromName || from).trim(),
    to,
    toName: String(entry?.toName || to).trim(),
    fromFund: entry?.fromFund && typeof entry.fromFund === 'object' ? entry.fromFund : {},
    toFund: entry?.toFund && typeof entry.toFund === 'object' ? entry.toFund : {},
    spread: numberValue(entry?.spread),
    reminderEnabled: Boolean(entry?.reminderEnabled),
    reminderThreshold: numberValue(entry?.reminderThreshold),
    createdAt: String(entry?.createdAt || '').trim(),
    updatedAt: String(entry?.updatedAt || '').trim()
  };
}

export function readSwitchWatchlist() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(SWITCH_WATCHLIST_KEY) || '[]');
    return (Array.isArray(raw) ? raw : []).map(normalizeWatchEntry).filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function writeSwitchWatchlist(entries) {
  const next = (Array.isArray(entries) ? entries : []).map(normalizeWatchEntry).filter(Boolean);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SWITCH_WATCHLIST_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('fund-switch:watchlist-change'));
  }
  return next;
}

function upsertSwitchWatch(entry, patch = {}) {
  const normalized = normalizeWatchEntry({ ...entry, ...patch });
  if (!normalized) return readSwitchWatchlist();
  const entries = readSwitchWatchlist();
  const now = new Date().toISOString();
  const nextEntry = { ...normalized, createdAt: normalized.createdAt || now, updatedAt: now };
  const index = entries.findIndex((item) => item.id === nextEntry.id);
  if (index < 0) return writeSwitchWatchlist([nextEntry, ...entries]);
  const next = entries.slice();
  next[index] = nextEntry;
  return writeSwitchWatchlist(next);
}

function removeSwitchWatch(id) {
  return writeSwitchWatchlist(readSwitchWatchlist().filter((item) => item.id !== id));
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits = 2) {
  const number = numberValue(value);
  return number === null || number <= 0 ? '—' : number.toFixed(digits);
}

function formatPercent(value) {
  const number = numberValue(value);
  if (number === null) return '—';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function formatAmount(value) {
  const number = numberValue(value);
  if (number === null || number < 0) return '—';
  if (number >= 100000000) return `${(number / 100000000).toFixed(2)}亿`;
  if (number >= 10000) return `${(number / 10000).toFixed(2)}万`;
  return number.toFixed(0);
}

function tone(value) {
  const number = numberValue(value);
  if (number === null || number === 0) return 'is-neutral';
  return number > 0 ? 'is-up' : 'is-down';
}

function findFund(funds, code) {
  return (Array.isArray(funds) ? funds : []).find((fund) => String(fund?.code || '') === String(code || '')) || null;
}

function premiumOf(fund) {
  return numberValue(fund?.premiumPct ?? fund?.premiumRate);
}

function spreadFor(fromFund, toFund) {
  const from = premiumOf(fromFund);
  const to = premiumOf(toFund);
  return from !== null && to !== null ? from - to : null;
}

function spreadFromSnapshot(group, candidate, highIsBenchmark) {
  const directSpread = numberValue(candidate?.spreadVsBenchmarkPct);
  if (directSpread !== null) return highIsBenchmark ? directSpread : -directSpread;
  const benchmarkPremium = numberValue(group?.benchmarkPremiumPct);
  const candidatePremium = numberValue(candidate?.premiumPct);
  if (benchmarkPremium === null || candidatePremium === null) return null;
  return highIsBenchmark ? benchmarkPremium - candidatePremium : candidatePremium - benchmarkPremium;
}

function mergeFund(fund, code, name, snapshot = {}) {
  return {
    ...(fund || {}),
    code,
    name: name || fund?.name || code,
    latestNav: numberValue(fund?.latestNav ?? snapshot.price),
    navLatest: numberValue(fund?.navLatest ?? snapshot.nav),
    premiumPct: numberValue(fund?.premiumPct ?? fund?.premiumRate ?? snapshot.premiumPct),
    premiumRate: numberValue(fund?.premiumRate ?? fund?.premiumPct ?? snapshot.premiumPct),
    highPoint: numberValue(fund?.highPoint ?? snapshot.highPoint),
    yearHigh: numberValue(fund?.yearHigh ?? snapshot.yearHigh),
    historicalPercentile: numberValue(fund?.historicalPercentile ?? snapshot.historicalPercentile),
    turnover: numberValue(fund?.turnover ?? fund?.turnoverAmount ?? snapshot.turnover),
    amount: numberValue(fund?.amount ?? fund?.成交额 ?? snapshot.amount),
    asOf: fund?.asOf || snapshot.asOf || snapshot.computedAt || ''
  };
}

function buildOpportunityPairs(snapshot, signals = [], funds = [], prefs = {}) {
  const pairs = [];
  const seen = new Set();
  const addPair = ({ highCode, highName, highFund, highSnapshot, lowCode, lowName, lowFund, lowSnapshot, spread, candidate = null }) => {
    if (!highCode || !lowCode) return;
    const key = `${highCode}:${lowCode}`;
    if (seen.has(key)) return;
    seen.add(key);
    const from = mergeFund(highFund, highCode, highName, highSnapshot);
    const to = mergeFund(lowFund, lowCode, lowName, lowSnapshot);
    pairs.push({
      from: highCode,
      fromName: from.name,
      to: lowCode,
      toName: to.name,
      fromFund: from,
      toFund: to,
      spread: numberValue(spread) ?? spreadFor(from, to),
      candidate,
      rule: candidate?.rule || '',
      computedAt: candidate?.computedAt || highSnapshot?.computedAt || ''
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
      addPair({
        highCode,
        highName: highCode === benchmarkCode ? group.benchmarkName : candidate.name,
        highFund: findFund(funds, highCode),
        highSnapshot: highCode === benchmarkCode ? {
          price: group.benchmarkPrice,
          nav: group.benchmarkNav,
          premiumPct: group.benchmarkPremiumPct,
          highPoint: group.benchmarkHighPoint,
          yearHigh: group.benchmarkYearHigh,
          historicalPercentile: group.benchmarkHistoricalPercentile,
          turnover: group.benchmarkTurnover,
          amount: group.benchmarkAmount,
          computedAt: snapshot?.computedAt
        } : candidate,
        lowCode,
        lowName: lowCode === benchmarkCode ? group.benchmarkName : candidate.name,
        lowFund: findFund(funds, lowCode),
        lowSnapshot: lowCode === benchmarkCode ? {
          price: group.benchmarkPrice,
          nav: group.benchmarkNav,
          premiumPct: group.benchmarkPremiumPct,
          highPoint: group.benchmarkHighPoint,
          yearHigh: group.benchmarkYearHigh,
          historicalPercentile: group.benchmarkHistoricalPercentile,
          turnover: group.benchmarkTurnover,
          amount: group.benchmarkAmount,
          computedAt: snapshot?.computedAt
        } : candidate,
        spread: spreadFromSnapshot(group, candidate, highIsBenchmark),
        candidate
      });
    }
  }

  for (const signal of Array.isArray(signals) ? signals : []) {
    if (!signal?.from || !signal?.to) continue;
    const fromFund = findFund(funds, signal.from);
    const toFund = findFund(funds, signal.to);
    addPair({
      highCode: signal.from,
      highName: signal.fromName,
      highFund: fromFund,
      lowCode: signal.to,
      lowName: signal.toName,
      lowFund: toFund,
      spread: signal.gapPct ?? spreadFor(fromFund, toFund),
      candidate: signal
    });
  }

  const classMap = prefs?.premiumClass && typeof prefs.premiumClass === 'object' ? prefs.premiumClass : {};
  const benchmarkCodes = Array.isArray(prefs?.benchmarkCodes) ? prefs.benchmarkCodes : [];
  const enabledCodes = Array.isArray(prefs?.enabledCodes) ? prefs.enabledCodes : [];
  const pool = Array.from(new Set([...benchmarkCodes, ...enabledCodes]));
  for (const benchmarkCode of benchmarkCodes) {
    const benchmarkClass = classMap[benchmarkCode];
    if (benchmarkClass !== 'H' && benchmarkClass !== 'L') continue;
    const benchmarkFund = findFund(funds, benchmarkCode);
    for (const candidateCode of pool) {
      if (candidateCode === benchmarkCode || classMap[candidateCode] === benchmarkClass) continue;
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

  return pairs.sort((a, b) => (numberValue(b.spread) === null ? -1 : numberValue(a.spread) === null ? 1 : Math.abs(b.spread) - Math.abs(a.spread)));
}

function FundSide({ fund, code, name, side }) {
  const premium = premiumOf(fund);
  return (
    <div className={cx('mobile-switch-compare-side', side === 'high' ? 'is-high' : 'is-low')}>
      <div className="mobile-switch-compare-side__label">{side === 'high' ? '高溢价 H（卖出候选）' : '低溢价 L（买入候选）'}</div>
      <div className="mobile-switch-compare-side__identity"><strong>{code || '—'}</strong><span>{name || fund?.name || '—'}</span></div>
      <div className="mobile-switch-compare-side__metrics"><div><span>最新价</span><b>{formatNumber(fund?.latestNav)}</b></div><div><span>溢价率</span><b>{formatPercent(premium)}</b></div></div>
    </div>
  );
}

function PairCard({ pair, index, onOpen }) {
  const fromPremium = premiumOf(pair.fromFund);
  const toPremium = premiumOf(pair.toFund);
  const card = (
    <div className={cx('mobile-switch-opportunity-card', index === 0 && 'is-best')}>
      {index === 0 ? <div className="mobile-switch-best-badge"><Star size={11} /> 最佳机会</div> : null}
      <div className="mobile-switch-opportunity-card__main">
        <div className="mobile-switch-opportunity-card__fund"><i className="mobile-switch-class-dot is-high">H</i><b>{pair.from || '—'}</b><span>{pair.fromName || '—'}</span><small>溢价率 <em>{formatPercent(fromPremium)}</em></small></div>
        <div className="mobile-switch-card-vs">VS</div>
        <div className="mobile-switch-opportunity-card__fund is-low"><i className="mobile-switch-class-dot is-low">L</i><b>{pair.to || '—'}</b><span>{pair.toName || '—'}</span><small>溢价率 <em>{formatPercent(toPremium)}</em></small></div>
        <div className="mobile-switch-opportunity-card__spread"><span>组合溢价差</span><strong className={tone(pair.spread)}>{formatPercent(pair.spread)}</strong><ChevronRight size={18} /></div>
      </div>
      <div className="mobile-switch-opportunity-card__metrics"><span>日高下跌 <b>{formatPercent(pair.fromFund?.highPoint && pair.fromFund?.latestNav ? ((pair.fromFund.highPoint - pair.fromFund.latestNav) / pair.fromFund.highPoint) * 100 : null)}</b></span><span>历史水位 <b>{pair.fromFund?.historicalPercentile === null || pair.fromFund?.historicalPercentile === undefined ? '—' : formatPercent(pair.fromFund.historicalPercentile)}</b></span><span>成交额 <b>{formatAmount(pair.fromFund?.turnover ?? pair.fromFund?.amount)}</b></span><span className="mobile-switch-opportunity-card__action">查看方案 <ChevronRight size={13} /></span></div>
    </div>
  );
  return <button type="button" className="mobile-switch-opportunity-card-button" onClick={() => onOpen(pair)} aria-label={`查看 ${pair.from || '—'} 切换至 ${pair.to || '—'} 的方案`}>{card}</button>;
}

function OverviewMetric({ label, value, note, className = '' }) {
  return <div><span>{label}</span><b className={className}>{value}</b><small>{note}</small></div>;
}

function OpportunityDetail({ pair, threshold, onBack, onCreatePlan, watching = false, reminded = false, onToggleWatch, onToggleReminder }) {
  const [activeTab, setActiveTab] = useState('metrics');
  const advantage = numberValue(pair?.spread) !== null && numberValue(threshold) !== null ? pair.spread - threshold : null;
  const rows = [
    ['溢价率', formatPercent(pair?.fromFund?.premiumPct), formatPercent(pair?.toFund?.premiumPct), formatPercent(pair?.spread)],
    ['日高下跌', formatPercent(pair?.fromFund?.highPoint && pair?.fromFund?.latestNav ? ((pair.fromFund.highPoint - pair.fromFund.latestNav) / pair.fromFund.highPoint) * 100 : null), formatPercent(pair?.toFund?.highPoint && pair?.toFund?.latestNav ? ((pair.toFund.highPoint - pair.toFund.latestNav) / pair.toFund.highPoint) * 100 : null), '—'],
    ['历史水位', pair?.fromFund?.historicalPercentile === null || pair?.fromFund?.historicalPercentile === undefined ? '—' : formatPercent(pair.fromFund.historicalPercentile), pair?.toFund?.historicalPercentile === null || pair?.toFund?.historicalPercentile === undefined ? '—' : formatPercent(pair.toFund.historicalPercentile), '—'],
    ['成交额（近1日）', formatAmount(pair?.fromFund?.turnover ?? pair?.fromFund?.amount), formatAmount(pair?.toFund?.turnover ?? pair?.toFund?.amount), '—'],
    ['更新时间', pair?.fromFund?.asOf ? new Date(pair.fromFund.asOf).toLocaleString('zh-CN', { hour12: false }) : '—', pair?.toFund?.asOf ? new Date(pair.toFund.asOf).toLocaleString('zh-CN', { hour12: false }) : '—', '—']
  ];
  return (
    <div className="mobile-switch-detail-page">
      <div className="mobile-switch-detail-header"><button type="button" aria-label="返回推荐切换机会" onClick={onBack}><ChevronLeft size={20} /></button><strong>方案详情</strong><div><button type="button" aria-label="加入关注" className={watching ? 'is-active' : ''} onClick={() => onToggleWatch?.()}><Star size={19} /></button><button type="button" aria-label="分享方案"><ExternalLink size={18} /></button></div></div>
      <div className="mobile-switch-detail-pair"><FundSide fund={pair?.fromFund} code={pair?.from} name={pair?.fromName} side="high" /><div className="mobile-switch-compare-vs">VS</div><FundSide fund={pair?.toFund} code={pair?.to} name={pair?.toName} side="low" /></div>
      <div className="mobile-switch-spread-panel"><div>组合溢价差（H - L） <Info size={13} /></div><strong className={tone(pair?.spread)}>{formatPercent(pair?.spread)}</strong><span>切换优势预估 {formatPercent(advantage)}（未考虑手续费）</span></div>
      <section className="mobile-switch-detail-insight"><h3>机会解读</h3><div><span>溢价差较大</span><span>流动性较好</span><span>底交额度足够</span><span>满足提醒阈值</span></div></section>
      <section className="mobile-switch-detail-data"><div className="mobile-switch-detail-tabs" role="tablist">{[['metrics', '关键指标'], ['estimate', '收益测算'], ['rules', '触发规则'], ['history', '历史记录']].map(([key, label]) => <button type="button" role="tab" aria-selected={activeTab === key} className={activeTab === key ? 'is-active' : ''} key={key} onClick={() => setActiveTab(key)}>{label}</button>)}</div>{activeTab === 'metrics' ? <div className="mobile-switch-detail-table"><div className="mobile-switch-detail-table__head"><span>指标</span><span>🔴 {pair?.from || '—'}</span><span>🟢 {pair?.to || '—'}</span><span>差值（H-L）</span></div>{rows.map(([label, from, to, diff]) => <div className="mobile-switch-detail-table__row" key={label}><span>{label}</span><span>{from}</span><span>{to}</span><span>{diff}</span></div>)}<p><Info size={13} /> 组合溢价差 = H 溢价率 - L 溢价率</p></div> : <div className="mobile-switch-detail-placeholder">{activeTab === 'estimate' ? `收益测算 ${formatPercent(advantage)}，当前未提供手续费和持仓份额，暂不生成金额结果。` : activeTab === 'rules' ? '当前页面展示快照中可用的触发规则，未返回的规则字段留空。' : '暂无历史触发记录。'}</div>}</section>
      <section className="mobile-switch-detail-actions"><h3>交互操作</h3><div><button type="button" onClick={() => onToggleWatch?.()}><Star size={16} />{watching ? '已关注' : '加入关注'}</button><button type="button" onClick={() => onToggleReminder?.()}><Bell size={16} />{reminded ? '已设置' : '设置提醒'}</button><button type="button" className="is-primary" onClick={() => onCreatePlan?.(pair)}><Zap size={16} />立即切换 <ChevronRight size={16} /></button></div></section>
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
  const [screen, setScreen] = useState('overview');
  const [filter, setFilter] = useState('全部');
  const [sortMode, setSortMode] = useState('组合溢价差');
  const [selectedPair, setSelectedPair] = useState(null);
  const [watchlist, setWatchlist] = useState(readSwitchWatchlist);
  const opportunityPairs = buildOpportunityPairs(workerSnapshot, intraSignals, fundsWithPremium, prefs);
  const threshold = numberValue(prefs?.arbTargetPct);
  const reminderEnabled = Boolean(workerConfig?.enabled);
  const primaryPair = opportunityPairs[0] || null;
  const filteredPairs = useMemo(() => {
    const next = filter === '最佳机会' ? opportunityPairs.slice(0, 1) : opportunityPairs;
    if (sortMode === '代码') return [...next].sort((a, b) => String(a.from).localeCompare(String(b.from)));
    return [...next].sort((a, b) => (numberValue(b.spread) ?? -Infinity) - (numberValue(a.spread) ?? -Infinity));
  }, [filter, opportunityPairs, sortMode]);
  const advantage = numberValue(primaryPair?.spread) !== null && threshold !== null ? primaryPair.spread - threshold : null;
  const hasOtcSignal = Boolean(otcSignal?.ready && otcSignal?.triggered);
  const opportunityCount = opportunityPairs.length + (hasOtcSignal ? 1 : 0);

  if (screen === 'detail' && selectedPair) {
    const watchId = selectedPair.from + ':' + selectedPair.to;
    const watchedEntry = watchlist.find((item) => item.id === watchId);
    const toggleWatch = () => {
      if (watchedEntry) {
        setWatchlist(removeSwitchWatch(watchId));
        return;
      }
      setWatchlist(upsertSwitchWatch({ ...selectedPair, id: watchId, reminderEnabled: false, reminderThreshold: threshold }));
    };
    const toggleReminder = () => {
      const nextEnabled = watchedEntry?.reminderEnabled !== true;
      setWatchlist(upsertSwitchWatch({ ...selectedPair, id: watchId, reminderEnabled: nextEnabled, reminderThreshold: threshold }));
    };
    return <OpportunityDetail pair={selectedPair} threshold={threshold} watching={Boolean(watchedEntry)} reminded={watchedEntry?.reminderEnabled === true} onToggleWatch={toggleWatch} onToggleReminder={toggleReminder} onBack={() => setScreen('recommended')} onCreatePlan={onViewPlan} />;
  }

  if (screen === 'recommended') {
    return (
      <div className="mobile-switch-recommended-page">
        <div className="mobile-switch-list-header"><button type="button" aria-label="返回机会概览" onClick={() => setScreen('overview')}><ChevronLeft size={20} /></button><strong>推荐切换机会</strong><button type="button" aria-label="筛选机会"><SlidersHorizontal size={18} /></button></div>
        <div className="mobile-switch-list-filters">{['全部', '持有中', '最佳机会'].map((item) => <button type="button" key={item} className={filter === item ? 'is-active' : ''} onClick={() => setFilter(item)}>{item}</button>)}<button type="button" className="mobile-switch-list-sort" onClick={() => setSortMode((value) => value === '组合溢价差' ? '代码' : '组合溢价差')}>{sortMode}⌄</button></div>
        <div className="mobile-switch-list-summary"><span>共 {opportunityPairs.length || '—'} 组机会</span><small>点击卡片查看方案详情 <Info size={12} /></small></div>
        <div className="mobile-switch-opportunity-list">{filteredPairs.map((pair, index) => <PairCard key={`${pair.from}-${pair.to}`} pair={pair} index={index} onOpen={(item) => { setSelectedPair(item); setScreen('detail'); }} />)}{!filteredPairs.length ? <div className="mobile-switch-empty-card">暂无符合条件的切换机会</div> : null}</div>
      </div>
    );
  }

  return (
    <div className="mobile-switch-opportunity">
      <div className="mobile-switch-opportunity__title-row"><div className="mobile-switch-opportunity__section-title">当前机会 <span>（持有中）</span></div><button type="button" className="mobile-switch-sort-label" onClick={() => setSortMode((value) => value === '组合溢价差' ? '代码' : '组合溢价差')}>{sortMode} <ChevronRight size={15} /></button></div>
      <section className="mobile-switch-current-opportunity">{primaryPair ? <><div className="mobile-switch-compare-grid"><FundSide fund={primaryPair.fromFund} code={primaryPair.from} name={primaryPair.fromName} side="high" /><div className="mobile-switch-compare-vs">VS</div><FundSide fund={primaryPair.toFund} code={primaryPair.to} name={primaryPair.toName} side="low" /></div><div className="mobile-switch-spread-panel"><div>组合溢价差（H - L） <Info size={13} /></div><strong className={tone(primaryPair.spread)}>{formatPercent(primaryPair.spread)}</strong><span>切换优势预估 {formatPercent(advantage)}（未考虑手续费）</span></div></> : <div className="mobile-switch-empty-card">暂无当前切换机会</div>}</section>
      <section className="mobile-switch-overview-section"><div className="mobile-switch-section-heading"><span>机会概览</span><ChevronRight size={17} /></div><div className="mobile-switch-overview-grid"><OverviewMetric label="组合溢价差" value={formatPercent(primaryPair?.spread)} note="越大越好" className={tone(primaryPair?.spread)} /><OverviewMetric label="历史分位（近1年）" value="—" note="—" /><OverviewMetric label="预计切换优势" value={formatPercent(advantage)} note="未考虑手续费" className="is-purple" /><OverviewMetric label="符合规则的机会" value={opportunityCount || '—'} note={opportunityCount ? '共 18 组' : '—'} className="is-purple" /></div>{workerError ? <div className="mobile-switch-inline-warning">切换策略数据未连接：{workerError}</div> : null}{!workerError && navError ? <div className="mobile-switch-inline-warning">{navError}</div> : null}</section>
      <section className="mobile-switch-opportunity-list"><div className="mobile-switch-section-heading"><span>推荐切换机会 <small>（部分）</small></span><button type="button" onClick={() => setScreen('recommended')}>查看更多 <ChevronRight size={14} /></button></div>{opportunityPairs.slice(0, 3).map((pair, index) => <PairCard key={`${pair.from}-${pair.to}`} pair={pair} index={index} onOpen={(item) => { setSelectedPair(item); setScreen('detail'); }} />)}{hasOtcSignal ? <div className="mobile-switch-empty-card">场外信号已触发，详情字段暂未返回</div> : null}{!opportunityCount ? <div className="mobile-switch-empty-card">暂无符合条件的切换机会</div> : null}</section>
      {reminderEnabled ? <section className="mobile-switch-reminder-card"><Bell size={27} /><div><strong>智能提醒已开启</strong><span>当组合溢价差 ≥ {threshold !== null ? `${threshold.toFixed(2)}%` : '—'} 时提醒我</span></div><ChevronRight size={18} /></section> : null}
      {!reminderEnabled && benchmarks[0] ? <div className="mobile-switch-reminder-placeholder" aria-hidden="true" /> : null}
      {navUpdatedHint ? <div className="mobile-switch-updated-hint">NAV 最新日期 {navUpdatedHint.replace(/^NAV 最新日期\s*/, '')}</div> : null}
      <div className="mobile-switch-overview-hints"><div><Target size={16} /><span>核心指标集中展示<br /><small>关键数据一屏看懂，辅助快速判断</small></span></div><div><Sparkles size={16} /><span>推荐列表重点突出<br /><small>最佳机会优先展示，支持快速进入详情</small></span></div></div>
    </div>
  );
}

export function MobileFundSwitchWatchlist({ prefs = {}, fundsWithPremium = [] }) {
  const [watchlist, setWatchlist] = useState(readSwitchWatchlist);

  useEffect(() => {
    const refresh = () => setWatchlist(readSwitchWatchlist());
    window.addEventListener('fund-switch:watchlist-change', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('fund-switch:watchlist-change', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const configuredPairs = useMemo(() => {
    const rules = Array.isArray(prefs?.rules) && prefs.rules.length ? prefs.rules : [prefs];
    const result = [];
    const seen = new Set();
    for (const rule of rules) {
      const pairs = buildOpportunityPairs(null, [], fundsWithPremium, rule);
      for (const pair of pairs) {
        const id = pair.from + ':' + pair.to;
        if (seen.has(id)) continue;
        seen.add(id);
        result.push({ ...pair, ruleName: rule?.name || rule?.ruleName || '当前配置' });
      }
    }
    return result;
  }, [fundsWithPremium, prefs]);

  return (
    <div className="mobile-switch-watchlist-page">
      <div className="mobile-switch-watchlist-header"><div><strong>我的关注</strong><span>持续跟踪已关注的切换方案和历史配置</span></div><Star size={20} /></div>
      <section className="mobile-switch-watchlist-section"><div className="mobile-switch-watchlist-section__title"><span>关注中的切换方案</span><b>{watchlist.length}</b></div>{watchlist.length ? <div className="mobile-switch-watchlist-list">{watchlist.map((item) => <div className="mobile-switch-watchlist-card" key={item.id}><div className="mobile-switch-watchlist-card__pair"><div><i className="mobile-switch-class-dot is-high">H</i><strong>{item.from}</strong><span>{item.fromName}</span></div><span className="mobile-switch-card-vs">VS</span><div><i className="mobile-switch-class-dot is-low">L</i><strong>{item.to}</strong><span>{item.toName}</span></div><b className={tone(item.spread)}>差值 {formatPercent(item.spread)}</b></div><div className="mobile-switch-watchlist-card__actions"><span>{item.reminderEnabled ? '提醒已开启' : '未设置提醒'}</span><button type="button" onClick={() => setWatchlist(upsertSwitchWatch(item, { reminderEnabled: !item.reminderEnabled }))}><Bell size={14} />{item.reminderEnabled ? '关闭提醒' : '设置提醒'}</button><button type="button" onClick={() => setWatchlist(removeSwitchWatch(item.id))}>取消关注</button></div></div>)}</div> : <div className="mobile-switch-watchlist-empty"><Star size={18} /><span>还没有关注方案<br /><small>在方案详情中点击“加入关注”后，会在这里持续跟踪。</small></span></div>}</section>
      <section className="mobile-switch-watchlist-section"><div className="mobile-switch-watchlist-section__title"><span>历史配置的切换</span><b>{configuredPairs.length}</b></div>{configuredPairs.length ? <div className="mobile-switch-watchlist-history">{configuredPairs.map((pair) => <div className="mobile-switch-watchlist-history__item" key={pair.from + ':' + pair.to}><div><strong>{pair.from} → {pair.to}</strong><span>{pair.ruleName}</span></div><b className={tone(pair.spread)}>{formatPercent(pair.spread)}</b></div>)}</div> : <div className="mobile-switch-watchlist-empty">暂无历史配置的切换。</div>}</section>
    </div>
  );
}

export function MobileFundSwitchEmpty({ title, description, onBack }) {
  return <div className="mobile-switch-empty-page"><div className="mobile-switch-empty-page__icon"><Star size={22} /></div><div className="mobile-switch-empty-page__title">{title}</div><div className="mobile-switch-empty-page__description">{description}</div><button type="button" onClick={onBack}>查看推荐机会</button></div>;
}
