import { formatCurrency, formatPercent } from './accumulation.js';
import { buildDcaProjection, readDcaList } from './dca.js';
import { buildPlan, readPlanList } from './plan.js';
import { readSellPlanList } from './sellPlans.js';
import { buildSellPlan } from './sellStrategy.js';

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateLabel(date) {
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) {
    return '--';
  }

  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

function createDate(baseDate) {
  const target = baseDate instanceof Date
    ? new Date(baseDate.getTime())
    : baseDate == null
      ? new Date()
      : new Date(baseDate);
  target.setHours(0, 0, 0, 0);
  return target;
}

function addDays(baseDate, days) {
  const next = createDate(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(baseDate, months, day) {
  const next = createDate(baseDate);
  next.setMonth(next.getMonth() + months, 1);
  const monthLastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(Math.max(Number(day) || 1, 1), monthLastDay));
  return next;
}

function getNextExecutionDate(frequency = '每月', executionDay = 1, now = new Date()) {
  const today = createDate(now);
  const safeDay = Math.max(Number(executionDay) || 1, 1);

  switch (frequency) {
    case '每日':
      return addDays(today, 1);
    case '每周': {
      const weekDay = Math.min(safeDay, 7);
      const currentWeekDay = ((today.getDay() + 6) % 7) + 1;
      const offset = weekDay > currentWeekDay ? weekDay - currentWeekDay : 7 - (currentWeekDay - weekDay);
      return addDays(today, offset || 7);
    }
    case '每季': {
      const candidate = addMonths(today, 0, safeDay);
      if (candidate > today) {
        return candidate;
      }
      return addMonths(today, 3, safeDay);
    }
    case '每月':
    default: {
      const candidate = addMonths(today, 0, safeDay);
      if (candidate > today) {
        return candidate;
      }
      return addMonths(today, 1, safeDay);
    }
  }
}

function resolveStrategyTypeLabel(strategy = '') {
  return strategy === 'peak-drawdown' ? '跌幅触发买入' : '均线触发买入';
}

function resolveDisplayPlanName(plan = {}) {
  const segments = String(plan.name || '')
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean);

  if (segments.length >= 2) {
    return `${segments[0]} ${segments[1]}`;
  }

  if (segments.length === 1) {
    return segments[0];
  }

  return `${plan.symbol || '未命名标的'} 建仓计划`;
}

function resolveLayerTriggerLabel(plan, layer, totalLayers = 0) {
  if (plan.selectedStrategy === 'peak-drawdown') {
    return `较阶段高点累计回撤 ${formatPercent(layer.drawdown, 1)}`;
  }

  if ((layer.order || 0) === 1 || Math.abs(Number(layer.drawdown) || 0) < 0.1) {
    return '靠近 120 日线';
  }

  if ((layer.order || 0) === totalLayers && Number(layer.drawdown) > 12) {
    return `深水防守，参考回撤 ${formatPercent(layer.drawdown, 1)}`;
  }

  return `低于 120 日线 ${formatPercent(layer.drawdown, 1)}`;
}

function formatReferencePrice(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : '--';
}

