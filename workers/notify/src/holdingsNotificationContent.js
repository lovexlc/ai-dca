import {
  getExpectedLatestNavDate,
  resolveHoldingKindAsync
} from './holdingsNavSupport.js';

function isOtcSnapshotReady(latestNavDate, todayShanghai, expectedLatestNavDate) {
  // 收紧：场外/QDII 必须 latestNavDate >= 期望最新净值日期（且不超过今天）才算 ready。
  // 不再因 sourceUpdatedAt===今天 就提前判 ready，避免用 T-1 净值误报当日收益、
  // 并写入 dedup 抑制掉当晚真正的 T 日净值通知。
  if (!latestNavDate || latestNavDate > todayShanghai) return false;
  return latestNavDate >= expectedLatestNavDate;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function snapshotValueFields(snapshot = null, effectiveKind = 'otc') {
  const exchange = effectiveKind === 'exchange';
  const currentValue = exchange
    ? numberOrNull(snapshot?.price ?? snapshot?.currentPrice ?? snapshot?.close ?? snapshot?.latestNav)
    : numberOrNull(snapshot?.latestNav ?? snapshot?.currentPrice ?? snapshot?.price);
  const previousValue = exchange
    ? numberOrNull(snapshot?.previousClose ?? snapshot?.previousNav)
    : numberOrNull(snapshot?.previousNav);
  const valueDate = String(exchange
    ? (snapshot?.quoteDate || snapshot?.latestNavDate || '')
    : (snapshot?.latestNavDate || '')
  ).slice(0, 10);
  return { currentValue, previousValue, valueDate };
}

function normalizeDigestKind(kind) {
  const value = String(kind || '').trim().toLowerCase();
  return value === 'exchange' || value === 'otc' || value === 'qdii' ? value : '';
}

export async function computeWeightedReturn(bucket, snapshotsByCode, todayShanghai, kind = 'exchange', env = null) {
  // 返回 { ready, returnRate, contributors[] }。
  // ready=false 表示还有代码的 valueDate 未达预期最新日期，在调用方侧跳过。
  // 期望最新日期按「单只」实际 kind 计算：
  //   exchange = 当日行情价；otc（境内场外）= 当日净值（晚 21 点后才会刷）；
  //   qdii = 上一交易日净值（周一 T-3）。
  // bucket 仍是 exchange/otc 两档，但 otc bucket 里可能夹杂了 QDII，需要逐代码区分。
  let ready = true;
  const eligible = [];
  for (const entry of bucket) {
    const snap = snapshotsByCode[entry.code];
    const digestKind = normalizeDigestKind(entry.kind);
    const effectiveKind = digestKind || await resolveHoldingKindAsync(entry.code, kind, env);
    const expectedLatestNavDate = getExpectedLatestNavDate(effectiveKind, todayShanghai);
    const { currentValue, previousValue, valueDate } = snapshotValueFields(snap, effectiveKind);
    const dateReady = effectiveKind === 'exchange'
      ? valueDate >= expectedLatestNavDate && valueDate <= todayShanghai
      : isOtcSnapshotReady(valueDate, todayShanghai, expectedLatestNavDate);
    if (currentValue == null || previousValue == null) {
      // 缺少价格/净值或前值 → 在加权中跳过，但如果是日期不达预期造成的，则整套跳过。
      if (!dateReady) ready = false;
      continue;
    }
    if (!dateReady) {
      ready = false;
      continue;
    }
    eligible.push({
      code: entry.code,
      weight: entry.weight,
      kind: effectiveKind,
      valueType: effectiveKind === 'exchange' ? 'price' : 'nav',
      currentValue,
      previousValue,
      valueDate,
      ratio: currentValue / previousValue - 1
    });
  }

  if (!ready || !eligible.length) {
    return { ready: false, returnRate: 0, contributors: eligible };
  }

  // 在 bucket 内 re-normalize（仅限于 eligible）。
  const totalWeight = eligible.reduce((sum, item) => sum + item.weight, 0);
  if (!(totalWeight > 0)) {
    return { ready: false, returnRate: 0, contributors: eligible };
  }
  const weightedReturn = eligible.reduce((sum, item) => sum + (item.weight / totalWeight) * item.ratio, 0);

  return {
    ready: true,
    returnRate: weightedReturn,
    contributors: eligible
      .map((item) => ({ ...item, contribution: (item.weight / totalWeight) * item.ratio }))
      .sort((a, b) => Math.abs(b.ratio) - Math.abs(a.ratio))
  };
}

function formatPercent(value) {
  const sign = value >= 0 ? '+' : '−';
  return `${sign}${Math.abs(value * 100).toFixed(2)}%`;
}

function formatShortDateLabel(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) return '';
  return `${match[1].slice(-2)}-${match[2]}-${match[3]}`;
}

