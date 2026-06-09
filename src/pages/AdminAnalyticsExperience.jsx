import { Fragment, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Bell, Bot, Calendar, ChevronDown, ChevronRight, Clock, Eye, MessageSquareText, MousePointerClick, Percent, RefreshCw, ShieldCheck, Shuffle, Sparkles, Trash2, UserRound, Users } from 'lucide-react';
import { buildAnalyticsSummary, clearAnalyticsEvents, fetchRemoteAnalyticsSummary, isAnalyticsAdmin, trackAnalyticsEvent } from '../app/analytics.js';
import { loadCloudSession } from '../app/authClient.js';
import { cx } from '../components/experience-ui.jsx';

const RANGE_OPTIONS = [
  { key: 7, label: '7 天' },
  { key: 30, label: '30 天' },
  { key: 90, label: '90 天' }
];
const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };

function Card({ title, value, icon: Icon, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-slate-500">{title}</div>
        {Icon ? <Icon className="h-4 w-4 text-slate-400" /> : null}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

function NotifyCard({ total, platformUsers = {} }) {
  const [expanded, setExpanded] = useState(false);
  const platforms = [
    { key: 'ios', label: 'iOS', color: 'bg-blue-100 text-blue-700', count: platformUsers.ios || 0 },
    { key: 'serverchan3', label: 'Server酱³', color: 'bg-green-100 text-green-700', count: platformUsers.serverchan3 || 0 },
    { key: 'pc', label: 'PC', color: 'bg-purple-100 text-purple-700', count: platformUsers.pc || 0 },
    { key: 'unknown', label: '未知/历史', color: 'bg-slate-100 text-slate-600', count: platformUsers.unknown || 0 }
  ];
  const activePlatforms = platforms.filter((p) => p.count > 0);
  return (
    <div
      className="group cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-slate-500">通知使用人数</div>
        <div className="flex items-center gap-1.5">
          <Bell className="h-4 w-4 text-slate-400" />
          <ChevronDown className={cx('h-3.5 w-3.5 text-slate-300 transition-transform', expanded && 'rotate-180')} />
        </div>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{total}</div>
      {!expanded && activePlatforms.length > 0 && (
        <div className="mt-1 text-xs text-slate-400">{activePlatforms.map((p) => `${p.label} ${p.count}`).join(' · ')}</div>
      )}
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
          {platforms.map((p) => (
            <div key={p.key} className="flex items-center justify-between">
              <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', p.count > 0 ? p.color : 'bg-slate-50 text-slate-400')}>
                {p.label}
              </span>
              <span className="text-sm font-bold tabular-nums text-slate-700">{p.count}</span>
            </div>
          ))}
          <div className="pt-1 text-xs text-slate-400">按设备平台去重，未知/历史仅保留近 7 天仍无明确平台的通知用户</div>
        </div>
      )}
    </div>
  );
}

function EmptyChart() {
  return <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无统计数据</div>;
}

function formatPercent(value) {
  return `${((Number(value) || 0) * 100).toFixed(1)}%`;
}

