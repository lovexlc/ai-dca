import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';

const EVENT_NAME = 'ai-dca-switch-test-feedback';

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.abs(number).toFixed(2)}%` : '—';
}

function buildResult(detail = {}) {
  const payload = detail.payload || {};
  const preview = payload?.snapshot?.rules?.[0]?.snapshot || null;
  const group = preview?.byBenchmark?.[0] || null;
  const holdingClass = group?.benchmarkClass || preview?.premiumClass?.[group?.benchmarkCode] || '';
  const candidates = (group?.candidates || []).filter((item) => item?.valid && Number.isFinite(Number(item?.spreadVsBenchmarkPct)));
  const candidate = [...candidates].sort((a, b) => Math.abs(Number(b.spreadVsBenchmarkPct)) - Math.abs(Number(a.spreadVsBenchmarkPct)))[0] || null;
  const rawSpread = Number(candidate?.spreadVsBenchmarkPct);
  const gap = Number.isFinite(rawSpread) ? (holdingClass === 'L' ? -rawSpread : rawSpread) : null;
  const lower = Number(preview?.intraSellLowerPct);
  const upper = Number(preview?.intraBuyOtherPct);
  const threshold = holdingClass === 'H' ? upper : lower;
  const reached = Number.isFinite(gap) && Number.isFinite(threshold) && (holdingClass === 'H' ? gap >= threshold : gap <= threshold);
  const holdingCode = group?.benchmarkCode || '当前持仓';
  const candidateCode = candidate?.code || '候选基金';
  let comparison = '暂未找到可比较的候选基金';
  if (Number.isFinite(gap)) {
    comparison = holdingClass === 'H'
      ? (gap >= 0 ? `当前持仓 ${holdingCode} 比候选基金 ${candidateCode} 贵` : `当前持仓 ${holdingCode} 比候选基金 ${candidateCode} 便宜`)
      : (gap >= 0 ? `候选基金 ${candidateCode} 比当前持仓 ${holdingCode} 便宜` : `候选基金 ${candidateCode} 比当前持仓 ${holdingCode} 贵`);
  }
  return { gap, threshold, reached, comparison };
}

export function SwitchTestFeedbackModal() {
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    const handleFeedback = (event) => setDetail(event?.detail || null);
    window.addEventListener(EVENT_NAME, handleFeedback);
    return () => window.removeEventListener(EVENT_NAME, handleFeedback);
  }, []);
  const result = useMemo(() => buildResult(detail), [detail]);
  if (!detail) return null;
  const loading = detail.status === 'loading';
  const success = detail.status === 'success';
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/35 p-0 backdrop-blur-[1px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="快速测试结果">
    <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-3xl sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-2xl font-black text-slate-950">快速测试</h2><p className="mt-2 text-sm text-slate-500">立即获取最新可用行情并运行这条规则。</p></div><button type="button" onClick={() => setDetail(null)} className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"><X className="h-6 w-6" /></button></div>
      <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-7 text-slate-500"><div>不会发送正式提醒</div><div>不会修改持仓</div><div>不会产生交易</div></div>
      {loading ? <div className="mt-5 flex min-h-48 flex-col items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700"><Loader2 className="h-8 w-8 animate-spin" /><div className="mt-4 font-bold">正在获取行情并计算规则…</div></div> : null}
      {success ? <div className="mt-5 rounded-2xl bg-emerald-50 p-5 text-emerald-800"><h3 className="text-lg font-black">测试成功</h3><div className="mt-4 space-y-3 text-sm">{['远程服务器连接正常', '行情数据获取成功', '规则计算正常', '配置测试链路正常'].map((label) => <div key={label} className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /><span>{label}</span></div>)}</div><div className="mt-5 space-y-1.5 border-t border-emerald-100 pt-4 text-sm leading-6"><div>当前最佳切换优势 {formatPercent(result.gap)}</div><div>{result.comparison}</div><div>提醒条件 {formatPercent(result.threshold)}</div><div>当前结果 {result.reached ? '已达到提醒条件' : '未达到提醒条件'}</div><div>响应时间 {Math.max(0.1, Number(detail.elapsedMs || 0) / 1000).toFixed(1)} 秒</div></div></div> : null}
      {detail.status === 'error' ? <div className="mt-5 rounded-2xl bg-rose-50 p-5 text-rose-700"><h3 className="font-black">测试失败</h3><p className="mt-2 text-sm leading-6">{detail.message || '暂时无法完成测试，请稍后重试。'}</p></div> : null}
      {!loading ? <button type="button" onClick={() => setDetail(null)} className="mt-5 min-h-12 w-full rounded-2xl bg-slate-950 px-5 text-sm font-bold text-white">完成</button> : null}
    </div>
  </div>;
}
export default SwitchTestFeedbackModal;
