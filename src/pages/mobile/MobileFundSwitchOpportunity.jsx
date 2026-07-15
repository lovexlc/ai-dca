import {
  ArrowRightLeft,
  BarChart3,
  Bell,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Info,
  Plus,
  Sparkles,
  Star,
  Zap
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cx } from '../../components/experience-ui.jsx';
import {
  buildFundSwitchOpportunityModel,
  getSwitchOpportunityAdvantage,
  numberValue,
  premiumOf
} from './fundSwitchOpportunityModel.js';

const SWITCH_WATCHLIST_KEY = 'aiDcaSwitchWatchlist';

function normalizeWatchEntry(entry = {}) {
  const from = String(entry?.from || entry?.fromCode || '').trim();
  const to = String(entry?.to || entry?.toCode || '').trim();
  if (!from || !to) return null;
  const rule = String(entry?.rule || '').trim().toUpperCase();
  return {
    id: String(entry?.id || `${from}:${to}`).trim(),
    from,
    fromName: String(entry?.fromName || from).trim(),
    to,
    toName: String(entry?.toName || to).trim(),
    fromClass: String(entry?.fromClass || (rule === 'A' ? 'L' : 'H')).trim().toUpperCase(),
    toClass: String(entry?.toClass || (rule === 'A' ? 'H' : 'L')).trim().toUpperCase(),
    fromFund: entry?.fromFund && typeof entry.fromFund === 'object' ? entry.fromFund : {},
    toFund: entry?.toFund && typeof entry.toFund === 'object' ? entry.toFund : {},
    spread: numberValue(entry?.spread),
    threshold: numberValue(entry?.threshold ?? entry?.reminderThreshold),
    rule,
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

function classTone(fundClass) {
  if (fundClass === 'H') return 'is-high';
  if (fundClass === 'L') return 'is-low';
  return '';
}

function formatUpdatedAt(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '—';
}

function ruleCondition(pair) {
  const threshold = numberValue(pair?.threshold);
  if (pair?.rule === 'A') return `规则 A · H-L ≤ ${threshold === null ? '—' : `${threshold.toFixed(2)}%`}`;
  if (pair?.rule === 'B') return `规则 B · H-L ≥ ${threshold === null ? '—' : `${threshold.toFixed(2)}%`}`;
  return '未命中规则';
}

function SignalPageHeader({ title, subtitle, onBack, action, actionLabel = '', onAction, secondaryAction, secondaryActionLabel = '', onSecondaryAction }) {
  return (
    <header className="app-signal-page-header">
      <div className="app-signal-page-header__leading">
        {onBack ? <button type="button" aria-label="返回" onClick={onBack}><ChevronLeft size={18} /></button> : null}
        <div>
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </div>
      </div>
      <div className="app-signal-page-header__actions">{secondaryAction ? <button type="button" className="app-signal-page-header__secondary-action" onClick={onSecondaryAction} aria-label={secondaryActionLabel || undefined}>{secondaryAction}</button> : null}{action ? <button type="button" className="app-signal-page-header__action" onClick={onAction} aria-label={actionLabel || undefined}>{action}</button> : null}</div>
    </header>
  );
}

function OpportunitySection({ title, tag, pairs, onOpen, onAddPlan }) {
  return (
    <section className="app-signal-opportunity-section">
      <div className="app-signal-section-heading">
        <div><strong>{title}</strong><small>{tag}</small></div>
        <ChevronDown size={15} aria-hidden="true" />
      </div>
      {pairs.length ? pairs.slice(0, 3).map((pair, index) => (
        <PairCard key={pair.from + '-' + pair.to} pair={pair} index={index} onOpen={onOpen} onAddPlan={onAddPlan} />
      )) : <div className="app-signal-empty-row">当前没有命中该方向的切换机会</div>}
      {pairs.length > 3 ? <button type="button" className="app-signal-more-button" onClick={() => onOpen?.(pairs[0])}>查看更多 <ChevronRight size={13} /></button> : null}
    </section>
  );
}

function FundSide({ fund, code, name, fundClass, action }) {
  const premium = premiumOf(fund);
  return (
    <div className={cx('mobile-switch-compare-side', classTone(fundClass))}>
      <div className="mobile-switch-compare-side__label">{fundClass === 'H' ? '高溢价 H' : '低溢价 L'}（{action}）</div>
      <div className="mobile-switch-compare-side__identity"><strong>{code || '—'}</strong><span>{name || fund?.name || '—'}</span></div>
      <div className="mobile-switch-compare-side__metrics"><div><span>最新价</span><b>{formatNumber(fund?.latestNav)}</b></div><div><span>溢价率</span><b>{formatPercent(premium)}</b></div></div>
    </div>
  );
}

function PairCard({ pair, index, onOpen, onAddPlan }) {
  const fromPremium = premiumOf(pair.fromFund);
  const toPremium = premiumOf(pair.toFund);
  const card = (
    <div className={cx('mobile-switch-opportunity-card', index === 0 && 'is-best')}>
      {index === 0 ? <div className="mobile-switch-best-badge"><Star size={11} /> 最佳机会</div> : null}
      <div className="mobile-switch-opportunity-card__main">
        <div className={cx('mobile-switch-opportunity-card__fund', classTone(pair.fromClass))}><i className={cx('mobile-switch-class-dot', classTone(pair.fromClass))}>{pair.fromClass || '—'}</i><b>{pair.from || '—'}</b><span>{pair.fromName || '—'}</span><small>卖出 · 溢价率 <em>{formatPercent(fromPremium)}</em></small></div>
        <div className="mobile-switch-card-vs"><ArrowRightLeft size={15} /></div>
        <div className={cx('mobile-switch-opportunity-card__fund', classTone(pair.toClass))}><i className={cx('mobile-switch-class-dot', classTone(pair.toClass))}>{pair.toClass || '—'}</i><b>{pair.to || '—'}</b><span>{pair.toName || '—'}</span><small>买入 · 溢价率 <em>{formatPercent(toPremium)}</em></small></div>
        <div className="mobile-switch-opportunity-card__spread"><span>{ruleCondition(pair)}</span><strong className={tone(pair.spread)}>{formatPercent(pair.spread)}</strong><ChevronRight size={18} /></div>
      </div>
      <div className="mobile-switch-opportunity-card__metrics"><span>日高下跌 <b>{formatPercent(pair.fromFund?.highPoint && pair.fromFund?.latestNav ? ((pair.fromFund.highPoint - pair.fromFund.latestNav) / pair.fromFund.highPoint) * 100 : null)}</b></span><span>历史水位 <b>{pair.fromFund?.historicalPercentile === null || pair.fromFund?.historicalPercentile === undefined ? '—' : formatPercent(pair.fromFund.historicalPercentile)}</b></span><span>成交额 <b>{formatAmount(pair.fromFund?.turnover ?? pair.fromFund?.amount)}</b></span><span className="mobile-switch-opportunity-card__action">查看方案 <ChevronRight size={13} /></span></div>
    </div>
  );
  return <div className="mobile-switch-opportunity-card-shell"><button type="button" className="mobile-switch-opportunity-card-button" onClick={() => onOpen(pair)} aria-label={`查看 ${pair.from || '—'} 切换至 ${pair.to || '—'} 的方案`}>{card}</button><button type="button" className="mobile-switch-opportunity-card-add" onClick={() => onAddPlan?.(pair)}><Star size={13} /> 加入我的方案</button></div>;
}

function OverviewMetric({ label, value, note, className = '' }) {
  return <div><span>{label}</span><b className={className}>{value}</b><small>{note}</small></div>;
}

function OpportunityDetail({ pair, prefs = {}, onBack, onCreatePlan, watching = false, automationEnabled = false, onToggleWatch, onEnableAutomation }) {
  const [activeTab, setActiveTab] = useState('metrics');
  const advantage = getSwitchOpportunityAdvantage(pair);
  const rows = [
    ['溢价率', formatPercent(pair?.fromFund?.premiumPct), formatPercent(pair?.toFund?.premiumPct), formatPercent(pair?.spread)],
    ['日高下跌', formatPercent(pair?.fromFund?.highPoint && pair?.fromFund?.latestNav ? ((pair.fromFund.highPoint - pair.fromFund.latestNav) / pair.fromFund.highPoint) * 100 : null), formatPercent(pair?.toFund?.highPoint && pair?.toFund?.latestNav ? ((pair.toFund.highPoint - pair.toFund.latestNav) / pair.toFund.highPoint) * 100 : null), '—'],
    ['历史水位', pair?.fromFund?.historicalPercentile === null || pair?.fromFund?.historicalPercentile === undefined ? '—' : formatPercent(pair.fromFund.historicalPercentile), pair?.toFund?.historicalPercentile === null || pair?.toFund?.historicalPercentile === undefined ? '—' : formatPercent(pair.toFund.historicalPercentile), '—'],
    ['成交额（近1日）', formatAmount(pair?.fromFund?.turnover ?? pair?.fromFund?.amount), formatAmount(pair?.toFund?.turnover ?? pair?.toFund?.amount), '—'],
    ['更新时间', formatUpdatedAt(pair?.fromFund?.asOf), formatUpdatedAt(pair?.toFund?.asOf), '—']
  ];
  return (
    <div className="mobile-switch-detail-page app-signal-page app-signal-detail">
      <div className="mobile-switch-detail-header"><button type="button" aria-label="返回推荐切换机会" onClick={onBack}><ChevronLeft size={20} /></button><strong>方案详情</strong><div><button type="button" aria-label="加入关注" className={watching ? 'is-active' : ''} onClick={() => onToggleWatch?.()}><Star size={19} /></button></div></div>
      <div className="mobile-switch-detail-pair"><FundSide fund={pair?.fromFund} code={pair?.from} name={pair?.fromName} fundClass={pair?.fromClass} action="卖出" /><div className="mobile-switch-compare-vs">VS</div><FundSide fund={pair?.toFund} code={pair?.to} name={pair?.toName} fundClass={pair?.toClass} action="买入" /></div>
      <div className="mobile-switch-spread-panel"><div>组合溢价差（H - L） <Info size={13} /></div><strong className={tone(pair?.spread)}>{formatPercent(pair?.spread)}</strong><span>{ruleCondition(pair)} · 超出阈值 {formatPercent(advantage)}</span></div>
      <section className="app-signal-rule-grid">
        <div className={pair?.rule === 'A' ? 'is-active' : ''}><strong>规则 A</strong><span>H-L ≤ {numberValue(pair?.threshold ?? 1) === null ? '—' : Number(prefs?.intraSellLowerPct ?? 1).toFixed(2) + '%'}</span><small>卖 L 买 H</small></div>
        <div className="app-signal-rule-grid__current"><strong>当前差值</strong><span>{formatPercent(pair?.spread)}</span><small>{getSwitchOpportunityAdvantage(pair) === null ? '等待实时数据' : '已命中条件'}</small></div>
        <div className={pair?.rule === 'B' ? 'is-active' : ''}><strong>规则 B</strong><span>H-L ≥ {numberValue(pair?.threshold ?? 3) === null ? '—' : Number(prefs?.intraBuyOtherPct ?? 3).toFixed(2) + '%'}</span><small>卖 H 买 L</small></div>
      </section>
      <section className="mobile-switch-detail-insight"><h3>机会解读</h3><div><span>{pair?.rule === 'A' ? '差价收窄，低→高' : '差价扩大，高→低'}</span><span>{ruleCondition(pair)}</span>{numberValue(pair?.fromFund?.turnover ?? pair?.fromFund?.amount) !== null ? <span>成交额数据可用</span> : null}</div></section>
      <section className="mobile-switch-detail-data"><div className="mobile-switch-detail-tabs" role="tablist">{[['metrics', '关键指标'], ['estimate', '收益测算'], ['rules', '触发规则'], ['history', '历史记录']].map(([key, label]) => <button type="button" role="tab" aria-selected={activeTab === key} className={activeTab === key ? 'is-active' : ''} key={key} onClick={() => setActiveTab(key)}>{label}</button>)}</div>{activeTab === 'metrics' ? <div className="mobile-switch-detail-table"><div className="mobile-switch-detail-table__head"><span>指标</span><span>{pair?.fromClass || '—'} {pair?.from || '—'}</span><span>{pair?.toClass || '—'} {pair?.to || '—'}</span><span>差值（H-L）</span></div>{rows.map(([label, from, to, diff]) => <div className="mobile-switch-detail-table__row" key={label}><span>{label}</span><span>{from}</span><span>{to}</span><span>{diff}</span></div>)}<p><Info size={13} /> 组合溢价差 = H 溢价率 - L 溢价率</p></div> : <div className="mobile-switch-detail-placeholder">{activeTab === 'estimate' ? `当前超出触发阈值 ${formatPercent(advantage)}；未提供手续费和持仓份额，暂不生成金额结果。` : activeTab === 'rules' ? `${ruleCondition(pair)}。${pair?.description || '当前组合已命中该规则。'}` : '暂无历史触发记录。'}</div>}</section>
      <section className="mobile-switch-detail-actions"><h3>交互操作</h3><div><button type="button" onClick={() => onToggleWatch?.()}><Star size={16} />{watching ? '已关注' : '加入关注'}</button>{automationEnabled ? <button type="button" disabled><Bell size={16} />自动监控已开启</button> : <button type="button" onClick={() => onEnableAutomation?.()}><Bell size={16} />启用自动监控</button>}<button type="button" className="is-primary" onClick={() => onCreatePlan?.(pair)}><Zap size={16} />快速记录 <ChevronRight size={16} /></button></div></section>
    </div>
  );
}

export function MobileFundSwitchOpportunity({
  fundsWithPremium = [],
  intraSignals = [],
  workerSnapshot = null,
  otcSignal,
  prefs,
  navUpdatedHint = '',
  navError = '',
  workerError = '',
  workerConfig,
  heldCodes = null,
  onOpenPlans,
  onOpenRecords,
  onViewPlan,
  onEnableAutomation,
}) {
  const [screen, setScreen] = useState('overview');
  const [filter, setFilter] = useState('全部');
  const [sortMode, setSortMode] = useState('规则优势');
  const [selectedPair, setSelectedPair] = useState(null);
  const [watchlist, setWatchlist] = useState(readSwitchWatchlist);
  const opportunityModel = useMemo(() => buildFundSwitchOpportunityModel({
    snapshot: workerSnapshot,
    signals: intraSignals,
    funds: fundsWithPremium,
    prefs,
    otcSignal,
    heldCodes
  }), [fundsWithPremium, heldCodes, intraSignals, otcSignal, prefs, workerSnapshot]);
  const { candidateCount, hasOtcOpportunity, opportunityCount, opportunityPairs } = opportunityModel;
  const automationEnabled = Boolean(workerConfig?.enabled);
  const primaryPair = opportunityPairs[0] || null;
  const filteredPairs = useMemo(() => {
    const next = filter === '最佳机会'
      ? opportunityPairs.slice(0, 1)
      : filter === '规则 A' || filter === '规则 B'
        ? opportunityPairs.filter((pair) => `规则 ${pair.rule}` === filter)
        : opportunityPairs;
    if (sortMode === '代码') return [...next].sort((a, b) => String(a.from).localeCompare(String(b.from)));
    return next;
  }, [filter, opportunityPairs, sortMode]);
  const advantage = getSwitchOpportunityAdvantage(primaryPair);
  const ruleBPairs = opportunityPairs.filter((pair) => pair.rule === 'B');
  const ruleAPairs = opportunityPairs.filter((pair) => pair.rule === 'A');
  const openPair = (pair) => {
    if (!pair) return;
    setSelectedPair(pair);
    setScreen('detail');
  };
  const addPlan = (pair) => setWatchlist(upsertSwitchWatch({ ...pair, id: pair.from + ':' + pair.to }));

  if (screen === 'detail' && selectedPair) {
    const watchId = selectedPair.from + ':' + selectedPair.to;
    const watchedEntry = watchlist.find((item) => item.id === watchId);
    const toggleWatch = () => {
      if (watchedEntry) {
        setWatchlist(removeSwitchWatch(watchId));
        return;
      }
      setWatchlist(upsertSwitchWatch({ ...selectedPair, id: watchId }));
    };
    return <OpportunityDetail pair={selectedPair} prefs={prefs} watching={Boolean(watchedEntry)} automationEnabled={automationEnabled} onToggleWatch={toggleWatch} onEnableAutomation={onEnableAutomation} onBack={() => setScreen('recommended')} onCreatePlan={onViewPlan} />;
  }

  if (screen === 'recommended') {
    return (
      <div className="mobile-switch-recommended-page app-signal-page app-signal-recommended">
        <div className="mobile-switch-list-header"><button type="button" aria-label="返回机会概览" onClick={() => setScreen('overview')}><ChevronLeft size={20} /></button><strong>推荐切换机会</strong><span aria-hidden="true" /></div>
        <div className="mobile-switch-list-filters">{['全部', '规则 A', '规则 B', '最佳机会'].map((item) => <button type="button" key={item} className={filter === item ? 'is-active' : ''} onClick={() => setFilter(item)}>{item}</button>)}<button type="button" className="mobile-switch-list-sort" onClick={() => setSortMode((value) => value === '规则优势' ? '代码' : '规则优势')}>{sortMode}⌄</button></div>
        <div className="mobile-switch-list-summary"><span>共 {opportunityCount} 组命中</span><small>场内候选 {candidateCount} 组 <Info size={12} /></small></div>
        <div className="mobile-switch-opportunity-list">{filteredPairs.map((pair, index) => <PairCard key={`${pair.from}-${pair.to}`} pair={pair} index={index} onOpen={(item) => { setSelectedPair(item); setScreen('detail'); }} onAddPlan={(item) => setWatchlist(upsertSwitchWatch({ ...item, id: item.from + ':' + item.to }))} />)}{!filteredPairs.length ? <div className="mobile-switch-empty-card">暂无符合当前筛选的切换机会</div> : null}</div>
      </div>
    );
  }

  return (
    <div className="mobile-switch-opportunity app-signal-page app-signal-overview">
      <SignalPageHeader title="推荐机会" subtitle="根据当前持仓与实时溢价筛选切换方案" secondaryAction={<History size={16} />} secondaryActionLabel="切换记录" onSecondaryAction={onOpenRecords} action={<Bookmark size={17} />} actionLabel="打开我的方案" onAction={onOpenPlans} />
      <section className="app-signal-summary-card">
        <div className="app-signal-summary-card__heading"><strong>机会总览</strong><span><span className="app-signal-live-dot" />实时更新</span></div>
        <div className="app-signal-summary-grid">
          <OverviewMetric label="机会总数" value={opportunityCount} note="当前命中" />
          <OverviewMetric label="场内候选" value={candidateCount} note="已配置组合" />
          <OverviewMetric label="最佳差值" value={formatPercent(primaryPair?.spread)} note={primaryPair ? ruleCondition(primaryPair) : '等待数据'} className="is-green" />
          <OverviewMetric label="超出阈值" value={formatPercent(advantage)} note="按规则 A/B" className="is-purple" />
        </div>
      </section>
      <section className="app-signal-current-card">
        <div className="app-signal-section-heading"><div><strong>当前最佳机会</strong><small>{primaryPair ? '优先关注' : '实时扫描中'}</small></div><BarChart3 size={16} /></div>
        {primaryPair ? <><div className="mobile-switch-compare-grid"><FundSide fund={primaryPair.fromFund} code={primaryPair.from} name={primaryPair.fromName} fundClass={primaryPair.fromClass} action="卖出" /><div className="mobile-switch-compare-vs"><ArrowRightLeft size={15} /></div><FundSide fund={primaryPair.toFund} code={primaryPair.to} name={primaryPair.toName} fundClass={primaryPair.toClass} action="买入" /></div><div className="mobile-switch-spread-panel"><div>组合溢价差（H - L） <Info size={13} /></div><strong className={tone(primaryPair.spread)}>{formatPercent(primaryPair.spread)}</strong><span>{ruleCondition(primaryPair)} · 超出阈值 {formatPercent(advantage)}</span></div></> : <div className="app-signal-empty-state"><BarChart3 size={22} /><strong>暂无命中机会</strong><small>系统将根据当前持仓和实时溢价持续扫描</small></div>}
      </section>
      <OpportunitySection title="H 持仓 → 换进 L" tag={'规则 B · H-L ≥ ' + (numberValue(prefs?.intraBuyOtherPct) === null ? '—' : Number(prefs.intraBuyOtherPct).toFixed(2) + '%')} pairs={ruleBPairs} onOpen={openPair} onAddPlan={addPlan} />
      <OpportunitySection title="L 持仓 → 换进 H" tag={'规则 A · H-L ≤ ' + (numberValue(prefs?.intraSellLowerPct) === null ? '—' : Number(prefs.intraSellLowerPct).toFixed(2) + '%')} pairs={ruleAPairs} onOpen={openPair} onAddPlan={addPlan} />
      {hasOtcOpportunity ? <div className="app-signal-otc-row"><Sparkles size={16} /><span>场外信号已触发，目标与额度请到行情中心确认</span></div> : null}
      {automationEnabled ? <section className="mobile-switch-reminder-card"><Bell size={20} /><div><strong>自动监控已开启</strong><span>规则 A ≤ {numberValue(prefs?.intraSellLowerPct) === null ? '—' : Number(prefs.intraSellLowerPct).toFixed(2) + '%'} · 规则 B ≥ {numberValue(prefs?.intraBuyOtherPct) === null ? '—' : Number(prefs.intraBuyOtherPct).toFixed(2) + '%'}</span></div><ChevronRight size={16} /></section> : null}
      {workerError ? <div className="mobile-switch-inline-warning">切换策略数据未连接：{workerError}</div> : null}
      {!workerError && navError ? <div className="mobile-switch-inline-warning">{navError}</div> : null}
      {navUpdatedHint ? <div className="mobile-switch-updated-hint">NAV 最新日期 {navUpdatedHint.replace(/^NAV 最新日期\s*/, '')}</div> : null}
    </div>
  );
}

export function MobileFundSwitchWatchlist({ prefs = {}, fundsWithPremium = [], workerConfig = {}, heldCodes = [], onToggleWorker, onToggleRule, onAddRule, onOpenOpportunity }) {
  const [watchlist, setWatchlist] = useState(readSwitchWatchlist);
  const [expandedRuleId, setExpandedRuleId] = useState('');

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
      const pairs = buildFundSwitchOpportunityModel({ funds: fundsWithPremium, prefs: rule }).candidatePairs;
      for (const pair of pairs) {
        const id = pair.from + ':' + pair.to;
        if (seen.has(id)) continue;
        seen.add(id);
        result.push({ ...pair, ruleName: rule?.name || rule?.ruleName || '当前配置' });
      }
    }
    return result;
  }, [fundsWithPremium, prefs]);

  const classCounts = useMemo(() => {
    const classes = prefs?.premiumClass || {};
    return {
      high: Object.values(classes).filter((value) => value === 'H').length,
      low: Object.values(classes).filter((value) => value === 'L').length
    };
  }, [prefs?.premiumClass]);

  return (
    <div className="mobile-switch-watchlist-page app-signal-page app-signal-plans">
      <SignalPageHeader title="我的方案" subtitle="管理关注方案与自动监控规则" onBack={onOpenOpportunity} action={<Plus size={16} />} actionLabel="新建方案" onAction={onAddRule} />
      <div className="app-signal-plan-stats"><div><span>H 持仓</span><strong>{classCounts.high}</strong><small>高溢价组</small></div><div><span>L 持仓</span><strong>{classCounts.low}</strong><small>低溢价组</small></div><div><span>我的持仓</span><strong>{heldCodes.length}</strong><small>当前活跃</small></div><div><span>我的方案</span><strong>{watchlist.length}</strong><small>已关注</small></div></div>
      <section className="mobile-switch-plan-manager"><div><strong>自动监控</strong><span>{workerConfig?.enabled ? '已启用，按规则 A/B 扫描' : '已暂停，不会发送切换通知'}</span></div><button type="button" className={workerConfig?.enabled ? 'is-enabled' : ''} onClick={() => onToggleWorker?.(!workerConfig?.enabled)}>{workerConfig?.enabled ? '暂停监控' : '启用监控'}</button></section>
      <section className="mobile-switch-watchlist-section"><div className="mobile-switch-watchlist-section__title"><span>已加入我的方案</span><b>{watchlist.length}</b></div>{watchlist.length ? <div className="mobile-switch-watchlist-list">{watchlist.map((item) => <div className="mobile-switch-watchlist-card" key={item.id}><div className="mobile-switch-watchlist-card__pair"><div><i className={cx('mobile-switch-class-dot', classTone(item.fromClass))}>{item.fromClass || '—'}</i><strong>{item.from}</strong><span>{item.fromName}</span></div><span className="mobile-switch-card-vs">VS</span><div><i className={cx('mobile-switch-class-dot', classTone(item.toClass))}>{item.toClass || '—'}</i><strong>{item.to}</strong><span>{item.toName}</span></div><b className={tone(item.spread)}>H-L {formatPercent(item.spread)}</b></div><div className="mobile-switch-watchlist-card__actions"><span>{ruleCondition(item)}</span><button type="button" onClick={() => setWatchlist(removeSwitchWatch(item.id))}>取消关注</button></div></div>)}</div> : <div className="mobile-switch-watchlist-empty"><Star size={18} /><span>还没有关注方案<br /><small>在方案详情中点击“加入关注”后，会在这里持续跟踪。</small></span></div>}</section>
      <section className="mobile-switch-watchlist-section"><button type="button" className="mobile-switch-watchlist-section__title mobile-switch-watchlist-section__title-button" aria-expanded={Boolean(expandedRuleId)} onClick={() => setExpandedRuleId((current) => current ? '' : (prefs?.rules?.[0]?.id || ''))}><span>规则管理</span><b>{Array.isArray(prefs?.rules) ? prefs.rules.length : 0}</b></button><div className="mobile-switch-rule-list">{(Array.isArray(prefs?.rules) ? prefs.rules : []).map((rule) => { const isExpanded = expandedRuleId === rule.id; const toggleExpanded = () => setExpandedRuleId((current) => current === rule.id ? '' : rule.id); return <div className={cx('mobile-switch-rule-card', isExpanded && 'is-expanded')} key={rule.id} role="button" tabIndex={0} aria-expanded={isExpanded} onClick={toggleExpanded} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleExpanded(); } }}><div><strong>{rule.name || '未命名规则'}</strong><span>{(rule.benchmarkCodes || []).length} 持仓 / {(rule.enabledCodes || []).length} 候选 · A ≤ {numberValue(rule.intraSellLowerPct) === null ? '—' : Number(rule.intraSellLowerPct).toFixed(1) + '%'} / B ≥ {numberValue(rule.intraBuyOtherPct) === null ? '—' : Number(rule.intraBuyOtherPct).toFixed(1) + '%'}</span>{isExpanded ? <small className="mobile-switch-rule-card__detail">持仓：{(rule.benchmarkCodes || []).join('、') || '—'}<br />候选：{(rule.enabledCodes || []).join('、') || '—'}<br />点击卡片可收起规则详情</small> : null}</div><span className={rule.enabled ? 'is-running' : 'is-paused'}>{rule.enabled ? '监控中' : '已暂停'}</span><button type="button" onClick={(event) => { event.stopPropagation(); onToggleRule?.(rule.id, !rule.enabled); }}>{rule.enabled ? '暂停' : '启用'}</button></div>; })}</div></section>      <section className="mobile-switch-watchlist-section"><div className="mobile-switch-watchlist-section__title"><span>当前配置的组合</span><b>{configuredPairs.length}</b></div>{configuredPairs.length ? <div className="mobile-switch-watchlist-history">{configuredPairs.map((pair) => <div className="mobile-switch-watchlist-history__item" key={pair.from + ':' + pair.to}><div><strong>{pair.from} → {pair.to}</strong><span>{pair.ruleName} · {pair.fromClass || '—'}→{pair.toClass || '—'}</span></div><b className={tone(pair.spread)}>{formatPercent(pair.spread)}</b></div>)}</div> : <div className="mobile-switch-watchlist-empty">暂无已分类的持仓候选组合。</div>}</section>
    </div>
  );
}