function formatDuration(ms) {
  const seconds = Math.round((Number(ms) || 0) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

const FEATURE_COLORS = {
  holdings: 'bg-blue-50 text-blue-700 ring-blue-200',
  markets: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  dca: 'bg-violet-50 text-violet-700 ring-violet-200',
  sell_plan: 'bg-rose-50 text-rose-700 ring-rose-200',
  new_plan: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  trade_plans: 'bg-amber-50 text-amber-700 ring-amber-200',
  dca_calculator: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  switch_strategy: 'bg-orange-50 text-orange-700 ring-orange-200',
  fund_switch: 'bg-teal-50 text-teal-700 ring-teal-200',
  fund_switch_analysis: 'bg-lime-50 text-lime-700 ring-lime-200',
  notify: 'bg-pink-50 text-pink-700 ring-pink-200',
  home: 'bg-sky-50 text-sky-700 ring-sky-200',
  vix: 'bg-red-50 text-red-700 ring-red-200',
  premium: 'bg-yellow-50 text-yellow-700 ring-yellow-200'
};

function FeatureDetailsSection({ featureDetails = [] }) {
  const [expandedPrefix, setExpandedPrefix] = useState(null);
  if (!featureDetails.length) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-bold text-slate-900">功能明细统计</h2>
        <div className="flex min-h-[120px] items-center justify-center text-sm text-slate-400">暂无功能事件数据</div>
      </div>
    );
  }
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900">功能明细统计</h2>
        <span className="text-xs text-slate-400">{featureDetails.length} 个功能模块</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-100">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 text-left">功能</th>
              <th className="px-3 py-2 text-right">总事件</th>
              <th className="px-3 py-2 text-right">成功</th>
              <th className="px-3 py-2 text-right">失败</th>
              <th className="px-3 py-2 text-right">人数</th>
              <th className="px-3 py-2 text-right">成功率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {featureDetails.map((feature) => {
              const isExpanded = expandedPrefix === feature.prefix;
              const successRate = feature.total > 0 ? ((feature.success / feature.total) * 100).toFixed(1) : '—';
              const colorClass = FEATURE_COLORS[feature.prefix] || 'bg-slate-50 text-slate-600 ring-slate-200';
              return (
                <Fragment key={feature.prefix}>
                  <tr
                    className="cursor-pointer transition-colors hover:bg-slate-50/60"
                    onClick={() => setExpandedPrefix(isExpanded ? null : feature.prefix)}
                  >
                    <td className="px-2 py-2 text-center">
                      {isExpanded
                        ? <ChevronDown className="inline h-3.5 w-3.5 text-slate-400" />
                        : <ChevronRight className="inline h-3.5 w-3.5 text-slate-300" />}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1', colorClass)}>
                        {feature.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{feature.total}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{feature.success || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-600">{feature.error || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{feature.users}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{successRate}%</td>
                  </tr>
                  {isExpanded && feature.actions.length > 0 && (
                    <tr>
                      <td colSpan={7} className="bg-slate-50/50 px-0 py-0">
                        <div className="px-4 py-3">
                          <div className="mb-2 text-xs font-semibold text-slate-500">动作明细 — {feature.label}</div>
                          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <table className="min-w-full text-xs">
                              <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                  <th className="px-3 py-1.5 text-left">动作</th>
                                  <th className="px-3 py-1.5 text-right">次数</th>
                                  <th className="px-3 py-1.5 text-right">成功</th>
                                  <th className="px-3 py-1.5 text-right">失败</th>
                                  <th className="px-3 py-1.5 text-right">人数</th>
                                  <th className="px-3 py-1.5 text-right">成功率</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {feature.actions.map((action) => {
                                  const rate = action.count > 0 ? ((action.success / action.count) * 100).toFixed(1) : '—';
                                  return (
                                    <tr key={action.action}>
                                      <td className="px-3 py-1.5 font-medium text-slate-700">{action.label}</td>
                                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{action.count}</td>
                                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600">{action.success || '—'}</td>
                                      <td className="px-3 py-1.5 text-right tabular-nums text-rose-600">{action.error || '—'}</td>
                                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{action.users}</td>
                                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{rate}%</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminAnalyticsExperience({ embedded = false } = {}) {
  const [rangeDays, setRangeDays] = useState(30);
  const [version, setVersion] = useState(0);
  const [remoteSummary, setRemoteSummary] = useState(null);
  const [remoteStatus, setRemoteStatus] = useState('idle');
  const [remoteError, setRemoteError] = useState('');
  const session = loadCloudSession();
  const isAdmin = isAnalyticsAdmin(session);
  const localSummary = useMemo(() => buildAnalyticsSummary({ rangeDays }), [rangeDays, version]);
  const summary = remoteSummary || localSummary;

  useEffect(() => {
    function refresh() { setVersion((v) => v + 1); }
    window.addEventListener('analytics:changed', refresh);
    return () => window.removeEventListener('analytics:changed', refresh);
  }, []);

  useEffect(() => {
    if (isAdmin) trackAnalyticsEvent('admin_dashboard_view', { rangeDays });
  }, [isAdmin, rangeDays]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    setRemoteStatus('loading');
    setRemoteError('');
    fetchRemoteAnalyticsSummary({ rangeDays, session: loadCloudSession() })
      .then((payload) => {
        if (cancelled) return;
        setRemoteSummary(payload);
        setRemoteStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setRemoteSummary(null);
        setRemoteStatus('local');
        setRemoteError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [isAdmin, rangeDays, version]);

  if (!isAdmin) {
    return (
      <div className={cx('mx-auto max-w-4xl', embedded ? 'px-4 sm:px-6' : 'px-6')}>
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <div className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="h-5 w-5" />管理员权限 required</div>
          <p className="mt-2 text-sm leading-6">当前账号没有数据看板权限。请使用 lovexl 登录后访问。</p>
        </div>
      </div>
    );
  }

  const cards = [
    { title: '注册人数', value: summary.cards.registeredUsers, icon: Users, hint: '按登录/注册账号去重' },
    { title: 'PV', value: summary.cards.pv, icon: Eye, hint: `${rangeDays} 天页面访问` },
    { title: 'UV', value: summary.cards.uv, icon: MousePointerClick, hint: '按访客 ID 去重' },
    { title: 'Worker 跑切换', value: summary.cards.switchRuns, icon: Shuffle, hint: '切换运行/使用次数' },
    { title: 'AI 使用人数', value: summary.cards.aiUsers, icon: Bot, hint: '发送 AI 请求用户' },
    { title: '广告曝光', value: summary.ads?.views || 0, icon: Eye, hint: `点击 ${summary.ads?.clicks || 0} · CTR ${formatPercent(summary.ads?.ctr)}` },
    { title: '会话数', value: summary.engagement?.sessions || 0, icon: Activity, hint: `用户 ${summary.engagement?.sessionUsers || 0} · 心跳 ${summary.engagement?.heartbeats || 0}` },
    { title: '平均活跃', value: formatDuration(summary.engagement?.avgActiveTimeMs), icon: Clock, hint: `平均滚动 ${Math.round(Number(summary.engagement?.avgScrollPct) || 0)}%` },
    { title: '问卷提交', value: summary.premiumSurvey?.submits || 0, icon: MessageSquareText, hint: `提交用户 ${summary.premiumSurvey?.users || 0}` }
  ];

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700"><Activity className="h-3.5 w-3.5" />管理员数据看板</div>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">站点与功能统计</h1>
            <p className="mt-1 text-sm text-slate-500">优先读取 sync Worker 的 D1 汇总，失败时回落本地轻量事件，方便后续接入广告分析。</p>
            <div className="mt-2 text-xs text-slate-400">{remoteStatus === 'ready' ? '数据源：远程 D1 汇总' : remoteStatus === 'loading' ? '正在读取远程统计…' : `数据源：本地事件${remoteError ? ` · ${remoteError}` : ''}`}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {RANGE_OPTIONS.map((item) => (
              <button key={item.key} type="button" onClick={() => setRangeDays(item.key)} className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', rangeDays === item.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>{item.label}</button>
            ))}
            <button type="button" onClick={() => { setRemoteSummary(null); setVersion((v) => v + 1); }} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3.5 w-3.5" />刷新</button>
            <button type="button" onClick={() => { if (window.confirm('确认清空本地统计事件？')) clearAnalyticsEvents(); }} className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" />清空</button>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => <Card key={card.title} {...card} />)}
        <NotifyCard total={summary.cards.notifyUsers} platformUsers={summary.cards.notifyPlatformUsers} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-sky-500" />
              <h2 className="text-base font-bold text-slate-900">广告位表现</h2>
            </div>
            <span className="text-xs text-slate-400">曝光 / 点击 / CTR</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">广告位</th>
                  <th className="px-3 py-2 text-left">位置</th>
                  <th className="px-3 py-2 text-right">曝光</th>
                  <th className="px-3 py-2 text-right">点击</th>
                  <th className="px-3 py-2 text-right">CTR</th>
                  <th className="px-3 py-2 text-right">可见时长</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(summary.ads?.slots || []).length ? (summary.ads.slots || []).map((row) => (
                  <tr key={`${row.slotId}-${row.pageTab}-${row.position}`}>
                    <td className="px-3 py-2 font-semibold text-slate-800">{row.slotId}</td>
                    <td className="px-3 py-2 text-slate-500">{[row.pageTab, row.position].filter(Boolean).join(' / ') || '-'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.views}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.clicks}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatPercent(row.ctr)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatDuration(row.avgVisibleMs)}</td>
                  </tr>
                )) : <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">暂无广告位统计</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-500" />
              <h2 className="text-base font-bold text-slate-900">页面参与度</h2>
            </div>
            <span className="text-xs text-slate-400">停留 / 活跃 / 滚动</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Tab</th>
                  <th className="px-3 py-2 text-right">事件</th>
                  <th className="px-3 py-2 text-right">用户</th>
                  <th className="px-3 py-2 text-right">活跃</th>
                  <th className="px-3 py-2 text-right">滚动</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(summary.engagement?.byTab || []).length ? (summary.engagement.byTab || []).map((row) => (
                  <tr key={row.tab}>
                    <td className="px-3 py-2 font-semibold text-slate-800">{row.tab || 'unknown'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.events}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.users}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatDuration(row.avgActiveTimeMs)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Math.round(Number(row.avgScrollPct) || 0)}%</td>
                  </tr>
                )) : <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">暂无页面参与度统计</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <h2 className="text-base font-bold text-slate-900">高级版问卷</h2>
          </div>
          <span className="text-xs text-slate-400">固定选项汇总，不含自由文本和持仓信息</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">关注功能</th><th className="px-3 py-2 text-right">次数</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(summary.premiumSurvey?.interests || []).length ? (summary.premiumSurvey.interests || []).map((row) => (
                  <tr key={row.key}><td className="px-3 py-2 text-slate-700">{row.key}</td><td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.count}</td></tr>
                )) : <tr><td colSpan={2} className="px-3 py-8 text-center text-slate-400">暂无关注功能反馈</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">价格选项</th><th className="px-3 py-2 text-right">次数</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(summary.premiumSurvey?.priceOptions || []).length ? (summary.premiumSurvey.priceOptions || []).map((row) => (
                  <tr key={row.key}><td className="px-3 py-2 text-slate-700">{row.key}</td><td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.count}</td></tr>
                )) : <tr><td colSpan={2} className="px-3 py-8 text-center text-slate-400">暂无价格反馈</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">PV / UV 趋势</h2>
            <span className="text-xs text-slate-400">近 {rangeDays} 天</span>
          </div>
          <div className="h-72 min-w-0">
            {summary.daily.some((d) => d.pv || d.uv) ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={CHART_INITIAL_DIMENSION}>
                <AreaChart data={summary.daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="pv" name="PV" stroke="#2563eb" fill="#dbeafe" isAnimationActive={false} />
                  <Area type="monotone" dataKey="uv" name="UV" stroke="#16a34a" fill="#dcfce7" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">功能使用</h2>
            <span className="text-xs text-slate-400">次数 / 人数</span>
          </div>
          <div className="h-72 min-w-0">
            {(summary.features || []).some((d) => d.value || d.users) ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={CHART_INITIAL_DIMENSION}>
                <BarChart data={summary.features || []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="key" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Bar dataKey="value" name="次数" fill="#6366f1" radius={[8, 8, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="users" name="人数" fill="#f59e0b" radius={[8, 8, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-bold text-slate-900">高访问页面</h2>
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">页面</th><th className="px-3 py-2 text-right">PV</th><th className="px-3 py-2 text-right">UV</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(summary.pages || []).length ? (summary.pages || []).map((row) => (
                  <tr key={row.key}><td className="px-3 py-2 text-slate-700">{row.key}</td><td className="px-3 py-2 text-right tabular-nums">{row.pv}</td><td className="px-3 py-2 text-right tabular-nums">{row.uv}</td></tr>
                )) : <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-400">暂无页面访问</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <UserRound className="h-4 w-4 text-indigo-500" />
            <h2 className="text-base font-bold text-slate-900">用户活跃列表</h2>
          </div>
          <div className="max-h-80 overflow-auto rounded-2xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0"><tr><th className="px-3 py-2 text-left">用户</th><th className="px-3 py-2 text-right">事件数</th><th className="px-3 py-2 text-right">最后活跃</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(summary.userActivity || []).length ? (summary.userActivity || []).map((row) => (
                  <tr key={row.user}>
                    <td className="px-3 py-2 font-semibold text-slate-800">{row.username || row.user}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.events}</td>
                    <td className="px-3 py-2 text-right text-xs text-slate-400">{row.lastActive ? new Date(row.lastActive).toLocaleString() : '-'}</td>
                  </tr>
                )) : <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-400">暂无用户活动</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <h2 className="text-base font-bold text-slate-900">按小时分布</h2>
            </div>
            <span className="text-xs text-slate-400">24h 活跃时段</span>
          </div>
          <div className="h-56 min-w-0">
            {(summary.hourlyActivity || []).some((d) => d.events) ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={CHART_INITIAL_DIMENSION}>
                <BarChart data={summary.hourlyActivity || []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(h) => `${h}时`} interval={2} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip labelFormatter={(h) => `${h}:00-${h}:59`} />
                  <Bar dataKey="events" name="事件数" fill="#f59e0b" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="users" name="用户数" fill="#6366f1" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-500" />
              <h2 className="text-base font-bold text-slate-900">按星期分布</h2>
            </div>
            <span className="text-xs text-slate-400">周活跃规律</span>
          </div>
          <div className="h-56 min-w-0">
            {(summary.dailyActivity || []).some((d) => d.events) ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={CHART_INITIAL_DIMENSION}>
                <BarChart data={(summary.dailyActivity || []).map((d) => ({ ...d, label: ['日', '一', '二', '三', '四', '五', '六'][d.dow] }))} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Bar dataKey="events" name="事件数" fill="#10b981" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="users" name="用户数" fill="#6366f1" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </div>
        </div>
      </section>

      <FeatureDetailsSection featureDetails={summary.featureDetails || []} />
    </div>
  );
}
