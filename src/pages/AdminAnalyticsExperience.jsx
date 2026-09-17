import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  Globe,
  MousePointerClick,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  Wifi,
  WifiOff,
  Zap
} from 'lucide-react';
import { buildAnalyticsSummary, clearAnalyticsEvents, fetchRemoteAnalyticsSummary, isAnalyticsAdmin, trackAnalyticsEvent } from '../app/analytics.js';
import { triggerNetworkTrace, readLastNetworkTrace, getColoRegion } from '../app/networkTrace.js';
import { loadCloudSession } from '../app/authClient.js';
import { cx } from '../components/experience-ui.jsx';

const RANGE_OPTIONS = [
  { key: 7, label: '7 天' },
  { key: 30, label: '30 天' },
  { key: 90, label: '90 天' }
];
const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };

function Card({ title, value, icon: Icon, hint, badge, badgeColor }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-slate-500">{title}</div>
        <div className="flex items-center gap-1.5">
          {badge ? (
            <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', badgeColor || 'bg-slate-100 text-slate-700')}>
              {badge}
            </span>
          ) : null}
          {Icon ? <Icon className="h-4 w-4 text-slate-400" /> : null}
        </div>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs leading-5 text-slate-400">{hint}</div> : null}
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
      {!expanded && (
        <div className="mt-1 text-xs leading-5 text-slate-400">
          所选周期 notify_used / notify_enabled，按 userId 或 visitorId 去重
          {activePlatforms.length > 0 ? ` · ${activePlatforms.map((p) => `${p.label} ${p.count}`).join(' · ')}` : ''}
        </div>
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
          <div className="pt-1 text-xs leading-5 text-slate-400">总人数按所选周期的通知使用/启用事件，以 userId 或 visitorId 去重；平台内分别去重，未知/历史仅保留近 7 天仍无明确平台的用户</div>
        </div>
      )}
    </div>
  );
}

