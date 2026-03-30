import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, CalendarClock, Clock3, Layers3, Radar, Sparkles } from 'lucide-react';
import { loadNotifyEvents, loadNotifyStatus, persistNotifyAdminToken, readNotifyAdminToken, sendNotifyTest, syncTradePlanRules } from '../app/notifySync.js';
import { buildTradePlanCenter } from '../app/tradePlans.js';
import { getPrimaryTabs } from '../app/screens.js';
import { Card, PageHero, PageShell, PageTabs, Pill, SectionHeading, StatCard, TextInput, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

function PlanStatusPill({ tone = 'slate', children }) {
  return <Pill tone={tone}>{children}</Pill>;
}

export function TradePlansExperience({ links, embedded = false }) {
  const [selectedRowId, setSelectedRowId] = useState('');
  const [notifyStatus, setNotifyStatus] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [notifyError, setNotifyError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [adminToken, setAdminToken] = useState(() => readNotifyAdminToken());
  const { previewRows, summary, hasPlans } = useMemo(() => buildTradePlanCenter(), []);
  const primaryTabs = getPrimaryTabs(links);

  useEffect(() => {
    let cancelled = false;

    async function refreshNotifyPanel() {
      try {
        const [statusPayload, eventsPayload] = await Promise.all([
          loadNotifyStatus(),
          loadNotifyEvents()
        ]);

        if (cancelled) {
          return;
        }

        setNotifyStatus(statusPayload);
        setRecentEvents(Array.isArray(eventsPayload?.events) ? eventsPayload.events : []);
        setNotifyError('');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setNotifyError(error instanceof Error ? error.message : '通知服务暂时不可用');
      }
    }

    refreshNotifyPanel();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!previewRows.length) {
      setSelectedRowId('');
      return;
    }

    if (!previewRows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(previewRows[0].id);
    }
  }, [previewRows, selectedRowId]);

  const selectedRow = previewRows.find((row) => row.id === selectedRowId) || previewRows[0] || null;
  const notificationValue = notifyStatus
    ? notifyStatus.configured?.bark || notifyStatus.configured?.gotify
      ? '已配置'
      : '未配置'
    : summary.notificationStatus;
  const notificationNote = notifyStatus
    ? [
        notifyStatus.configured?.bark ? 'Bark' : null,
        notifyStatus.configured?.gotify ? 'Gotify' : null
      ].filter(Boolean).join(' / ') || '请先配置 Bark 或 Gotify'
    : '提醒渠道和推送能力后续接入';
  const selectedRowEvents = selectedRow
    ? recentEvents.filter((event) => (
      selectedRow.sourceType === 'plan'
        ? event.ruleId === `plan:${selectedRow.sourceId}`
        : String(event.ruleId || '').startsWith(`dca:${selectedRow.sourceId}:`)
    ))
    : [];

  function handleAdminTokenChange(value) {
    setAdminToken(value);
    persistNotifyAdminToken(value);
  }

  async function refreshNotifyData() {
    const [statusPayload, eventsPayload] = await Promise.all([
      loadNotifyStatus(),
      loadNotifyEvents()
    ]);

    setNotifyStatus(statusPayload);
    setRecentEvents(Array.isArray(eventsPayload?.events) ? eventsPayload.events : []);
    setNotifyError('');
  }

  async function handleSyncRules() {
    setIsSyncing(true);
    try {
      await syncTradePlanRules();
      await refreshNotifyData();
    } catch (error) {
      setNotifyError(error instanceof Error ? error.message : '通知规则同步失败');
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleTestNotify() {
    setIsTesting(true);
    try {
      await sendNotifyTest();
      await refreshNotifyData();
    } catch (error) {
      setNotifyError(error instanceof Error ? error.message : '测试通知发送失败');
    } finally {
      setIsTesting(false);
    }
  }

  const content = (
    <div className={cx('mx-auto max-w-6xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard accent="indigo" eyebrow="待执行计划" value={`${summary.pendingCount} 项`} note="包含价格触发买入与固定定投计划" />
        <StatCard eyebrow="最近触发条件" value={summary.nearestTrigger} note="优先显示最近需要观察的价格条件" />
        <StatCard accent="emerald" eyebrow="下一次定投日期" value={summary.nextDcaDate} note="按当前定投配置推算的最近执行日" />
        <StatCard eyebrow="通知状态" value={notificationValue} note={notificationNote} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]">
        <Card className="min-w-0">
          <SectionHeading
            eyebrow="计划列表"
            title="后续交易计划"
            description="首页只保留每类计划一个待执行摘要，更多层级和完整配置去对应页面查看。"
            action={
              <>
                <button className={secondaryButtonClass} type="button" onClick={handleSyncRules}>
                  {isSyncing ? '正在同步' : '同步通知规则'}
                </button>
                <button className={secondaryButtonClass} type="button" onClick={handleTestNotify}>
                  {isTesting ? '正在发送' : '测试通知'}
                </button>
                <a className={secondaryButtonClass} href={links.accumNew}>
                  新建策略
                </a>
                <a className={secondaryButtonClass} href={links.dca}>
                  查看定投计划
                </a>
              </>
            }
          />

          {hasPlans ? (
            <>
              <div className="mt-6 grid gap-4">
                {previewRows.map((row) => {
                  const isSelected = row.id === selectedRow?.id;
                  return (
                    <div
                      key={row.id}
                      className={cx(
                        'w-full rounded-2xl border px-5 py-5 text-left transition-colors',
                        isSelected ? 'border-indigo-200 bg-indigo-50/70' : 'border-slate-200 bg-slate-50 hover:bg-white'
                      )}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <button className="min-w-0 flex-1 space-y-2 text-left" type="button" onClick={() => setSelectedRowId(row.id)}>
                          <div className="flex flex-wrap items-center gap-2">
                            <PlanStatusPill tone={row.statusTone}>{row.statusLabel}</PlanStatusPill>
                            <Pill tone="slate">{row.typeLabel}</Pill>
                          </div>
                          <div className="text-base font-bold text-slate-900">{row.planName}</div>
                          <div className="text-sm leading-6 text-slate-500">{row.symbol}</div>
                        </button>
                        <a
                          className={cx(secondaryButtonClass, 'shrink-0')}
                          href={links[row.actionKey]}
                        >
                          查看更多
                          <ArrowRight className="h-4 w-4" />
                        </a>
                      </div>
                      <button className="mt-4 grid w-full gap-4 text-left text-sm text-slate-600 md:grid-cols-3" type="button" onClick={() => setSelectedRowId(row.id)}>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">触发条件</div>
                          <div className="mt-1 leading-6 text-slate-700">{row.triggerLabel}</div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">下一次执行</div>
                          <div className="mt-1 leading-6 text-slate-700">{row.nextExecutionLabel}</div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">通知</div>
                          <div className="mt-1 leading-6 text-slate-700">{row.notificationLabel}</div>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 text-sm text-slate-500">首页每类计划只展示一个待执行摘要，完整配置和更多层级请到对应页面查看。</div>
            </>
          ) : (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8">
              <div className="text-lg font-bold text-slate-900">还没有后续交易计划</div>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                先去新建建仓策略，或者配置一份定投计划。保存后，首页会自动汇总后续待执行动作和通知状态。
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <a className={cx(primaryButtonClass, 'w-full sm:w-auto')} href={links.accumNew}>
                  去新建策略
                </a>
                <a className={cx(secondaryButtonClass, 'w-full sm:w-auto')} href={links.dca}>
                  去配置定投
                </a>
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white">
            <SectionHeading eyebrow="计划详情" title={selectedRow?.detailTitle || '暂无选中计划'} />
            {notifyError ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {notifyError}
              </div>
            ) : null}
            {notifyStatus?.requiresAdminToken ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-700">通知管理口令</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">如果通知 Worker 开了写保护，需要在当前浏览器保存一份管理口令，页面上的“同步通知规则”和“测试通知”才会成功。</p>
                <div className="mt-3">
                  <TextInput placeholder="输入通知管理口令" type="password" value={adminToken} onChange={(event) => handleAdminTokenChange(event.target.value)} />
                </div>
              </div>
            ) : null}
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
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {notifyStatus
                      ? `${notifyStatus.configured?.bark ? 'Bark' : ''}${notifyStatus.configured?.bark && notifyStatus.configured?.gotify ? ' / ' : ''}${notifyStatus.configured?.gotify ? 'Gotify' : ''}` || '尚未配置通知通道'
                      : selectedRow.notificationMethod}
                  </p>
                </div>
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Clock3 className="h-4 w-4 text-slate-400" />
                    最近提醒记录
                  </div>
                  <div className="mt-3 space-y-2">
                    {selectedRowEvents.length ? selectedRowEvents.map((item) => (
                      <div key={item.id} className="rounded-xl bg-white px-3 py-3 text-sm text-slate-500">
                        <div className="font-semibold text-slate-700">{item.summary || item.title}</div>
                        <div className="mt-1 text-xs text-slate-400">{String(item.createdAt || '').replace('T', ' ').slice(0, 16)} · {item.status === 'delivered' ? '已送达' : item.status === 'failed' ? '发送失败' : '未发送'}</div>
                      </div>
                    )) : selectedRow.reminderLog.map((item) => (
                      <div key={item} className="rounded-xl bg-white px-3 py-3 text-sm text-slate-500">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <p className="text-sm leading-6 text-slate-500">当前还没有可展示的后续交易计划。先完成建仓策略或定投配置，这里会自动展示下一步待执行动作。</p>
                <a className={cx(primaryButtonClass, 'w-full sm:w-auto')} href={links.accumNew}>
                  去新建策略
                </a>
              </div>
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
