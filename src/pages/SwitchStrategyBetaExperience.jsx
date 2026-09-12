import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Edit3, Loader2, Play, Plus, RefreshCw } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';
import {
  loadSwitchConfigFromWorker,
  loadSwitchSnapshotFromWorker,
  normalizeSwitchConfigShape,
  readSwitchConfigCache,
  runSwitchOnce,
  saveSwitchConfigToWorker,
} from '../app/switchStrategySync.js';
import { resolveCnFundName } from './markets/marketsCatalog.js';
import { formatSwitchDate } from './switchStrategyHelpers.js';

function clamp(value, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function nameOf(code, fallback = '') { return fallback || resolveCnFundName(code) || code; }
function snapshotForRule(payload, ruleId) {
  const root = payload?.snapshot || payload || null;
  if (!root) return null;
  const matched = (root.rules || []).find((item) => String(item?.ruleId || item?.id || item?.snapshot?.ruleId || '') === String(ruleId || ''));
  return matched?.snapshot || matched || root;
}
function buildRuleStatus(rule, snapshotPayload) {
  const snapshot = snapshotForRule(snapshotPayload, rule.id);
  const groups = Array.isArray(snapshot?.byBenchmark) ? snapshot.byBenchmark : [];
  const lower = Number(rule.intraSellLowerPct);
  const upper = Number(rule.intraBuyOtherPct);
  const width = Number.isFinite(upper - lower) && upper > lower ? upper - lower : 1;
  const premiumClass = rule.premiumClass || {};
  const choices = [];
  for (const group of groups) {
    const benchmarkCode = String(group?.benchmarkCode || '');
    const benchmarkClass = premiumClass[benchmarkCode] || group?.benchmarkClass;
    for (const candidate of group?.candidates || []) {
      const candidateCode = String(candidate?.code || '');
      const candidateClass = premiumClass[candidateCode] || candidate?.candClass;
      const rawSpread = candidate?.spreadVsBenchmarkPct;
      if (!Number.isFinite(rawSpread) || !['H', 'L'].includes(benchmarkClass) || benchmarkClass === candidateClass) continue;
      const gap = benchmarkClass === 'H' ? rawSpread : -rawSpread;
      const direction = benchmarkClass === 'H' ? 'H → L' : 'L → H';
      const progress = benchmarkClass === 'H' ? clamp(((gap - lower) / width) * 100) : clamp(((upper - gap) / width) * 100);
      const remaining = benchmarkClass === 'H' ? Math.max(0, upper - gap) : Math.max(0, gap - lower);
      choices.push({ benchmarkCode, candidateCode, benchmarkClass, candidateClass, gap, direction, progress, remaining, triggered: benchmarkClass === 'H' ? gap >= upper : gap <= lower, benchmarkName: group?.benchmarkName || '', candidateName: candidate?.name || '' });
    }
  }
  choices.sort((a, b) => b.progress - a.progress);
  const current = choices[0] || null;
  const hFallback = Object.keys(premiumClass).find((code) => premiumClass[code] === 'H') || '';
  const lFallback = Object.keys(premiumClass).find((code) => premiumClass[code] === 'L') || '';
  const hCode = current ? (current.benchmarkClass === 'H' ? current.benchmarkCode : current.candidateCode) : hFallback;
  const lCode = current ? (current.benchmarkClass === 'L' ? current.benchmarkCode : current.candidateCode) : lFallback;
  const hName = current ? (current.benchmarkClass === 'H' ? current.benchmarkName : current.candidateName) : '';
  const lName = current ? (current.benchmarkClass === 'L' ? current.benchmarkName : current.candidateName) : '';
  return { snapshot, current, hCode, lCode, hName: nameOf(hCode, hName), lName: nameOf(lCode, lName) };
}
function FundSide({ side, code, name }) {
  const high = side === 'H';
  return <div className={cx('rounded-xl border p-3', high ? 'border-rose-100 bg-rose-50/70' : 'border-emerald-100 bg-emerald-50/70')}><div className={cx('text-[10px] font-black uppercase tracking-[0.16em]', high ? 'text-rose-500' : 'text-emerald-600')}>{side} 组基金</div><div className="mt-1 font-mono text-sm font-black text-slate-950">{code || '未配置'}</div><div className="mt-0.5 truncate text-xs text-slate-500">{code ? name : '请在方案中选择基金'}</div></div>;
}
function RuleCard({ rule, globalEnabled, snapshotPayload, busy, onToggle, onManage }) {
  const status = useMemo(() => buildRuleStatus(rule, snapshotPayload), [rule, snapshotPayload]);
  const active = Boolean(globalEnabled && rule.enabled);
  const current = status.current;
  return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-start justify-between gap-3 p-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-base font-black text-slate-950">{rule.name || '未命名方案'}</h3><span className={cx('rounded-full px-2 py-0.5 text-[10px] font-bold', active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{active ? '监控中' : '已停用'}</span></div><div className="mt-1 text-xs text-slate-400">更新于 {formatSwitchDate(status.snapshot?.computedAt)}</div></div><button type="button" onClick={onManage} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><Edit3 className="h-3.5 w-3.5" />管理</button></div><div className="grid grid-cols-2 gap-2 px-4 pb-4"><FundSide side="H" code={status.hCode} name={status.hName} /><FundSide side="L" code={status.lCode} name={status.lName} /></div><div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-slate-700">{current ? `当前待切换：${current.direction}` : '当前待切换进度'}</span><span className={cx('font-bold tabular-nums', current?.triggered ? 'text-emerald-600' : 'text-indigo-600')}>{current ? (current.triggered ? '已满足切换条件' : `${current.progress.toFixed(0)}%`) : '等待行情'}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(current?.progress || 0)}><div className={cx('h-full rounded-full transition-[width] duration-500', current?.triggered ? 'bg-emerald-500' : 'bg-indigo-500')} style={{ width: `${current?.progress || 0}%` }} /></div><div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-500"><span>{current ? `H−L ${current.gap >= 0 ? '+' : ''}${current.gap.toFixed(2)}%` : '尚无有效溢价数据'}</span><span>{current ? (current.triggered ? '可按规则切换' : `距阈值 ${current.remaining.toFixed(2)}%`) : `阈值 ${rule.intraSellLowerPct}% / ${rule.intraBuyOtherPct}%`}</span></div></div><div className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><span className="text-xs text-slate-400">H→L {rule.intraBuyOtherPct}% · L→H {rule.intraSellLowerPct}%</span><button type="button" disabled={busy} onClick={onToggle} className={cx('rounded-lg px-3 py-1.5 text-xs font-bold', active ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700')}>{active ? '暂停' : '启用'}</button></div></article>;
}

