import { fetchSwitchOrderBooks } from '../switchMarketCollector.js';

const DEFAULT_FROM = 'notify@freebacktrack.tech';
const DEFAULT_FROM_NAME = '美股策略助手';

export function normalizeEmailAddress(value = '') {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

export function normalizeEmailConfig(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const address = normalizeEmailAddress(input.address || '');
  const verified = Boolean(address && input.verified);
  return {
    address,
    verified,
    verifiedAt: verified ? String(input.verifiedAt || '').trim() : '',
    enabled: Boolean(verified && input.enabled)
  };
}

export function maskEmailAddress(value = '') {
  const email = normalizeEmailAddress(value);
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!local || !domain) return '';
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.min(Math.max(local.length - visible.length, 2), 6))}@${domain}`;
}

export function escapeEmailHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(value = '', max = 5000) {
  return String(value || '').slice(0, max);
}

function text(value = '', max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function finiteNumber(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function isExchangeSwitchNotification(notification = {}) {
  return notification?.eventType === 'switch-strategy-trigger'
    && text(notification?.params?.trigger, 64) === 'switch-threshold';
}

function switchCodes(notification = {}) {
  const fromCode = text(notification?.params?.code || notification?.symbol, 24);
  const toCode = text(notification?.params?.targetCode, 24);
  return { fromCode, toCode };
}

function switchGap(notification = {}) {
  const summary = text(notification?.summary, 500);
  const summaryMatch = summary.match(/([+-]?\d+(?:\.\d+)?)%\s*$/);
  if (summaryMatch) return finiteNumber(summaryMatch[1]);
  const body = text(notification?.body, 5000);
  const bodyMatch = body.match(/H[−-]L\s*([+-]?\d+(?:\.\d+)?)%/i);
  return bodyMatch ? finiteNumber(bodyMatch[1]) : null;
}

function switchLabels(notification = {}, fromCode = '', toCode = '') {
  const body = text(notification?.body, 5000);
  const match = body.match(/卖\s+(.+?)\s+→\s+买\s+([^\n]+)/);
  return {
    fromLabel: text(match?.[1] || fromCode, 120),
    toLabel: text(match?.[2] || toCode, 120)
  };
}

function switchRule(notification = {}) {
  const rule = text(notification?.params?.rule, 16).toUpperCase();
  return rule === 'A' || rule === 'B' ? rule : '';
}

function switchArrow(rule = '') {
  return rule === 'A' ? '低→高' : rule === 'B' ? '高→低' : '';
}

function eventTriggeredAt(notification = {}) {
  const eventId = text(notification?.eventId, 320);
  const match = eventId.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/);
  if (!match) return '';
  const parsed = Date.parse(`${match[1]}:00Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function formatShanghaiDateTime(value = '', { seconds = false } = {}) {
  const parsed = Date.parse(text(value, 80));
  if (!Number.isFinite(parsed)) return '';
  const options = {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  };
  if (seconds) options.second = '2-digit';
  return new Intl.DateTimeFormat('zh-CN', options).format(new Date(parsed)).replace(/\//g, '-');
}

function formatPrice(value) {
  const numberValue = finiteNumber(value);
  if (numberValue == null || numberValue <= 0) return '—';
  return numberValue >= 10 ? numberValue.toFixed(2) : numberValue.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function formatVolume(value) {
  const numberValue = finiteNumber(value);
  if (numberValue == null || numberValue < 0) return '—';
  if (numberValue >= 100000000) return `${(numberValue / 100000000).toFixed(2)}亿`;
  if (numberValue >= 10000) return `${(numberValue / 10000).toFixed(2)}万`;
  return String(Math.round(numberValue));
}

function sourceLabel(value = '') {
  const source = text(value, 32).toLowerCase();
  if (source === 'tencent') return '腾讯';
  if (source === 'sina') return '新浪备用';
  return source || '—';
}

function bestLevel(entry = {}, side = 'bid') {
  const book = entry?.orderBook && typeof entry.orderBook === 'object' ? entry.orderBook : {};
  const levels = Array.isArray(book.levels) ? book.levels : [];
  const top = levels.find((item) => Number(item?.level) === 1) || levels[0] || {};
  if (side === 'ask') {
    return {
      price: finiteNumber(top.askPrice ?? book.askPrice),
      volume: finiteNumber(top.askVolume ?? book.askVolume)
    };
  }
  return {
    price: finiteNumber(top.bidPrice ?? book.bidPrice),
    volume: finiteNumber(top.bidVolume ?? book.bidVolume)
  };
}

function embeddedOrderBookSnapshot(notification = {}) {
  const snapshot = notification?.marketSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.books || typeof snapshot.books !== 'object') return null;
  return {
    generatedAt: text(snapshot.capturedAt || snapshot.generatedAt, 80),
    source: text(snapshot.source, 80),
    books: snapshot.books,
    successCount: Number(snapshot.successCount) || 0,
    failureCount: Number(snapshot.failureCount) || 0
  };
}

export async function prepareSwitchEmailNotification(notification = {}) {
  if (!isExchangeSwitchNotification(notification)) return notification;
  if (embeddedOrderBookSnapshot(notification)) return notification;
  const { fromCode, toCode } = switchCodes(notification);
  if (!fromCode || !toCode) return notification;
  try {
    const snapshot = await fetchSwitchOrderBooks([fromCode, toCode]);
    return {
      ...notification,
      marketSnapshot: {
        capturedAt: snapshot.generatedAt || new Date().toISOString(),
        source: snapshot.source || 'tencent+sina-fallback',
        books: snapshot.books || {},
        successCount: Number(snapshot.successCount) || 0,
        failureCount: Number(snapshot.failureCount) || 0
      }
    };
  } catch (_error) {
    return {
      ...notification,
      marketSnapshot: {
        capturedAt: new Date().toISOString(),
        source: 'tencent+sina-fallback',
        books: {},
        successCount: 0,
        failureCount: 2
      }
    };
  }
}

function switchBookRows(orderBookSnapshot = {}, fromCode = '', toCode = '') {
  const books = orderBookSnapshot?.books && typeof orderBookSnapshot.books === 'object' ? orderBookSnapshot.books : {};
  const sell = books[fromCode] || null;
  const buy = books[toCode] || null;
  return {
    sell,
    buy,
    sellTop: bestLevel(sell, 'bid'),
    buyTop: bestLevel(buy, 'ask')
  };
}

export function buildSwitchEmailContent(notification = {}, orderBookSnapshot = {}, { dailyLimitReached = false } = {}) {
  const { fromCode, toCode } = switchCodes(notification);
  const rule = switchRule(notification);
  const arrow = switchArrow(rule);
  const gap = switchGap(notification);
  const gapText = gap == null ? '—' : `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}%`;
  const fromPremium = typeof notification?.fromPremiumPct === 'number' && Number.isFinite(notification.fromPremiumPct)
    ? notification.fromPremiumPct
    : null;
  const toPremium = typeof notification?.toPremiumPct === 'number' && Number.isFinite(notification.toPremiumPct)
    ? notification.toPremiumPct
    : null;
  const fromPremiumText = fromPremium == null ? '—' : `${fromPremium >= 0 ? '+' : ''}${fromPremium.toFixed(2)}%`;
  const toPremiumText = toPremium == null ? '—' : `${toPremium >= 0 ? '+' : ''}${toPremium.toFixed(2)}%`;
  const { fromLabel, toLabel } = switchLabels(notification, fromCode, toCode);
  const condition = text(notification?.triggerCondition, 1000);
  const strategyName = text(notification?.strategyName || '场内切换', 160);
  const triggeredAt = eventTriggeredAt(notification);
  const triggeredText = formatShanghaiDateTime(triggeredAt, { seconds: false });
  const capturedText = formatShanghaiDateTime(orderBookSnapshot?.generatedAt, { seconds: true });
  const { sell, buy, sellTop, buyTop } = switchBookRows(orderBookSnapshot, fromCode, toCode);
  const hasSellBook = sellTop.price != null;
  const hasBuyBook = buyTop.price != null;
  const sourceText = [
    sell ? `${fromCode} ${sourceLabel(sell.source)}` : '',
    buy ? `${toCode} ${sourceLabel(buy.source)}` : ''
  ].filter(Boolean).join(' · ');
  const subjectTime = triggeredText ? triggeredText.split(' ').pop() : '';
  const subjectText = `【切换提醒】${fromCode} → ${toCode}${gap != null ? `｜溢价差 ${gapText}` : ''}${subjectTime ? `｜${subjectTime}` : ''}`;

  const marketLines = [];
  if (hasSellBook) marketLines.push(`卖出参考 ${fromCode}：买一 ${formatPrice(sellTop.price)}，挂单量 ${formatVolume(sellTop.volume)}，触发溢价 ${fromPremiumText}`);
  if (hasBuyBook) marketLines.push(`买入参考 ${toCode}：卖一 ${formatPrice(buyTop.price)}，挂单量 ${formatVolume(buyTop.volume)}，触发溢价 ${toPremiumText}`);
  if (!marketLines.length) marketLines.push('盘口暂不可用，切换提醒仍正常发送。');
  if (capturedText) marketLines.push(`盘口快照：${capturedText}`);
  if (sourceText) marketLines.push(`盘口来源：${sourceText}`);

  const plainBody = [
    `${rule ? `切换 ${rule}${arrow ? ` ${arrow}` : ''}` : '切换提醒'}：${fromCode} → ${toCode}`,
    `策略溢价差：H-L ${gapText}`,
    condition ? `触发条件：${condition}` : '',
    `卖 ${fromLabel} → 买 ${toLabel}`,
    triggeredText ? `触发时间：${triggeredText}` : '',
    '',
    ...marketLines,
    '',
    '盘口只作为触发时附近的成交参考，下单前请再次核对实时价格、溢价和流动性。'
  ].filter((line, index, list) => line !== '' || (index > 0 && list[index - 1] !== '')).join('\n');

  const safe = {
    title: escapeEmailHtml(`切换 ${rule || ''}${arrow ? ` ${arrow}` : ''}`.trim() || '切换提醒'),
    pair: escapeEmailHtml(`${fromCode} → ${toCode}`),
    gap: escapeEmailHtml(gapText),
    strategy: escapeEmailHtml(strategyName),
    condition: escapeEmailHtml(condition || '—'),
    triggered: escapeEmailHtml(triggeredText || '—'),
    captured: escapeEmailHtml(capturedText || '—'),
    fromLabel: escapeEmailHtml(fromLabel),
    toLabel: escapeEmailHtml(toLabel),
    sellPrice: escapeEmailHtml(formatPrice(sellTop.price)),
    sellVolume: escapeEmailHtml(formatVolume(sellTop.volume)),
    fromPremium: escapeEmailHtml(fromPremiumText),
    buyPrice: escapeEmailHtml(formatPrice(buyTop.price)),
    buyVolume: escapeEmailHtml(formatVolume(buyTop.volume)),
    toPremium: escapeEmailHtml(toPremiumText),
    sellSource: escapeEmailHtml(sell ? sourceLabel(sell.source) : '不可用'),
    buySource: escapeEmailHtml(buy ? sourceLabel(buy.source) : '不可用')
  };

  const bookHtml = hasSellBook || hasBuyBook
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">
        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px;background:#fff">
          <div style="font-size:12px;color:#6b7280">卖出参考 · ${escapeEmailHtml(fromCode)}</div>
          <div style="font-size:13px;font-weight:700;margin-top:3px;color:#111827">${safe.fromLabel}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:6px">触发溢价 <strong style="color:#111827">${safe.fromPremium}</strong></div>
          <div style="font-size:12px;color:#6b7280;margin-top:12px">买一</div>
          <div style="font-size:24px;font-weight:800;line-height:1.2;color:#111827">${safe.sellPrice}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">挂单量 ${safe.sellVolume} · ${safe.sellSource}</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px;background:#fff">
          <div style="font-size:12px;color:#6b7280">买入参考 · ${escapeEmailHtml(toCode)}</div>
          <div style="font-size:13px;font-weight:700;margin-top:3px;color:#111827">${safe.toLabel}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:6px">触发溢价 <strong style="color:#111827">${safe.toPremium}</strong></div>
          <div style="font-size:12px;color:#6b7280;margin-top:12px">卖一</div>
          <div style="font-size:24px;font-weight:800;line-height:1.2;color:#111827">${safe.buyPrice}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">挂单量 ${safe.buyVolume} · ${safe.buySource}</div>
        </div>
      </div>`
    : '<div style="margin-top:16px;padding:14px;border:1px solid #e5e7eb;border-radius:12px;color:#6b7280;font-size:13px">盘口暂不可用，切换提醒仍正常发送。</div>';

  const detailUrl = text(notification?.detailUrl || notification?.url, 2000);
  const detailButtonHtml = detailUrl
    ? `<p style="margin:18px 0 0"><a href="${escapeEmailHtml(detailUrl)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111827;color:#fff;text-decoration:none">查看策略详情</a></p>`
    : '';
  const limitHtml = dailyLimitReached
    ? '<p style="margin:20px 0 0;color:#dc2626;font-weight:700">已达到邮件推荐限制</p>'
    : '';

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#111827;background:#f9fafb;padding:20px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px">
      <div style="font-size:12px;color:#6b7280">${safe.strategy}</div>
      <h2 style="font-size:20px;margin:4px 0 0">${safe.title}</h2>
      <div style="font-size:22px;font-weight:800;margin-top:2px">${safe.pair}</div>
      <div style="margin-top:14px;padding:12px 14px;border-radius:12px;background:#f3f4f6">
        <div style="font-size:12px;color:#6b7280">策略溢价差</div>
        <div style="font-size:22px;font-weight:800">H-L ${safe.gap}</div>
        <div style="font-size:13px;color:#4b5563;margin-top:6px">${safe.condition}</div>
      </div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:#6b7280">
        <span>触发时间 ${safe.triggered}</span>
        <span>盘口快照 ${safe.captured}</span>
      </div>
      ${bookHtml}
      <p style="margin:16px 0 0;font-size:12px;color:#6b7280">盘口只作为触发时附近的成交参考，下单前请再次核对实时价格、溢价和流动性。</p>
      ${detailButtonHtml}
      ${limitHtml}
    </div>
  </div>`;

  return { subjectText, plainBody, html };
}

export async function sendEmailMessage(env, { to, subject, text = '', html = '' } = {}) {
  const email = normalizeEmailAddress(to);
  if (!email) throw new Error('邮箱地址无效。');
  if (!env?.EMAIL || typeof env.EMAIL.send !== 'function') {
    throw new Error('未配置 Cloudflare Email Service 绑定。');
  }

  const fromEmail = normalizeEmailAddress(env.EMAIL_FROM || DEFAULT_FROM) || DEFAULT_FROM;
  const fromName = truncate(env.EMAIL_FROM_NAME || DEFAULT_FROM_NAME, 80);
  const normalizedSubject = truncate(subject || '美股策略助手通知', 160);
  const result = await env.EMAIL.send({
    to: email,
    from: { email: fromEmail, name: fromName },
    subject: normalizedSubject,
    text: truncate(text, 12000),
    html: truncate(html, 30000)
  });
  return result || {};
}

export async function sendVerifiedEmailNotification({
  email,
  title,
  body,
  summary,
  detailUrl,
  dailyLimitReached = false,
  ...notification
} = {}, env) {
  const config = normalizeEmailConfig(email);
  if (!config.address || !config.verified || !config.enabled) {
    return {
      channel: 'email',
      status: 'skipped',
      detail: '邮箱提醒未验证或未启用'
    };
  }

  const fullNotification = { ...notification, title, body, summary, detailUrl };
  const url = String(detailUrl || '').trim();
  let subjectText = String(title || summary || '策略提醒').trim();
  let plainBody = String(body || summary || '').trim();
  let customHtml = '';

  if (isExchangeSwitchNotification(fullNotification)) {
    let orderBookSnapshot = embeddedOrderBookSnapshot(fullNotification);
    if (!orderBookSnapshot) {
      const { fromCode, toCode } = switchCodes(fullNotification);
      orderBookSnapshot = { generatedAt: new Date().toISOString(), books: {}, errors: [] };
      try {
        orderBookSnapshot = await fetchSwitchOrderBooks([fromCode, toCode]);
      } catch (_error) {
        // 盘口是增强信息。获取失败时继续发原切换提醒，避免丢通知。
      }
    }
    const rendered = buildSwitchEmailContent(fullNotification, orderBookSnapshot, { dailyLimitReached });
    subjectText = rendered.subjectText;
    plainBody = rendered.plainBody;
    customHtml = rendered.html;
  }

  const subject = subjectText.startsWith('【美股策略助手】') || subjectText.startsWith('【切换提醒】')
    ? subjectText
    : `【美股策略助手】${subjectText}`;
  const safeTitle = escapeEmailHtml(subjectText);
  const safeBody = escapeEmailHtml(plainBody).replace(/\n/g, '<br>');
  const safeUrl = escapeEmailHtml(url);
  const limitText = dailyLimitReached ? '\n\n已达到邮件推荐限制，今日后续通知将不再通过邮件发送。' : '';
  const limitHtml = dailyLimitReached && !customHtml
    ? '<p style="margin:20px 0 0;color:#dc2626;font-weight:700">已达到邮件推荐限制</p>'
    : '';
  const linkHtml = url
    ? `<p style="margin:20px 0 0"><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111827;color:#fff;text-decoration:none">查看详情</a></p>`
    : '';
  const html = customHtml
    ? customHtml
    : `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#111827"><h2 style="font-size:18px;margin:0 0 12px">${safeTitle}</h2><div style="font-size:14px;color:#374151">${safeBody}</div>${linkHtml}${limitHtml}<p style="margin-top:24px;font-size:12px;color:#9ca3af">这是一封由美股策略助手自动发送的通知邮件。</p></div>`;

  const result = await sendEmailMessage(env, {
    to: config.address,
    subject,
    text: `${plainBody}${url ? `\n\n查看详情：${url}` : ''}${limitText}`,
    html
  });

  return {
    channel: 'email',
    status: 'delivered',
    detail: result?.messageId ? `邮件已提交发送（${result.messageId}）` : '邮件已提交发送'
  };
}