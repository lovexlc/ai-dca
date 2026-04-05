import { formatCurrency, formatPercent } from './accumulation.js';
import { buildDcaProjection, hasSavedDcaState, readDcaState } from './dca.js';
import { buildPlan, readPlanList } from './plan.js';

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

function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function parseStoredDate(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  const target = createDate(normalized);
  return isValidDate(target) ? target : null;
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

function getExecutionDateOnOrAfter(frequency = '每月', executionDay = 1, startDate = new Date()) {
  const start = createDate(startDate);
  const safeDay = Math.max(Number(executionDay) || 1, 1);

  switch (frequency) {
    case '每日':
      return start;
    case '每周': {
      const weekDay = Math.min(safeDay, 7);
      const currentWeekDay = ((start.getDay() + 6) % 7) + 1;
      const offset = weekDay >= currentWeekDay ? weekDay - currentWeekDay : 7 - (currentWeekDay - weekDay);
      return addDays(start, offset);
    }
    case '每季': {
      let candidate = addMonths(start, 0, safeDay);
      while (!([0, 3, 6, 9].includes(candidate.getMonth())) || candidate < start) {
        candidate = addMonths(candidate, 1, safeDay);
      }
      return candidate;
    }
    case '每月':
    default: {
      const candidate = addMonths(start, 0, safeDay);
      return candidate >= start ? candidate : addMonths(start, 1, safeDay);
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
      actionLabel: '查看策略',
      actionKey: 'home',
      detailTitle: `${displayPlanName} ${layer.label}`,
      detailSummary: `计划投入 ${formatCurrency(layer.amount, '¥ ')}，按 ${layer.label} 这一档执行后续买入。`,
      triggerExplain: `${resolveLayerTriggerLabel({ ...plan }, { ...layer, order }, computed.layers.length)}，参考买入价 ${formatReferencePrice(layer.price)}。`,
      notificationMethod: '预留站内提醒 / 消息通知',
      reminderLog: ['尚未开启通知，后续可追加提醒渠道。'],
      order,
      createdAt: plan.createdAt || plan.updatedAt || ''
    });
    });
  });
}

function buildDcaRows(dcaState, now = new Date(), planList = readPlanList()) {
  if (!hasSavedDcaState()) {
    return [];
  }

  const projection = buildDcaProjection(dcaState, { planList });

  if (!projection.effectiveSymbol) {
    return [];
  }

  const nextExecutionDate = getNextExecutionDate(dcaState.frequency, dcaState.executionDay, now);
  const nextExecutionLabel = formatDateLabel(nextExecutionDate);

  return [
    {
      id: `dca-${projection.effectiveSymbol}-${dcaState.frequency}-${dcaState.executionDay}-${projection.linkedPlanId || 'standard'}`,
      ruleId: `dca:${projection.effectiveSymbol}:${dcaState.frequency}:${dcaState.executionDay}:${projection.linkedPlanId || 'standard'}`,
      sourceType: 'dca',
      sourceId: projection.effectiveSymbol,
      planName: `${projection.effectiveSymbol} 定投计划`,
      typeLabel: projection.isLinkedPlan ? '定投 + 策略分批' : '固定定投',
      symbol: projection.effectiveSymbol,
      triggerLabel: projection.cadenceLabel,
      nextExecutionLabel,
      statusLabel: '待执行',
      statusTone: 'emerald',
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
      order: 999,
      createdAt: ''
    }
  ];
}

function sortRows(rows = []) {
  return [...rows].sort((left, right) => {
    if (left.sourceType !== right.sourceType) {
      return left.sourceType === 'plan' ? -1 : 1;
    }

    if (left.sourceId !== right.sourceId) {
      return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
    }

    return (left.order || 0) - (right.order || 0);
  });
}

function buildPreviewRows(rows = []) {
  const seenTypes = new Set();

  return rows.filter((row) => {
    const typeKey = `${row.actionKey}:${row.typeLabel}`;
    if (seenTypes.has(typeKey)) {
      return false;
    }

    seenTypes.add(typeKey);
    return true;
  });
}

function resolveDcaHistoryStartDate(dcaState, now = new Date()) {
  return parseStoredDate(dcaState.createdAt || dcaState.updatedAt) || createDate(now);
}