export function SwitchStrategyBetaExperience({ onUseClassic }) {
  const [config, setConfig] = useState(() => normalizeSwitchConfigShape(readSwitchConfigCache()));
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState('');
  const [notice, setNotice] = useState('');
  const reload = useCallback(async () => { setLoading(true); const [remoteConfig, remoteSnapshot] = await Promise.all([loadSwitchConfigFromWorker().catch(() => null), loadSwitchSnapshotFromWorker().catch(() => null)]); if (remoteConfig) setConfig(remoteConfig); if (remoteSnapshot) setSnapshot(remoteSnapshot); setLoading(false); }, []);
  useEffect(() => { reload(); }, [reload]);
  async function runNow() { setRunning(true); setNotice(''); try { const result = await runSwitchOnce(); setSnapshot(result?.snapshot ? { snapshot: result.snapshot } : snapshot); setNotice('已完成最新行情分析'); } catch (error) { setNotice(error?.message || '运行失败，请稍后重试'); } finally { setRunning(false); } }
  async function toggleRule(rule) { setBusyRuleId(rule.id); setNotice(''); try { const rules = (config.rules || []).map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item); const next = normalizeSwitchConfigShape({ ...config, enabled: rules.some((item) => item.enabled), rules }); const result = await saveSwitchConfigToWorker(next); setConfig(result?.config || next); setNotice(rule.enabled ? '方案已暂停' : '方案已启用'); } catch (error) { setNotice(error?.message || '保存失败'); } finally { setBusyRuleId(''); } }
  const rules = (config.rules || []).filter((rule) => rule.benchmarkCodes?.length || rule.enabledCodes?.length || Object.keys(rule.premiumClass || {}).length);
  if (loading) return <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-indigo-500" /></div>;
  return <div className="space-y-4"><section className="rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#fff_0%,#f5f3ff_100%)] p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-indigo-600"><ArrowLeftRight className="h-4 w-4" />智能换基方案 <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[9px]">Beta</span></div><div className="mt-2 text-2xl font-black text-slate-950">{rules.length} <span className="text-sm text-slate-400">个方案</span></div><p className="mt-1 text-xs text-slate-500">参考新版策略工作台，集中查看 H/L 基金与实时切换进度。</p></div><div className="flex gap-2"><button type="button" onClick={reload} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600"><RefreshCw className="h-4 w-4" />刷新</button><button type="button" disabled={running || !rules.length} onClick={runNow} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-indigo-50 px-3 text-xs font-bold text-indigo-700 disabled:opacity-40">{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{running ? '分析中' : '立即分析'}</button></div></div></section>{notice ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5 text-xs font-semibold text-indigo-700">{notice}</div> : null}{rules.length ? <div className="space-y-3">{rules.map((rule) => <RuleCard key={rule.id} rule={rule} globalEnabled={config.enabled} snapshotPayload={snapshot} busy={busyRuleId === rule.id} onToggle={() => toggleRule(rule)} onManage={onUseClassic} />)}</div> : <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-center"><ArrowLeftRight className="h-8 w-8 text-slate-300" /><div className="mt-3 text-sm font-bold text-slate-700">还没有换基方案</div><button type="button" onClick={onUseClassic} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-indigo-50 px-4 text-sm font-bold text-indigo-700"><Plus className="h-4 w-4" />创建方案</button></div>}</div>;
}
export default SwitchStrategyBetaExperience;
