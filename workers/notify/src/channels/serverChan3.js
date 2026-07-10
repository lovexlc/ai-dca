export function normalizeServerChan3Config(config = {}) {
  return {
    uid: String(config?.uid || '').trim(),
    sendKey: String(config?.sendKey || '').trim()
  };
}

export function maskServerChan3SendKey(value = '') {
  const normalized = String(value || '').trim();
  return normalized ? `${normalized.slice(0, 6)}...${normalized.slice(-4)}` : '';
}

const DEFAULT_TAG = 'AI-DCA';
const MAX_SHORT_LENGTH = 64;

const EVENT_TAGS = {
  'plan-trigger': '买入提醒',
  'dca-schedule': '定投提醒',
  'sell-signal': '卖出提醒',
  'position-cap': '仓位提醒',
  'cash-high': '仓位提醒',
  'rebalance-needed': '再平衡提醒',
  'vix-signal': '风控提醒',
  'switch-strategy-trigger': '切换提醒',
  'holdings-daily-return': '持仓收益',
  admin_alert: '系统告警',
  test: '测试'
};

function normalizeText(value = '') {
  return String(value || '').trim();
}

function singleLine(value = '') {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function truncateText(value = '', maxLength = MAX_SHORT_LENGTH) {
  const normalized = singleLine(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(maxLength - 1, 0))}…`;
}

function markdownTableCell(value = '') {
  return singleLine(value).replace(/\|/g, '\\|');
}

function stripMarkdownForShort(value = '') {
  return singleLine(value)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveServerChanTags(notification = {}) {
  const eventType = normalizeText(notification.eventType);
  const rawTags = Array.isArray(notification.tags)
    ? notification.tags
    : String(notification.tags || '').split('|');
  const tags = [
    DEFAULT_TAG,
    EVENT_TAGS[eventType] || '',
    ...rawTags
  ]
    .map((tag) => singleLine(tag))
    .filter(Boolean);
  return Array.from(new Set(tags)).join('|');
}

function buildMetadataRows(notification = {}) {
  const rows = [];
  const symbol = normalizeText(notification.symbol);
  const strategyName = normalizeText(notification.strategyName);
  const triggerCondition = normalizeText(notification.triggerCondition);
  const purchaseAmount = normalizeText(notification.purchaseAmount);

  if (strategyName) rows.push(['策略', strategyName]);
  if (symbol) rows.push(['标的', symbol]);
  if (triggerCondition) rows.push(['触发条件', triggerCondition]);
  if (purchaseAmount) rows.push(['建议金额', purchaseAmount]);
  return rows;
}

function buildServerChanMarkdown(notification = {}) {
  const title = normalizeText(notification.title || notification.summary || '交易计划提醒');
  const summary = normalizeText(notification.summary);
  const bodyMd = normalizeText(notification.body_md || notification.bodyMd);
  const body = normalizeText(notification.body || summary);
  const detailUrl = normalizeText(notification.detailUrl || notification.url);
  const lines = [`# ${title}`];

  if (summary && summary !== title) {
    lines.push(`> ${summary}`);
  }

  const rows = buildMetadataRows(notification);
  if (rows.length) {
    lines.push([
      '| 项目 | 内容 |',
      '| --- | --- |',
      ...rows.map(([key, value]) => `| ${markdownTableCell(key)} | ${markdownTableCell(value)} |`)
    ].join('\n'));
  }

  if (bodyMd) {
    lines.push(bodyMd);
  } else if (body) {
    lines.push(body);
  }

  if (detailUrl) {
    lines.push(`[打开 AI-DCA 查看详情](${detailUrl})`);
  }

  return lines.join('\n\n');
}

export function buildServerChan3MessagePayload(notification = {}) {
  const title = normalizeText(notification.title || notification.summary || '交易计划提醒');
  const markdown = buildServerChanMarkdown(notification);
  const shortSource = normalizeText(notification.short)
    || normalizeText(notification.summary)
    || title;
  return {
    title,
    desp: markdown,
    short: truncateText(stripMarkdownForShort(shortSource)),
    tags: resolveServerChanTags(notification)
  };
}

export async function sendServerChan3Notification({ uid = '', sendKey = '', ...notification } = {}) {
  const normalizedUid = String(uid || '').trim();
  const normalizedSendKey = String(sendKey || '').trim();

  if (!normalizedUid || !normalizedSendKey) {
    return {
      channel: 'serverchan3',
      status: 'skipped',
      detail: '未配置 Server酱³ UID 或 SendKey'
    };
  }

  const endpoint = `https://${encodeURIComponent(normalizedUid)}.push.ft07.com/send/${encodeURIComponent(normalizedSendKey)}.send`;
  const message = buildServerChan3MessagePayload(notification);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(message).toString()
  });
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(rawText || `Server酱³ 推送失败：状态 ${response.status}`);
  }

  return {
    channel: 'serverchan3',
    status: 'delivered',
    detail: rawText || '已发送到 Server酱³'
  };
}