export function buildHoldingsNotificationContent(kind, returnRate, contributors, dateKey = '') {
  const kindLabel = kind === 'exchange' ? '场内' : '场外';
  const dateLabel = formatShortDateLabel(dateKey);
  const title = `[${kindLabel}] ${dateLabel ? `${dateLabel} ` : ''}当日收益 ${formatPercent(returnRate)}`;
  const top = contributors.slice(0, 3).map((item) => `${item.code} ${formatPercent(item.ratio)}`);
  // 出于隐私考虑：推送仅展示加权收益率，不再携带 ¥ 金额；具体金额请回网页查看。
  const body = top.length
    ? `今日${kindLabel}加权收益率 ${formatPercent(returnRate)}；贡献 Top：${top.join('、')}。详情请打开网页查看。`
    : `今日${kindLabel}加权收益率 ${formatPercent(returnRate)}。详情请打开网页查看。`;
  // 富文本通道支持 **bold** / 列表 / 空行；这里给出更清晰的视觉层次。
  const topMdItems = contributors.slice(0, 3).map((item) => `- ${item.code} **${formatPercent(item.ratio)}**`);
  const bodyMdLines = [`**${kindLabel}加权收益率 ${formatPercent(returnRate)}**`];
  if (topMdItems.length) {
    bodyMdLines.push('', '贡献 Top：', ...topMdItems);
  }
  bodyMdLines.push('', '详情请打开网页查看。');
  const body_md = bodyMdLines.join('\n');
  return { title, body, summary: `${kindLabel}当日收益 ${formatPercent(returnRate)}`, body_md };
}

// 全仓总览（场内 + 场外合并）推送内容构造。
// 出于隐私考虑：不再展示任何 ¥ 金额（不论旧版 digest 是否携带 totals），
// 仅显示加权收益率百分比 + 贡献 Top；具体金额引导用户去网页查看。
// 第三个参数保留签名以兼容旧调用方，内部不再读取。
export function buildHoldingsNotificationContentAll(returnRate, contributors, dateKey = '', _totalsLegacy = null) {
  void _totalsLegacy;
  const dailyPct = formatPercent(returnRate);
  const dateLabel = formatShortDateLabel(dateKey);
  const top = (contributors || []).slice(0, 3).map((item) => `${item.code} ${formatPercent(item.ratio)}`);
  const title = `[持仓总览] ${dateLabel ? `${dateLabel} ` : ''}当日收益 ${dailyPct}`;
  const summary = `当日加权收益率 ${dailyPct}`;
  const body = top.length
    ? `今日加权收益率 ${dailyPct}；贡献 Top：${top.join('、')}。详情请打开网页查看。`
    : `今日加权收益率 ${dailyPct}。详情请打开网页查看。`;

  // 富文本通道支持 **bold** / 列表 / 空行；这里给出更清晰的视觉层次。
  const topMdItems = (contributors || []).slice(0, 3).map((item) => `- ${item.code} **${formatPercent(item.ratio)}**`);
  const bodyMdLines = [`**当日加权收益率 ${dailyPct}**`];
  if (topMdItems.length) {
    bodyMdLines.push('', '贡献 Top：', ...topMdItems);
  }
  bodyMdLines.push('', '详情请打开网页查看。');
  const body_md = bodyMdLines.join('\n');

  return { title, body, summary, body_md };
}
