import { ChevronDown, ChevronUp, RefreshCw, Send, Wallet } from 'lucide-react';
import {
  Card,
  Pill,
  cx,
  secondaryButtonClass
} from '../components/experience-ui.jsx';

export function NotifyStrategyCard({
  expandedStrategy,
  setExpandedStrategy,
  rulesLastSyncedLabel,
  holdingsRule,
  holdingsDigestStats,
  isSyncingRules,
  isSavingHoldingsRule,
  isSyncingHoldingsDigest,
  isTestingHoldingsNotify,
  handleSyncRules,
  handleToggleHoldingsRule,
  handleSyncHoldingsDigest,
  handleTestHoldingsNotify
}) {
  const holdingsEnabled = Boolean(holdingsRule?.enabled);
  const items = [
    {
      key: 'rules',
      icon: <RefreshCw className="h-4 w-4 text-indigo-500" />,
      title: '交易计划规则同步',
      subtitle: `上次同步：${rulesLastSyncedLabel}`,
      pill: null,
      body: (
        <SyncRulesBody
          rulesLastSyncedLabel={rulesLastSyncedLabel}
          isSyncingRules={isSyncingRules}
          handleSyncRules={handleSyncRules}
        />
      )
    },
    {
      key: 'holdings',
      icon: <Wallet className="h-4 w-4 text-emerald-500" />,
      title: '持仓当日收益提醒',
      subtitle: '北京时间 15:30 推场内；20:30 / 21:30 推全仓总览',
      pill: holdingsEnabled
        ? { tone: 'emerald', label: '已启用' }
        : { tone: 'slate', label: '未启用' },
      body: (
        <HoldingsRuleBody
          holdingsRule={holdingsRule}
          stats={holdingsDigestStats}
          isSavingHoldingsRule={isSavingHoldingsRule}
          isSyncingHoldingsDigest={isSyncingHoldingsDigest}
          isTestingHoldingsNotify={isTestingHoldingsNotify}
          handleToggleHoldingsRule={handleToggleHoldingsRule}
          handleSyncHoldingsDigest={handleSyncHoldingsDigest}
          handleTestHoldingsNotify={handleTestHoldingsNotify}
        />
      )
    }
  ];

  return (
    <Card>
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Strategies</div>
      <div className="mt-1 text-base font-bold text-slate-900 sm:text-lg">提醒策略 · {items.length} 条</div>
      <div className="mt-4 space-y-3">
        {items.map((item) => {
          const expanded = expandedStrategy === item.key;
          return (
            <div key={item.key} className="rounded-2xl border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setExpandedStrategy(expanded ? null : item.key)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={expanded}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {item.icon}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800">{item.title}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">{item.subtitle}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.pill ? <Pill tone={item.pill.tone}>{item.pill.label}</Pill> : null}
                  {expanded
                    ? <ChevronUp className="h-4 w-4 text-slate-400" />
                    : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </div>
              </button>
              {expanded ? (
                <div className="border-t border-slate-100 px-4 py-4">
                  {item.body}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function SyncRulesBody({ rulesLastSyncedLabel, isSyncingRules, handleSyncRules }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs leading-5 text-slate-500">
            将本机交易计划与定投规则同步到云端。交易计划中心修改后会自动同步，这里只是手动补同步入口。
          </p>
          <p className="mt-1 text-xs text-slate-400">上次同步：{rulesLastSyncedLabel}</p>
        </div>
        <button
          type="button"
          className={cx(secondaryButtonClass, isSyncingRules && 'cursor-not-allowed opacity-60')}
          onClick={handleSyncRules}
          disabled={isSyncingRules}
        >
          <RefreshCw className="h-4 w-4" />
          {isSyncingRules ? '正在同步' : '同步通知规则'}
        </button>
      </div>
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
        <p className="text-xs text-indigo-700">
          💡 想查看所有通知规则？
          <a
            href="?tab=notify&from=tradePlans"
            className="ml-1 font-medium underline hover:text-indigo-800"
          >
            前往通知管理中心 →
          </a>
        </p>
      </div>
    </div>
  );
}

function HoldingsRuleBody({
  holdingsRule,
  stats,
  isSavingHoldingsRule,
  isSyncingHoldingsDigest,
  isTestingHoldingsNotify,
  handleToggleHoldingsRule,
  handleSyncHoldingsDigest,
  handleTestHoldingsNotify
}) {
  return (
    <div>
      <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          checked={Boolean(holdingsRule?.enabled)}
          disabled={isSavingHoldingsRule}
          onChange={(event) => handleToggleHoldingsRule(event.target.checked)}
        />
        <div className="min-w-0 text-sm leading-6 text-slate-700">
          <div className="font-semibold text-slate-800">启用持仓当日收益推送</div>
          <div className="mt-1 text-xs text-slate-500">
            仅同步代码与组合权重到云端，不会上传份额、成本或金额。关闭后云端不再推送。
          </div>
        </div>
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
          <div className="text-xs text-slate-500">场内持仓</div>
          <div className="mt-1 text-base font-semibold text-slate-900">{stats.exchangeCount} 只</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
          <div className="text-xs text-slate-500">场外持仓</div>
          <div className="mt-1 text-base font-semibold text-slate-900">{stats.otcCount} 只</div>
        </div>
      </div>

      <div className="mt-3 text-xs leading-6 text-slate-500">
        <div>快照生成时间：{stats.generatedLabel}</div>
        <div>云端保存时间：{stats.updatedLabel}</div>
        <div>覆盖权重：{(stats.totalWeight * 100).toFixed(2)}%</div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={cx(secondaryButtonClass, isSyncingHoldingsDigest && 'cursor-not-allowed opacity-60')}
          onClick={handleSyncHoldingsDigest}
          disabled={isSyncingHoldingsDigest}
        >
          <RefreshCw className="h-4 w-4" />
          {isSyncingHoldingsDigest ? '正在同步快照' : '立即同步快照'}
        </button>
        <button
          type="button"
          className={cx(secondaryButtonClass, isTestingHoldingsNotify && 'cursor-not-allowed opacity-60')}
          onClick={handleTestHoldingsNotify}
          disabled={isTestingHoldingsNotify}
        >
          <Send className="h-4 w-4" />
          {isTestingHoldingsNotify ? '正在发送测试' : '消息测试'}
        </button>
        {!stats.hasDigest ? (
          <span className="text-xs text-amber-600">
            当前云端未保存持仓快照，点击「立即同步快照」后才会调度推送。
          </span>
        ) : null}
      </div>
    </div>
  );
}