function EmptyChart({ message = '暂无统计数据' }) {
  return <div className="flex h-full items-center justify-center text-sm text-slate-400">{message}</div>;
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

// 实时连通自检卡片
function LiveNetworkProbeCard({ onRetestComplete }) {
  const [currentTrace, setCurrentTrace] = useState(() => readLastNetworkTrace());
  const [testing, setTesting] = useState(false);

  const handleTestNow = async () => {
    setTesting(true);
    try {
      const res = await triggerNetworkTrace({ force: true });
      setCurrentTrace(res);
      if (onRetestComplete) onRetestComplete(res);
    } catch {
      // ignore
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    if (!currentTrace) {
      handleTestNow();
    }
  }, []);

  const reachable = currentTrace?.cnReachable === true || currentTrace?.cnStatus === 'ok';
  const hasResult = Boolean(currentTrace?.ip || currentTrace?.colo);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className={cx(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-colors',
            !hasResult ? 'bg-slate-100 text-slate-500' : reachable ? 'bg-emerald-50 text-emerald-600 ring-4 ring-emerald-50' : 'bg-rose-50 text-rose-600 ring-4 ring-rose-50'
          )}>
            {testing ? (
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-600" />
            ) : reachable ? (
              <Wifi className="h-6 w-6" />
            ) : (
              <WifiOff className="h-6 w-6" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">当前客户端网络与连通自检</h2>
              {testing ? (
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 animate-pulse">
                  探测中…
                </span>
              ) : reachable ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> CN 域名连通正常
                </span>
              ) : hasResult ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                  <AlertCircle className="h-3.5 w-3.5" /> CN 访问受阻
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              自动通过 Cloudflare Trace 解析当前公网 IP 与接入边缘，并异步探测 cn.freebacktrack.tech:5000 端口连通性。
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleTestNow}
          disabled={testing}
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-700 transition-all hover:bg-indigo-100 active:scale-95 disabled:opacity-60"
        >
          {testing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {testing ? '正在测速…' : '重新测试连通性'}
        </button>
      </div>

      {hasResult && (
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 pt-3 border-t border-slate-100 text-xs">
          <div className="rounded-xl bg-slate-50 p-2.5">
            <span className="text-slate-400 block mb-0.5">公网 IP 地址</span>
            <span className="font-mono font-bold text-slate-800 text-sm">{currentTrace.ip || '未获取'}</span>
          </div>
          <div className="rounded-xl bg-slate-50 p-2.5">
            <span className="text-slate-400 block mb-0.5">Cloudflare 接入节点</span>
            <span className="font-semibold text-slate-800 text-sm truncate block" title={currentTrace.coloRegion}>
              {currentTrace.colo} · {currentTrace.coloRegion || getColoRegion(currentTrace.colo, currentTrace.loc)}
            </span>
          </div>
          <div className="rounded-xl bg-slate-50 p-2.5">
            <span className="text-slate-400 block mb-0.5">国家与地区</span>
            <span className="font-semibold text-slate-800 text-sm">
              {currentTrace.loc === 'CN' ? '🇨🇳 中国大陆 (CN)' : currentTrace.loc === 'HK' ? '🇭🇰 中国香港 (HK)' : currentTrace.loc || '未知'}
            </span>
          </div>
          <div className="rounded-xl bg-slate-50 p-2.5">
            <span className="text-slate-400 block mb-0.5">CN 域名延迟与状态</span>
            <span className={cx('font-bold text-sm', reachable ? 'text-emerald-600' : 'text-rose-600')}>
              {reachable ? (currentTrace.cnLatency ? `${currentTrace.cnLatency}ms (正常)` : '直连 (0ms)') : (currentTrace.cnError || '端口阻断/超时')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// 地区与网络连通看板视图
function NetworkConnectivityView({ summary, onRetestComplete }) {
  const network = summary?.network || { total: 0, successful: 0, failed: 0, successRate: 1, avgLatency: 0, regions: [], recent: [] };
  const [filterQuery, setFilterQuery] = useState('');
  const [onlyFailed, setOnlyFailed] = useState(false);

  const filteredRegions = useMemo(() => {
    let list = network.regions || [];
    if (onlyFailed) {
      list = list.filter((r) => r.failed > 0 || r.successRate < 1);
    }
    const q = filterQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        r.colo?.toLowerCase().includes(q) ||
        r.name?.toLowerCase().includes(q) ||
        r.loc?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [network.regions, filterQuery, onlyFailed]);

  const successRatePct = Math.round((network.successRate || 0) * 100);
  const successRateBadgeColor = successRatePct >= 95 ? 'bg-emerald-50 text-emerald-700' : successRatePct >= 80 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700';

  const cards = [
    { title: '探测总次数', value: formatCount(network.total), icon: Globe, hint: '所有接入客户端上报的连通探测总数' },
    {
      title: 'CN 域名连通率',
      value: `${successRatePct}%`,
      icon: Server,
      badge: successRatePct >= 95 ? '良好' : successRatePct >= 80 ? '部分异常' : '严重阻断',
      badgeColor: successRateBadgeColor,
      hint: `成功连通 ${formatCount(network.successful)} 次，受阻 ${formatCount(network.failed)} 次`
    },
    {
      title: '异常/阻断次数',
      value: formatCount(network.failed),
      icon: AlertCircle,
      badge: network.failed > 0 ? `${network.failed} 次受阻` : '无阻断',
      badgeColor: network.failed > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700',
      hint: '由于 5000 端口受阻或运营商超时导致的不通'
    },
    { title: '平均连通延迟', value: network.avgLatency ? `${network.avgLatency}ms` : '-', icon: Clock, hint: '成功连通探测的平均 TCP/HTTP 耗时' },
    { title: '覆盖节点与地区', value: `${(network.regions || []).length} 个`, icon: Activity, hint: '涵盖的 Cloudflare 边缘节点及省市' },
    {
      title: '异常地区数',
      value: `${(network.regions || []).filter((r) => r.failed > 0).length} 个`,
      icon: ShieldAlert,
      hint: '存在至少一次连通失败记录的地区/节点'
    }
  ];

  return (
    <div className="space-y-4">
      <LiveNetworkProbeCard onRetestComplete={onRetestComplete} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => <Card key={c.title} {...c} />)}
      </section>

      {/* 地区与节点连通性分布表 */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-900">地区与 Cloudflare 节点连通分布</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              按各省市边缘节点汇总探测表现，帮助排查哪些地区或运营商打不开 cn 域名。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="搜索地区或节点代码 (如 上海, SJW)..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="rounded-full border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-indigo-500 focus:outline-none w-56"
              />
            </div>
            <button
              type="button"
              onClick={() => setOnlyFailed((v) => !v)}
              className={cx(
                'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                onlyFailed ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              仅看异常地区 ({ (network.regions || []).filter((r) => r.failed > 0).length })
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-100">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-48 sm:w-64" />
              <col className="w-16" />
              <col className="w-18" />
              <col className="w-18" />
              <col className="w-36" />
              <col className="w-24" />
              <col className="w-28" />
            </colgroup>
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3.5 py-2.5 text-left font-semibold">节点 / 地区</th>
                <th className="px-2 py-2.5 text-center font-semibold">位置</th>
                <th className="px-2 py-2.5 text-right font-semibold">探测次数</th>
                <th className="px-2 py-2.5 text-right font-semibold">独立 IP</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">连通率</th>
                <th className="px-2 py-2.5 text-right font-semibold">平均延迟</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">状态与异常原因</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRegions.length > 0 ? (
                filteredRegions.map((row) => {
                  const ratePct = Math.round((row.successRate || 0) * 100);
                  const isHealthy = row.failed === 0;
                  const isSevere = ratePct < 50;
                  return (
                    <tr key={`${row.colo}_${row.loc}`} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-700">
                            {row.colo}
                          </span>
                          <span className="font-semibold text-slate-800 truncate" title={row.name}>
                            {row.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center text-xs font-mono text-slate-500">
                        {row.loc}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums text-slate-700 font-medium">
                        {formatCount(row.total)}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums text-slate-500 text-xs">
                        {row.uniqueIps || '-'}
                      </td>
                      <td className="px-3.5 py-3">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className={cx('font-bold', isHealthy ? 'text-emerald-700' : isSevere ? 'text-rose-700' : 'text-amber-700')}>
                              {ratePct}%
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {row.successful}/{row.total}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden flex">
                            <div
                              className="h-full bg-emerald-500 transition-all"
                              style={{ width: `${ratePct}%` }}
                            />
                            {row.failed > 0 && (
                              <div
                                className="h-full bg-rose-500 transition-all"
                                style={{ width: `${100 - ratePct}%` }}
                              />
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums font-mono text-xs text-slate-600">
                        {row.avgLatency != null ? `${row.avgLatency}ms` : '-'}
                      </td>
                      <td className="px-3.5 py-3 text-xs">
                        {isHealthy ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" /> 全部正常
                          </span>
                        ) : (
                          <div className="space-y-0.5">
                            <span className={cx('inline-flex items-center gap-1 font-semibold', isSevere ? 'text-rose-600' : 'text-amber-600')}>
                              <AlertCircle className="h-3.5 w-3.5" /> {row.failed} 次受阻
                            </span>
                            {row.topError ? (
                              <span className="block text-[11px] text-slate-400 truncate max-w-[200px]" title={row.topError}>
                                {row.topError}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-400">
                    {filterQuery || onlyFailed ? '无符合条件的地区或节点' : '暂无连通探测数据'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 最近探测流水明细 */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">最近探测流水明细</h2>
          </div>
          <span className="text-xs text-slate-400">最近 50 条连通记录</span>
        </div>

        <div className="max-h-96 overflow-auto rounded-2xl border border-slate-100">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-36" />
              <col className="w-36" />
              <col className="w-48" />
              <col className="w-44" />
              <col className="w-24" />
              <col className="w-20" />
              <col />
            </colgroup>
            <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">时间</th>
                <th className="px-3 py-2 text-left font-semibold">客户端 IP</th>
                <th className="px-3 py-2 text-left font-semibold">CF 节点 / 地区</th>
                <th className="px-3 py-2 text-left font-semibold">访问域名</th>
                <th className="px-3 py-2 text-center font-semibold">状态</th>
                <th className="px-3 py-2 text-right font-semibold">耗时</th>
                <th className="px-3 py-2 text-left font-semibold">诊断与错误</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(network.recent || []).length > 0 ? (
                (network.recent || []).map((item) => {
                  const reachable = item.cnReachable === true || item.cnStatus === 'ok';
                  return (
                    <tr key={item.id || `${item.createdAt}_${item.ip}`} className="hover:bg-slate-50/60 transition-colors text-xs">
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                        {item.createdAt ? new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono font-medium text-slate-700">
                        {item.ip || '未获取'}
                      </td>
                      <td className="px-3 py-2 text-slate-800 font-medium truncate" title={item.coloRegion || getColoRegion(item.colo, item.loc)}>
                        <span className="font-mono font-bold mr-1 text-slate-600">{item.colo}</span>
                        {item.coloRegion || getColoRegion(item.colo, item.loc)}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-500 truncate" title={item.currentHost}>
                        {item.currentHost || '外部访问'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {reachable ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" /> 连通
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                            <AlertCircle className="h-3 w-3" /> 受阻
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                        {item.cnLatency ? `${item.cnLatency}ms` : '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-500 truncate" title={item.cnError}>
                        {reachable ? <span className="text-slate-400">正常响应</span> : <span className="text-rose-600 font-medium">{item.cnError || '连接失败'}</span>}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    暂无近期连通流水
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function AdminAnalyticsExperience({ embedded = false, initialView = 'overview' } = {}) {
  const [rangeDays, setRangeDays] = useState(30);
  const [activeView, setActiveView] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const v = p.get('view');
      if (v === 'network') return 'network';
    }
    return initialView || 'overview';
  });
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
    window.addEventListener('network-trace:completed', refresh);
    return () => {
      window.removeEventListener('analytics:changed', refresh);
      window.removeEventListener('network-trace:completed', refresh);
    };
  }, []);

  useEffect(() => {
    if (isAdmin) trackAnalyticsEvent('admin_dashboard_view', { rangeDays, view: activeView });
  }, [isAdmin, rangeDays, activeView]);

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
    { title: '注册人数', value: summary.cards.registeredUsers, icon: Users, hint: '全部历史 user_register / user_login 事件，按 userId 或 username 去重' },
    { title: '访客总人数', value: summary.cards.visitorUsers || 0, icon: UserRound, hint: '全部历史未登录事件，按 visitorId 去重' },
    { title: '日活用户', value: summary.cards.dailyActiveUsers || 0, icon: Activity, hint: `${summary.cards.dailyActiveDate ? summary.cards.dailyActiveDate.slice(5) : '最近一天'} 按 userId 或 visitorId 去重（排除后台切换任务）；所选 ${rangeDays} 天日均 ${formatCount(summary.cards.avgDailyActiveUsers, 1)}` },
    { title: 'PV', value: summary.cards.pv, icon: Eye, hint: `所选 ${rangeDays} 天 page_view 事件总次数` },
    { title: 'UV', value: summary.cards.uv, icon: MousePointerClick, hint: `所选 ${rangeDays} 天 page_view 事件，按 visitorId 去重` },
    { title: '会话数', value: summary.engagement?.sessions || 0, icon: Activity, hint: `所选 ${rangeDays} 天 session_start 次数；用户按 userId/visitorId 去重 ${summary.engagement?.sessionUsers || 0}，心跳 session_heartbeat ${summary.engagement?.heartbeats || 0}` },
    { title: '平均活跃', value: formatDuration(summary.engagement?.avgActiveTimeMs), icon: Clock, hint: `所选 ${rangeDays} 天 page_engagement 的 activeTimeMs 平均值；maxScrollPct 平均 ${Math.round(Number(summary.engagement?.avgScrollPct) || 0)}%` }
  ];

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                <Activity className="h-3.5 w-3.5" />管理员数据中心
              </div>
              {/* 顶栏视角切换 Tabs */}
              <div className="inline-flex items-center rounded-full bg-slate-100 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setActiveView('overview')}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors',
                    activeView === 'overview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  )}
                >
                  <BarChart3 className="h-3.5 w-3.5" /> 站点与功能统计
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('network')}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors',
                    activeView === 'network' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  )}
                >
                  <Globe className="h-3.5 w-3.5" /> 地区与网络连通看板
                  {summary.network?.failed > 0 && (
                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                  )}
                </button>
              </div>
            </div>

            <h1 className="mt-3 text-2xl font-bold text-slate-900">
              {activeView === 'network' ? '地区与网络连通看板 (CN可达性)' : '站点与功能统计'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {activeView === 'network'
                ? '异步采集各地区用户的 IP、Cloudflare 边缘节点及 cn.freebacktrack.tech:5000 连通状况，快速定位打不开的省份与网络阻断。'
                : '展示站内功能统计；远程汇总失败时回落本地轻量事件。'}
            </p>
            <div className="mt-2 text-xs text-slate-400">
              {remoteStatus === 'ready' ? '数据源：远程 D1 汇总' : remoteStatus === 'loading' ? '正在读取远程统计…' : `数据源：本地事件${remoteError ? ` · ${remoteError}` : ''}`}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {RANGE_OPTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setRangeDays(item.key)}
                className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', rangeDays === item.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setRemoteSummary(null); setVersion((v) => v + 1); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />刷新
            </button>
            <button
              type="button"
              onClick={() => { if (window.confirm('确认清空本地统计事件？')) clearAnalyticsEvents(); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" />清空
            </button>
          </div>
        </div>
      </header>

      {activeView === 'network' ? (
        <NetworkConnectivityView
          summary={summary}
          onRetestComplete={() => setVersion((v) => v + 1)}
        />
      ) : (
        <>
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
                  <colgroup><col /><col className="w-14" /><col className="w-14" /></colgroup>
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
              <div className="mb-3 flex items-center gap-2"><UserRound className="h-4 w-4 text-indigo-500" /><h2 className="text-base font-bold text-slate-900">用户活跃列表</h2></div>
              <div className="max-h-80 overflow-auto rounded-2xl border border-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300" tabIndex={0} aria-label="用户活跃列表滚动区域">
                <table className="w-full table-fixed text-sm">
                  <colgroup><col /><col className="w-16" /><col className="w-28" /></colgroup>
                  <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0"><tr><th className="px-3 py-2 text-left">用户</th><th className="px-3 py-2 text-right">事件数</th><th className="px-3 py-2 text-right">最后活跃</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(summary.userActivity || []).length ? (summary.userActivity || []).map((row) => (
                      <tr key={row.user}><td className="break-all px-3 py-2 font-semibold text-slate-800">{row.username || row.user}</td><td className="px-3 py-2 text-right tabular-nums text-slate-600">{row.events}</td><td className="px-3 py-2 text-right text-xs text-slate-400">{row.lastActive ? new Date(row.lastActive).toLocaleString() : '-'}</td></tr>
                    )) : <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-400">暂无用户活动</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Clock className="h-4 w-4 text-amber-500" /><h2 className="text-base font-bold text-slate-900">按小时分布</h2></div><span className="text-xs text-slate-400">24h 活跃时段</span></div>
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
              <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-emerald-500" /><h2 className="text-base font-bold text-slate-900">按星期分布</h2></div><span className="text-xs text-slate-400">周活跃规律</span></div>
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
        </>
      )}
    </div>
  );
}
