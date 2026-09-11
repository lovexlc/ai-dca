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
  detailUrl
} = {}, env) {
  const config = normalizeEmailConfig(email);
  if (!config.address || !config.verified || !config.enabled) {
    return {
      channel: 'email',
      status: 'skipped',
      detail: '邮箱提醒未验证或未启用'
    };
  }

  const subjectText = String(title || summary || '策略提醒').trim();
  const subject = subjectText.startsWith('【美股策略助手】')
    ? subjectText
    : `【美股策略助手】${subjectText}`;
  const plainBody = String(body || summary || '').trim();
  const url = String(detailUrl || '').trim();
  const safeTitle = escapeEmailHtml(subjectText);
  const safeBody = escapeEmailHtml(plainBody).replace(/\n/g, '<br>');
  const safeUrl = escapeEmailHtml(url);
  const linkHtml = url
    ? `<p style="margin:20px 0 0"><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111827;color:#fff;text-decoration:none">查看详情</a></p>`
    : '';

  const result = await sendEmailMessage(env, {
    to: config.address,
    subject,
    text: `${plainBody}${url ? `\n\n查看详情：${url}` : ''}`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#111827"><h2 style="font-size:18px;margin:0 0 12px">${safeTitle}</h2><div style="font-size:14px;color:#374151">${safeBody}</div>${linkHtml}<p style="margin-top:24px;font-size:12px;color:#9ca3af">这是一封由美股策略助手自动发送的通知邮件。</p></div>`
  });

  return {
    channel: 'email',
    status: 'delivered',
    detail: result?.messageId ? `邮件已提交发送（${result.messageId}）` : '邮件已提交发送'
  };
}
