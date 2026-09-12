import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Play,
  Save,
  Search
} from 'lucide-react';
import { readLedgerState } from '../app/holdingsLedger.js';
import { aggregateByCode } from '../app/holdingsLedgerCore.js';
import {
  buildSwitchConfigSyncKey,
  getActiveSwitchRule,
  loadSwitchConfigFromWorker,
  normalizeSwitchConfigShape,
  readSwitchConfigCache,
  saveSwitchConfigToWorker,
  selectSwitchRule,
  updateActiveSwitchRule
} from '../app/switchStrategySync.js';
import { testSwitchConfig } from '../app/switchStrategyTestSync.js';
import {
  formatSwitchDate,
  loadNasdaqList,
  readSwitchPrefs,
  writeSwitchPrefs
} from './switchStrategyHelpers.js';
import { Card, cx } from '../components/experience-ui.jsx';

const STEP_LABELS = [
  { id: 1, title: 'H / L 与持仓', short: 'H/L' },
  { id: 2, title: '切换阈值', short: '阈值' },
  { id: 3, title: '测试并保存', short: '测试' }
];

function initialConfig() {
  const cache = normalizeSwitchConfigShape(readSwitchConfigCache());
  const prefs = normalizeSwitchConfigShape(readSwitchPrefs());
  const activeCache = getActiveSwitchRule(cache);
  const hasCache = Boolean(
    activeCache?.benchmarkCodes?.length
      || activeCache?.enabledCodes?.length
      || Object.keys(activeCache?.premiumClass || {}).length
  );
  return hasCache ? cache : prefs;
}

function getExchangeHoldings() {
  try {
    const ledger = readLedgerState();
    return aggregateByCode(ledger.transactions || [], ledger.snapshotsByCode || {})
      .filter((item) => item?.kind === 'exchange' && item?.hasPosition)
      .map((item) => ({
        code: String(item.code || ''),
        name: String(item.name || ''),
        totalShares: Number(item.totalShares) || 0,
        marketValue: Number(item.marketValue) || 0
      }));
  } catch (_error) {
    return [];
  }
}

function normalizeFundRow(item = {}) {
  return {
    code: String(item.code || '').trim(),
    name: String(item.name || '').trim(),
    indexKey: String(item.index_key || item.indexKey || '').trim()
  };
}

