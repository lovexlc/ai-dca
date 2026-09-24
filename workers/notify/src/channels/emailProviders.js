// 多邮件发送通道：Resend + Brevo + Cloudflare Email Service。
//
// 路由策略：按 EMAIL_PROVIDER_ORDER（默认 resend,brevo,cloudflare，即免费额度优先）
// 依次尝试；单个通道失败（网络错误 / 4xx / 5xx）自动降级到下一个。
// 配额感知：每个通道的日发送量记在 NOTIFY_STATE KV（emailq:<通道>:<UTC日期>），
// 达到日上限或当日收到过 429 的通道会被跳过。KV 为最终一致，计数是 soft guard。
//
// 需要用户侧配置（缺哪个就自动跳过哪个通道）：
//   Resend:    注册 resend.com，在 Domains 验证 freebacktrack.tech，
//              wrangler secret put RESEND_TOKEN
//   Brevo:     注册 brevo.com，验证发件域名，
//              wrangler secret put BREVO_API_KEY
//   Cloudflare: 已有 [[send_email]] 绑定 EMAIL，无需额外配置
//
// 可选调参（wrangler.toml [vars] 或 secret）：
//   EMAIL_PROVIDER_ORDER   默认 "resend,brevo,cloudflare"
//   RESEND_DAILY_LIMIT     默认 100（Resend 免费档 100/天）
//   BREVO_DAILY_LIMIT      默认 300（Brevo 免费档 300/天）
//   CF_EMAIL_DAILY_LIMIT   默认 200（CF 账号日配额，按信誉浮动）

const PROVIDER_NAMES = ['resend', 'brevo', 'cloudflare'];

const DEFAULT_DAILY_LIMITS = {
  resend: 100,
  brevo: 300,
  cloudflare: 200
};

const LIMIT_ENV_KEYS = {
  resend: 'RESEND_DAILY_LIMIT',
  brevo: 'BREVO_DAILY_LIMIT',
  cloudflare: 'CF_EMAIL_DAILY_LIMIT'
};

export const PROVIDER_LABELS = {
  resend: 'Resend',
  brevo: 'Brevo',
  cloudflare: 'Cloudflare'
};

export function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function quotaKey(provider, dateKey) {
  return `emailq:${provider}:${dateKey}`;
}

function exhaustedKey(provider, dateKey) {
  return `emailq:${provider}:${dateKey}:exhausted`;
}

function positiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function dailyLimit(env, provider) {
  return positiveInt(env?.[LIMIT_ENV_KEYS[provider]], DEFAULT_DAILY_LIMITS[provider]);
}

export function isProviderConfigured(env, provider) {
  if (provider === 'resend') return Boolean(String(env?.RESEND_TOKEN || '').trim());
  if (provider === 'brevo') return Boolean(String(env?.BREVO_API_KEY || '').trim());
  if (provider === 'cloudflare') return Boolean(env?.EMAIL && typeof env.EMAIL.send === 'function');
  return false;
}

