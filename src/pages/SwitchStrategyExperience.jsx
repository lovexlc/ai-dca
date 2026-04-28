import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownUp, Info, RefreshCw, Repeat } from 'lucide-react';
import { Card, Pill, SectionHeading, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';
import { readLedgerState } from '../app/holdingsLedger.js';
import { aggregateByCode } from '../app/holdingsLedgerCore.js';

// 场内 / 场外纳指 100 切换套利策略实时建议器。
//
// 数据来源说明：
// - 持仓基础数据来自 readLedgerState() + aggregateByCode()，与持仓页保持一致。
// - 场内 ETF 单价用聚合结果中的 latestNav（场内基金的 latestNav 即最新成交价）。
// - 真实的 ETF 溢价 = 价格 / IOPV - 1，需要 IOPV 数据；本组件 V1 暂未接入 IOPV，
//   场外切换面板的「基准当前溢价 %」和「场内最低溢价 %」由用户手动输入做触发模拟，
//   后续 worker 加 /api/notify/iopv 接口后再切换到自动拉取。
//
// 持久化：
// - aiDcaSwitchStrategyPrefs：候选基金、基准 ETF、阈值、手动溢价输入。
// - aiDcaSwitchStrategyLedger：人工记录的套利轮次（开仓 / 平仓 / 收益 %）。

const SWITCH_PREFS_KEY = 'aiDcaSwitchStrategyPrefs';
const SWITCH_LEDGER_KEY = 'aiDcaSwitchStrategyLedger';

const DEFAULT_PREFS = {
  benchmarkCode: '513100',
  enabledCodes: [],
  arbTargetPct: 2,
  intraSellLowerPct: 1,
  intraBuyOtherPct: 3,
  otcPremiumThresholdPct: 8,
  otcMinIntraPremiumLow: 1,
  otcMinIntraPremiumHigh: 2,
  manualBenchmarkPremiumPct: '',
  manualMinIntraPremiumPct: ''
};

function readPrefs() {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage?.getItem(SWITCH_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...parsed, enabledCodes: Array.isArray(parsed?.enabledCodes) ? parsed.enabledCodes : [] };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(prefs) {
  if (typeof window === 'undefined') return;
  try { window.localStorage?.setItem(SWITCH_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function readSwitchLedger() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage?.getItem(SWITCH_LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeSwitchLedger(rows) {
  if (typeof window === 'undefined') return;
  try { window.localStorage?.setItem(SWITCH_LEDGER_KEY, JSON.stringify(rows)); } catch {}
}

function formatPercent(value, digits = 2, withSign = false) {
  if (!Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  const fixed = v.toFixed(digits);
  if (withSign && v > 0) return `+${fixed}%`;
  return `${fixed}%`;
}

function formatPrice(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return v.toFixed(4);
}

function formatDate(value) {
  if (!value) return '—';
  return String(value);
}

function nowIso() {
  return new Date().toISOString();
}

function parseFloatOrEmpty(value) {
  if (value === '' || value === null || value === undefined) return '';
  const v = Number(value);
  return Number.isFinite(v) ? v : '';
}

export function SwitchStrategyExperience({ links, inPagesDir, embedded } = {}) {
  const [prefs, setPrefs] = useState(readPrefs);
  const [ledger, setLedger] = useState(readSwitchLedger);
  const [aggregates, setAggregates] = useState([]);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => { writePrefs(prefs); }, [prefs]);
  useEffect(() => { writeSwitchLedger(ledger); }, [ledger]);

  useEffect(() => {
    try {
      const state = readLedgerState();
      const aggs = aggregateByCode(state.transactions || [], state.snapshotsByCode || {});
      setAggregates(Array.isArray(aggs) ? aggs : []);
    } catch (err) {
      setAggregates([]);
    }
  }, [refreshTick]);

  const exchangeFunds = useMemo(
    () => aggregates.filter((agg) => agg.kind === 'exchange' && agg.hasPosition),
    [aggregates]
  );
  const otcFunds = useMemo(
    () => aggregates.filter((agg) => (agg.kind === 'qdii' || agg.kind === 'otc') && agg.hasPosition),
    [aggregates]
  );

  // enabledCodes 与候选池：用户从持仓 exchange ETF 中手动勾选，
  // 默认（首次进入且 enabledCodes 为空时）自动选中所有持仓的 exchange ETF。
  useEffect(() => {
    if (!exchangeFunds.length) return;
    setPrefs((p) => {
      if (Array.isArray(p.enabledCodes) && p.enabledCodes.length > 0) return p;
      return { ...p, enabledCodes: exchangeFunds.map((f) => f.code) };
    });
  }, [exchangeFunds.length]);

  const candidateExchange = useMemo(() => {
    const set = new Set(prefs.enabledCodes || []);
    return exchangeFunds.filter((f) => set.has(f.code));
  }, [exchangeFunds, prefs.enabledCodes]);

  const benchmark = useMemo(
    () => exchangeFunds.find((f) => f.code === prefs.benchmarkCode)
      || candidateExchange[0]
      || exchangeFunds[0]
      || null,
    [exchangeFunds, candidateExchange, prefs.benchmarkCode]
  );

  function toggleEnabled(code) {
    setPrefs((p) => {
      const set = new Set(p.enabledCodes || []);
      if (set.has(code)) set.delete(code); else set.add(code);
      return { ...p, enabledCodes: Array.from(set) };
    });
  }

  function setBenchmarkCode(code) {
    setPrefs((p) => ({ ...p, benchmarkCode: code }));
  }

  function setPrefField(field, value) {
    setPrefs((p) => ({ ...p, [field]: value }));
  }

  // 场内切换信号：基准 ETF 单价 vs 候选 ETF 单价。
  // 注：用单位价格直接相比仅在两只 ETF 单位规模可比时才接近真实「溢价差」；后续接入 IOPV 后会更准确。
  const intraSignals = useMemo(() => {
    if (!benchmark || !(benchmark.latestNav > 0)) return [];
    return candidateExchange
      .filter((f) => f.code !== benchmark.code && f.latestNav > 0)
      .map((f) => {
        const benchPrice = benchmark.latestNav;
        const otherPrice = f.latestNav;
        const diffVsOther = ((benchPrice - otherPrice) / otherPrice) * 100;
        const sellHoldBuyBench = diffVsOther <= Number(prefs.intraSellLowerPct || 0);
        const sellBenchBuyOther = diffVsOther >= Number(prefs.intraBuyOtherPct || 0);
        return {
          code: f.code,
          name: f.name || f.code,
          latestNav: f.latestNav,
          latestNavDate: f.latestNavDate,
          diffVsOther,
          sellHoldBuyBench,
          sellBenchBuyOther
        };
      })
      .sort((a, b) => a.diffVsOther - b.diffVsOther);
  }, [benchmark, candidateExchange, prefs.intraSellLowerPct, prefs.intraBuyOtherPct]);

  // 场外切换：用户手动输入「基准 ETF 当前溢价 %」「场内最低溢价 %」做触发判定。
  const otcSignal = useMemo(() => {
    const benchPrem = Number(prefs.manualBenchmarkPremiumPct);
    const minIntraPrem = Number(prefs.manualMinIntraPremiumPct);
    const benchOk = Number.isFinite(benchPrem) && prefs.manualBenchmarkPremiumPct !== '';
    const intraOk = Number.isFinite(minIntraPrem) && prefs.manualMinIntraPremiumPct !== '';
    if (!benchOk || !intraOk) {
      return {
        ready: false,
        message: '请在下方「场外切换信号」中填写基准 ETF 当前溢价 % 与场内最低溢价 %（IOPV 自动拉取功能开发中）。'
      };
    }
    const benchHigh = benchPrem > Number(prefs.otcPremiumThresholdPct || 0);
    const intraLowSoft = minIntraPrem < Number(prefs.otcMinIntraPremiumHigh || 0);
    const intraLowHard = minIntraPrem < Number(prefs.otcMinIntraPremiumLow || 0);
    const triggered = benchHigh && (intraLowSoft || intraLowHard);
    let level = '未触发';
    if (triggered && intraLowHard) level = '强信号';
    else if (triggered) level = '弱信号';
    return { ready: true, benchPrem, minIntraPrem, benchHigh, intraLowSoft, intraLowHard, triggered, level };
  }, [
    prefs.manualBenchmarkPremiumPct,
    prefs.manualMinIntraPremiumPct,
    prefs.otcPremiumThresholdPct,
    prefs.otcMinIntraPremiumLow,
    prefs.otcMinIntraPremiumHigh
  ]);

  // 套利轮次记录
  function appendCycleEntry() {
    const next = {
      id: `cycle-${Date.now()}`,
      createdAt: nowIso(),
      benchmarkCode: prefs.benchmarkCode,
      counterpartCode: '',
      enterPrice: '',
      exitPrice: '',
      shares: '',
      pnl: '',
      note: ''
    };
    setLedger((rows) => [next, ...rows]);
  }

  function updateCycleField(id, field, value) {
    setLedger((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removeCycleEntry(id) {
    setLedger((rows) => rows.filter((r) => r.id !== id));
  }

  const headerNote = useMemo(() => {
    if (!exchangeFunds.length) return '当前持仓中没有场内 ETF，先在持仓页录入交易再回来配置切换策略。';
    if (!benchmark) return '请先选择一只基准 ETF。';
    return `基准：${benchmark.code} · ${benchmark.name || ''} · 最新 ${formatPrice(benchmark.latestNav)} (${formatDate(benchmark.latestNavDate)})`;
  }, [exchangeFunds.length, benchmark]);

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeading
          eyebrow="切换策略"
          title="场内 / 场外纳指 100 切换套利"
          description={'通过基准 ETF（默认 513100）和候选 ETF 之间的价差，在场内不同 ETF、以及场内基准 ETF 与场外 QDII 联接基金之间寻找一个套利周期目标 2% 的切换机会。'}
        />

        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <Info className="h-4 w-4 text-slate-400" />
            <span>{headerNote}</span>
            <button
              type="button"
              className={cx(secondaryButtonClass, 'ml-auto h-9 px-3 text-xs')}
              onClick={() => setRefreshTick((t) => t + 1)}
            >
              <RefreshCw className="h-4 w-4" />
              重新读取持仓
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">基准 ETF</div>
              <select
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 focus:border-indigo-300 focus:outline-none"
                value={prefs.benchmarkCode}
                onChange={(event) => setBenchmarkCode(event.target.value)}
              >
                {exchangeFunds.length === 0 ? (
                  <option value="">（持仓暂无场内 ETF）</option>
                ) : null}
                {exchangeFunds.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.code} · {f.name || ''}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">默认 513100；下拉切换为其他你持有的场内 ETF。建议选择规模大、流动性强的那只作为基准。</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">套利目标</div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  step="0.5"
                  className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 focus:border-indigo-300 focus:outline-none"
                  value={prefs.arbTargetPct}
                  onChange={(event) => setPrefField('arbTargetPct', event.target.value)}
                />
                <span className="text-sm text-slate-600">% / 周期</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">作为评估单笔切换是否值得的参考，触发判定本身不直接使用该值。</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">候选基金（场内）</div>
                <div className="mt-1 text-sm text-slate-600">从持仓 exchange ETF 中勾选要参与切换比对的基金。</div>
              </div>
              <div className="text-xs text-slate-500">已选 {prefs.enabledCodes.length} / 持仓 {exchangeFunds.length}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {exchangeFunds.length === 0 ? (
                <div className="text-sm text-slate-500">持仓中暂无场内 ETF。</div>
              ) : null}
              {exchangeFunds.map((f) => {
                const enabled = (prefs.enabledCodes || []).includes(f.code);
                return (
                  <button
                    key={f.code}
                    type="button"
                    onClick={() => toggleEnabled(f.code)}
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      enabled
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                    )}
                  >
                    <span>{f.code}</span>
                    <span className="text-slate-400">·</span>
                    <span className="max-w-[120px] truncate text-slate-600">{f.name || ''}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="场内切换信号"
          title="基准 ETF 与候选 ETF 价差"
          description="以基准 ETF 单价为锚，比较候选 ETF 单价的相对差。两只 ETF 跟踪同一指数且单位规模相近时，单价差近似等于溢价差。"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              规则 A
            </div>
            <div className="mt-1 text-slate-700">
              基准价 − 持有价 ≤
              <input
                type="number"
                step="0.5"
                value={prefs.intraSellLowerPct}
                onChange={(event) => setPrefField('intraSellLowerPct', event.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />
              %  →  卖出持有，买入基准
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              规则 B
            </div>
            <div className="mt-1 text-slate-700">
              基准（持有） − 另一只 ≥
              <input
                type="number"
                step="0.5"
                value={prefs.intraBuyOtherPct}
                onChange={(event) => setPrefField('intraBuyOtherPct', event.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />
              %  →  卖出基准，买入另一只
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">候选</th>
                <th className="px-3 py-2 text-right font-semibold">单价</th>
                <th className="px-3 py-2 text-right font-semibold">基准 − 候选</th>
                <th className="px-3 py-2 text-left font-semibold">建议</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {!benchmark ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-sm text-slate-500">先选定一只基准 ETF。</td>
                </tr>
              ) : null}
              {benchmark && intraSignals.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-sm text-slate-500">候选池中除了基准没有其他场内 ETF。多勾选几只再回来。</td>
                </tr>
              ) : null}
              {intraSignals.map((row) => {
                let tone = 'slate';
                let advice = '观望';
                if (row.sellBenchBuyOther) { tone = 'emerald'; advice = `卖基准 → 买 ${row.code}`; }
                else if (row.sellHoldBuyBench) { tone = 'indigo'; advice = `卖 ${row.code} → 买基准`; }
                return (
                  <tr key={row.code}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-700">{row.code}</div>
                      <div className="text-xs text-slate-400">{row.name}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatPrice(row.latestNav)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatPercent(row.diffVsOther, 2, true)}</td>
                    <td className="px-3 py-2">
                      <Pill tone={tone}>{advice}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            当前以「ETF 最新成交价」直接相比，仅在两只 ETF 跟踪同一指数且单位规模可比时近似有效。
            完整的 ETF 溢价（价格 / IOPV − 1）数据接入正在排期，接入后该面板会自动改用真实溢价差。
          </span>
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="场外切换信号"
          title="基准 ETF 溢价 vs 场内最低溢价"
          description="判定何时把场内基准 ETF 换成场外 QDII 联接基金（或反向）。当前 IOPV 数据未自动接入，请先手动输入两个值。"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">基准 ETF 当前溢价 %</div>
            <input
              type="number"
              step="0.1"
              placeholder="例如 9.2"
              value={prefs.manualBenchmarkPremiumPct}
              onChange={(event) => setPrefField('manualBenchmarkPremiumPct', event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold focus:border-indigo-300 focus:outline-none"
            />
            <div className="mt-1 text-xs text-slate-500">
              触发阈值：&gt;
              <input
                type="number"
                step="0.5"
                value={prefs.otcPremiumThresholdPct}
                onChange={(event) => setPrefField('otcPremiumThresholdPct', event.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />
              %
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">场内最低溢价 %</div>
            <input
              type="number"
              step="0.1"
              placeholder="例如 0.6"
              value={prefs.manualMinIntraPremiumPct}
              onChange={(event) => setPrefField('manualMinIntraPremiumPct', event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold focus:border-indigo-300 focus:outline-none"
            />
            <div className="mt-1 text-xs text-slate-500">
              触发阈值：&lt;
              <input
                type="number"
                step="0.5"
                value={prefs.otcMinIntraPremiumLow}
                onChange={(event) => setPrefField('otcMinIntraPremiumLow', event.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />
              %（强）/ &lt;
              <input
                type="number"
                step="0.5"
                value={prefs.otcMinIntraPremiumHigh}
                onChange={(event) => setPrefField('otcMinIntraPremiumHigh', event.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />
              %（弱）
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          {!otcSignal.ready ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Info className="h-4 w-4 text-slate-400" />
              {otcSignal.message}
            </div>
          ) : (
            <div className="space-y-2 text-sm text-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={otcSignal.triggered ? (otcSignal.intraLowHard ? 'emerald' : 'amber') : 'slate'}>{otcSignal.level}</Pill>
                <span>
                  基准溢价 {formatPercent(otcSignal.benchPrem, 2, true)}
                  <span className="mx-1 text-slate-400">·</span>
                  场内最低溢价 {formatPercent(otcSignal.minIntraPrem, 2, true)}
                </span>
              </div>
              {otcSignal.triggered ? (
                <div className="text-slate-700">
                  建议：卖出场内基准 ETF（{prefs.benchmarkCode}）→ 申购场外 QDII 联接基金，等溢价回归再赎回换回场内。
                </div>
              ) : (
                <div className="text-slate-500">
                  未触发。等到「基准溢价 &gt; {prefs.otcPremiumThresholdPct}% 且 场内最低溢价 &lt; {prefs.otcMinIntraPremiumHigh}%」再考虑切换。
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">持仓中的场外 / QDII 基金</div>
          {otcFunds.length === 0 ? (
            <div className="mt-2 text-sm text-slate-500">持仓中暂无场外或 QDII 基金。</div>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {otcFunds.map((f) => (
                <li key={f.code} className="flex flex-wrap items-center gap-2">
                  <Pill tone={f.kind === 'qdii' ? 'purple' : 'indigo'}>{f.kind === 'qdii' ? 'QDII' : '场外'}</Pill>
                  <span className="font-semibold text-slate-700">{f.code}</span>
                  <span className="text-slate-500">{f.name || ''}</span>
                  <span className="ml-auto tabular-nums text-slate-400">最新 {formatPrice(f.latestNav)} · {formatDate(f.latestNavDate)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 text-xs text-slate-500">这些基金可作为「场外切换」时的申购目标。建议优先选择费率低、跟踪误差小的联接基金。</div>
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="套利轮次记录"
          title="切换周期人工日志"
          description={`记录每一次切换的开仓 / 平仓价、份额与盈亏，用于回看是否达到目标 ${prefs.arbTargetPct}% / 周期。`}
        />
        <div className="mt-4 flex items-center justify-end">
          <button type="button" onClick={appendCycleEntry} className={cx(primaryButtonClass, 'h-9 px-3 text-xs')}>
            <ArrowDownUp className="h-4 w-4" />
            新增一笔切换
          </button>
        </div>
        {ledger.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            还没有套利记录。每完成一轮切换就回来登一笔，便于回看节奏。
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">基准 / 对手</th>
                  <th className="px-3 py-2 text-right font-semibold">开仓价</th>
                  <th className="px-3 py-2 text-right font-semibold">平仓价</th>
                  <th className="px-3 py-2 text-right font-semibold">份额</th>
                  <th className="px-3 py-2 text-right font-semibold">盈亏 %</th>
                  <th className="px-3 py-2 text-left font-semibold">备注</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {ledger.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2">
                      <input
                        value={row.benchmarkCode}
                        onChange={(event) => updateCycleField(row.id, 'benchmarkCode', event.target.value)}
                        className="w-20 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs focus:border-indigo-300 focus:outline-none"
                      />
                      <span className="mx-1 text-slate-400">→</span>
                      <input
                        value={row.counterpartCode}
                        onChange={(event) => updateCycleField(row.id, 'counterpartCode', event.target.value)}
                        className="w-20 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs focus:border-indigo-300 focus:outline-none"
                        placeholder="对手代码"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="0.001"
                        value={row.enterPrice}
                        onChange={(event) => updateCycleField(row.id, 'enterPrice', event.target.value)}
                        className="w-24 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-right text-xs tabular-nums focus:border-indigo-300 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="0.001"
                        value={row.exitPrice}
                        onChange={(event) => updateCycleField(row.id, 'exitPrice', event.target.value)}
                        className="w-24 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-right text-xs tabular-nums focus:border-indigo-300 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="1"
                        value={row.shares}
                        onChange={(event) => updateCycleField(row.id, 'shares', event.target.value)}
                        className="w-24 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-right text-xs tabular-nums focus:border-indigo-300 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {(() => {
                        const enter = Number(row.enterPrice);
                        const exit = Number(row.exitPrice);
                        if (!(enter > 0) || !(exit > 0)) return <span className="text-slate-400">—</span>;
                        const pct = ((exit - enter) / enter) * 100;
                        return <span className={pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{formatPercent(pct, 2, true)}</span>;
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={row.note}
                        onChange={(event) => updateCycleField(row.id, 'note', event.target.value)}
                        className="w-full min-w-[8rem] rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs focus:border-indigo-300 focus:outline-none"
                        placeholder="备注"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeCycleEntry(row.id)}
                        className="text-xs font-semibold text-slate-400 hover:text-rose-500"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default SwitchStrategyExperience;
