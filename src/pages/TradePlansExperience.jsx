import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, CalendarClock, Clock3, Layers3, Radar, Save, Sparkles } from 'lucide-react';
import { checkGcmConnection, loadNotifyEvents, loadNotifyStatus, persistNotifyClientConfig, readNotifyClientConfig, registerGcmClient, saveNotifySettings, sendNotifyTest, syncTradePlanRules } from '../app/notifySync.js';
import { buildTradePlanCenter } from '../app/tradePlans.js';
import { getPrimaryTabs } from '../app/screens.js';
import { Card, Field, PageHero, PageShell, PageTabs, Pill, SectionHeading, StatCard, TextInput, cx, inputClass, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';

function PlanStatusPill({ tone = 'slate', children }) {
  return <Pill tone={tone}>{children}</Pill>;
}

function formatEventTimeLabel(value = '') {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '--';
  }

  const normalized = rawValue.replace('T', ' ').slice(0, 16);
  return normalized || '--';
}

function resolveEventStatusMeta(status = '') {
  switch (status) {
    case 'delivered':
      return {
        label: '已送达',
        tone: 'emerald'
      };
    case 'failed':
      return {
        label: '发送失败',
        tone: 'red'
      };
    default:
      return {
        label: '未发送',
        tone: 'slate'
      };
  }
}

function resolveGcmCheckMeta(status = '') {
  switch (status) {
    case 'validated':
      return {
        label: '校验通过',
        tone: 'emerald'
      };
    case 'credentials-ready':
      return {
        label: '凭证可用',
        tone: 'amber'
      };
    case 'failed':
      return {
        label: '检查失败',
        tone: 'red'
      };
    default:
      return {
        label: '未检查',
        tone: 'slate'
      };
  }
}