function buildPlanRows(planList = []) {
  return planList.flatMap((plan) => {
    const computed = buildPlan(plan);
    const displayPlanName = resolveDisplayPlanName(plan);
    const totalLayers = computed.layers.length;
    const layerItems = computed.layers.map((item, itemIndex) => ({
      id: item.id || `layer-${itemIndex + 1}`,
      label: `第${itemIndex + 1}层`,
      detail: Number.isFinite(Number(item.drawdown)) ? `-${Number(item.drawdown).toFixed(1)}%` : '',
      amount: formatCurrency(item.amount, '¥ '),
      price: formatReferencePrice(item.price),
      trigger: resolveLayerTriggerLabel({ ...plan }, { ...item, order: itemIndex + 1 }, totalLayers),
      status: '待执行'
    }));
    return computed.layers.map((layer, index) => {
      const order = index + 1;
      return ({
      id: `${plan.id}-${layer.id}`,
      ruleId: `plan:${plan.id}`,
      sourceType: 'plan',
      sourceId: plan.id,
      planName: displayPlanName,
      typeLabel: resolveStrategyTypeLabel(plan.selectedStrategy),
      symbol: plan.symbol,
      triggerLabel: resolveLayerTriggerLabel({ ...plan }, { ...layer, order }, computed.layers.length),
      nextExecutionLabel: '价格满足条件后提醒',
      statusLabel: order === 1 ? '待首仓' : '监控中',
      statusTone: order === 1 ? 'indigo' : 'slate',
      cardTypeLabel: '加仓',
      cardTone: 'indigo',
      progressLabel: `${totalLayers}层策略 · 第 ${order}/${totalLayers} 层待执行`,
      progressValue: totalLayers > 1 ? Math.min(Math.max((order - 1) / (totalLayers - 1), 0), 1) : 0,
      progressCaption: `当前监控：${resolveLayerTriggerLabel({ ...plan }, { ...layer, order }, totalLayers)}`,
      progressItems: computed.layers.slice(0, 4).map((item, itemIndex) => ({
        label: `第${itemIndex + 1}层`,
        detail: Number.isFinite(Number(item.drawdown)) ? `-${Number(item.drawdown).toFixed(0)}%` : '',
        status: itemIndex + 1 < order ? '已执行' : itemIndex + 1 === order ? '待执行' : '待执行'
      })),
      footerLabel: `下次执行：${order === 1 ? '价格满足后' : '继续监控'} · 预计买入 ${formatCurrency(layer.amount, '¥ ')}`,
      actionLabel: '查看策略',
      actionKey: 'home',
      detailTitle: `${displayPlanName} ${layer.label}`,
      detailSummary: `计划投入 ${formatCurrency(layer.amount, '¥ ')}，按 ${layer.label} 这一档执行后续买入。`,
      triggerExplain: `${resolveLayerTriggerLabel({ ...plan }, { ...layer, order }, computed.layers.length)}，参考买入价 ${formatReferencePrice(layer.price)}。`,
      notificationMethod: '预留站内提醒 / 消息通知',
      reminderLog: ['尚未开启通知，后续可追加提醒渠道。'],
      detailItems: layerItems.map((item, itemIndex) => ({
        ...item,
        status: itemIndex + 1 < order ? '已执行' : itemIndex + 1 === order ? '当前监控' : '待执行'
      })),
      editPayload: plan,
      order,
      createdAt: plan.createdAt || plan.updatedAt || ''
    });
    });
  });
}

