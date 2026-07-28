import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowDown, ArrowUp, CloudDownload, FileText, Info, Radio, TrendingUp } from 'lucide-react';
import { TACO_EVENTS, TACO_HISTORY, TACO_LATEST, TACO_MODEL, sampleTacoHistory } from '../app/tacoSentimentData.js';
import { cx } from '../components/experience-ui.jsx';

const FACTOR_TONE_CLASSES = {
  rose: {
    bar: 'bg-rose-500',
    icon: 'bg-rose-50 text-rose-700',
    value: 'text-rose-700'
  },
  amber: {
    bar: 'bg-amber-500',
    icon: 'bg-amber-50 text-amber-700',
    value: 'text-amber-700'
  },
  emerald: {
    bar: 'bg-emerald-600',
    icon: 'bg-emerald-50 text-emerald-700',
    value: 'text-emerald-700'
  },
  slate: {
    bar: 'bg-slate-500',
    icon: 'bg-slate-100 text-slate-600',
    value: 'text-slate-600'
  }
};

function formatChartDate(value) {
  return String(value || '').slice(0, 7).replace('-', '.');
}

function ScoreRail({ score }) {
  return (
    <div className="mt-8">
      <div className="relative h-2.5 rounded-full bg-white/15">
        <div className="absolute inset-y-0 left-0 rounded-full bg-[#b5ef75]" style={{ width: `${score}%` }} />
        <div className="absolute -top-1.5 h-5 w-px bg-white/70" style={{ left: '79%' }} aria-hidden="true" />
        <div className="absolute -top-1.5 h-5 w-px bg-white/70" style={{ left: '100%' }} aria-hidden="true" />
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-medium uppercase tracking-[0.16em] text-white/55">
        <span>低压 0</span>
        <span>行动区 79</span>
        <span>转向 100</span>
      </div>
    </div>
  );
}

