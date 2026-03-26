import { ArrowRight, LayoutGrid, LineChart, Plus, Search, Shield, TrendingUp, Wallet } from 'lucide-react';
import { buildStages, formatCurrency, formatPercent, readAccumulationState } from '../app/accumulation.js';
import { buildDcaProjection, readDcaState } from '../app/dca.js';
import { buildPlan, readPlanState } from '../app/plan.js';
import { Card, PageHero, PageShell, Pill, SectionHeading, StatCard, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

const WATCHLIST = [
  { symbol: 'QQQ', price: 502.44, note: '纳斯达克 100', active: true },
  { symbol: 'VOO', price: 512.1, note: 'S&P 500' },
  { symbol: 'SPY', price: 560.22, note: '核心指数' }
];

const HISTORY_PLANS = [
  { name: '科技股累积', note: '平均成本: $548.05', active: true },
  { name: '股息增长', note: '平均成本: $42.10' }
];

export function HomeExperience({ links }) {
  const accumulationState = readAccumulationState();
  const accumulation = buildStages(accumulationState);
  const planState = readPlanState();
  const plan = buildPlan(planState);
  const dcaState = readDcaState();
  const dca = buildDcaProjection(dcaState);
  const nextBuyPrice = accumulation.stages[1]?.price ?? accumulationState.basePrice;
  const reserveRatio = planState.totalBudget > 0 ? plan.reserveCapital / planState.totalBudget * 100 : 0;
  const highlightedStages = accumulation.stages.slice(0, 3);

  return (
    <PageShell>
      <PageHero
        backHref={links.catalog}
        backLabel="返回页面目录"
        eyebrow="Strategy Dashboard"
        title="QQQ 建仓策略总览"
        description="将加仓计划、资金留存和定投节奏汇总到一个轻量决策视图里，便于快速判断下一次操作窗口和预算占用。"
        badges={[
          <Pill key="status" tone="indigo">运行中</Pill>,
          <Pill key="layers" tone="slate">{accumulation.stages.length} 层建仓</Pill>
        ]}
        actions={
          <>
            <a className={secondaryButtonClass} href={links.accumEdit}>修改配置</a>
            <a className={primaryButtonClass} href={links.accumNew}>
              <Plus className="h-4 w-4" />
              新建建仓计划
            </a>
          </>
        }
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard accent="indigo" eyebrow="Portfolio Budget" value={formatCurrency(accumulation.investedCapital)} note="当前金字塔策略总预算" progress={Math.max(100 - reserveRatio, 0)} />
          <StatCard eyebrow="Reserve Cash" value={formatCurrency(plan.reserveCapital)} note={`${formatPercent(reserveRatio, 1)} 作为流动性缓冲`} />
          <StatCard eyebrow="Next Trigger" value={formatCurrency(nextBuyPrice)} note="下一层计划买入价位" />
          <StatCard accent="emerald" eyebrow="Average Cost" value={formatCurrency(accumulation.averageCost)} note={`${formatPercent(4.2, 1, true)} 假设增长空间`} />
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <SectionHeading
              eyebrow="Price Pulse"
              title="价格走势与买点位"
              description="用一个轻量趋势面板观察基准价、触发价与执行节奏，不再依赖侧边栏或旧仪表盘骨架。"
              action={
                <div className="flex items-center gap-2 rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500">
                  <span className="rounded-full px-3 py-1">1D</span>
                  <span className="rounded-full bg-white px-3 py-1 text-slate-900 shadow-sm">1W</span>
                  <span className="rounded-full px-3 py-1">1M</span>
                </div>
              }
            />

            <div className="mt-6 rounded-[24px] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-5">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">基准买点</div>
                  <div className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(accumulation.stages[0]?.price ?? accumulationState.basePrice)}</div>
                  <div className="mt-1 text-sm text-slate-500">阶段 01 已执行完成</div>
                </div>
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">下一观察价</div>
                  <div className="mt-2 text-xl font-bold text-indigo-700">{formatCurrency(nextBuyPrice)}</div>
                  <div className="mt-1 text-sm text-indigo-600">阶段 02 即将触发</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">定投节奏</div>
                  <div className="mt-2 text-xl font-bold text-slate-900">{dcaState.frequency}</div>
                  <div className="mt-1 text-sm text-slate-500">{dca.executionCount} 次执行窗口</div>
                </div>
              </div>

              <div className="relative mt-6 h-72 overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.16),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.1),_transparent_30%)]" />
                <svg className="absolute inset-0 h-full w-full text-slate-300" preserveAspectRatio="none" viewBox="0 0 100 100">
                  <rect fill="currentColor" height="28" width="2.5" x="4" y="72" />
                  <rect fill="currentColor" height="42" width="2.5" x="10" y="58" />
                  <rect fill="currentColor" height="34" width="2.5" x="16" y="66" />
                  <rect fill="currentColor" height="50" width="2.5" x="22" y="50" />
                  <rect fill="currentColor" height="44" width="2.5" x="28" y="56" />
                  <rect fill="currentColor" height="60" width="2.5" x="34" y="40" />
                  <rect fill="currentColor" height="46" width="2.5" x="40" y="54" />
                  <rect fill="currentColor" height="58" width="2.5" x="46" y="42" />
                  <rect fill="currentColor" height="40" width="2.5" x="52" y="60" />
                  <rect fill="currentColor" height="68" width="2.5" x="58" y="32" />
                  <rect fill="currentColor" height="48" width="2.5" x="64" y="52" />
                  <rect fill="currentColor" height="62" width="2.5" x="70" y="38" />
                  <rect fill="currentColor" height="74" width="2.5" x="76" y="26" />
                  <rect fill="currentColor" height="54" width="2.5" x="82" y="46" />
                  <rect fill="currentColor" height="66" width="2.5" x="88" y="34" />
                </svg>
                <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                  <polyline fill="none" points="0,76 10,72 18,75 28,64 38,58 48,46 58,52 68,34 78,26 88,18 100,8" stroke="#4f46e5" strokeWidth="2.2" />
                  <polyline fill="none" points="0,84 10,82 18,79 28,76 38,69 48,60 58,46 68,38 78,29 88,20 100,12" stroke="#10b981" strokeWidth="2.2" strokeDasharray="3 3" />
                </svg>
                <div className="absolute left-[18%] top-[54%] rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                  阶段 01
                </div>
                <div className="absolute left-[56%] top-[28%] rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-indigo-200">
                  阶段 02 预警
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {highlightedStages.map((stage, index) => (
                  <div key={stage.id} className={cx('rounded-2xl border p-4 transition-colors', index === 1 ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white')}>
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">阶段 {String(index + 1).padStart(2, '0')}</div>
                    <div className="mt-2 text-lg font-bold text-slate-900">{formatCurrency(stage.price)}</div>
                    <div className="mt-1 text-sm text-slate-500">{index === 0 ? '执行完成' : index === 1 ? '即将触发' : '继续待命'}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <div className="space-y-6 lg:col-span-2">
            <Card>
              <SectionHeading eyebrow="Execution Map" title="建仓计划详情" />
              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">阶段</th>
                      <th className="px-4 py-3 font-semibold">价格</th>
                      <th className="px-4 py-3 font-semibold">跌幅</th>
                      <th className="px-4 py-3 font-semibold">金额</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {accumulation.stages.map((stage, index) => (
                      <tr key={stage.id}>
                        <td className="px-4 py-3 font-semibold text-slate-700">{String(index + 1).padStart(2, '0')}</td>
                        <td className="px-4 py-3 text-slate-600">{formatCurrency(stage.price)}</td>
                        <td className="px-4 py-3 text-slate-600">{index === 0 ? '基准' : formatPercent(stage.drawdown, 1)}</td>
                        <td className="px-4 py-3 text-slate-900">{formatCurrency(stage.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <SectionHeading eyebrow="Capital Mix" title="资金配置模型" />
              <div className="mt-6 flex min-h-[180px] items-end justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                {accumulation.stages.map((stage, index) => (
                  <div key={stage.id} className="flex w-16 flex-col items-center gap-3">
                    <div className={cx('flex w-full items-end justify-center rounded-t-2xl px-2 py-3 text-xs font-bold text-white', index === accumulation.stages.length - 1 ? 'bg-indigo-600' : 'bg-slate-400')} style={{ height: `${Math.max(stage.weightPercent * 1.8, 44)}px` }}>
                      {formatPercent(stage.weightPercent, 0)}
                    </div>
                    <span className="text-xs font-semibold text-slate-400">阶段 {index + 1}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-sm leading-6 text-slate-500">
                分配权重与目标跌幅同步驱动入场价格，末层最大跌幅 {formatPercent(accumulationState.maxDrawdown, 2)}。
              </div>
            </Card>

            <Card>
              <SectionHeading eyebrow="Operator Notes" title="执行建议" />
              <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
                <li>首笔建仓使用 {formatCurrency(accumulation.stages[0]?.price ?? accumulationState.basePrice)} 作为基准价。</li>
                <li>下一层计划买入价为 {formatCurrency(nextBuyPrice)}，触发后会自动重算平均成本。</li>
                <li>定投计划当前总投入 {formatCurrency(dca.totalInvestment)}，执行频率为 {dcaState.frequency}。</li>
              </ul>
            </Card>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionHeading
              eyebrow="Market Watch"
              title="自选股观察"
              action={
                <button className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-800" type="button">
                  <Search className="h-4 w-4" />
                  搜索市场
                </button>
              }
            />
            <div className="mt-5 space-y-3">
              {WATCHLIST.map((item) => (
                <a key={item.symbol} className={cx('flex items-center justify-between rounded-2xl border px-4 py-4 transition-all', item.active ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-slate-50 hover:bg-white')} href={links.home}>
                  <div>
                    <div className="font-semibold text-slate-900">{item.symbol}</div>
                    <div className="text-sm text-slate-500">{item.note}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-900">{formatCurrency(item.price)}</div>
                    <div className="mt-1 text-xs text-slate-400">{item.active ? '当前策略标的' : '观察中'}</div>
                  </div>
                </a>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeading eyebrow="Playbooks" title="历史计划与调试入口" />
            <div className="mt-5 space-y-3">
              {HISTORY_PLANS.map((item) => (
                <div key={item.name} className={cx('rounded-2xl border px-4 py-4', item.active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50')}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-semibold">{item.name}</div>
                      <div className={cx('mt-1 text-sm', item.active ? 'text-slate-300' : 'text-slate-500')}>{item.note}</div>
                    </div>
                    <LayoutGrid className={cx('h-5 w-5', item.active ? 'text-slate-300' : 'text-slate-400')} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Wallet className="h-4 w-4 text-slate-400" />
                  预留现金
                </div>
                <div className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(plan.reserveCapital)}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <TrendingUp className="h-4 w-4 text-slate-400" />
                  定投总投入
                </div>
                <div className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(dca.totalInvestment)}</div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a className={secondaryButtonClass} href={links.catalog}>打开目录</a>
              <a className={primaryButtonClass} href={links.history}>
                查看历史记录
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>

            <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm leading-6 text-emerald-700">
              <div className="flex items-center gap-2 font-semibold">
                <Shield className="h-4 w-4" />
                资金纪律
              </div>
              <p className="mt-2">
                当前预留资金占总预算 {formatPercent(reserveRatio, 1)}，这让你在阶段二和阶段三出现快速下探时仍有足够现金缓冲。
              </p>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              <div className="flex items-center gap-2 font-semibold text-slate-700">
                <LineChart className="h-4 w-4 text-slate-400" />
                趋势提示
              </div>
              <p className="mt-2">
                如果 QQQ 触及 {formatCurrency(nextBuyPrice)} 附近，可以优先回到“加仓配置”页确认第二层权重与总现金使用节奏。
              </p>
            </div>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