function buildDcaRows(dcaList = [], now = new Date(), planList = readPlanList()) {
  if (!Array.isArray(dcaList) || !dcaList.length) {
    return [];
  }

  return dcaList.flatMap((dcaState) => {
    const projection = buildDcaProjection(dcaState, { planList });

    if (!projection.effectiveSymbol) {
      return [];
    }

    const nextExecutionDate = getNextExecutionDate(dcaState.frequency, dcaState.executionDay, now);
    const nextExecutionLabel = formatDateLabel(nextExecutionDate);
    const sourceId = dcaState.id || `${projection.effectiveSymbol}-${dcaState.frequency}-${dcaState.executionDay}-${projection.linkedPlanId || 'standard'}`;
    const detailItems = projection.isLinkedPlan
      ? projection.linkedPlanSplit.map((item) => ({
          id: item.id,
          label: item.label,
          detail: item.drawdown > 0 ? `回撤 ${formatPercent(item.drawdown, 1)}` : '首批',
          amount: formatCurrency(item.amount, '¥ '),
          price: '',
          trigger: item.drawdown > 0 ? `参考回撤 ${formatPercent(item.drawdown, 1)}` : '首批参考区间',
          status: '周期内分批'
        }))
      : projection.schedule.slice(0, 4).map((item) => ({
          id: item.id,
          label: item.label,
          detail: item.note,
          amount: formatCurrency(item.contribution, '¥ '),
          price: '',
          trigger: projection.cadenceLabel,
          status: '待执行'
        }));

    return [{
      id: `dca-${sourceId}`,
      ruleId: `dca:${sourceId}`,
      sourceType: 'dca',
      sourceId,
      planName: dcaState.name || `${projection.effectiveSymbol} 定投计划`,
      typeLabel: projection.isLinkedPlan ? '定投 + 策略分批' : '固定定投',
      symbol: projection.effectiveSymbol,
      triggerLabel: projection.cadenceLabel,
      nextExecutionLabel,
      statusLabel: '待执行',
      statusTone: 'emerald',
      cardTypeLabel: '定投',
      cardTone: 'emerald',
      progressLabel: `${projection.cadenceLabel} · 第 1/∞ 期`,
      progressValue: 0.35,
      progressCaption: `单次金额 ${formatCurrency(dcaState.recurringInvestment, '¥ ')}`,
      progressItems: [
        { label: '已设置', detail: dcaState.frequency || '定投', status: '已启用' },
        { label: '下一期', detail: nextExecutionLabel, status: '待执行' }
      ],
      footerLabel: `下期扣款：${nextExecutionLabel} · 本期金额 ${formatCurrency(dcaState.recurringInvestment, '¥ ')}`,
      actionLabel: '查看定投',
      actionKey: 'dca',
      detailTitle: `${projection.effectiveSymbol} 定投计划`,
      detailSummary: projection.isLinkedPlan
        ? `每个执行周期投入 ${formatCurrency(dcaState.recurringInvestment, '¥ ')}，按「${projection.linkedPlanName}」拆分为 ${projection.linkedPlanSplitCount || 0} 批，在周期内分批执行。`
        : `单次投入 ${formatCurrency(dcaState.recurringInvestment, '¥ ')}，周期内预计执行 ${projection.executionCount} 次。`,
      triggerExplain: projection.isLinkedPlan
        ? `${projection.cadenceLabel}，下一次计划执行日期 ${nextExecutionLabel}。到期后请前往网页查看本期分批策略。`
        : `${projection.cadenceLabel}，下一次计划执行日期 ${nextExecutionLabel}。`,
      notificationMethod: '预留执行前提醒',
      reminderLog: ['执行前提醒功能待接入。'],
      detailItems,
      editPayload: dcaState,
      order: 999,
      createdAt: dcaState.createdAt || dcaState.updatedAt || ''
    }];
  });
}

