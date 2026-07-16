import {
  Bell,
  BadgePercent,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  Info,
  ListChecks,
  Settings2,
  Star,
  Zap
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cx } from '../../components/experience-ui.jsx';
import { getUserDataStorage } from '../../app/userDataStore.js';
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
    const raw = JSON.parse(getUserDataStorage().getItem(SWITCH_WATCHLIST_KEY) || '[]');
    return (Array.isArray(raw) ? raw : []).map(normalizeWatchEntry).filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function writeSwitchWatchlist(entries) {
  const next = (Array.isArray(entries) ? entries : []).map(normalizeWatchEntry).filter(Boolean);
  if (typeof window !== 'undefined') {
    getUserDataStorage().setItem(SWITCH_WATCHLIST_KEY, JSON.stringify(next));
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

const CONDITION_OPTIONS = {
  high: [1.5, 2, 2.5, 3, 3.5].map((value) => ({ value, label: `≥ ${value.toFixed(2)}%` })),
  low: [-0.5, -1, -1.5, -2, -2.5].map((value) => ({ value, label: `≤ ${value.toFixed(2)}%` })),
  holding: [
    { value: 'held-only', label: '仅持仓' },
    { value: 'held-when-available', label: '有持仓时才评估' },
    { value: 'unheld-only', label: '无持仓时才评估' },
    { value: 'all', label: '全部（持仓+无持仓）' }
  ],
  trigger: [
    { value: 'ab', label: 'A/B 规则' },
    { value: 'a', label: '触发规则 A' },
    { value: 'b', label: '触发规则 B' },
    { value: 'custom', label: '自定义规则（即将上线）', disabled: true }
  ],
  hGroup: [
    { value: 'auto', label: '自动识别', note: '按溢价率自动标记 H 组' },
    { value: 'manual', label: '手动选择', note: '自己指定 H 组基金' }
  ],
  lGroup: [
    { value: 'auto', label: '自动识别', note: '按溢价率自动标记 L 组' },
    { value: 'manual', label: '手动选择', note: '自己指定 L 组基金' }
  ],
  holdingFunds: [
    { value: 'auto', label: '自动同步持仓', note: '跟随当前持仓自动更新' },
    { value: 'manual', label: '手动调整', note: '手动选择要评估的持仓基金' }
  ]
};

const CONDITION_META = {
  high: { title: '高溢价阈值（卖出）', icon: BadgePercent },
  low: { title: '低溢价阈值（买入）', icon: CircleDollarSign },
  holding: { title: '持仓条件', icon: BriefcaseBusiness },
  trigger: { title: '触发规则', icon: ListChecks },
  hGroup: { title: 'H 组设置', icon: BadgePercent },
  lGroup: { title: 'L 组设置', icon: CircleDollarSign },
  holdingFunds: { title: '持仓基金设置', icon: BriefcaseBusiness }
};

function readConditionSettings(prefs = {}) {
  const high = numberValue(prefs?.intraBuyOtherPct);
  const low = numberValue(prefs?.intraSellLowerPct);
  return {
    high: high === null ? 2.5 : high,
    low: low === null ? -1.5 : low,
    holding: String(prefs?.holdingCondition || 'held-only'),
    trigger: String(prefs?.triggerRule || 'ab'),
    hGroup: String(prefs?.hGroupMode || 'auto'),
    lGroup: String(prefs?.lGroupMode || 'auto'),
    holdingFunds: String(prefs?.holdingFundsMode || 'auto')
  };
}

function conditionOptionLabel(type, value) {
  const option = CONDITION_OPTIONS[type]?.find((item) => String(item.value) === String(value));
  if (option) return option.label;
  if (type === 'high') return `≥ ${Number(value).toFixed(2)}%`;
  if (type === 'low') return `≤ ${Number(value).toFixed(2)}%`;
  return value || '—';
}

function ConditionSummaryItem({ icon: Icon, label, value, tone = '' }) {
  return (
    <div className="mobile-switch-condition-summary__item">
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function ConditionPicker({ type, value, onBack, onSelect }) {
  const meta = CONDITION_META[type];
  const Icon = meta?.icon || Settings2;
  const supportsCustomThreshold = type === 'high' || type === 'low';
  const [customValue, setCustomValue] = useState(() => {
    const current = numberValue(value);
    return supportsCustomThreshold && current !== null ? String(current) : '';
  });
  const customNumber = Number(customValue);
  const customError = !customValue.trim()
    ? '请输入阈值'
    : !Number.isFinite(customNumber)
      ? '请输入数字'
      : '';
  const applyCustom = () => {
    if (customError) return;
    onSelect(customNumber);
  };
  return (
    <div className="mobile-switch-condition-picker" role="dialog" aria-modal="true" aria-label={meta?.title || '切换条件设置'}>
      <div className="mobile-switch-condition-picker__header">
        <button type="button" aria-label="返回切换条件设置" onClick={onBack}><ChevronLeft size={20} /></button>
        <div><Icon size={15} /><strong>{meta?.title || '切换条件设置'}</strong></div>
        <span aria-hidden="true" />
      </div>
      <div className="mobile-switch-condition-picker__list">
        {(CONDITION_OPTIONS[type] || []).map((option) => {
          const selected = String(option.value) === String(value);
          return (
            <button type="button" key={String(option.value)} className={selected ? 'is-selected' : ''} disabled={option.disabled} onClick={() => onSelect(option.value)}>
              <span>{option.label}</span>
              {selected ? <Check size={17} aria-label="已选择" /> : option.disabled ? <small>即将上线</small> : option.note ? <small>{option.note}</small> : null}
            </button>
          );
        })}
      </div>
      {supportsCustomThreshold ? (
        <div className="mobile-switch-condition-picker__custom">
          <label htmlFor={`custom-${type}-threshold`}>
            <span>{type === 'high' ? '自定义高溢价阈值' : '自定义低溢价阈值'}</span>
            <div>
              <input
                id={`custom-${type}-threshold`}
                type="number"
                inputMode="decimal"
                step="0.1"
                value={customValue}
                onChange={(event) => setCustomValue(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') applyCustom(); }}
                aria-invalid={Boolean(customError)}
                placeholder="例如 4.2 或 -1.8"
              />
              <b>%</b>
            </div>
          </label>
          <small>直接使用输入值，支持正数和负数</small>
          {customError ? <em>{customError}</em> : null}
          <button type="button" disabled={Boolean(customError)} onClick={applyCustom}>应用自定义阈值</button>
        </div>
      ) : null}
    </div>
  );
}

function FundGroupPicker({ funds = [], prefs = {}, onBack, onSave }) {
  const classes = prefs?.premiumClass && typeof prefs.premiumClass === 'object' ? prefs.premiumClass : {};
  const [group, setGroup] = useState('H');
  const [modes, setModes] = useState({ H: prefs?.hGroupMode || 'auto', L: prefs?.lGroupMode || 'auto' });
  const [selectedByGroup, setSelectedByGroup] = useState(() => ({
    H: Object.entries(classes).filter(([, value]) => value === 'H').map(([code]) => code),
    L: Object.entries(classes).filter(([, value]) => value === 'L').map(([code]) => code)
  }));
  const candidates = useMemo(() => {
    const seen = new Set();
    return (Array.isArray(funds) ? funds : []).filter((fund) => {
      const code = String(fund?.code || '').trim();
      if (!/^\d{6}$/.test(code) || seen.has(code)) return false;
      seen.add(code);
      return true;
    });
  }, [funds]);
  const selectedCodes = selectedByGroup[group] || [];
  const toggle = (code) => setSelectedByGroup((current) => ({ ...current, [group]: selectedCodes.includes(code) ? selectedCodes.filter((item) => item !== code) : [...selectedCodes, code] }));
  const save = () => {
    const nextClasses = { ...classes };
    ['H', 'L'].forEach((kind) => {
      Object.keys(nextClasses).forEach((code) => { if (nextClasses[code] === kind && !selectedByGroup[kind].includes(code)) delete nextClasses[code]; });
      selectedByGroup[kind].forEach((code) => { nextClasses[code] = kind; });
    });
    onSave?.(nextClasses, modes);
    onBack?.();
  };
  const title = 'H/L 分组设置';
  return (
    <div className="mobile-switch-condition-picker mobile-switch-fund-group-picker" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mobile-switch-condition-picker__header">
        <button type="button" aria-label="返回切换条件设置" onClick={onBack}><ChevronLeft size={20} /></button>
        <div><BadgePercent size={15} /><strong>{title}</strong></div>
        <span aria-hidden="true" />
      </div>
      <div className="mobile-switch-group-tabs" role="tablist"><button type="button" className={group === 'H' ? 'is-active' : ''} onClick={() => setGroup('H')}>H 组设置</button><button type="button" className={group === 'L' ? 'is-active' : ''} onClick={() => setGroup('L')}>L 组设置</button></div>
      <div className="mobile-switch-fund-group-picker__mode-title">选择模式</div>
      <div className="mobile-switch-fund-group-picker__modes"><button type="button" className={modes[group] === 'auto' ? 'is-active' : ''} onClick={() => setModes((current) => ({ ...current, [group]: 'auto' }))}><strong>自动识别</strong><small>按溢价率自动归类</small></button><button type="button" className={modes[group] === 'manual' ? 'is-active' : ''} onClick={() => setModes((current) => ({ ...current, [group]: 'manual' }))}><strong>手动选择</strong><small>自行指定基金分组</small></button></div>
      {modes[group] === 'auto' ? <div className="mobile-switch-fund-group-picker__auto-hint"><Check size={15} /> 已启用自动识别，基金分组会随实时溢价率更新</div> : <>
        <div className="mobile-switch-fund-group-picker__hint">{group} 组基金（已选 {selectedCodes.length} 只），可多选</div>
        <div className="mobile-switch-fund-group-picker__list">
          {candidates.length ? candidates.map((fund) => {
            const code = String(fund.code);
            const checked = selectedCodes.includes(code);
            return <button type="button" key={code} className={checked ? 'is-selected' : ''} onClick={() => toggle(code)}><span className="mobile-switch-fund-group-picker__check">{checked ? <Check size={14} /> : null}</span><span className="mobile-switch-fund-group-picker__name"><strong>{code}</strong><small>{fund.name || '未命名基金'}</small></span><span className="mobile-switch-fund-group-picker__premium">{formatPercent(premiumOf(fund))}</span></button>;
          }) : <div className="mobile-switch-fund-group-picker__empty">暂无可配置基金，请先添加候选基金</div>}
        </div>
      </>}
      <div className="mobile-switch-fund-group-picker__footnote">支持自动识别或手动选择，保存后立即用于推荐机会计算</div>
      <button type="button" className="mobile-switch-condition-save" onClick={save}>保存分组</button>
    </div>
  );
}

function HoldingFundsPicker({ funds = [], prefs = {}, heldCodes = [], onBack, onSave }) {
  const initial = Array.isArray(prefs?.benchmarkCodes) && prefs.benchmarkCodes.length ? prefs.benchmarkCodes.map(String) : (Array.isArray(heldCodes) ? heldCodes.map(String) : []);
  const [selectedCodes, setSelectedCodes] = useState(initial);
  const [autoSync, setAutoSync] = useState(prefs?.holdingFundsMode !== 'manual');
  const codes = useMemo(() => {
    const seen = new Set();
    return (Array.isArray(funds) ? funds : []).filter((fund) => {
      const code = String(fund?.code || '').trim();
      if (!/^\d{6}$/.test(code) || seen.has(code)) return false;
      seen.add(code);
      return true;
    });
  }, [funds]);
  const current = codes.filter((fund) => selectedCodes.includes(String(fund.code)));
  const other = codes.filter((fund) => !selectedCodes.includes(String(fund.code)));
  const toggle = (code) => setSelectedCodes((list) => list.includes(code) ? list.filter((item) => item !== code) : [...list, code]);
  const save = () => { onSave?.(selectedCodes, autoSync); onBack?.(); };
  const renderFund = (fund, checked) => {
    const code = String(fund.code);
    return <button type="button" key={code} className={checked ? 'is-selected' : ''} onClick={() => toggle(code)}><span className="mobile-switch-fund-group-picker__check">{checked ? <Check size={14} /> : null}</span><span className="mobile-switch-fund-group-picker__name"><strong>{code}</strong><small>{fund.name || '未命名基金'}</small></span><small className="mobile-switch-holding-picker__tag">{checked ? '持仓' : '未持仓'}</small></button>;
  };
  return (
    <div className="mobile-switch-condition-picker mobile-switch-holding-picker" role="dialog" aria-modal="true" aria-label="持仓基金设置">
      <div className="mobile-switch-condition-picker__header"><button type="button" aria-label="返回切换条件设置" onClick={onBack}><ChevronLeft size={20} /></button><div><BriefcaseBusiness size={15} /><strong>持仓基金设置</strong></div><span aria-hidden="true" /></div>
      <div className="mobile-switch-holding-picker__notice"><Check size={15} /><div><strong>已检测到符合条件的持仓</strong><small>默认带出当前持仓基金，可手动调整</small></div></div>
      <div className="mobile-switch-holding-picker__section-title">当前持仓基金 <span>{current.length} 只</span><button type="button" onClick={() => setSelectedCodes(codes.map((fund) => String(fund.code)))}>全选</button></div>
      <div className="mobile-switch-fund-group-picker__list">{current.length ? current.map((fund) => renderFund(fund, true)) : <div className="mobile-switch-fund-group-picker__empty">暂无当前持仓</div>}</div>
      <div className="mobile-switch-holding-picker__section-title">其它可选基金 <span>（未持仓）</span></div>
      <div className="mobile-switch-fund-group-picker__list">{other.length ? other.map((fund) => renderFund(fund, false)) : <div className="mobile-switch-fund-group-picker__empty">暂无其它候选基金</div>}</div>
      <label className="mobile-switch-holding-picker__toggle"><span><strong>自动同步我的持仓</strong><small>关闭后可手动维护持仓基金</small></span><input type="checkbox" checked={autoSync} onChange={(event) => setAutoSync(event.target.checked)} /><i aria-hidden="true" /></label>
      <div className="mobile-switch-holding-picker__actions"><button type="button" onClick={() => setAutoSync(false)}>手动重选</button><button type="button" className="is-primary" onClick={save}>确认使用</button></div>
    </div>
  );
}

function ConditionSettingsCard({ prefs = {}, fundsWithPremium = [], heldCodes = [], onSetPrefValue }) {
  const persisted = useMemo(() => readConditionSettings(prefs), [prefs]);
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState('');
  const [draft, setDraft] = useState(persisted);

  useEffect(() => {
    if (!expanded) setDraft(persisted);
  }, [expanded, persisted]);

  const settings = expanded ? draft : persisted;
  const save = () => {
    onSetPrefValue?.('intraBuyOtherPct', Number(settings.high));
    onSetPrefValue?.('intraSellLowerPct', Number(settings.low));
    onSetPrefValue?.('holdingCondition', settings.holding);
    onSetPrefValue?.('triggerRule', settings.trigger);
    onSetPrefValue?.('hGroupMode', settings.hGroup);
    onSetPrefValue?.('lGroupMode', settings.lGroup);
    onSetPrefValue?.('holdingFundsMode', settings.holdingFunds);
    setExpanded(false);
  };

  return (
    <>
      <section className={cx('mobile-switch-condition-card', expanded && 'is-expanded')}>
        <button type="button" className="mobile-switch-condition-card__header" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          <span className="mobile-switch-condition-card__title"><Settings2 size={15} /><strong>切换条件设置</strong></span>
          <span className="mobile-switch-condition-card__status">{expanded ? '收起' : '已设置'}{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
        </button>
        {!expanded ? (
          <div className="mobile-switch-condition-summary">
            <ConditionSummaryItem icon={BadgePercent} label="H/L 分组" value={settings.hGroup === 'manual' ? '手动选择' : '自动识别'} tone="is-purple" />
            <ConditionSummaryItem icon={BriefcaseBusiness} label="监控候选" value={`${Array.isArray(prefs?.enabledCodes) ? prefs.enabledCodes.length : 0} 只`} tone="is-purple" />
            <ConditionSummaryItem icon={BadgePercent} label="高溢价阈值" value={conditionOptionLabel('high', settings.high)} tone="is-high" />
            <ConditionSummaryItem icon={CircleDollarSign} label="低溢价阈值" value={conditionOptionLabel('low', settings.low)} tone="is-low" />
          </div>
        ) : (
          <div className="mobile-switch-condition-editor">
            {(['high', 'low', 'hGroup', 'lGroup', 'holdingFunds', 'trigger']).map((type) => {
              const meta = CONDITION_META[type];
              const Icon = meta.icon;
              return (
                <div className="mobile-switch-condition-row" key={type}>
                  <div className="mobile-switch-condition-row__label"><Icon size={15} /><span>{meta.title}</span></div>
                  <button type="button" onClick={() => setPicker(type === 'hGroup' || type === 'lGroup' ? 'groups' : type === 'holdingFunds' ? 'holding' : type)}>
                    <span>{conditionOptionLabel(type, settings[type]) || '—'}</span>
                    <ChevronRight size={15} />
                  </button>
                </div>
              );
            })}
            <button type="button" className="mobile-switch-condition-save" onClick={save}>保存设置</button>
          </div>
        )}
      </section>
      {picker ? (
        picker === 'groups' ? (
          <FundGroupPicker
            funds={fundsWithPremium}
            prefs={prefs}
            onBack={() => setPicker('')}
            onSave={(premiumClass, modes) => {
              onSetPrefValue?.('premiumClass', premiumClass);
              setDraft((current) => ({ ...current, hGroup: modes.H, lGroup: modes.L }));
            }}
          />
        ) : picker === 'holding' ? (
          <HoldingFundsPicker
            funds={fundsWithPremium}
            prefs={prefs}
            heldCodes={heldCodes}
            onBack={() => setPicker('')}
            onSave={(benchmarkCodes, autoSync) => {
              onSetPrefValue?.('benchmarkCodes', benchmarkCodes);
              setDraft((current) => ({ ...current, holdingFunds: autoSync ? 'auto' : 'manual' }));
            }}
          />
        ) : (
          <ConditionPicker
            type={picker}
            value={draft[picker]}
            onBack={() => setPicker('')}
            onSelect={(value) => {
              setDraft((current) => ({ ...current, [picker]: value }));
              setPicker('');
            }}
          />
        )
      ) : null}
    </>
  );
}

function ruleCondition(pair) {
  const threshold = numberValue(pair?.threshold);
  if (pair?.rule === 'A') return `规则 A · H-L ≤ ${threshold === null ? '—' : `${threshold.toFixed(2)}%`}`;
  if (pair?.rule === 'B') return `规则 B · H-L ≥ ${threshold === null ? '—' : `${threshold.toFixed(2)}%`}`;
  return '未命中规则';
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
        <div className="mobile-switch-card-vs">VS</div>
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

function OpportunityDetail({ pair, onBack, onCreatePlan, watching = false, automationEnabled = false, onToggleWatch, onEnableAutomation }) {
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
    <div className="mobile-switch-detail-page">
      <div className="mobile-switch-detail-header"><button type="button" aria-label="返回推荐切换机会" onClick={onBack}><ChevronLeft size={20} /></button><strong>方案详情</strong><div><button type="button" aria-label="加入关注" className={watching ? 'is-active' : ''} onClick={() => onToggleWatch?.()}><Star size={19} /></button></div></div>
      <div className="mobile-switch-detail-pair"><FundSide fund={pair?.fromFund} code={pair?.from} name={pair?.fromName} fundClass={pair?.fromClass} action="卖出" /><div className="mobile-switch-compare-vs">VS</div><FundSide fund={pair?.toFund} code={pair?.to} name={pair?.toName} fundClass={pair?.toClass} action="买入" /></div>
      <div className="mobile-switch-spread-panel"><div>组合溢价差（H - L） <Info size={13} /></div><strong className={tone(pair?.spread)}>{formatPercent(pair?.spread)}</strong><span>{ruleCondition(pair)} · 超出阈值 {formatPercent(advantage)}</span></div>
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
  workerError = '',
  workerConfig,
  heldCodes = null,
  onSetPrefValue,
  onViewPlan,
  onEnableAutomation,
}) {
  const [screen, setScreen] = useState('overview');
  const [filter, setFilter] = useState('全部');
  const [sortMode, setSortMode] = useState('规则优势');
  const [selectedPair, setSelectedPair] = useState(null);
  const [watchlist, setWatchlist] = useState(readSwitchWatchlist);
  const holdingCondition = String(prefs?.holdingCondition || 'held-only').trim().toLowerCase();
  const modelHeldCodes = holdingCondition === 'all'
    ? null
    : holdingCondition === 'unheld-only'
      ? (Array.isArray(heldCodes) && heldCodes.length ? [] : null)
      : heldCodes;
  const opportunityModel = useMemo(() => buildFundSwitchOpportunityModel({
    snapshot: workerSnapshot,
    signals: intraSignals,
    funds: fundsWithPremium,
    prefs,
    otcSignal,
    heldCodes: modelHeldCodes
  }), [fundsWithPremium, intraSignals, modelHeldCodes, otcSignal, prefs, workerSnapshot]);
  const { candidateCount, hasOtcOpportunity, opportunityPairs: allOpportunityPairs } = opportunityModel;
  const opportunityPairs = useMemo(() => {
    const triggerRule = String(prefs?.triggerRule || 'ab').trim().toLowerCase();
    if (triggerRule === 'a') return allOpportunityPairs.filter((pair) => pair.rule === 'A');
    if (triggerRule === 'b') return allOpportunityPairs.filter((pair) => pair.rule === 'B');
    if (triggerRule === 'custom') return [];
    return allOpportunityPairs;
  }, [allOpportunityPairs, prefs?.triggerRule]);
  const opportunityCount = opportunityPairs.length + (hasOtcOpportunity ? 1 : 0);
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
    return <OpportunityDetail pair={selectedPair} watching={Boolean(watchedEntry)} automationEnabled={automationEnabled} onToggleWatch={toggleWatch} onEnableAutomation={onEnableAutomation} onBack={() => setScreen('recommended')} onCreatePlan={onViewPlan} />;
  }

  if (screen === 'recommended') {
    return (
      <div className="mobile-switch-recommended-page">
        <div className="mobile-switch-list-header"><button type="button" aria-label="返回机会概览" onClick={() => setScreen('overview')}><ChevronLeft size={20} /></button><strong>推荐切换机会</strong><span aria-hidden="true" /></div>
        <div className="mobile-switch-list-filters">{['全部', '规则 A', '规则 B', '最佳机会'].map((item) => <button type="button" key={item} className={filter === item ? 'is-active' : ''} onClick={() => setFilter(item)}>{item}</button>)}<button type="button" className="mobile-switch-list-sort" onClick={() => setSortMode((value) => value === '规则优势' ? '代码' : '规则优势')}>{sortMode}⌄</button></div>
        <div className="mobile-switch-list-summary"><span>共 {opportunityCount} 组命中</span><small>场内候选 {candidateCount} 组 <Info size={12} /></small></div>
        <div className="mobile-switch-opportunity-list">{filteredPairs.map((pair, index) => <PairCard key={`${pair.from}-${pair.to}`} pair={pair} index={index} onOpen={(item) => { setSelectedPair(item); setScreen('detail'); }} onAddPlan={(item) => setWatchlist(upsertSwitchWatch({ ...item, id: item.from + ':' + item.to }))} />)}{!filteredPairs.length ? <div className="mobile-switch-empty-card">暂无符合当前筛选的切换机会</div> : null}</div>
      </div>
    );
  }

  return (
    <div className="mobile-switch-opportunity">
      <ConditionSettingsCard prefs={prefs} fundsWithPremium={fundsWithPremium} heldCodes={heldCodes} onSetPrefValue={onSetPrefValue} />
      <div className="mobile-switch-opportunity__title-row"><div className="mobile-switch-opportunity__section-title">当前机会 <span>（规则命中）</span></div><button type="button" className="mobile-switch-sort-label" onClick={() => setSortMode((value) => value === '规则优势' ? '代码' : '规则优势')}>{sortMode} <ChevronRight size={15} /></button></div>
      <section className="mobile-switch-current-opportunity">{primaryPair ? <><div className="mobile-switch-compare-grid"><FundSide fund={primaryPair.fromFund} code={primaryPair.from} name={primaryPair.fromName} fundClass={primaryPair.fromClass} action="卖出" /><div className="mobile-switch-compare-vs">VS</div><FundSide fund={primaryPair.toFund} code={primaryPair.to} name={primaryPair.toName} fundClass={primaryPair.toClass} action="买入" /></div><div className="mobile-switch-spread-panel"><div>组合溢价差（H - L） <Info size={13} /></div><strong className={tone(primaryPair.spread)}>{formatPercent(primaryPair.spread)}</strong><span>{ruleCondition(primaryPair)} · 超出阈值 {formatPercent(advantage)}</span></div></> : <div className="mobile-switch-empty-card">当前没有命中规则的场内切换机会</div>}</section>
      <section className="mobile-switch-overview-section"><div className="mobile-switch-section-heading"><span>机会概览</span><ChevronRight size={17} /></div><div className="mobile-switch-overview-grid"><OverviewMetric label="H-L 溢价差" value={formatPercent(primaryPair?.spread)} note={primaryPair ? ruleCondition(primaryPair) : '—'} className={tone(primaryPair?.spread)} /><OverviewMetric label="历史分位（近1年）" value="—" note="暂无统一口径" /><OverviewMetric label="超出触发阈值" value={formatPercent(advantage)} note="按规则 A/B 计算" className="is-purple" /><OverviewMetric label="符合规则的机会" value={opportunityCount} note={`场内共 ${candidateCount} 组候选`} className="is-purple" /></div>{workerError ? <div className="mobile-switch-inline-warning">切换策略数据未连接：{workerError}</div> : null}</section>
      <section className="mobile-switch-opportunity-list"><div className="mobile-switch-section-heading"><span>推荐切换机会 <small>（部分）</small></span><button type="button" onClick={() => setScreen('recommended')}>查看更多 <ChevronRight size={14} /></button></div>{opportunityPairs.slice(0, 3).map((pair, index) => <PairCard key={`${pair.from}-${pair.to}`} pair={pair} index={index} onOpen={(item) => { setSelectedPair(item); setScreen('detail'); }} onAddPlan={(item) => setWatchlist(upsertSwitchWatch({ ...item, id: item.from + ':' + item.to }))} />)}{hasOtcOpportunity ? <div className="mobile-switch-empty-card">场外信号已触发；场外申购目标与额度请到行情中心确认</div> : null}{!opportunityCount ? <div className="mobile-switch-empty-card">暂无符合规则的切换机会</div> : null}</section>
      {automationEnabled ? <section className="mobile-switch-reminder-card"><Bell size={27} /><div><strong>自动监控已开启</strong><span>规则 A ≤ {numberValue(prefs?.intraSellLowerPct) === null ? '—' : `${Number(prefs.intraSellLowerPct).toFixed(2)}%`} · 规则 B ≥ {numberValue(prefs?.intraBuyOtherPct) === null ? '—' : `${Number(prefs.intraBuyOtherPct).toFixed(2)}%`}</span></div><ChevronRight size={18} /></section> : null}
      {navUpdatedHint ? <div className="mobile-switch-updated-hint">NAV 最新日期 {navUpdatedHint.replace(/^NAV 最新日期\s*/, '')}</div> : null}
    </div>
  );
}

export function MobileFundSwitchWatchlist({
  prefs = {},
  fundsWithPremium = [],
  heldCodes = [],
  workerConfig = {},
  onToggleWorker,
  onSetPrefValue,
  onRuleSelect,
  onRuleNameChange,
  onRuleEnabledChange,
  onRuleRemove
}) {
  const [watchlist, setWatchlist] = useState(readSwitchWatchlist);
  const [expandedRuleId, setExpandedRuleId] = useState('');
  const [editingRuleId, setEditingRuleId] = useState('');
  const ruleList = Array.isArray(prefs?.rules) ? prefs.rules : [];

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
    const rules = ruleList.length ? ruleList : [prefs];
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
  }, [fundsWithPremium, prefs, ruleList]);

  const beginRuleEdit = (rule) => {
    onRuleSelect?.(rule.id);
    setExpandedRuleId(rule.id);
    setEditingRuleId(rule.id);
  };

  const removeRule = (rule) => {
    if (ruleList.length <= 1) return;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(`确认删除规则“${rule.name || '未命名规则'}”？`)) return;
    onRuleRemove?.(rule.id);
    setEditingRuleId((current) => current === rule.id ? '' : current);
    setExpandedRuleId((current) => current === rule.id ? '' : current);
  };

  return (
    <div className="mobile-switch-watchlist-page">
      <div className="mobile-switch-watchlist-header"><div><strong>我的方案</strong><span>管理关注方案和自动监控规则</span></div><Star size={20} /></div><section className="mobile-switch-plan-manager"><div><strong>自动监控</strong><span>{workerConfig?.enabled ? '已启用，按规则 A/B 扫描' : '已暂停，不会发送切换通知'}</span></div><button type="button" className={workerConfig?.enabled ? 'is-enabled' : ''} onClick={() => onToggleWorker?.(!workerConfig?.enabled)}>{workerConfig?.enabled ? '暂停监控' : '启用监控'}</button></section>
      <section className="mobile-switch-watchlist-section"><div className="mobile-switch-watchlist-section__title"><span>已加入我的方案</span><b>{watchlist.length}</b></div>{watchlist.length ? <div className="mobile-switch-watchlist-list">{watchlist.map((item) => <div className="mobile-switch-watchlist-card" key={item.id}><div className="mobile-switch-watchlist-card__pair"><div><i className={cx('mobile-switch-class-dot', classTone(item.fromClass))}>{item.fromClass || '—'}</i><strong>{item.from}</strong><span>{item.fromName}</span></div><span className="mobile-switch-card-vs">VS</span><div><i className={cx('mobile-switch-class-dot', classTone(item.toClass))}>{item.toClass || '—'}</i><strong>{item.to}</strong><span>{item.toName}</span></div><b className={tone(item.spread)}>H-L {formatPercent(item.spread)}</b></div><div className="mobile-switch-watchlist-card__actions"><span>{ruleCondition(item)}</span><button type="button" onClick={() => setWatchlist(removeSwitchWatch(item.id))}>取消关注</button></div></div>)}</div> : <div className="mobile-switch-watchlist-empty"><Star size={18} /><span>还没有关注方案<br /><small>在方案详情中点击“加入关注”后，会在这里持续跟踪。</small></span></div>}</section>
      <section className="mobile-switch-watchlist-section">
        <button
          type="button"
          className="mobile-switch-watchlist-section__title mobile-switch-watchlist-section__title-button"
          aria-expanded={Boolean(expandedRuleId)}
          onClick={() => setExpandedRuleId((current) => current ? '' : (ruleList[0]?.id || ''))}
        >
          <span>规则管理</span><b>{ruleList.length}</b>
        </button>
        <div className="mobile-switch-rule-list">
          {ruleList.map((rule) => {
            const isExpanded = expandedRuleId === rule.id;
            const isEditing = editingRuleId === rule.id;
            const toggleExpanded = () => setExpandedRuleId((current) => current === rule.id ? '' : rule.id);
            return (
              <div
                className={cx('mobile-switch-rule-card', isExpanded && 'is-expanded')}
                key={rule.id}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onClick={toggleExpanded}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleExpanded();
                  }
                }}
              >
                {isEditing ? (
                  <div className="mobile-switch-rule-card__editor" onClick={(event) => event.stopPropagation()}>
                    <div className="mobile-switch-rule-card__editor-head">
                      <label>
                        <span>规则名称</span>
                        <input
                          value={rule.name || ''}
                          onChange={(event) => onRuleNameChange?.(rule.id, event.target.value)}
                          autoFocus
                        />
                      </label>
                      <label className="mobile-switch-rule-card__editor-toggle">
                        <input
                          type="checkbox"
                          checked={Boolean(rule.enabled)}
                          onChange={(event) => onRuleEnabledChange?.(rule.id, event.target.checked)}
                        />
                        <span>启用这条规则</span>
                      </label>
                    </div>
                    <ConditionSettingsCard
                      prefs={rule}
                      fundsWithPremium={fundsWithPremium}
                      heldCodes={heldCodes}
                      onSetPrefValue={onSetPrefValue}
                    />
                    <div className="mobile-switch-rule-card__editor-actions">
                      <button type="button" onClick={() => setEditingRuleId('')}>完成</button>
                      <button type="button" className="is-danger" onClick={() => removeRule(rule)} disabled={ruleList.length <= 1}>删除</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <strong>{rule.name || '未命名规则'}</strong>
                      <span>{(rule.benchmarkCodes || []).length} 持仓 / {(rule.enabledCodes || []).length} 候选 · A ≤ {numberValue(rule.intraSellLowerPct) === null ? '—' : Number(rule.intraSellLowerPct).toFixed(1) + '%'} / B ≥ {numberValue(rule.intraBuyOtherPct) === null ? '—' : Number(rule.intraBuyOtherPct).toFixed(1) + '%'}</span>
                      {isExpanded ? <small className="mobile-switch-rule-card__detail">持仓：{(rule.benchmarkCodes || []).join('、') || '—'}<br />候选：{(rule.enabledCodes || []).join('、') || '—'}<br />点击卡片可收起规则详情</small> : null}
                    </div>
                    <span className={rule.enabled ? 'is-running' : 'is-paused'}>{rule.enabled ? '监控中' : '已暂停'}</span>
                    <div className="mobile-switch-rule-card__actions" onClick={(event) => event.stopPropagation()}>
                      <button type="button" onClick={() => beginRuleEdit(rule)}>编辑</button>
                      <button type="button" onClick={() => onRuleEnabledChange?.(rule.id, !rule.enabled)}>{rule.enabled ? '暂停' : '启用'}</button>
                      <button type="button" className="is-danger" onClick={() => removeRule(rule)} disabled={ruleList.length <= 1}>删除</button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <section className="mobile-switch-watchlist-section"><div className="mobile-switch-watchlist-section__title"><span>当前配置的组合</span><b>{configuredPairs.length}</b></div>{configuredPairs.length ? <div className="mobile-switch-watchlist-history">{configuredPairs.map((pair) => <div className="mobile-switch-watchlist-history__item" key={pair.from + ':' + pair.to}><div><strong>{pair.from} → {pair.to}</strong><span>{pair.ruleName} · {pair.fromClass || '—'}→{pair.toClass || '—'}</span></div><b className={tone(pair.spread)}>{formatPercent(pair.spread)}</b></div>)}</div> : <div className="mobile-switch-watchlist-empty">暂无已分类的持仓候选组合。</div>}</section>
    </div>
  );
}
