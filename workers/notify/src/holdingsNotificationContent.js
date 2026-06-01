import {
  getExpectedLatestNavDate,
  resolveHoldingKindAsync
} from './holdingsNavSupport.js';

export async function computeWeightedReturn(bucket, snapshotsByCode, todayShanghai, kind = 'exchange', env = null) {
  // 返回 { ready, returnRate, contributors[] }。
  // ready=false 表示还有代码的 latestNavDate 未达预期最新日期，在调用方侧跳过。
  // 期望最新日期按「单只」实际 kind 计算：
  //   exchange = 当日；otc（境内场外）= 当日（晚 21 点后才会刷）；qdii = 上一交易日（周一 T-3）。
  // bucket 仍是 exchange/otc 两档，但 otc bucket 里可能夹杂了 QDII，需要逐代码区分。
  let ready = true;
  const eligible = [];
  for (const entry of bucket) {
    const snap = snapshotsByCode[entry.code];
    const latestNav = Number(snap?.latestNav);
    const previousNav = Number(snap?.previousNav);
    const latestNavDate = String(snap?.latestNavDate || '');
    const effectiveKind = await resolveHoldingKindAsync(entry.code, kind, env);
    const expectedLatestNavDate = getExpectedLatestNavDate(effectiveKind, todayShanghai);
    if (!Number.isFinite(latestNav) || !Number.isFinite(previousNav) || previousNav <= 0) {
      // 缺少净值或昨日净值 → 在加权中跳过，但如果是 latestNavDate 不达预期日期造成的，则整套跳过。
      if (!latestNavDate || latestNavDate < expectedLatestNavDate) ready = false;
      continue;
    }
    if (latestNavDate < expectedLatestNavDate || latestNavDate > todayShanghai) {
      ready = false;
      continue;
    }
    eligible.push({
      code: entry.code,
      weight: entry.weight,
      latestNav,
      previousNav,
      ratio: latestNav / previousNav - 1
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
  // Android 客户端 MarkdownRenderer 支持 **bold** / 列表 / 空行；这里给出更清晰的视觉层次。
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

  // Android 客户端 MarkdownRenderer 支持 **bold** / 列表 / 空行；这里给出更清晰的视觉层次。
  const topMdItems = (contributors || []).slice(0, 3).map((item) => `- ${item.code} **${formatPercent(item.ratio)}**`);
  const bodyMdLines = [`**当日加权收益率 ${dailyPct}**`];
  if (topMdItems.length) {
    bodyMdLines.push('', '贡献 Top：', ...topMdItems);
  }
  bodyMdLines.push('', '详情请打开网页查看。');
  const body_md = bodyMdLines.join('\n');

  return { title, body, summary, body_md };
}