function ScoreCard() {
  return (
    <section className="relative overflow-hidden rounded-[24px] bg-[#123d31] p-5 text-white shadow-xl shadow-[#123d31]/15 sm:p-7">
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[#b5ef75]/15 blur-2xl" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#b5ef75]">
              <Activity className="h-4 w-4" aria-hidden="true" />
              TACO 转向分
            </div>
            <p className="mt-3 max-w-md text-sm leading-6 text-white/65">
              分数越高，市场与航运压力越接近历史转向区间。
            </p>
          </div>
          <span className="rounded-full border border-[#b5ef75]/30 bg-[#b5ef75]/10 px-2.5 py-1 text-xs font-semibold text-[#d8ffb2]">
            {TACO_LATEST.status}
          </span>
        </div>

        <div className="mt-7 flex items-end gap-3">
          <span className="text-7xl font-semibold leading-none tracking-[-0.08em] tabular-nums text-[#f3ffe8]">{TACO_LATEST.score}</span>
          <span className="mb-1 text-sm text-white/55">/ 100</span>
        </div>
        <ScoreRail score={TACO_LATEST.score} />

        <div className="mt-7 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 sm:grid-cols-4">
          <div>
            <div className="text-[11px] text-white/45">历史分位</div>
            <div className="mt-1 text-sm font-semibold text-white">{TACO_LATEST.percentile}</div>
          </div>
          <div>
            <div className="text-[11px] text-white/45">历史排名</div>
            <div className="mt-1 text-sm font-semibold text-white">{TACO_LATEST.rank}</div>
          </div>
          <div>
            <div className="text-[11px] text-white/45">观察日期</div>
            <div className="mt-1 text-sm font-semibold text-white">{TACO_LATEST.date}</div>
          </div>
          <div>
            <div className="text-[11px] text-white/45">数据状态</div>
            <div className="mt-1 text-sm font-semibold text-[#b5ef75]">离线快照</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SnapshotCard() {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Snapshot</div>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">四因子压力</h2>
        </div>
        <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700">
          <Activity className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {TACO_LATEST.factors.map((factor) => {
          const tone = FACTOR_TONE_CLASSES[factor.tone] || FACTOR_TONE_CLASSES.slate;
          const isNegative = factor.contribution < 0;
          return (
            <div key={factor.key}>
              <div className="flex items-center gap-3">
                <span className={cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', tone.icon)}>
                  {factor.key === 'hormuz' ? <Radio className="h-4 w-4" aria-hidden="true" /> : factor.key === 'sp500' ? <TrendingUp className="h-4 w-4" aria-hidden="true" /> : <Activity className="h-4 w-4" aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-semibold text-slate-800">{factor.label}</span>
                    <span className={cx('shrink-0 text-sm font-bold tabular-nums', tone.value)}>{factor.value}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={cx('h-full rounded-full', tone.bar)} style={{ width: `${Math.min(100, Math.abs(factor.contribution))}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between gap-2 text-[11px] text-slate-400">
                    <span>{factor.direction} · {factor.note}</span>
                    <span className="font-semibold tabular-nums">{isNegative ? '' : '+'}{factor.contribution}%</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HistoryChart() {
  const chartData = sampleTacoHistory(TACO_HISTORY).map((row) => ({
    ...row,
    label: formatChartDate(row.date)
  }));

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">History</div>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">完整历史曲线</h2>
          <p className="mt-1 text-sm text-slate-500">1,707 个自然日 · 2021-11-25 至 2026-07-28</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-600" />转向分</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-amber-500" />行动区 79</span>
        </div>
      </div>
      <div className="mt-5 h-[280px] w-full sm:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="tacoHistoryFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0b8f65" stopOpacity={0.26} />
                <stop offset="100%" stopColor="#0b8f65" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 4" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={32} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip
              labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''}
              formatter={(value) => [`${value} 分`, '转向分']}
              contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.10)' }}
            />
            <ReferenceLine y={79} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: '行动区', position: 'insideTopRight', fill: '#b45309', fontSize: 11 }} />
            <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="3 5" />
            <Area type="monotone" dataKey="score" stroke="#087653" strokeWidth={2.5} fill="url(#tacoHistoryFill)" activeDot={{ r: 4, fill: '#b5ef75', stroke: '#087653', strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-5">
        {TACO_EVENTS.map((event) => (
          <div key={event.date} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs">
            <span className="min-w-0 truncate font-medium text-slate-600">{event.date.slice(5)} · {event.label}</span>
            <span className="shrink-0 font-bold tabular-nums text-emerald-700">{event.score}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ModelCard() {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Explainability</div>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">可复现模型</h2>
        </div>
        <div className="rounded-xl bg-slate-100 p-2 text-slate-600">
          <FileText className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-500">
        这是基于公开历史曲线和公开输入代理拟合出的等价式；原始权重、标准差和 Windward 日界线并未公开，因此保留为测试环境研究快照。
      </p>
      <div className="mt-4 overflow-x-auto rounded-2xl bg-[#10271d] p-4 font-mono text-xs leading-6 text-[#d8ffb2]">
        <code className="break-words">{TACO_MODEL.scoreFormula}</code>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-[11px] text-slate-400">拟合样本</div>
          <div className="mt-1 text-base font-bold tabular-nums text-slate-800">{TACO_MODEL.fit.observations}</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-[11px] text-slate-400">RMSE</div>
          <div className="mt-1 text-base font-bold tabular-nums text-slate-800">{TACO_MODEL.fit.rmse}</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-[11px] text-slate-400">误差 ≤ 3</div>
          <div className="mt-1 text-base font-bold tabular-nums text-slate-800">{TACO_MODEL.fit.withinThreeRate}%</div>
        </div>
      </div>
    </section>
  );
}

export function SentimentExperience() {
  return (
    <div className="min-h-full px-4 pb-10 pt-4 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-col gap-4 border-b border-emerald-900/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
            <Activity className="h-4 w-4" aria-hidden="true" />
            Test / Sentiment Lab
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">情绪监控</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">用 TACO 转向分把能源、利率、风险资产和霍尔木兹航运压力放到同一条时间轴上。</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden="true" />
          测试快照 · {TACO_LATEST.date}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <ScoreCard />
        <SnapshotCard />
      </div>

      <div className="mt-5 space-y-5">
        <HistoryChart />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <ModelCard />
          <section className="rounded-[24px] border border-amber-200 bg-amber-50/75 p-5 shadow-sm sm:p-6">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-amber-100 p-2 text-amber-700"><Info className="h-5 w-5" aria-hidden="true" /></span>
              <div>
                <h2 className="text-lg font-bold tracking-tight text-amber-950">读法与边界</h2>
                <p className="mt-2 text-sm leading-6 text-amber-900/75">航运因子对分数最敏感；分数达到 79 进入历史行动区。页面实时卡片使用 Windward，当前页面使用的是离线快照，不会在列表加载时请求外部详情接口。</p>
              </div>
            </div>
            <div className="mt-5 grid gap-2 text-xs text-amber-950/70">
              <div className="flex items-center gap-2"><ArrowUp className="h-3.5 w-3.5" />能源与收益率上行会抬高压力</div>
              <div className="flex items-center gap-2"><ArrowDown className="h-3.5 w-3.5" />标普与船舶通行量上行会缓解压力</div>
              <div className="flex items-center gap-2"><CloudDownload className="h-3.5 w-3.5" />原始权重不可由总分唯一识别</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
