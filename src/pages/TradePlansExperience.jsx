import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, Layers3, Plus, Radar, Sparkles } from 'lucide-react';
import { loadNotifyStatus, readNotifyClientConfig, sendNotifyTest } from '../app/notifySync.js';
import { buildTradePlanCenter } from '../app/tradePlans.js';
import { showActionToast } from '../app/toast.js';
import { Card, Pill, SectionHeading, StatCard, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';
import { NewPlanExperience } from './NewPlanExperience.jsx';
import {
  buildRuleDetailUrl,
  extractPurchaseAmount
} from '../app/tradePlansHelpers.js';

export function TradePlansExperience({ links, embedded = false }) {
  const [selectedRowId, setSelectedRowId] = useState('');
  // 《新建计划》嵌入在本 tab 中：view === 'new' 时渲染 NewPlanExperience 覆盖原内容。
  // 用 URL hash (#new) 作为持久化入口，这样刷新或浏览器后退/前进按钮能回到正确视图。
  const [view, setView] = useState(() => {
    if (typeof window === 'undefined') {
      return 'list';
    }
    return window.location.hash === '#new' ? 'new' : 'list';
  });
  const [testingRowId, setTestingRowId] = useState('');
  // 仅判断是否已配置任一推送通道，未配置时在顶部提示一行链接。
  // 通知配置/历史/同步统一收口到《消息通知》tab，本页只保留测试通知动作。
  const [channelConfigured, setChannelConfigured] = useState(true);
  // 仅读取 clientId：交易计划 tab 不再维护通道配置，只在发送测试通知时引用。配置入口请去《通知》tab。
  const notifyClientId = useMemo(() => readNotifyClientConfig().notifyClientId || '', []);
  const { previewRows, summary, hasPlans } = useMemo(() => buildTradePlanCenter(), []);

  // 向《新建计划》子视图切换：写入 hash 以便浏览器后退/前进能在两个视图间来回。
  function enterNewPlanView() {
    if (typeof window !== 'undefined' && window.location.hash !== '#new') {
      window.history.pushState({ view: 'new' }, '', `${window.location.pathname}${window.location.search}#new`);
    }
    setView('new');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function exitNewPlanView() {
    if (typeof window !== 'undefined' && window.location.hash === '#new') {
      // 回到交易计划视图，保持返回按钮行为：跳近最近的历史条目。
      window.history.back();
    }
    setView('list');
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    function syncViewFromHash() {
      setView(window.location.hash === '#new' ? 'new' : 'list');
    }
    window.addEventListener('hashchange', syncViewFromHash);
    window.addEventListener('popstate', syncViewFromHash);
    return () => {
      window.removeEventListener('hashchange', syncViewFromHash);
      window.removeEventListener('popstate', syncViewFromHash);
    };
  }, []);

  // 拉取一次通知状态，仅用于决定是否展示顶部「未配置」提示行。
  useEffect(() => {
    let cancelled = false;
    async function refreshChannelStatus() {
      try {
        const status = await loadNotifyStatus(notifyClientId);
        if (cancelled) return;
        const barkConfigured = Boolean(status?.configured?.bark);
        const androidConfigured = Array.isArray(status?.setup?.gcmCurrentClientRegistrations)
          && status.setup.gcmCurrentClientRegistrations.length > 0;
        setChannelConfigured(barkConfigured || androidConfigured);
      } catch (_error) {
        // 拉取失败时按「已配置」处理，避免误导。
        if (!cancelled) {
          setChannelConfigured(true);
        }
      }
    }
    refreshChannelStatus();
    return () => {
      cancelled = true;
    };
  }, [notifyClientId]);

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
  function buildRowTestPayload(row) {
    const normalizedRuleId = String(row?.ruleId || '').trim() || 'test';
    const normalizedPlanName = String(row?.planName || row?.detailTitle || '交易计划').trim();
    const purchaseAmount = extractPurchaseAmount(row);
    const detailUrl = buildRuleDetailUrl(row);

    if (row?.sourceType === 'dca') {
      return {
        eventId: `${normalizedRuleId}:manual-test:${Date.now()}`,
        eventType: 'dca-test',
        ruleId: normalizedRuleId,
        symbol: String(row?.symbol || '').trim(),
        strategyName: normalizedPlanName,
        triggerCondition: String(row?.triggerLabel || '').trim(),
        purchaseAmount,
        detailUrl,
        title: '定投计划测试提醒',
        summary: `${normalizedPlanName} 测试提醒`,
        body: `这是「${normalizedPlanName}」的测试通知。已到达您设定的定投日，请前往网页查看本期投资策略。`
      };
    }

    return {
      eventId: `${normalizedRuleId}:manual-test:${Date.now()}`,
      eventType: 'plan-test',
      ruleId: normalizedRuleId,
      symbol: String(row?.symbol || '').trim(),
      strategyName: normalizedPlanName,
      triggerCondition: String(row?.triggerLabel || '').trim(),
      purchaseAmount,
      detailUrl,
      title: '交易计划测试提醒',
      summary: `${normalizedPlanName} 测试提醒`,
      body: `这是「${normalizedPlanName}」的测试通知。已触发您设置的购买条件${row?.triggerLabel ? `（${row.triggerLabel}）` : ''}，请前往网页查看当前投资策略。`
    };
  }

  async function handleTestNotify(row) {
    if (!row?.id) {
      return;
    }

    setTestingRowId(row.id);
    try {
      await sendNotifyTest({
        clientId: notifyClientId,
        ...buildRowTestPayload(row)
      });
      showActionToast('测试通知', 'success', {
        description: `已发送「${row.planName}」的测试通知。`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '测试通知发送失败';
      showActionToast('测试通知', 'error', {
        description: `${message}。请到《消息通知》页面检查推送通道接入。`
      });
    } finally {
      setTestingRowId('');
    }
  }

  function renderPlansCard() {
    return (
      <Card className="min-w-0">
        <SectionHeading
          eyebrow="计划列表"
          title="后续交易计划"
          description="首页只保留每类计划一个待执行摘要，更多层级和完整配置去对应页面查看。"
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
                          <Pill tone={row.statusTone}>{row.statusLabel}</Pill>
                          <Pill tone="slate">{row.typeLabel}</Pill>
                        </div>
                        <div className="text-base font-bold text-slate-900">{row.planName}</div>
                        <div className="text-sm leading-6 text-slate-500">{row.symbol}</div>
                      </button>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          className={cx(
                            secondaryButtonClass,
                            'border-slate-300 bg-white shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
                          )}
                          type="button"
                          disabled={testingRowId === row.id}
                          onClick={() => handleTestNotify(row)}
                        >
                          <Bell className="h-4 w-4" />
                          {testingRowId === row.id ? '正在发送' : '测试通知'}
                        </button>
                        <a
                          className={cx(secondaryButtonClass, 'shrink-0')}
                          href={links[row.actionKey]}
                        >
                          查看更多
                          <ArrowRight className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                    <button className="mt-4 grid w-full gap-4 text-left text-sm text-slate-600 md:grid-cols-2" type="button" onClick={() => setSelectedRowId(row.id)}>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">触发条件</div>
                        <div className="mt-1 leading-6 text-slate-700">{row.triggerLabel}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">下一次执行</div>
                        <div className="mt-1 leading-6 text-slate-700">{row.nextExecutionLabel}</div>
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
    );
  }

  function renderPlanDetailCard() {
    return (
      <Card className="min-w-0">
        <SectionHeading
          eyebrow="计划详情"
          title={selectedRow?.detailTitle || '当前没有待查看计划'}
          description={selectedRow ? '右侧只展示当前选中计划的规则摘要和触发说明。' : '先在左侧选择一条交易计划，这里再展开对应的执行说明。'}
        />
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
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
            <p className="text-sm leading-6 text-slate-500">当前还没有可展示的计划详情。先完成建仓策略或定投配置，或者从左侧选中一条后续交易计划。</p>
            <div className="mt-4 flex flex-wrap gap-3">
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
    );
  }

  function renderAutomationCard() {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Sparkles className="h-4 w-4 text-slate-400" />
          自动执行
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-500">当前只做计划承载和提醒入口，后续可扩展为条件单同步、执行确认和策略版本管理。</p>
      </Card>
    );
  }

  // 当进入《新建计划》子视图时，直接用 NewPlanExperience 覆盖当前内容。
  // NewPlanExperience 自带 PageHero 左上角的《返回交易计划》按钮会调用 onBack 退出。
  if (view === 'new') {
    const newPlanNode = (
      <NewPlanExperience
        links={links}
        embedded
        onBack={exitNewPlanView}
      />
    );
    return newPlanNode;
  }

  const content = (
    <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
      {/* 标题 + 《新建计划》入口，点击后在本 tab 内覆盖为新建计划页。 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Trade plans</div>
          <h1 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">交易计划中心</h1>
        </div>
        <button
          type="button"
          onClick={enterNewPlanView}
          className={cx(primaryButtonClass, 'h-10 px-4 text-sm')}
        >
          <Plus className="h-4 w-4" />
          新建计划
        </button>
      </div>

      {channelConfigured ? null : (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <Bell className="h-4 w-4 text-amber-600" />
          <span>通知通道尚未配置，测试 / 触发通知不会推送。</span>
          <a
            className="ml-auto inline-flex items-center gap-1 font-semibold text-amber-700 underline-offset-4 hover:underline"
            href={links.notify}
          >
            去消息通知配置
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard accent="indigo" eyebrow="待执行计划" value={`${summary.pendingCount} 项`} note="包含价格触发买入与固定定投计划" />
        <StatCard eyebrow="最近触发条件" value={summary.nearestTrigger} note="优先显示最近需要观察的价格条件" />
        <StatCard accent="emerald" eyebrow="下一次定投日期" value={summary.nextDcaDate} note="按当前定投配置推算的最近执行日" />
      </div>

      {/* Mobile / tablet: single column stack */}
      <div className="space-y-6 lg:hidden">
        {renderPlansCard()}
        {renderPlanDetailCard()}
        {renderAutomationCard()}
      </div>

      {/* Desktop: 2-column layout. Left = list + automation. Right = sticky plan detail card. */}
      <div className="hidden items-start gap-6 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.9fr)]">
        <div className="min-w-0 space-y-6">
          {renderPlansCard()}
          {renderAutomationCard()}
        </div>
        <div className="min-w-0 space-y-6 lg:sticky lg:top-4">
          {renderPlanDetailCard()}
        </div>
      </div>
    </div>
  );

  return content;
}