// PR 1.5：将已保存的卖出计划按分档拆为交易计划中心的行。
// 每个 sellPlan -> N 档行，交互与 plan 行一致（actionKey 切 'sell'，statusTone rose）。
function buildSellPlanRows(sellPlanList = []) {
  return sellPlanList.flatMap((plan) => {
    const computed = buildSellPlan(plan);
    if (!computed || !computed.sellable || !Array.isArray(computed.layers) || !computed.layers.length) {
      return [];
    }

    const displayName = plan.name || `${plan.symbol || '未命名标的'} 卖出计划`;
    const totalShares = computed.totalSharesPlanned || 0;
    const totalProceeds = computed.totalProceeds || 0;

    return computed.layers.map((layer, index) => {
      const order = index + 1;
      const ratioPct = formatPercent((Number(layer.ratio) || 0) * 100, 1);
      const gainPct = formatPercent(Number(layer.gainPct) || 0, 1);
      const priceText = Number.isFinite(Number(layer.triggerPrice))
        ? `$${Number(layer.triggerPrice).toFixed(2)}`
        : '--';
      return {
        id: `sell-${plan.id}-${order}`,
        ruleId: `sell:${plan.id}:${order}`,
        sourceType: 'sell',
        sourceId: plan.id,
        planName: displayName,
        typeLabel: '分档卖出',
        symbol: plan.symbol,
        triggerLabel: `盈利 ${gainPct} → 卖 ${ratioPct} (≈ ${priceText})`,
        nextExecutionLabel: '价格达到后提醒',
        statusLabel: order === 1 ? '首档待触发' : '监控中',
        statusTone: order === 1 ? 'rose' : 'slate',
        cardTypeLabel: '卖出',
        cardTone: 'amber',
        progressLabel: `${computed.layers.length}档止盈 · 第 0/${computed.layers.length} 档触发`,
        progressValue: computed.layers.length > 1 ? Math.min(Math.max((order - 1) / (computed.layers.length - 1), 0), 1) : 0,
        progressCaption: `当前目标：盈利 ${gainPct}`,
        progressItems: computed.layers.slice(0, 4).map((item, itemIndex) => ({
          label: `第${itemIndex + 1}档`,
          detail: `+${Number(item.gainPct || 0).toFixed(0)}%`,
          status: '待触发'
        })),
        footerLabel: `持仓成本：${formatCurrency(plan.holdingCost, '$ ')} · 触发价 ${priceText}`,
        actionLabel: '查看卖出',
        actionKey: 'sell',
        detailTitle: `${displayName} · 第 ${order} 档`,
        detailSummary: `成本 ${formatCurrency(plan.holdingCost, '$ ')} / 持有 ${plan.holdingShares} 股，本档卖 ${Math.round(Number(layer.shares) || 0)} 股，预计回收 ${formatCurrency(Number(layer.proceeds) || 0, '$ ')}。`,
        triggerExplain: `达到盈利 ${gainPct} 后卖出 ${ratioPct} 仓位，触发价格 ≈ ${priceText}。全计划共卖 ${Math.round(totalShares)} 股、预计回收 ${formatCurrency(totalProceeds, '$ ')}。`,
        notificationMethod: '预留价格达到提醒',
        reminderLog: ['卖出提醒通道待接入。'],
        order,
        createdAt: plan.createdAt || plan.updatedAt || ''
      };
    });
  });
}

function sortRows(rows = []) {
  return [...rows].sort((left, right) => {
    if (left.sourceType !== right.sourceType) {
      const order = { plan: 0, sell: 1, dca: 2 };
      const lo = order[left.sourceType] ?? 9;
      const ro = order[right.sourceType] ?? 9;
      return lo - ro;
    }

    if (left.sourceId !== right.sourceId) {
      return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
    }

    return (left.order || 0) - (right.order || 0);
  });
}

function buildPreviewRows(rows = []) {
  const seenSources = new Set();

  return rows.filter((row) => {
    const sourceKey = `${row.sourceType}:${row.sourceId || row.id}`;
    if (seenSources.has(sourceKey)) {
      return false;
    }

    seenSources.add(sourceKey);
    return true;
  });
}

export function buildTradePlanCenter(now = new Date()) {
  const planList = readPlanList();
  const planRows = buildPlanRows(planList);
  const dcaRows = buildDcaRows(readDcaList(), now, planList);
  const sellPlanRows = buildSellPlanRows(readSellPlanList());
  const rows = sortRows([...planRows, ...sellPlanRows, ...dcaRows]);
  const previewRows = buildPreviewRows(rows);
  const nearestPricePlan = previewRows.find((row) => row.sourceType === 'plan') || null;
  const nextDcaPlan = previewRows.find((row) => row.sourceType === 'dca') || null;
  const nextSellPlan = previewRows.find((row) => row.sourceType === 'sell') || null;

  return {
    rows,
    previewRows,
    hasPlans: previewRows.length > 0,
    summary: {
      pendingCount: previewRows.length,
      nearestTrigger: nearestPricePlan?.triggerLabel || '待新建',
      nextDcaDate: nextDcaPlan?.nextExecutionLabel || '未配置',
      nextSellTrigger: nextSellPlan?.triggerLabel || '未配置',
      notificationStatus: '通知预留中'
    }
  };
}