export function providerOrder(env) {
  const raw = String(env?.EMAIL_PROVIDER_ORDER || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((name) => PROVIDER_NAMES.includes(name));
  const seen = new Set();
  const ordered = [];
  for (const name of [...raw, ...PROVIDER_NAMES]) {
    if (!seen.has(name)) {
      seen.add(name);
      ordered.push(name);
    }
  }
  return ordered;
}

async function readQuota(env, provider, dateKey) {
  try {
    const [countRaw, exhausted] = await Promise.all([
      env.NOTIFY_STATE.get(quotaKey(provider, dateKey)),
      env.NOTIFY_STATE.get(exhaustedKey(provider, dateKey))
    ]);
    const used = Number.parseInt(String(countRaw || '0'), 10);
    return {
      used: Number.isFinite(used) && used > 0 ? used : 0,
      exhausted: exhausted === '1'
    };
  } catch {
    return { used: 0, exhausted: false };
  }
}

async function bumpQuota(env, provider, dateKey) {
  try {
    const key = quotaKey(provider, dateKey);
    const raw = await env.NOTIFY_STATE.get(key);
    const used = Number.parseInt(String(raw || '0'), 10);
    const next = (Number.isFinite(used) && used > 0 ? used : 0) + 1;
    await env.NOTIFY_STATE.put(key, String(next), { expirationTtl: 48 * 3600 });
    return next;
  } catch {
    return 0;
  }
}

async function markExhausted(env, provider, dateKey) {
  try {
    await env.NOTIFY_STATE.put(exhaustedKey(provider, dateKey), '1', { expirationTtl: 48 * 3600 });
  } catch {
    // 标记失败不影响主流程
  }
}

// 返回本日可用的通道（已按优先级排序），供监控/调试使用。
export async function resolveEmailProviders(env, dateKey = utcDateKey()) {
  const kvAvailable = Boolean(env?.NOTIFY_STATE?.get);
  const result = [];
  for (const name of providerOrder(env)) {
    if (!isProviderConfigured(env, name)) continue;
    const limit = dailyLimit(env, name);
    let used = 0;
    let exhausted = false;
    if (kvAvailable) ({ used, exhausted } = await readQuota(env, name, dateKey));
    if (exhausted || used >= limit) continue;
    result.push({ name, used, limit, remaining: limit - used });
  }
  return result;
}

function isQuotaStatus(status) {
  return status === 429;
}

async function readErrorBody(resp) {
  try {
    const data = await resp.json();
    const message = data?.message || data?.error || data?.errors;
    if (message) return String(Array.isArray(message) ? message.join('; ') : message).slice(0, 200);
  } catch {
    // 不是 JSON，继续尝试 text
  }
  try {
    return String(await resp.text()).slice(0, 200);
  } catch {
    return '';
  }
}

function providerError(name, status, detail) {
  const error = new Error(`${name} 发送失败（HTTP ${status}）${detail ? `：${detail}` : ''}`);
  error.provider = name;
  error.status = status;
  error.quotaExceeded = isQuotaStatus(status);
  return error;
}

async function sendViaResend(env, payload) {
  const token = String(env.RESEND_TOKEN || '').trim();
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: payload.fromName ? `${payload.fromName} <${payload.fromEmail}>` : payload.fromEmail,
      to: [payload.to],
      subject: payload.subject,
      ...(payload.html ? { html: payload.html } : {}),
      ...(payload.text ? { text: payload.text } : {})
    })
  });
  if (!resp.ok) throw providerError('resend', resp.status, await readErrorBody(resp));
  const data = await resp.json().catch(() => ({}));
  return { messageId: data?.id ? String(data.id) : '', provider: 'resend' };
}

async function sendViaBrevo(env, payload) {
  const apiKey = String(env.BREVO_API_KEY || '').trim();
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: payload.fromName || undefined, email: payload.fromEmail },
      to: [{ email: payload.to }],
      subject: payload.subject,
      ...(payload.html ? { htmlContent: payload.html } : {}),
      textContent: payload.text || payload.subject
    })
  });
  if (!resp.ok) throw providerError('brevo', resp.status, await readErrorBody(resp));
  const data = await resp.json().catch(() => ({}));
  return { messageId: data?.messageId ? String(data.messageId) : '', provider: 'brevo' };
}

async function sendViaCloudflare(env, payload) {
  const result = await env.EMAIL.send({
    to: payload.to,
    from: { email: payload.fromEmail, name: payload.fromName },
    subject: payload.subject,
    text: payload.text,
    html: payload.html
  });
  return { messageId: result?.messageId ? String(result.messageId) : '', provider: 'cloudflare' };
}

const SENDERS = {
  resend: sendViaResend,
  brevo: sendViaBrevo,
  cloudflare: sendViaCloudflare
};

// payload: { fromEmail, fromName, to, subject, text, html }
// 成功返回 { messageId, provider }；全部通道失败时抛错。
export async function sendEmailViaProviders(env, payload, dateKey = utcDateKey()) {
  const candidates = await resolveEmailProviders(env, dateKey);
  if (!candidates.length) {
    throw new Error('没有可用的邮件发送通道（Resend/Brevo 未配置或配额已用完，Cloudflare Email 绑定不可用）。');
  }
  const failures = [];
  for (const { name } of candidates) {
    try {
      const result = await SENDERS[name](env, payload);
      await bumpQuota(env, name, dateKey);
      return result;
    } catch (error) {
      failures.push(error?.message || String(error));
      if (error?.quotaExceeded) await markExhausted(env, name, dateKey);
    }
  }
  throw new Error(`全部邮件通道发送失败：${failures.join('；')}`);
}