function StepIndicator({ step }) {
  const activeIndex = Math.max(0, STEP_LABELS.findIndex((item) => item.id === step));
  const progress = activeIndex / Math.max(STEP_LABELS.length - 1, 1);
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold">
        <span className="text-slate-800">配置换基策略</span>
        <span className="text-slate-400">第 {activeIndex + 1} 步 / 共 {STEP_LABELS.length} 步</span>
      </div>
      <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-indigo-500 transition-transform duration-300"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {STEP_LABELS.map((item, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <div key={item.id} className={cx('flex min-w-0 items-center gap-1.5 text-xs font-semibold', index <= activeIndex ? 'text-indigo-700' : 'text-slate-400')}>
              <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', index <= activeIndex ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400')}>
                {done ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <span className="truncate">{active ? item.title : item.short}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ValidationNote({ text }) {
  if (!text) return null;
  return (
    <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function FundRow({ fund, holding, currentClass, isBenchmark, onClassChange, onHoldingToggle }) {
  const classified = currentClass === 'H' || currentClass === 'L';
  return (
    <div className={cx(
      'rounded-xl border px-3 py-3 transition-colors sm:flex sm:items-center sm:gap-3',
      isBenchmark ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'
    )}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{fund.code}</span>
          {holding ? <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">账户持仓</span> : null}
          {isBenchmark ? <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">策略持仓</span> : null}
        </div>
        <div className="mt-1 truncate text-xs text-slate-500">{fund.name || '基金名称未加载'}</div>
        {holding ? (
          <div className="mt-1 text-[11px] text-slate-400">
            持有 {holding.totalShares.toLocaleString('zh-CN')} 份
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0 sm:justify-end">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => onClassChange(currentClass === 'H' ? null : 'H')}
            className={cx('min-h-8 rounded-md px-3 text-xs font-bold transition-colors', currentClass === 'H' ? 'bg-rose-500 text-white' : 'text-slate-500 hover:bg-rose-50 hover:text-rose-700')}
          >
            H
          </button>
          <button
            type="button"
            onClick={() => onClassChange(currentClass === 'L' ? null : 'L')}
            className={cx('min-h-8 rounded-md px-3 text-xs font-bold transition-colors', currentClass === 'L' ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700')}
          >
            L
          </button>
        </div>
        <button
          type="button"
          disabled={!classified}
          onClick={onHoldingToggle}
          className={cx(
            'min-h-8 rounded-lg border px-3 text-xs font-semibold transition-colors',
            isBenchmark ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-700',
            !classified && 'cursor-not-allowed opacity-45'
          )}
          title={classified ? '' : '先选择 H 或 L'}
        >
          {isBenchmark ? '取消持仓' : '设为持仓'}
        </button>
      </div>
    </div>
  );
}

function ThresholdField({ tone, title, formula, value, onChange, helper }) {
  const toneClass = tone === 'rose'
    ? 'border-rose-200 bg-rose-50/50'
    : 'border-emerald-200 bg-emerald-50/50';
  return (
    <div className={cx('rounded-2xl border p-4', toneClass)}>
      <div className="text-sm font-bold text-slate-900">{title}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{helper}</div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/80 bg-white p-3 shadow-sm">
        <span className="min-w-0 flex-1 text-sm font-semibold text-slate-700">{formula}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="0.1"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-20 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-right text-sm font-bold text-slate-900 focus:border-indigo-300 focus:outline-none"
          />
          <span className="text-sm text-slate-500">%</span>
        </div>
      </div>
    </div>
  );
}

function TriggerList({ triggers = [] }) {
  if (!triggers.length) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
        测试通过。当前行情没有触发切换阈值，配置可以保存。
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {triggers.slice(0, 6).map((trigger, index) => (
        <div key={`${trigger.ruleId || ''}-${trigger.fromCode || ''}-${trigger.toCode || ''}-${index}`} className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2.5">
          <div className="text-sm font-bold text-slate-900">卖 {trigger.fromCode} → 买 {trigger.toCode}</div>
          <div className="mt-1 text-xs text-slate-500">
            规则 {trigger.rule || '—'} · 当前差值 {Number.isFinite(Number(trigger.gapPct)) ? `${Number(trigger.gapPct).toFixed(2)}%` : '—'} · 阈值 {Number.isFinite(Number(trigger.threshold)) ? `${Number(trigger.threshold).toFixed(2)}%` : '—'}
          </div>
        </div>
      ))}
      {triggers.length > 6 ? <div className="text-xs text-slate-400">另有 {triggers.length - 6} 条测试信号未展开。</div> : null}
    </div>
  );
}

export function SwitchStrategySetupExperience() {
  const [draft, setDraft] = useState(initialConfig);
  const [step, setStep] = useState(1);
  const [catalog, setCatalog] = useState([]);
  const [holdings, setHoldings] = useState(getExchangeHoldings);
  const [query, setQuery] = useState('');
  const [autoEnable, setAutoEnable] = useState(() => Boolean(initialConfig().enabled));
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testedKey, setTestedKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [funds, workerConfig] = await Promise.all([
        loadNasdaqList().catch(() => []),
        loadSwitchConfigFromWorker().catch(() => null)
      ]);
      if (cancelled) return;
      setCatalog((funds || []).map(normalizeFundRow).filter((item) => item.code));
      if (workerConfig) {
        setDraft(workerConfig);
        setAutoEnable(Boolean(workerConfig.enabled));
      }
      setLoading(false);
    })();
    const onStorage = () => setHoldings(getExchangeHoldings());
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const rule = useMemo(() => getActiveSwitchRule(draft) || {}, [draft]);
  const premiumClass = rule.premiumClass || {};
  const benchmarkSet = useMemo(() => new Set(rule.benchmarkCodes || []), [rule.benchmarkCodes]);
  const holdingMap = useMemo(() => new Map(holdings.map((item) => [item.code, item])), [holdings]);
  const currentTestKey = useMemo(
    () => buildSwitchConfigSyncKey({ ...draft, enabled: false }),
    [draft]
  );
  const testIsCurrent = Boolean(testedKey && testedKey === currentTestKey);

  const funds = useMemo(() => {
    const map = new Map();
    catalog.forEach((item) => map.set(item.code, item));
    holdings.forEach((item) => {
      if (!map.has(item.code)) map.set(item.code, { code: item.code, name: item.name || '', indexKey: '' });
    });
    [...(rule.benchmarkCodes || []), ...(rule.enabledCodes || []), ...Object.keys(premiumClass)].forEach((code) => {
      if (!map.has(code)) map.set(code, { code, name: holdingMap.get(code)?.name || '', indexKey: '' });
    });
    const list = [...map.values()];
    list.sort((a, b) => {
      const aHeld = holdingMap.has(a.code) ? 1 : 0;
      const bHeld = holdingMap.has(b.code) ? 1 : 0;
      if (aHeld !== bHeld) return bHeld - aHeld;
      const aConfigured = premiumClass[a.code] ? 1 : 0;
      const bConfigured = premiumClass[b.code] ? 1 : 0;
      if (aConfigured !== bConfigured) return bConfigured - aConfigured;
      return a.code.localeCompare(b.code);
    });
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((item) => item.code.includes(needle) || item.name.toLowerCase().includes(needle));
  }, [catalog, holdings, holdingMap, premiumClass, query, rule.benchmarkCodes, rule.enabledCodes]);

  const hCodes = useMemo(() => Object.entries(premiumClass).filter(([, value]) => value === 'H').map(([code]) => code), [premiumClass]);
  const lCodes = useMemo(() => Object.entries(premiumClass).filter(([, value]) => value === 'L').map(([code]) => code), [premiumClass]);

  const step1Error = !rule.benchmarkCodes?.length
    ? '至少选择 1 只策略持仓。先给基金设置 H / L，再点击“设为持仓”。'
    : (rule.benchmarkCodes || []).some((code) => !premiumClass[code])
      ? '策略持仓必须先归类为 H 或 L。'
      : !hCodes.length || !lCodes.length
        ? 'H 组和 L 组都至少需要 1 只基金，才能计算组间切换。'
        : '';
  const lowerValue = Number(rule.intraSellLowerPct);
  const upperValue = Number(rule.intraBuyOtherPct);
  const step2Error = !Number.isFinite(lowerValue) || !Number.isFinite(upperValue)
    ? '请填写有效的切换阈值。'
    : lowerValue >= upperValue
      ? '低→高阈值需要小于高→低阈值，例如 1% 和 3%。'
      : '';

  function mutateDraft(updater) {
    setDraft((prev) => normalizeSwitchConfigShape(typeof updater === 'function' ? updater(prev) : updater));
    setTestedKey('');
    setTestResult(null);
    setNotice('');
    setError('');
  }

  function updateClass(code, nextClass) {
    mutateDraft((prev) => updateActiveSwitchRule(prev, (active) => {
      const nextPremiumClass = { ...(active.premiumClass || {}) };
      const nextBenchmarks = new Set(active.benchmarkCodes || []);
      const nextEnabled = new Set(active.enabledCodes || []);
      if (nextClass === 'H' || nextClass === 'L') {
        nextPremiumClass[code] = nextClass;
        if (!nextBenchmarks.has(code)) nextEnabled.add(code);
      } else {
        delete nextPremiumClass[code];
        if (!nextBenchmarks.has(code)) nextEnabled.delete(code);
      }
      return {
        premiumClass: nextPremiumClass,
        enabledCodes: [...nextEnabled]
      };
    }));
  }

  function toggleHolding(code) {
    if (!premiumClass[code]) return;
    mutateDraft((prev) => updateActiveSwitchRule(prev, (active) => {
      const nextBenchmarks = new Set(active.benchmarkCodes || []);
      const nextEnabled = new Set(active.enabledCodes || []);
      if (nextBenchmarks.has(code)) {
        nextBenchmarks.delete(code);
        nextEnabled.add(code);
      } else {
        nextBenchmarks.add(code);
        nextEnabled.delete(code);
      }
      return {
        benchmarkCodes: [...nextBenchmarks],
        enabledCodes: [...nextEnabled]
      };
    }));
  }

  function updateThreshold(field, value) {
    mutateDraft((prev) => updateActiveSwitchRule(prev, { [field]: value }));
  }

  async function runTest() {
    if (step1Error || step2Error) return;
    setTesting(true);
    setError('');
    setNotice('');
    try {
      const executable = updateActiveSwitchRule({ ...draft, enabled: false }, { enabled: true });
      const payload = await testSwitchConfig(executable);
      setTestResult(payload);
      if (payload?.summary?.ready === false) {
        setTestedKey('');
        setError('测试已运行，但实时行情不足，暂时不能完成验证。请稍后重新测试。');
      } else {
        setTestedKey(currentTestKey);
        setNotice('测试完成。当前草稿尚未保存，你可以先核对结果，再决定是否启用自动监控。');
      }
    } catch (testError) {
      setTestedKey('');
      setTestResult(null);
      setError(testError?.message || '测试失败，请稍后重试。');
    } finally {
      setTesting(false);
    }
  }

  async function saveConfig() {
    if (!testIsCurrent) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const executable = updateActiveSwitchRule(draft, { enabled: true });
      const result = await saveSwitchConfigToWorker({ ...executable, enabled: autoEnable });
      const stored = result?.config || result || executable;
      setDraft(stored);
      writeSwitchPrefs(stored);
      setAutoEnable(Boolean(stored.enabled));
      setTestedKey(buildSwitchConfigSyncKey({ ...stored, enabled: false }));
      setNotice(stored.enabled ? '配置已保存并启用自动监控。' : '配置已保存，自动监控保持关闭。');
    } catch (saveError) {
      setError(saveError?.message || '保存配置失败。');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card className="flex min-h-[360px] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取换基配置…
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <StepIndicator step={step} />

      {draft.rules?.length > 1 ? (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <span className="text-xs font-semibold text-slate-500">当前规则</span>
          <select
            value={draft.activeRuleId}
            onChange={(event) => {
              mutateDraft((prev) => selectSwitchRule(prev, event.target.value));
              setStep(1);
            }}
            className="min-w-0 max-w-[220px] rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-semibold text-slate-800"
          >
            {draft.rules.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
          </select>
        </div>
      ) : null}

      {step === 1 ? (
        <div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">先确定 H / L 和当前持仓</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">把需要参与切换的基金分到高溢价 H、低溢价 L，并标记当前实际希望监控的持仓。账户里已有持仓会优先显示。</p>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-center">
              <div className="text-lg font-bold text-rose-700">{hCodes.length}</div>
              <div className="text-[11px] font-semibold text-rose-600">H 组</div>
            </div>
            <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-center">
              <div className="text-lg font-bold text-emerald-700">{lCodes.length}</div>
              <div className="text-[11px] font-semibold text-emerald-600">L 组</div>
            </div>
            <div className="rounded-xl bg-indigo-50 px-3 py-2.5 text-center">
              <div className="text-lg font-bold text-indigo-700">{rule.benchmarkCodes?.length || 0}</div>
              <div className="text-[11px] font-semibold text-indigo-600">策略持仓</div>
            </div>
          </div>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索基金代码或名称"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-indigo-300 focus:outline-none"
            />
          </div>
          <div className="mt-3 max-h-[52vh] space-y-2 overflow-y-auto pr-1">
            {funds.map((fund) => (
              <FundRow
                key={fund.code}
                fund={fund}
                holding={holdingMap.get(fund.code)}
                currentClass={premiumClass[fund.code] || null}
                isBenchmark={benchmarkSet.has(fund.code)}
                onClassChange={(nextClass) => updateClass(fund.code, nextClass)}
                onHoldingToggle={() => toggleHolding(fund.code)}
              />
            ))}
            {!funds.length ? <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">没有匹配的基金。</div> : null}
          </div>
          <ValidationNote text={step1Error} />
        </div>
      ) : null}

      {step === 2 ? (
        <div>
          <h2 className="text-xl font-bold text-slate-900">设置两条切换阈值</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">只保留最关键的两条场内切换条件。其他场外参数继续沿用原配置，不在这里重复干扰。</p>
          <div className="mt-5 space-y-3">
            <ThresholdField
              tone="rose"
              title="规则 A · L → H"
              formula="H 溢价 − L 溢价 <"
              value={rule.intraSellLowerPct}
              onChange={(value) => updateThreshold('intraSellLowerPct', value)}
              helper="差价收窄时，从低溢价持仓切到高溢价组。默认可从 1% 开始。"
            />
            <ThresholdField
              tone="emerald"
              title="规则 B · H → L"
              formula="H 溢价 − L 溢价 >"
              value={rule.intraBuyOtherPct}
              onChange={(value) => updateThreshold('intraBuyOtherPct', value)}
              helper="差价扩大时，从高溢价持仓切回低溢价组。默认可从 3% 开始。"
            />
          </div>
          <ValidationNote text={step2Error} />
        </div>
      ) : null}

      {step === 3 ? (
        <div>
          <h2 className="text-xl font-bold text-slate-900">先测试，再保存</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">测试只计算当前草稿和实时行情，不写入策略、不占每日推送次数，也不会发送通知。</p>
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">当前持仓</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{(rule.benchmarkCodes || []).join('、') || '未设置'}</div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">阈值</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">A &lt; {rule.intraSellLowerPct}% · B &gt; {rule.intraBuyOtherPct}%</div>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={runTest}
            disabled={testing || Boolean(step1Error) || Boolean(step2Error)}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {testing ? '正在读取实时行情并测试…' : '手动跑一次测试'}
          </button>

          {testResult ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>测试时间：{formatSwitchDate(testResult?.snapshot?.computedAt || testResult?.computedAt)}</span>
                <span>有效行情 {Number(testResult?.summary?.validFundCount || 0)} 只 · 命中 {Number(testResult?.summary?.triggered || 0)} 条</span>
              </div>
              <TriggerList triggers={testResult?.snapshot?.triggers || []} />
            </div>
          ) : null}

          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={autoEnable}
                onChange={(event) => setAutoEnable(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              <span>
                <span className="block text-sm font-bold text-slate-900">保存后启用自动监控</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">关闭时只保存配置，不会按分钟自动扫描。</span>
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={saveConfig}
            disabled={!testIsCurrent || saving}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? '正在保存…' : autoEnable ? '保存并启用监控' : '保存配置'}
          </button>
          {!testIsCurrent ? <div className="mt-2 text-center text-xs text-slate-400">当前配置需要先完成一次测试，保存按钮才会解锁。</div> : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs leading-5 text-emerald-800">{notice}</div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => setStep((value) => Math.max(1, value - 1))}
          disabled={step === 1}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" />
          上一步
        </button>
        {step < 3 ? (
          <button
            type="button"
            onClick={() => setStep((value) => Math.min(3, value + 1))}
            disabled={(step === 1 && Boolean(step1Error)) || (step === 2 && Boolean(step2Error))}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            下一步
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStep(1)}
            className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600"
          >
            重新调整
          </button>
        )}
      </div>
    </Card>
  );
}