export function TradePlansExperience({ links, embedded = false }) {
  const [selectedRowId, setSelectedRowId] = useState('');
  const [notifyStatus, setNotifyStatus] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [notifyError, setNotifyError] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isCheckingGcm, setIsCheckingGcm] = useState(false);
  const [isRegisteringGcm, setIsRegisteringGcm] = useState(false);
  const [notifyPlatform, setNotifyPlatform] = useState('android');
  const [notifyConfig, setNotifyConfig] = useState(() => {
    const persistedConfig = readNotifyClientConfig();

    return {
      gotifyBaseUrl: persistedConfig.gotifyBaseUrl || '',
      gotifyUsername: persistedConfig.gotifyUsername || '',
      gotifyPassword: persistedConfig.gotifyPassword || '',
      barkDeviceKey: persistedConfig.barkDeviceKey || '',
      gcmProjectId: persistedConfig.gcmProjectId || '',
      gcmPackageName: persistedConfig.gcmPackageName || '',
      gcmDeviceName: persistedConfig.gcmDeviceName || '',
      gcmToken: persistedConfig.gcmToken || ''
    };
  });
  const { previewRows, summary, hasPlans } = useMemo(() => buildTradePlanCenter(), []);
  const primaryTabs = getPrimaryTabs(links);
  const gcmSetup = notifyStatus?.setup || {};
  const gcmRegistrations = Array.isArray(gcmSetup?.gcmRegistrations) ? gcmSetup.gcmRegistrations : [];
  const gcmCheckMeta = resolveGcmCheckMeta(gcmSetup?.gcmLastCheckStatus);

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
        setNotifyConfig((current) => ({
          gotifyBaseUrl: statusPayload?.setup?.gotifyBaseUrl || current.gotifyBaseUrl || '',
          gotifyUsername: current.gotifyUsername || '',
          gotifyPassword: current.gotifyPassword || '',
          barkDeviceKey: current.barkDeviceKey || statusPayload?.setup?.barkDeviceKey || '',
          gcmProjectId: current.gcmProjectId || statusPayload?.setup?.gcmProjectId || '',
          gcmPackageName: current.gcmPackageName || statusPayload?.setup?.gcmPackageName || '',
          gcmDeviceName: current.gcmDeviceName || '',
          gcmToken: current.gcmToken || ''
        }));
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
    ? notifyStatus.configured?.bark || notifyStatus.configured?.gotify || notifyStatus.configured?.gcm
      ? '已配置'
      : '未配置'
    : summary.notificationStatus;
  const notificationNote = notifyStatus
    ? [
        notifyStatus.configured?.bark ? 'Bark 可发送' : null,
        notifyStatus.configured?.gotify ? 'Gotify 可发送' : null,
        notifyStatus.configured?.gcm ? `Android GCM 已注册 ${gcmSetup?.gcmRegistrationCount || 0} 台` : null
      ].filter(Boolean).join('；') || '请先配置 Bark，或完成 Android GCM 注册'
    : '提醒渠道和推送能力后续接入';
  const notifyChannelLabel = notifyStatus
    ? [
        notifyStatus.configured?.bark ? 'Bark' : null,
        notifyStatus.configured?.gotify ? 'Gotify' : null,
        notifyStatus.configured?.gcm ? `Android GCM (${gcmSetup?.gcmRegistrationCount || 0} 台已注册)` : null
      ].filter(Boolean).join(' / ') || '尚未配置通知通道'
    : selectedRow?.notificationMethod || '尚未配置通知通道';
  const selectedRowEvents = selectedRow
    ? recentEvents.filter((event) => (
      selectedRow.sourceType === 'plan'
        ? event.ruleId === `plan:${selectedRow.sourceId}`
        : String(event.ruleId || '').startsWith(`dca:${selectedRow.sourceId}:`)
    ))
    : [];

  async function refreshNotifyData() {
    const [statusPayload, eventsPayload] = await Promise.all([
      loadNotifyStatus(),
      loadNotifyEvents()
    ]);

    setNotifyStatus(statusPayload);
    setRecentEvents(Array.isArray(eventsPayload?.events) ? eventsPayload.events : []);
    setNotifyConfig((current) => ({
      ...current,
      gcmProjectId: current.gcmProjectId || statusPayload?.setup?.gcmProjectId || '',
      gcmPackageName: current.gcmPackageName || statusPayload?.setup?.gcmPackageName || ''
    }));
    setNotifyError('');
  }

  async function handleSyncRules() {
    setIsSyncing(true);
    setNotifyError('');
    setNotifyMessage('');
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
    setNotifyError('');
    setNotifyMessage('');
    try {
      await sendNotifyTest();
      await refreshNotifyData();
    } catch (error) {
      setNotifyError(error instanceof Error ? error.message : '测试通知发送失败');
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSaveNotifyConfig() {
    setIsSavingSettings(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await saveNotifySettings({
        barkDeviceKey: notifyConfig.barkDeviceKey
      });
      persistNotifyClientConfig({
        barkDeviceKey: notifyConfig.barkDeviceKey,
        gotifyBaseUrl: notifyConfig.gotifyBaseUrl,
        gotifyUsername: notifyConfig.gotifyUsername,
        gotifyPassword: notifyConfig.gotifyPassword,
        gcmProjectId: notifyConfig.gcmProjectId,
        gcmPackageName: notifyConfig.gcmPackageName,
        gcmDeviceName: notifyConfig.gcmDeviceName,
        gcmToken: notifyConfig.gcmToken
      });
      await refreshNotifyData();
      setNotifyMessage('Bark 配置已保存。');
    } catch (error) {
      setNotifyError(error instanceof Error ? error.message : '通知配置保存失败');
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleCheckGcm() {
    setIsCheckingGcm(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      const payload = await checkGcmConnection({
        projectId: notifyConfig.gcmProjectId,
        packageName: notifyConfig.gcmPackageName,
        deviceName: notifyConfig.gcmDeviceName,
        token: notifyConfig.gcmToken
      });
      persistNotifyClientConfig({
        barkDeviceKey: notifyConfig.barkDeviceKey,
        gotifyBaseUrl: notifyConfig.gotifyBaseUrl,
        gotifyUsername: notifyConfig.gotifyUsername,
        gotifyPassword: notifyConfig.gotifyPassword,
        gcmProjectId: notifyConfig.gcmProjectId,
        gcmPackageName: notifyConfig.gcmPackageName,
        gcmDeviceName: notifyConfig.gcmDeviceName,
        gcmToken: notifyConfig.gcmToken
      });
      await refreshNotifyData();
      setNotifyMessage(payload?.result?.detail || 'GCM 连接检查完成。');
    } catch (error) {
      setNotifyError(error instanceof Error ? error.message : 'GCM 连接检查失败');
    } finally {
      setIsCheckingGcm(false);
    }
  }

  async function handleRegisterGcm() {
    setIsRegisteringGcm(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      const payload = await registerGcmClient({
        projectId: notifyConfig.gcmProjectId,
        packageName: notifyConfig.gcmPackageName,
        deviceName: notifyConfig.gcmDeviceName,
        token: notifyConfig.gcmToken
      });
      persistNotifyClientConfig({
        barkDeviceKey: notifyConfig.barkDeviceKey,
        gotifyBaseUrl: notifyConfig.gotifyBaseUrl,
        gotifyUsername: notifyConfig.gotifyUsername,
        gotifyPassword: notifyConfig.gotifyPassword,
        gcmProjectId: notifyConfig.gcmProjectId,
        gcmPackageName: notifyConfig.gcmPackageName,
        gcmDeviceName: notifyConfig.gcmDeviceName,
        gcmToken: notifyConfig.gcmToken
      });
      await refreshNotifyData();
      setNotifyMessage(`Android GCM 注册成功，当前已登记 ${payload?.setup?.gcmRegistrationCount || 0} 台设备。`);
    } catch (error) {
      setNotifyError(error instanceof Error ? error.message : 'Android GCM 注册失败');
    } finally {
      setIsRegisteringGcm(false);
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

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.95fr)]">
        <Card className="min-w-0">
          <SectionHeading
            eyebrow="计划列表"
            title="后续交易计划"
            description="首页只保留每类计划一个待执行摘要，更多层级和完整配置去对应页面查看。"
            action={
              <div className="flex flex-wrap gap-2">
                <button
                  className={cx(
                    primaryButtonClass,
                    'bg-slate-900 text-white shadow-sm hover:bg-slate-800'
                  )}
                  type="button"
                  onClick={handleSyncRules}
                >
                  {isSyncing ? '正在同步规则' : '同步通知规则'}
                </button>
                <button
                  className={cx(
                    secondaryButtonClass,
                    'border-slate-300 bg-white shadow-sm hover:bg-slate-50'
                  )}
                  type="button"
                  onClick={handleTestNotify}
                >
                  {isTesting ? '正在发送' : '测试通知'}
                </button>
              </div>
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
          <Card className="min-w-0">
            <SectionHeading
              eyebrow="通知接入"
              title="消息推送配置"
              action={
                <div className="inline-flex items-center gap-1 rounded-2xl bg-slate-100 p-1">
                  <button
                    className={cx(
                      'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                      notifyPlatform === 'android' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    )}
                    type="button"
                    onClick={() => setNotifyPlatform('android')}
                  >
                    Android
                  </button>
                  <button
                    className={cx(
                      'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                      notifyPlatform === 'ios' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    )}
                    type="button"
                    onClick={() => setNotifyPlatform('ios')}
                  >
                    iOS
                  </button>
                </div>
              }
            />
            {notifyError ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {notifyError}
              </div>
            ) : null}
            {notifyMessage ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {notifyMessage}
              </div>
            ) : null}
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
              {notifyPlatform === 'android' ? (
                <>
                  <div className="text-sm font-semibold text-slate-900">Android App 注册管理</div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    普通用户不应该手动填 token。推荐直接安装 Android app 自动注册设备；这里保留给管理和调试使用，底层仍然按 Firebase registration token 做服务端检查。
                  </p>
                  <div className="mt-4 grid gap-3 xl:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Firebase Project</div>
                      <div className="mt-2 text-sm font-semibold text-slate-800">{gcmSetup?.gcmProjectId || notifyConfig.gcmProjectId || '未设置'}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">包名限制</div>
                      <div className="mt-2 text-sm font-semibold text-slate-800">{gcmSetup?.gcmPackageName || notifyConfig.gcmPackageName || '未设置'}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">服务账号</div>
                      <div className="mt-2 text-sm font-semibold text-slate-800">{gcmSetup?.gcmServiceAccountConfigured ? '已就绪' : '未配置'}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">已注册设备</div>
                      <div className="mt-2 text-sm font-semibold text-slate-800">{gcmSetup?.gcmRegistrationCount || 0} 台</div>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <Field label="Firebase Project ID" helper="连接检查会优先使用这里的 projectId，未填时再回退到 Worker 服务账号内的 project_id。">
                      <TextInput value={notifyConfig.gcmProjectId} onChange={(event) => setNotifyConfig((current) => ({ ...current, gcmProjectId: event.target.value }))} placeholder="例如：ai-dca-prod" />
                    </Field>
                    <Field label="Android 包名" helper="可选。填写后连接检查会带上 restrictedPackageName。">
                      <TextInput value={notifyConfig.gcmPackageName} onChange={(event) => setNotifyConfig((current) => ({ ...current, gcmPackageName: event.target.value }))} placeholder="例如：tech.freebacktrack.aidca" />
                    </Field>
                    <Field label="设备名称" helper="只是便于后台区分多个 Android 设备。">
                      <TextInput value={notifyConfig.gcmDeviceName} onChange={(event) => setNotifyConfig((current) => ({ ...current, gcmDeviceName: event.target.value }))} placeholder="例如：Pixel 9 Pro" />
                    </Field>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">最近检查</div>
                        <PlanStatusPill tone={gcmCheckMeta.tone}>{gcmCheckMeta.label}</PlanStatusPill>
                      </div>
                      <div className="mt-3 text-sm leading-6 text-slate-600">{gcmSetup?.gcmLastCheckDetail || '还没有执行过连接检查。'}</div>
                      <div className="mt-3 text-xs text-slate-400">{formatEventTimeLabel(gcmSetup?.gcmLastCheckAt)}</div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Field label="Registration Token" helper="把 Android 端 `FirebaseMessaging.getToken()` 返回的 token 粘贴到这里。">
                      <textarea
                        className={cx(inputClass, 'h-auto min-h-[132px] py-3 leading-6')}
                        value={notifyConfig.gcmToken}
                        onChange={(event) => setNotifyConfig((current) => ({ ...current, gcmToken: event.target.value }))}
                        placeholder="粘贴 Android 设备的 Firebase registration token"
                      />
                    </Field>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button className={primaryButtonClass} type="button" onClick={handleCheckGcm}>
                      {isCheckingGcm ? '正在检查 GCM 连接' : '检查 GCM 连接'}
                    </button>
                    <button className={subtleButtonClass} type="button" onClick={handleRegisterGcm}>
                      {isRegisteringGcm ? '正在注册设备' : '注册 Android 设备'}
                    </button>
                  </div>
                  <div className="mt-5 space-y-3">
                    {gcmRegistrations.length ? gcmRegistrations.map((registration) => {
                      const registrationMeta = resolveGcmCheckMeta(registration.lastCheckStatus);
                      return (
                        <div key={registration.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900">{registration.deviceName || 'Android Device'}</div>
                              <div className="mt-1 text-xs text-slate-400">{registration.tokenMasked || 'token 未展示'}</div>
                            </div>
                            <PlanStatusPill tone={registrationMeta.tone}>{registrationMeta.label}</PlanStatusPill>
                          </div>
                          <div className="mt-3 text-sm leading-6 text-slate-600">{registration.lastCheckDetail || '设备已登记，尚未执行单独校验。'}</div>
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                            <span>包名: {registration.packageName || '未设置'}</span>
                            <span>注册时间: {formatEventTimeLabel(registration.createdAt)}</span>
                            <span>最近检查: {formatEventTimeLabel(registration.lastCheckedAt)}</span>
                          </div>
                        </div>
                      );
                    }) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm leading-6 text-slate-500">
                        还没有 Android 设备注册记录。先填入 registration token，再执行连接检查或注册。
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold text-slate-900">iPhone Bark Key</div>
                  <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                    <Field label="Bark 设备 Key">
                      <TextInput value={notifyConfig.barkDeviceKey} onChange={(event) => setNotifyConfig((current) => ({ ...current, barkDeviceKey: event.target.value }))} />
                    </Field>
                    <button className={primaryButtonClass} type="button" onClick={handleSaveNotifyConfig}>
                      <Save className="h-4 w-4" />
                      {isSavingSettings ? '正在保存 Bark 配置' : '保存 Bark 配置'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card className="min-w-0">
            <SectionHeading
              eyebrow="计划详情"
              title={selectedRow?.detailTitle || '当前没有待查看计划'}
              description={selectedRow ? '右侧只展示当前选中计划的规则摘要、触发说明和最近提醒记录。' : '先在左侧选择一条交易计划，这里再展开对应的执行说明。'}
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
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Bell className="h-4 w-4 text-slate-400" />
                    通知方式
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{notifyChannelLabel}</p>
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
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
        <Card>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <CalendarClock className="h-4 w-4 text-slate-400" />
            提醒历史
          </div>
          <div className="mt-4 space-y-3">
            {recentEvents.length ? recentEvents.slice(0, 4).map((item) => {
              const statusMeta = resolveEventStatusMeta(item.status);
              return (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 text-sm font-semibold text-slate-800">{item.summary || item.title || '提醒记录'}</div>
                    <PlanStatusPill tone={statusMeta.tone}>{statusMeta.label}</PlanStatusPill>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">{item.body || item.title || '当前没有更多提醒内容。'}</div>
                  <div className="mt-2 text-xs text-slate-400">{formatEventTimeLabel(item.createdAt)}</div>
                </div>
              );
            }) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
                目前还没有提醒记录。触发测试通知或规则提醒后，这里会展示实际通知内容。
              </div>
            )}
          </div>
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
