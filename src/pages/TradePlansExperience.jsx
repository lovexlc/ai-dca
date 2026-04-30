import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, CalendarClock, Layers3, ListChecks, Plus, Radar, Repeat, Sparkles, Trash2, TrendingUp } from 'lucide-react';
import { loadNotifyStatus, readNotifyClientConfig, sendNotifyTest } from '../app/notifySync.js';
import { buildTradePlanCenter } from '../app/tradePlans.js';
import { deletePlan } from '../app/plan.js';
import { clearDcaState } from '../app/dca.js';
import { showActionToast } from '../app/toast.js';
import { Card, Pill, SectionHeading, StatCard, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';
import { NewPlanExperience } from './NewPlanExperience.jsx';
import {
  buildRuleDetailUrl,
  extractPurchaseAmount
} from '../app/tradePlansHelpers.js';

// 加仓计划 / 定投计划已合并为本 tab 的二级视图，按需 lazy 加载，避免初次进入交易计划就拖入 home dashboard 的图表 chunk。
const HomeExperienceLazy = lazy(() => import('./HomeExperience.jsx').then((m) => ({ default: m.HomeExperience })));
const DcaExperienceLazy = lazy(() => import('./DcaExperience.jsx').then((m) => ({ default: m.DcaExperience })));
// 「切换」二级视图：场内 / 场外纳指 100 切换套利策略，首次进入才拉取实时价格快照。
const SwitchStrategyExperienceLazy = lazy(() => import('./SwitchStrategyExperience.jsx').then((m) => ({ default: m.SwitchStrategyExperience })));

// 子视图与 URL hash 对应关系：
//   ''  / '#list' → 列表（默认）
//   '#home'      → 加仓
//   '#dca'       → 定投
//   '#switch'    → 切换（场内/场外套利）
//   '#new'       → 新建（覆盖整个 tab，独占视图）
const SUB_VIEW_HASH = {
  list: '',
  home: '#home',
  dca: '#dca',
  switch: '#switch',
  new: '#new'
};

function parseSubViewFromHash(hash = '') {
  if (hash === '#new') return 'new';
  if (hash === '#home') return 'home';
  if (hash === '#dca') return 'dca';
  if (hash === '#switch') return 'switch';
  return 'list';
}

function getInitialSubView() {
  if (typeof window === 'undefined') return 'list';
  return parseSubViewFromHash(window.location.hash || '');
}

function SubViewLoadingFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-slate-500">
      加载中…
    </div>
  );
}

