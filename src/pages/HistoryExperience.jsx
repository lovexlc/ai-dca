import { useMemo } from 'react';
import { ArrowRight, CalendarClock, Layers3, Wallet } from 'lucide-react';
import { formatCurrency } from '../app/accumulation.js';
import { buildTradeHistory } from '../app/tradePlans.js';
import { Card, Pill, SectionHeading, StatCard, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

function HistoryStatusPill({ tone = 'slate', children }) {
  return <Pill tone={tone}>{children}</Pill>;
}

export function HistoryExperience({ links, embedded = false }) {
  const { rows, hasHistory, summary, dcaMeta } = useMemo(() => buildTradeHistory(), []);

  const content = (
    <div className={cx('mx-auto max-w-6xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard eyebrow="策略记录" value={`${summary.recordCount} 条`} note="按已保存策略自动生成的历史记录" />
        <StatCard accent="indigo" eyebrow="累计投入" value={formatCurrency(summary.totalInvestment, '¥ ')} note="只统计已经写入历史的计划金额" />
        <StatCard eyebrow="覆盖策略" value={`${summary.strategyCount} 个`} note="当前进入历史的策略数量" />
        <StatCard accent="emerald" eyebrow="最近执行日" value={summary.latestExecutionDate} note={dcaMeta.configured ? dcaMeta.cadenceLabel : '先配置定投计划后才会生成历史'} />
      </div>

      <Card>
        <SectionHeading
          eyebrow="历史表格"
          title="策略生成记录"
          description="交易历史不再展示示例成交，当前会按已保存定投计划的执行日和金额自动生成记录。"
        />

        {hasHistory ? (
          <>
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">日期</th>
                    <th className="px-4 py-3 font-semibold">策略</th>
                    <th className="px-4 py-3 font-semibold">类型</th>
                    <th className="px-4 py-3 font-semibold">金额</th>
                    <th className="px-4 py-3 font-semibold">状态</th>
                    <th className="px-4 py-3 font-semibold">说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {rows.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-slate-50/70">
                      <td className="px-4 py-4 text-slate-600">{row.dateLabel}</td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-900">{row.planName}</div>
                        <div className="mt-1 text-xs text-slate-400">{row.symbol}</div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{row.typeLabel}</td>
                      <td className="px-4 py-4 font-semibold text-slate-900">{formatCurrency(row.amount, '¥ ')}</td>
                      <td className="px-4 py-4">
                        <HistoryStatusPill tone={row.statusTone}>{row.statusLabel}</HistoryStatusPill>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 text-sm text-slate-500">显示 1-{rows.length} 条，共 {rows.length} 条记录</div>
          </>
        ) : (
          <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8">
            <div className="text-lg font-bold text-slate-900">还没有可写入历史的策略记录</div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
              历史页只展示能确定执行日期和金额的记录。先去配置定投计划，后续会按执行日自动写入历史；价格触发型策略不会再用假数据充数。
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <a className={cx(primaryButtonClass, 'w-full sm:w-auto')} href={links.dca}>
                去配置定投
              </a>
              <a className={cx(secondaryButtonClass, 'w-full sm:w-auto')} href={links.tradePlans}>
                查看交易计划
              </a>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 text-white">
          <SectionHeading eyebrow="生成规则" title="历史来源" />
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
            交易历史直接读取当前已保存的定投配置，按执行频率、执行日、初始投资额和每期金额生成记录，不再使用示例成交数据。
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <CalendarClock className="h-4 w-4" />
                当前节奏
              </div>
              <div className="mt-2 text-xl font-extrabold tracking-tight">{dcaMeta.cadenceLabel}</div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Wallet className="h-4 w-4" />
                每期金额
              </div>
              <div className="mt-2 text-xl font-extrabold tracking-tight">{formatCurrency(dcaMeta.recurringInvestment || 0, '¥ ')}</div>
            </div>
          </div>
        </Card>

        <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white">
          <SectionHeading eyebrow="联动策略" title={dcaMeta.planName} />
          <p className="mt-4 text-sm leading-6 text-slate-600">
            {dcaMeta.isLinkedPlan
              ? `当前定投周期会按「${dcaMeta.linkedPlanName}」在周期内分批执行，历史里先记该周期的总投入金额。`
              : '当前历史记录会直接按定投计划的单次金额入表。'}
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Layers3 className="h-4 w-4 text-slate-400" />
                当前计划
              </div>
              <div className="mt-2 text-xl font-bold text-slate-900">{dcaMeta.planName}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <ArrowRight className="h-4 w-4 text-slate-400" />
                分批联动
              </div>
              <div className="mt-2 text-xl font-bold text-slate-900">{dcaMeta.isLinkedPlan ? dcaMeta.linkedPlanName : '未关联'}</div>
            </div>
          </div>
          <div className="mt-6">
            <a className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 transition-colors hover:text-indigo-900" href={links.dca}>
              去调整定投计划
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </Card>
      </div>
    </div>
  );

  return content;
}
