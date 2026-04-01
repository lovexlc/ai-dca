import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, CalendarClock, Layers3, Radar, Save, Sparkles, Trash2 } from 'lucide-react';
import { issueNotifyGroupShareCode, joinNotifyGroup, loadNotifyEvents, loadNotifyStatus, pairAndroidDevice, persistNotifyClientConfig, readNotifyClientConfig, saveNotifySettings, sendNotifyTest, syncTradePlanRules, unpairAndroidDevice } from '../app/notifySync.js';
import { buildTradePlanCenter } from '../app/tradePlans.js';
import { getPrimaryTabs } from '../app/screens.js';
import { showActionToast } from '../app/toast.js';
import { Card, Field, PageHero, PageShell, PageTabs, Pill, SectionHeading, StatCard, TextInput, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

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

function buildRuleDetailUrl(row) {
  if (typeof window === 'undefined') {
    return '';
  }

  const url = new URL('/index.html', window.location.origin);
  url.searchParams.set('tab', row?.sourceType === 'dca' ? 'dca' : 'tradePlans');

  if (String(row?.ruleId || '').trim()) {
    url.searchParams.set('ruleId', String(row.ruleId).trim());
  }

  return url.toString();
}

function extractPurchaseAmount(row) {
  const summary = String(row?.detailSummary || '').trim();
  const match = summary.match(/[¥$]\s?\d+(?:\.\d+)?/);
  return match ? match[0].replace(/\s+/g, '') : '';
}

export function TradePlansExperience({ links, embedded = false }) {
  const [selectedRowId, setSelectedRowId] = useState('');
  const [notifyStatus, setNotifyStatus] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [notifyError, setNotifyError] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [testingRowId, setTestingRowId] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isPairingAndroid, setIsPairingAndroid] = useState(false);
  const [unpairingRegistrationId, setUnpairingRegistrationId] = useState('');
  const [isIssuingNotifyGroupShareCode, setIsIssuingNotifyGroupShareCode] = useState(false);
  const [isJoiningNotifyGroup, setIsJoiningNotifyGroup] = useState(false);
  const [notifyPlatform, setNotifyPlatform] = useState('ios');
  const [androidPairingCode, setAndroidPairingCode] = useState('');
  const [notifyGroupShareCode, setNotifyGroupShareCode] = useState('');
  const [notifyGroupShareExpiresAt, setNotifyGroupShareExpiresAt] = useState('');
  const [notifyGroupJoinCode, setNotifyGroupJoinCode] = useState('');
  const [notifyConfig, setNotifyConfig] = useState(() => {
    const persistedConfig = readNotifyClientConfig();

    return {
      barkDeviceKey: persistedConfig.barkDeviceKey || '',
      notifyClientId: persistedConfig.notifyClientId || '',
      notifyClientLabel: persistedConfig.notifyClientLabel || ''
    };
  });
  const { previewRows, summary, hasPlans } = useMemo(() => buildTradePlanCenter(), []);
  const primaryTabs = getPrimaryTabs(links);
  const androidSetup = notifyStatus?.setup || null;
  const pairedAndroidDevices = Array.isArray(androidSetup?.gcmCurrentClientRegistrations)
    ? androidSetup.gcmCurrentClientRegistrations
    : [];
  const notifyGroupId = String(androidSetup?.notifyGroupId || notifyConfig.notifyClientId || '').trim();
  const notifyGroupMemberCount = Math.max(Number(androidSetup?.notifyGroupMemberCount) || 0, notifyGroupId ? 1 : 0);
  const barkConfigured = Boolean(notifyStatus?.configured?.bark);
  const androidConfigured = pairedAndroidDevices.length > 0;

  useEffect(() => {
    let cancelled = false;

    async function refreshNotifyPanel() {
      try {
        const [statusPayload, eventsPayload] = await Promise.all([
          loadNotifyStatus(notifyConfig.notifyClientId),
          loadNotifyEvents()
        ]);

        if (cancelled) {
          return;
        }

        setNotifyStatus(statusPayload);
        setRecentEvents(Array.isArray(eventsPayload?.events) ? eventsPayload.events : []);
        setNotifyConfig((current) => ({
          ...current,
          barkDeviceKey: current.barkDeviceKey || statusPayload?.setup?.barkDeviceKey || ''
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
  }, [notifyConfig.notifyClientId]);

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
    ? barkConfigured || androidConfigured ? '已配置' : '未配置'
    : summary.notificationStatus;
  const notificationNote = notifyStatus
    ? barkConfigured && androidConfigured
      ? 'iOS Bark 与当前共享组已配对 Android 设备都可发送'
      : barkConfigured
        ? 'Bark 可发送'
        : androidConfigured
          ? '当前共享组已关联 Android 设备'
          : '请先配置 iOS Bark 或绑定 Android 设备'
    : '提醒渠道和推送能力后续接入';
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

  async function refreshNotifyData() {
    const [statusPayload, eventsPayload] = await Promise.all([
      loadNotifyStatus(notifyConfig.notifyClientId),
      loadNotifyEvents()
    ]);

    setNotifyStatus(statusPayload);
    setRecentEvents(Array.isArray(eventsPayload?.events) ? eventsPayload.events : []);
    setNotifyConfig((current) => ({
      ...current,
      barkDeviceKey: current.barkDeviceKey || statusPayload?.setup?.barkDeviceKey || ''
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
      showActionToast('同步通知规则', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '通知规则同步失败';
      setNotifyError(message);
      showActionToast('同步通知规则', 'error', {
        description: message
      });
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleTestNotify(row) {
    if (!row?.id) {
      return;
    }

    setTestingRowId(row.id);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await sendNotifyTest({
        clientId: notifyConfig.notifyClientId,
        ...buildRowTestPayload(row)
      });
      await refreshNotifyData();
      setNotifyMessage(`已发送「${row.planName}」的测试通知。`);
      showActionToast('测试通知', 'success', {
        description: `已发送「${row.planName}」的测试通知。`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '测试通知发送失败';
      setNotifyError(message);
      showActionToast('测试通知', 'error', {
        description: message
      });
    } finally {
      setTestingRowId('');
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
        barkDeviceKey: notifyConfig.barkDeviceKey
      });
      await refreshNotifyData();
      setNotifyMessage('Bark 配置已保存。');
      showActionToast('保存 Bark 配置', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '通知配置保存失败';
      setNotifyError(message);
      showActionToast('保存 Bark 配置', 'error', {
        description: message
      });
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handlePairAndroidCode() {
    setIsPairingAndroid(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await pairAndroidDevice({
        pairingCode: androidPairingCode,
        clientId: notifyConfig.notifyClientId,
        clientName: notifyConfig.notifyClientLabel
      });
      persistNotifyClientConfig({
        notifyClientId: notifyConfig.notifyClientId,
        notifyClientLabel: notifyConfig.notifyClientLabel
      });
      setAndroidPairingCode('');
      await refreshNotifyData();
      setNotifyMessage('Android 设备已绑定到当前共享组。');
      showActionToast('绑定 Android 设备', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Android 设备绑定失败';
      setNotifyError(message);
      showActionToast('绑定 Android 设备', 'error', {
        description: message
      });
    } finally {
      setIsPairingAndroid(false);
    }
  }

  async function handleUnpairAndroidRegistration(registrationId = '') {
    if (!registrationId) {
      return;
    }

    setUnpairingRegistrationId(registrationId);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await unpairAndroidDevice({
        registrationId,
        clientId: notifyConfig.notifyClientId
      });
      await refreshNotifyData();
      setNotifyMessage('Android 设备已从当前共享组解绑，组内浏览器都会停止共享这台设备。');
      showActionToast('解绑共享组 Android', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Android 设备解绑失败';
      setNotifyError(message);
      showActionToast('解绑共享组 Android', 'error', {
        description: message
      });
    } finally {
      setUnpairingRegistrationId('');
    }
  }

  async function handleIssueNotifyGroupShareCode() {
    setIsIssuingNotifyGroupShareCode(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      const payload = await issueNotifyGroupShareCode({
        clientId: notifyConfig.notifyClientId,
        clientLabel: notifyConfig.notifyClientLabel
      });
      setNotifyGroupShareCode(String(payload?.shareGroup?.code || '').trim());
      setNotifyGroupShareExpiresAt(String(payload?.shareGroup?.expiresAt || '').trim());
      await refreshNotifyData();
      setNotifyMessage('通知共享码已生成，可在其他浏览器加入当前共享组。');
      showActionToast('生成通知共享码', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成通知共享码失败';
      setNotifyError(message);
      showActionToast('生成通知共享码', 'error', {
        description: message
      });
    } finally {
      setIsIssuingNotifyGroupShareCode(false);
    }
  }

  async function handleJoinNotifyGroup() {
    setIsJoiningNotifyGroup(true);
    setNotifyError('');
    setNotifyMessage('');
    try {
      await joinNotifyGroup({
        shareCode: notifyGroupJoinCode,
        clientId: notifyConfig.notifyClientId,
        clientLabel: notifyConfig.notifyClientLabel
      });
      setNotifyGroupJoinCode('');
      setNotifyGroupShareCode('');
      setNotifyGroupShareExpiresAt('');
      await refreshNotifyData();
      setNotifyMessage('当前浏览器已加入通知共享组，可直接复用同组 Android 设备。');
      showActionToast('加入通知共享组', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '加入通知共享组失败';
      setNotifyError(message);
      showActionToast('加入通知共享组', 'error', {
        description: message
      });
    } finally {
      setIsJoiningNotifyGroup(false);
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
                      notifyPlatform === 'ios' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    )}
                    type="button"
                    onClick={() => setNotifyPlatform('ios')}
                  >
                    iOS
                  </button>
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
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
                    <div className="text-sm font-semibold text-slate-900">当前浏览器与通知共享组</div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Android app 会向 Worker 申请 8 位配对码。把 app 里显示的配对码填到这里后，这台设备会绑定到当前通知共享组。其他浏览器只要加入同一共享组，就能直接复用这台 Android app。
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">浏览器标签</div>
                        <div className="mt-2 text-sm font-semibold text-slate-700">{notifyConfig.notifyClientLabel}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">共享组成员</div>
                        <div className="mt-2 text-sm font-semibold text-slate-700">{notifyGroupMemberCount || '--'} 个浏览器</div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">已关联设备</div>
                        <div className="mt-2 text-sm font-semibold text-slate-700">{pairedAndroidDevices.length} 台</div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-slate-950 px-4 py-3 font-mono text-xs text-slate-100">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">浏览器 uniqId</div>
                        <div className="mt-2">{notifyConfig.notifyClientId}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-950 px-4 py-3 font-mono text-xs text-slate-100">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">通知共享组 ID</div>
                        <div className="mt-2">{notifyGroupId || '--'}</div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                      <Field label="加入通知共享组">
                        <TextInput
                          value={notifyGroupJoinCode}
                          placeholder="输入另一台浏览器生成的 8 位共享码"
                          onChange={(event) => setNotifyGroupJoinCode(String(event.target.value || '').replace(/\s+/g, '').toUpperCase())}
                        />
                      </Field>
                      <button className={primaryButtonClass} type="button" onClick={handleJoinNotifyGroup}>
                        <Save className="h-4 w-4" />
                        {isJoiningNotifyGroup ? '正在加入共享组' : '加入共享组'}
                      </button>
                    </div>
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">通知共享码</div>
                          <div className="mt-2 font-mono text-lg font-semibold text-slate-900">{notifyGroupShareCode || '--------'}</div>
                          <div className="mt-2 text-xs text-slate-500">
                            {notifyGroupShareExpiresAt ? `有效期至 ${formatEventTimeLabel(notifyGroupShareExpiresAt)}` : '生成后可在其他浏览器加入当前共享组'}
                          </div>
                        </div>
                        <button className={secondaryButtonClass} type="button" onClick={handleIssueNotifyGroupShareCode}>
                          {isIssuingNotifyGroupShareCode ? '正在生成共享码' : '生成共享码'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                    <Field label="Android 配对码">
                      <TextInput
                        value={androidPairingCode}
                        placeholder="在 Android app 中查看 8 位配对码"
                        onChange={(event) => setAndroidPairingCode(String(event.target.value || '').replace(/\s+/g, '').toUpperCase())}
                      />
                    </Field>
                    <button className={primaryButtonClass} type="button" onClick={handlePairAndroidCode}>
                      <Save className="h-4 w-4" />
                      {isPairingAndroid ? '正在绑定 Android 设备' : '绑定 Android 设备'}
                    </button>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">当前共享组已关联的 Android 设备</div>
                      <Pill tone={pairedAndroidDevices.length ? 'emerald' : 'slate'}>
                        {pairedAndroidDevices.length ? `${pairedAndroidDevices.length} 台已关联` : '未关联'}
                      </Pill>
                    </div>
                    {pairedAndroidDevices.length ? (
                      <div className="mt-4 space-y-3">
                        {pairedAndroidDevices.map((registration) => (
                          <div key={registration.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-900">{registration.deviceName || 'Android Device'}</div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Pill tone={registration.lastCheckStatus === 'validated' ? 'emerald' : 'slate'}>
                                  {registration.lastCheckStatus === 'validated' ? 'FCM 已校验' : registration.lastCheckStatus || '待校验'}
                                </Pill>
                                <button
                                  className={cx(
                                    secondaryButtonClass,
                                    'border-rose-200 bg-white px-3 text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60'
                                  )}
                                  type="button"
                                  disabled={unpairingRegistrationId === registration.id}
                                  onClick={() => handleUnpairAndroidRegistration(registration.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {unpairingRegistrationId === registration.id ? '正在解绑' : '解绑共享组'}
                                </button>
                              </div>
                            </div>
                            <div className="mt-2 text-sm text-slate-500">{registration.packageName || androidSetup?.gcmPackageName || '未记录包名'}</div>
                            <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                              <div>Android uniqId: {registration.deviceInstallationId || registration.id || '--'}</div>
                              <div>Token: {registration.tokenMasked || '--'}</div>
                              <div>绑定时间: {formatEventTimeLabel(registration.updatedAt || registration.createdAt)}</div>
                              <div>最近校验: {formatEventTimeLabel(registration.lastCheckedAt)}</div>
                              <div>配对状态: {registration.pairedToCurrentClient ? '当前共享组已绑定' : '未绑定'}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm leading-6 text-slate-500">
                        当前共享组还没有关联 Android 设备。先打开 Android app，拿到配对码，再回到这里完成绑定。
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-sm font-semibold text-slate-900">iOS Bark Key</div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    当前仅保留 iOS 的 Bark 推送接入。填入设备 Key 后，可继续用于测试通知和规则提醒。
                  </p>
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
        backLabel="返回加仓计划"
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