export function TradePlansExperience({ links, inPagesDir = false, embedded = false }) {
  const [selectedRowId, setSelectedRowId] = useState('');
  // 子视图（list / home / dca / switch / new）通过 URL hash 持久化，方便刷新和浏览器前进后退。
  const [subView, setSubView] = useState(getInitialSubView);
  const [testingRowId, setTestingRowId] = useState('');
  // 仅判断是否已配置任一推送通道，未配置时在顶部提示一行链接。
  // 通知配置/历史/同步统一收口到《消息通知》tab，本页只保留测试通知动作。
  const [channelConfigured, setChannelConfigured] = useState(true);
  // 仅读取 clientId：交易计划 tab 不再维护通道配置，只在发送测试通知时引用。配置入口请去《通知》tab。
  const notifyClientId = useMemo(() => readNotifyClientConfig().notifyClientId || '', []);
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const { previewRows, summary, hasPlans } = useMemo(() => buildTradePlanCenter(), [planRefreshKey]);

  // 切换到任意子视图：写入对应 hash 以便浏览器后退/前进能在视图间来回。
  // 新建子视图对其他视图来说是 push（保留返回栈）；其他子视图之间互相切换用 replace，避免在二级 tab 间频繁切换时把历史栈撑大。
  function gotoSubView(nextView, { push = false } = {}) {
    if (typeof window === 'undefined') {
      setSubView(nextView);
      return;
    }
    const targetHash = SUB_VIEW_HASH[nextView] ?? '';
    const currentHash = window.location.hash || '';
    const baseUrl = `${window.location.pathname}${window.location.search}${targetHash}`;
    if (currentHash !== targetHash) {
      if (push) {
        window.history.pushState({ subView: nextView }, '', baseUrl);
      } else {
        window.history.replaceState({ subView: nextView }, '', baseUrl);
      }
    }
    setSubView(nextView);
    if (nextView === 'new') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function enterNewPlanView() {
    gotoSubView('new', { push: true });
  }

  function exitNewPlanView() {
    if (typeof window !== 'undefined' && window.location.hash === '#new') {
      // #new 是 push 进来的，回退一次能回到上一个视图。
      window.history.back();
      return;
    }
    gotoSubView('list');
  }

  // 二级 tab 之间切换：list / home / dca / switch
  function handleSelectSubTab(nextView) {
    if (nextView === subView) return;
    gotoSubView(nextView);
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    function syncSubViewFromHash() {
      setSubView(parseSubViewFromHash(window.location.hash || ''));
    }
    window.addEventListener('hashchange', syncSubViewFromHash);
    window.addEventListener('popstate', syncSubViewFromHash);
    return () => {
      window.removeEventListener('hashchange', syncSubViewFromHash);
      window.removeEventListener('popstate', syncSubViewFromHash);
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

  function handleDeletePlanRow(row) {
    if (!row) return;
    if (row.sourceType === 'dca') {
      clearDcaState();
      showActionToast('删除定投计划', 'success');
    } else if (row.sourceType === 'plan' && row.sourceId) {
      const removed = deletePlan(row.sourceId);
      if (!removed) return;
      showActionToast('删除加仓计划', 'success');
    } else {
      return;
    }
    if (selectedRowId === row.id) {
      setSelectedRowId('');
    }
    setPlanRefreshKey((value) => value + 1);
  }
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
                        <button
                          type="button"
                          className={cx(
                            secondaryButtonClass,
                            'border-rose-200 bg-white text-rose-600 shadow-sm hover:border-rose-300 hover:bg-rose-50'
                          )}
                          onClick={() => handleDeletePlanRow(row)}
                        >
                          <Trash2 className="h-4 w-4" />
                          删除
                        </button>
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

            <div className="mt-4 text-sm text-slate-500">列表只展示每类计划的待执行摘要，完整配置可点击「加仓」「定投」二级 tab 查看。</div>
          </>
        ) : (
          <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8">
            <div className="text-lg font-bold text-slate-900">还没有后续交易计划</div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
              先去新建建仓策略，或者在「定投」二级 tab 配置一份定投计划。保存后这里会自动汇总后续待执行动作和通知状态。
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={enterNewPlanView} className={cx(primaryButtonClass, 'w-full sm:w-auto')}>
                去新建策略
              </button>
              <button type="button" onClick={() => handleSelectSubTab('dca')} className={cx(secondaryButtonClass, 'w-full sm:w-auto')}>
                去配置定投
              </button>
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
              <button type="button" onClick={enterNewPlanView} className={cx(primaryButtonClass, 'w-full sm:w-auto')}>
                去新建策略
              </button>
              <button type="button" onClick={() => handleSelectSubTab('dca')} className={cx(secondaryButtonClass, 'w-full sm:w-auto')}>
                去配置定投
              </button>
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
  if (subView === 'new') {
    return (
      <NewPlanExperience
        links={links}
        embedded
        onBack={exitNewPlanView}
      />
    );
  }

  const subTabs = [
    { key: 'list', label: '列表', icon: ListChecks },
    { key: 'home', label: '加仓', icon: TrendingUp },
    { key: 'dca', label: '定投', icon: CalendarClock },
    { key: 'switch', label: '切换', icon: Repeat }
  ];

  function renderSubTabBar() {
    return (
      <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-100/70 p-1">
        {subTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = subView === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleSelectSubTab(tab.key)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-colors',
                isActive
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:bg-white/60 hover:text-slate-700'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>
    );
  }

  // 加仓 / 定投 / 切换 二级视图：内嵌各自的 Experience 组件，外层共享标题与二级 tab 切换。
  // 二级 tab 右侧不再重复「新建计划」主按钮（空状态与「加仓」「定投」「切换」页内都有明确的创建入口）。
  if (subView === 'home' || subView === 'dca' || subView === 'switch') {
    return (
      <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Trade plans</div>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">交易计划中心</h1>
          </div>
        </div>

        {renderSubTabBar()}

        <Suspense fallback={<SubViewLoadingFallback />}>
          {subView === 'home' ? (
            <HomeExperienceLazy links={links} inPagesDir={inPagesDir} embedded />
          ) : subView === 'dca' ? (
            <DcaExperienceLazy
              links={links}
              inPagesDir={inPagesDir}
              embedded
              onAfterSave={() => gotoSubView('list')}
            />
          ) : (
            <SwitchStrategyExperienceLazy
              links={links}
              inPagesDir={inPagesDir}
              embedded
            />
          )}
        </Suspense>
      </div>
    );
  }

  // 默认：列表视图。
  return (
    <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Trade plans</div>
          <h1 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">交易计划中心</h1>
        </div>
        {/* 列表顶部不再重复「新建计划」主按钮：空状态卡片以及「加仓 / 定投 / 切换」二级 tab 内都有明确的创建 / 保存入口。 */}
      </div>

      {renderSubTabBar()}

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
}
