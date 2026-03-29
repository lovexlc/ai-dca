import { ArrowRight, Calendar, Filter, LineChart, Shield, Wallet } from 'lucide-react';
import { buildStages, formatCurrency, readAccumulationState } from '../app/accumulation.js';
import { getPrimaryTabs } from '../app/screens.js';
import { Card, PageHero, PageShell, PageTabs, Pill, SectionHeading, StatCard, secondaryButtonClass } from '../components/experience-ui.jsx';

const sampleHistory = [
  { date: '2024-03-25', type: '买入', shares: 10, price: 445.2, status: '已提交' },
  { date: '2024-03-18', type: '买入', shares: 15, price: 431.1, status: '已提交' },
  { date: '2024-03-11', type: '卖出', shares: 5, price: 445.5, status: '已完成' },
  { date: '2024-03-04', type: '买入', shares: 22, price: 425.8, status: '已提交' },
  { date: '2024-02-26', type: '买入', shares: 12, price: 432.4, status: '已提交' }
];

export function HistoryExperience({ links }) {
  const accumulationState = readAccumulationState();
  const accumulation = buildStages(accumulationState);
  const totalShares = sampleHistory.reduce((sum, row) => sum + row.shares, 0);
  const totalInvestment = sampleHistory.reduce((sum, row) => sum + row.shares * row.price, 0);
  const buyAmount = sampleHistory.filter((row) => row.type === '买入').reduce((sum, row) => sum + row.shares * row.price, 0);
  const sellAmount = sampleHistory.filter((row) => row.type === '卖出').reduce((sum, row) => sum + row.shares * row.price, 0);
  const primaryTabs = getPrimaryTabs(links);

  return (
    <PageShell>
      <PageHero
        backHref={links.accumEdit}
        backLabel="返回加仓配置"
        eyebrow="Execution History"
        title="QQQ 交易历史"
        description="把最近执行过的买卖记录集中到一个轻量 SaaS 表格里，便于快速核对执行密度、累计金额和当前计划的一致性。"
        badges={[
          <Pill key="symbol" tone="indigo">QQQ</Pill>,
          <Pill key="count" tone="slate">{sampleHistory.length} 条记录</Pill>
        ]}
      >
        <PageTabs activeKey="history" tabs={primaryTabs} />
      </PageHero>

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard eyebrow="Gross Shares" value={`${totalShares.toFixed(2)} 股`} note="最近执行记录累计股数" />
          <StatCard eyebrow="Average Price" value={formatCurrency(totalInvestment / Math.max(totalShares, 1))} note="历史成交均价" />
          <StatCard accent="indigo" eyebrow="Buy Amount" value={formatCurrency(buyAmount)} note="共享建仓状态同步的买入金额" />
          <StatCard accent="emerald" eyebrow="Sell Amount" value={formatCurrency(sellAmount)} note="用于观察历史兑现规模" />
        </div>

        <Card>
          <SectionHeading
            eyebrow="History Table"
            title="最近执行记录"
            description="保留极简表头和横向分隔线，确保在调试数据时信息密度够高但不显得拥挤。"
            action={
              <>
                <button className={secondaryButtonClass} type="button">
                  <Filter className="h-4 w-4" />
                  年份筛选
                </button>
                <button className={secondaryButtonClass} type="button">
                  <Calendar className="h-4 w-4" />
                  日期筛选
                </button>
              </>
            }
          />

          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">日期</th>
                  <th className="px-4 py-3 font-semibold">类型</th>
                  <th className="px-4 py-3 font-semibold">数量</th>
                  <th className="px-4 py-3 font-semibold">单价</th>
                  <th className="px-4 py-3 font-semibold">总金额</th>
                  <th className="px-4 py-3 font-semibold">状态</th>
                  <th className="px-4 py-3 font-semibold text-right">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {sampleHistory.map((row) => (
                  <tr key={`${row.date}-${row.type}-${row.price}`} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-4 py-4 text-slate-600">{row.date}</td>
                    <td className="px-4 py-4">
                      <span className={row.type === '卖出' ? 'font-semibold text-red-500' : 'font-semibold text-emerald-600'}>
                        {row.type}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{`${row.shares.toFixed(2)} 股`}</td>
                    <td className="px-4 py-4 text-slate-600">{formatCurrency(row.price)}</td>
                    <td className="px-4 py-4 font-semibold text-slate-900">{formatCurrency(row.shares * row.price)}</td>
                    <td className="px-4 py-4">
                      <span className={row.status === '已完成' ? 'inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600' : 'inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700'}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-slate-400">查看</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 text-sm text-slate-500">显示 1-{sampleHistory.length} 条，共 {sampleHistory.length} 条记录</div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 text-white">
            <SectionHeading eyebrow="Value Trend" title="价值趋势分析" />
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
              查看不同买入区间的执行密度，以及历史成交对当前平均成本的影响。近期买入主要集中在第二层和第三层附近。
            </p>
            <div className="mt-6 rounded-[24px] border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <LineChart className="h-4 w-4" />
                当前平均成本
              </div>
              <div className="mt-2 text-3xl font-extrabold tracking-tight">{formatCurrency(accumulation.averageCost)}</div>
              <div className="mt-3 text-sm text-slate-300">最近成交均价 {formatCurrency(totalInvestment / Math.max(totalShares, 1))}</div>
            </div>
          </Card>

          <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white">
            <SectionHeading eyebrow="Strategy Suggestion" title="金字塔加仓建议" />
            <p className="mt-4 text-sm leading-6 text-slate-600">
              基于过去 5 次买入操作，当前阶段性加仓仍然偏向第二和第三层。建议保留对 {formatCurrency(accumulation.stages[1]?.price ?? accumulationState.basePrice)} 的观察仓位。
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Wallet className="h-4 w-4 text-slate-400" />
                  共享买入金额
                </div>
                <div className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(buyAmount)}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Shield className="h-4 w-4 text-slate-400" />
                  当前观察价
                </div>
                <div className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(accumulation.stages[1]?.price ?? accumulationState.basePrice)}</div>
              </div>
            </div>
            <div className="mt-6">
              <a className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 transition-colors hover:text-indigo-900" href={links.accumEdit}>
                查看当前建仓计划
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
