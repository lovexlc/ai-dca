import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Bell, Bot, Calendar, ChevronDown, Clock, Eye, MousePointerClick, RefreshCw, ShieldCheck, Shuffle, Trash2, UserRound, Users } from 'lucide-react';
import { buildAnalyticsSummary, clearAnalyticsEvents, fetchRemoteAnalyticsSummary, isAnalyticsAdmin, trackAnalyticsEvent } from '../app/analytics.js';
import { loadCloudSession } from '../app/authClient.js';
import { cx } from '../components/experience-ui.jsx';

const RANGE_OPTIONS = [
  { key: 7, label: '7 天' },
  { key: 30, label: '30 天' },
  { key: 90, label: '90 天' }
];
const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };
const UMAMI_SHARE_URL = 'https://cloud.umami.is/analytics/us/share/xnYvpAacsvCInEHo';

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

function formatCount(value, digits = 0) {
  const num = Number(value) || 0;
  return num.toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function formatDuration(ms) {
  const seconds = Math.round((Number(ms) || 0) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function AdminAnalyticsExperience({ embedded = false } = {}) {
  const [rangeDays, setRangeDays] = useState(30);
  const [version, setVersion] = useState(0);
  const [remoteSummary, setRemoteSummary] = useState(null);
  const [remoteStatus, setRemoteStatus] = useState('idle');
  const [remoteError, setRemoteError] = useState('');
  const session = loadCloudSession();
  const isAdmin = isAnalyticsAdmin(session);
  const localSummary = useMemo(() => {
    void version;
    return buildAnalyticsSummary({ rangeDays });
  }, [rangeDays, version]);
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
    { title: '注册人数', value: summary.cards.registeredUsers, icon: Users, hint: '注册账号去重' },
    { title: '访客总人数', value: summary.cards.visitorUsers || 0, icon: UserRound, hint: '未登录 visitor 去重' },
    { title: '日活用户', value: summary.cards.dailyActiveUsers || 0, icon: Activity, hint: `日均 ${formatCount(summary.cards.avgDailyActiveUsers, 1)} · ${summary.cards.dailyActiveDate ? summary.cards.dailyActiveDate.slice(5) : '最近一天'}` },
    { title: 'PV', value: summary.cards.pv, icon: Eye, hint: `${rangeDays} 天页面访问` },
    { title: 'UV', value: summary.cards.uv, icon: MousePointerClick, hint: '按访客 ID 去重' },
    { title: 'Worker 跑切换', value: summary.cards.switchRuns, icon: Shuffle, hint: '切换运行/使用次数' },
    { title: 'AI 使用人数', value: summary.cards.aiUsers, icon: Bot, hint: '发送 AI 请求用户' },
    { title: '会话数', value: summary.engagement?.sessions || 0, icon: Activity, hint: `用户 ${summary.engagement?.sessionUsers || 0} · 心跳 ${summary.engagement?.heartbeats || 0}` },
    { title: '平均活跃', value: formatDuration(summary.engagement?.avgActiveTimeMs), icon: Clock, hint: `平均滚动 ${Math.round(Number(summary.engagement?.avgScrollPct) || 0)}%` }
  ];

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700"><Activity className="h-3.5 w-3.5" />管理员数据看板</div>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">站点与功能统计</h1>
            <p className="mt-1 text-sm text-slate-500">嵌入 Umami 共享看板，并保留站内功能统计；远程汇总失败时回落本地轻量事件。</p>
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

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Umami 访问统计</h2>
            <p className="mt-1 text-xs text-slate-400">来自 Umami Share URL 的公开统计看板</p>
          </div>
          <a className="text-xs font-semibold text-indigo-600 hover:text-indigo-700" href={UMAMI_SHARE_URL} target="_blank" rel="noreferrer">打开原始看板</a>
        </div>
        <div className="h-[720px] bg-slate-50 sm:h-[820px] lg:h-[900px]">
          <iframe
            title="Umami 共享统计看板"
            src={UMAMI_SHARE_URL}
            className="h-full w-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => <Card key={card.title} {...card} />)}
        <NotifyCard total={summary.cards.notifyUsers} platformUsers={summary.cards.notifyPlatformUsers} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">PV / UV / 活跃用户趋势</h2>
            <span className="text-xs text-slate-400">近 {rangeDays} 天</span>
          </div>
          <div className="h-72 min-w-0">
            {summary.daily.some((d) => d.pv || d.uv || d.activeUsers) ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={CHART_INITIAL_DIMENSION}>
                <AreaChart data={summary.daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="pv" name="PV" stroke="#2563eb" fill="#dbeafe" isAnimationActive={false} />
                  <Area type="monotone" dataKey="uv" name="UV" stroke="#16a34a" fill="#dcfce7" isAnimationActive={false} />
                  <Area type="monotone" dataKey="activeUsers" name="活跃用户" stroke="#f59e0b" fill="#fef3c7" isAnimationActive={false} />
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

      <section className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-bold text-slate-900">高访问页面</h2>
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col />
                <col className="w-14" />
                <col className="w-14" />
              </colgroup>
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">页面</th><th className="px-3 py-2 text-right">PV</th><th className="px-3 py-2 text-right">UV</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(summary.pages || []).length ? (summary.pages || []).map((row) => (
                  <tr key={row.key}><td className="break-all px-3 py-2 text-slate-700">{row.key}</td><td className="px-3 py-2 text-right tabular-nums">{row.pv}</td><td className="px-3 py-2 text-right tabular-nums">{row.uv}</td></tr>
                )) : <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-400">暂无页面访问</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <UserRound className="h-4 w-4 text-indigo-500" />
            <h2 className="text-base font-bold text-slate-900">用户活跃列表</h2>
          </div>
          <div
            className="max-h-80 overflow-auto rounded-2xl border border-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            tabIndex={0}
            aria-label="用户活跃列表滚动区域"
          >
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col />
                <col className="w-16" />
                <col className="w-28" />
              </colgroup>
              <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0"><tr><th className="px-3 py-2 text-left">用户</th><th className="px-3 py-2 text-right">事件数</th><th className="px-3 py-2 text-right">最后活跃</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(summary.userActivity || []).length ? (summary.userActivity || []).map((row) => (
                  <tr key={row.user}>
                    <td className="break-all px-3 py-2 font-semibold text-slate-800">{row.username || row.user}</td>
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

    </div>
  );
}