function buildDcaHistoryRows(dcaState, now = new Date(), planList = readPlanList()) {
  const projection = buildDcaProjection(dcaState, { planList });
  if (!hasSavedDcaState() || !projection.effectiveSymbol) {
    return {
      rows: [],
      projection
    };
  }

  const rows = [];
  const endDate = createDate(now);
  const startDate = resolveDcaHistoryStartDate(dcaState, now);
  const recurringInvestment = Math.max(Number(projection.recurringInvestment) || 0, 0);
  const initialInvestment = Math.max(Number(projection.initialInvestment) || 0, 0);

  if (!projection.isLinkedPlan && initialInvestment > 0 && startDate <= endDate) {
    rows.push({
      id: `history-dca-initial-${projection.effectiveSymbol}-${formatDateLabel(startDate)}`,
      dateLabel: formatDateLabel(startDate),
      sortDate: startDate.toISOString(),
      sourceType: 'dca',
      planName: `${projection.effectiveSymbol} 定投计划`,
      symbol: projection.effectiveSymbol,
      typeLabel: '初始建仓',
      amount: initialInvestment,
      statusLabel: '按策略生成',
      statusTone: 'indigo',
      note: '来自定投计划中的初始投资额。'
    });
  }

  if (!(recurringInvestment > 0) || !(projection.executionCount > 0)) {
    return {
      rows,
      projection
    };
  }

  let cycleDate = getExecutionDateOnOrAfter(dcaState.frequency, dcaState.executionDay, startDate);
  let cycleIndex = 0;

  while (isValidDate(cycleDate) && cycleDate <= endDate && cycleIndex < projection.executionCount) {
    cycleIndex += 1;
    rows.push({
      id: `history-dca-cycle-${projection.effectiveSymbol}-${formatDateLabel(cycleDate)}-${cycleIndex}`,
      dateLabel: formatDateLabel(cycleDate),
      sortDate: cycleDate.toISOString(),
      sourceType: 'dca',
      planName: `${projection.effectiveSymbol} 定投计划`,
      symbol: projection.effectiveSymbol,
      typeLabel: '定投执行',
      amount: recurringInvestment,
      statusLabel: '按策略生成',
      statusTone: 'emerald',
      note: projection.isLinkedPlan
        ? `${projection.cadenceLabel}，按「${projection.linkedPlanName}」拆分 ${projection.linkedPlanSplitCount || 0} 批执行。`
        : projection.cadenceLabel
    });
    cycleDate = getNextExecutionDate(dcaState.frequency, dcaState.executionDay, cycleDate);
  }

  return {
    rows,
    projection
  };
}

function sortHistoryRows(rows = []) {
  return [...rows].sort((left, right) => String(right.sortDate || '').localeCompare(String(left.sortDate || '')));
}

export function buildTradeHistory(now = new Date()) {
  const planList = readPlanList();
  const dcaState = readDcaState();
  const { rows: dcaRows, projection } = buildDcaHistoryRows(dcaState, now, planList);
  const rows = sortHistoryRows(dcaRows);
  const totalInvestment = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const strategyCount = new Set(rows.map((row) => row.planName)).size;
  const dcaConfigured = hasSavedDcaState() && Boolean(projection.effectiveSymbol);

  return {
    rows,
    hasHistory: rows.length > 0,
    summary: {
      recordCount: rows.length,
      totalInvestment,
      latestExecutionDate: rows[0]?.dateLabel || '--',
      strategyCount
    },
    dcaMeta: {
      configured: dcaConfigured,
      cadenceLabel: dcaConfigured ? projection.cadenceLabel || '未配置' : '未配置',
      planName: dcaConfigured ? `${projection.effectiveSymbol} 定投计划` : '未配置',
      isLinkedPlan: dcaConfigured && projection.isLinkedPlan,
      linkedPlanName: dcaConfigured && projection.isLinkedPlan ? projection.linkedPlanName : '',
      recurringInvestment: dcaConfigured ? projection.recurringInvestment : 0
    }
  };
}

export function buildTradePlanCenter(now = new Date()) {
  const planList = readPlanList();
  const planRows = buildPlanRows(planList);
  const dcaRows = buildDcaRows(readDcaState(), now, planList);
  const rows = sortRows([...planRows, ...dcaRows]);
  const previewRows = buildPreviewRows(rows);
  const nearestPricePlan = previewRows.find((row) => row.sourceType === 'plan') || null;
  const nextDcaPlan = previewRows.find((row) => row.sourceType === 'dca') || null;

  return {
    rows,
    previewRows,
    hasPlans: previewRows.length > 0,
    summary: {
      pendingCount: previewRows.length,
      nearestTrigger: nearestPricePlan?.triggerLabel || '待新建',
      nextDcaDate: nextDcaPlan?.nextExecutionLabel || '未配置',
      notificationStatus: '通知预留中'
    }
  };
}
