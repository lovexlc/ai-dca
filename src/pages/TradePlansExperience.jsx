import { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarClock, Clock3, Layers3, Radar, Sparkles } from 'lucide-react';
import { buildTradePlanCenter } from '../app/tradePlans.js';
import { getPrimaryTabs } from '../app/screens.js';
import { Card, PageHero, PageShell, PageTabs, Pill, SectionHeading, StatCard, cx, secondaryButtonClass } from '../components/experience-ui.jsx';

function PlanStatusPill({ tone = 'slate', children }) {
  return <Pill tone={tone}>{children}</Pill>;
}

export function TradePlansExperience({ links, embedded = false }) {
  const [selectedRowId, setSelectedRowId] = useState('');
  const { rows, summary } = useMemo(() => buildTradePlanCenter(), []);
  const primaryTabs = getPrimaryTabs(links);

  useEffect(() => {
    if (!rows.length) {
      setSelectedRowId('');
      return;
    }

    if (!rows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(rows[0].id);
    }
  }, [rows, selectedRowId]);

  const selectedRow = rows.find((row) => row.id === selectedRowId) || rows[0] || null;

  const content = (
    <div className={cx('mx-auto max-w-6xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard accent="indigo" eyebrow="待执行计划" value={`${summary.pendingCount} 项`} note="包含价格触发买入与固定定投计划" />
        <StatCard eyebrow="最近触发条件" value={summary.nearestTrigger} note="优先显示最近需要观察的价格条件" />
        <StatCard accent="emerald" eyebrow="下一次定投日期" value={summary.nextDcaDate} note="按当前定投配置推算的最近执行日" />
        <StatCard eyebrow="通知状态" value={summary.notificationStatus} note="提醒渠道和推送能力后续接入" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]">
        <Card className="min-w-0">
          <SectionHeading
            eyebrow="计划列表"
            title="后续交易计划"
            description="集中查看未来要执行的买入规则，后续可在这里扩展通知、提醒历史和自动执行。"
            action={
              <>
                <a className={secondaryButtonClass} href={links.home}>
                  查看策略总览
                </a>
                <a className={secondaryButtonClass} href={links.dca}>
                  查看定投计划
                </a>
              </>
            }
          />

          <div className="mt-6 hidden overflow-hidden rounded-2xl border border-slate-200 md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">计划名称</th>
                  <th className="px-4 py-3 font-semibold">计划类型</th>
                  <th className="px-4 py-3 font-semibold">标的</th>
                  <th className="px-4 py-3 font-semibold">触发条件</th>
                  <th className="px-4 py-3 font-semibold">下一次执行</th>
                  <th className="px-4 py-3 font-semibold">通知</th>
                  <th className="px-4 py-3 font-semibold">状态</th>
                  <th className="px-4 py-3 font-semibold text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.map((row) => {
                  const isSelected = row.id === selectedRow?.id;
                  return (
                    <tr
                      key={row.id}
                      className={cx('cursor-pointer transition-colors hover:bg-slate-50/70', isSelected ? 'bg-indigo-50/60' : '')}
                      onClick={() => setSelectedRowId(row.id)}
                    >
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-900">{row.planName}</div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{row.typeLabel}</td>
                      <td className="px-4 py-4 text-slate-600">{row.symbol}</td>
                      <td className="px-4 py-4 text-slate-600">{row.triggerLabel}</td>
                      <td className="px-4 py-4 text-slate-600">{row.nextExecutionLabel}</td>
                      <td className="px-4 py-4 text-slate-600">{row.notificationLabel}</td>
                      <td className="px-4 py-4">
                        <PlanStatusPill tone={row.statusTone}>{row.statusLabel}</PlanStatusPill>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <a className="text-sm font-semibold text-indigo-700 transition-colors hover:text-indigo-900" href={links[row.actionKey]}>
                          {row.actionLabel}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 space-y-3 md:hidden">
            {rows.map((row) => {
              const isSelected = row.id === selectedRow?.id;
              return (
                <button
                  key={row.id}
                  className={cx(
                    'w-full rounded-2xl border px-4 py-4 text-left transition-colors',
                    isSelected ? 'border-indigo-200 bg-indigo-50/70' : 'border-slate-200 bg-slate-50'
                  )}
                  type="button"
                  onClick={() => setSelectedRowId(row.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{row.planName}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">{row.typeLabel}</div>
                    </div>
                    <PlanStatusPill tone={row.statusTone}>{row.statusLabel}</PlanStatusPill>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm text-slate-600">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">触发条件</div>
                      <div className="mt-1">{row.triggerLabel}</div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">下一次执行</div>
                        <div className="mt-1">{row.nextExecutionLabel}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">通知</div>
                        <div className="mt-1">{row.notificationLabel}</div>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 text-sm text-slate-500">共 {rows.length} 项后续计划，后续支持按状态、标的和通知方式筛选。</div>
        </Card>

        <div className="space-y-6">
          <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white">
            <SectionHeading eyebrow="计划详情" title={selectedRow?.detailTitle || '暂无选中计划'} />
            {selectedRow ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Layers3 className="h-4 w-4 text-slate-400" />
                    规则摘要
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{selectedRow.detailSummary}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Radar className="h-4 w-4 text-slate-400" />
                    触发说明
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{selectedRow.triggerExplain}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Bell className="h-4 w-4 text-slate-400" />
                    通知方式
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{selectedRow.notificationMethod}</p>
                </div>
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Clock3 className="h-4 w-4 text-slate-400" />
                    最近提醒记录
                  </div>
                  <div className="mt-3 space-y-2">
                    {selectedRow.reminderLog.map((item) => (
                      <div key={item} className="rounded-xl bg-white px-3 py-3 text-sm text-slate-500">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-slate-500">当前还没有可展示的后续交易计划。</p>
            )}
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Bell className="h-4 w-4 text-slate-400" />
            通知渠道
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">后续可接入站内提醒、浏览器通知和消息推送，当前先保留通知状态与配置占位。</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <CalendarClock className="h-4 w-4 text-slate-400" />
            提醒历史
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">未来可记录每一次提醒是否送达、何时确认，以及用户是否已处理对应计划。</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Sparkles className="h-4 w-4 text-slate-400" />
            自动执行
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">当前只做计划承载和提醒入口，后续可扩展为条件单同步、执行确认和策略版本管理。</p>
        </Card>
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <PageShell>
      <PageHero
        backHref={links.home}
        backLabel="返回策略总览"
        eyebrow="交易计划"
        title="交易计划中心"
        description="统一查看后续买入计划、触发条件和通知状态，后续所有规则型交易计划都从这里汇总。"
        badges={[
          <Pill key="pending" tone="indigo">{summary.pendingCount} 项待执行</Pill>,
          <Pill key="notify" tone="slate">{summary.notificationStatus}</Pill>
        ]}
      >
        <PageTabs activeKey="tradePlans" tabs={primaryTabs} />
      </PageHero>

      {content}
    </PageShell>
  );
}
