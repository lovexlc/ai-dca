import { normalizeEmailAddress, sendEmailMessage, escapeEmailHtml } from './channels/email.js';

async function hashText(value = '') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('');
}

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_MAX_ATTEMPTS = 5;
const USER_COOLDOWN_MS = 2 * 60 * 1000;
const EMAIL_WINDOW_10M_MS = 10 * 60 * 1000;
const EMAIL_WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const IP_WINDOW_10M_MS = 10 * 60 * 1000;

function randomDigits(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => String(value % 10)).join('');
}

function randomNonce(length = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function verificationKey(userId = '') {
  return `email-verification:${String(userId || '').trim()}`;
}

async function readRate(env, key) {
  const raw = await env.NOTIFY_STATE.get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

async function writeRate(env, key, timestamps, ttlSeconds) {
  await env.NOTIFY_STATE.put(key, JSON.stringify(timestamps), { expirationTtl: ttlSeconds });
}

async function assertRateLimit(env, key, { windowMs, max, now, ttlSeconds, message }) {
  const previous = await readRate(env, key);
  const active = previous.filter((value) => now - value < windowMs);
  if (active.length >= max) {
    const error = new Error(message);
    error.status = 429;
    throw error;
  }
  const next = [...active, now];
  await writeRate(env, key, next, ttlSeconds);
  return next;
}

export function getRequestIp(request) {
  return String(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown')
    .split(',')[0]
    .trim()
    .slice(0, 80);
}

export async function enforceEmailCodeRateLimits(env, { userId, email, ip, now = Date.now() } = {}) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedEmail = normalizeEmailAddress(email);
  if (!normalizedUserId || !normalizedEmail) throw new Error('邮箱验证参数无效。');
  const emailHash = await hashText(normalizedEmail);
  const ipHash = await hashText(ip || 'unknown');
  const userHash = await hashText(normalizedUserId);

  await assertRateLimit(env, `email-rate:user:${userHash}`, {
    windowMs: USER_COOLDOWN_MS,
    max: 1,
    now,
    ttlSeconds: 180,
    message: '验证码发送过于频繁，请 2 分钟后重试。'
  });
  await assertRateLimit(env, `email-rate:email10m:${emailHash}`, {
    windowMs: EMAIL_WINDOW_10M_MS,
    max: 3,
    now,
    ttlSeconds: 11 * 60,
    message: '该邮箱验证码发送过于频繁，请稍后重试。'
  });
  await assertRateLimit(env, `email-rate:email24h:${emailHash}`, {
    windowMs: EMAIL_WINDOW_24H_MS,
    max: 10,
    now,
    ttlSeconds: 25 * 60 * 60,
    message: '该邮箱今日验证码发送次数已达上限。'
  });
  await assertRateLimit(env, `email-rate:ip10m:${ipHash}`, {
    windowMs: IP_WINDOW_10M_MS,
    max: 10,
    now,
    ttlSeconds: 11 * 60,
    message: '当前网络验证码请求过于频繁，请稍后重试。'
  });
}

export async function createEmailVerification(env, { userId, email, ip } = {}) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedEmail = normalizeEmailAddress(email);
  if (!normalizedUserId || !normalizedEmail) {
    const error = new Error('请输入有效的邮箱地址。');
    error.status = 400;
    throw error;
  }

  await enforceEmailCodeRateLimits(env, { userId: normalizedUserId, email: normalizedEmail, ip });
  const code = randomDigits(6);
  const nonce = randomNonce(16);
  const now = Date.now();
  const expiresAt = now + EMAIL_CODE_TTL_MS;
  const codeHash = await hashText(`${normalizedUserId}:${normalizedEmail}:${code}:${nonce}`);
  const record = {
    email: normalizedEmail,
    nonce,
    codeHash,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    attempts: 0,
    verifiedAt: ''
  };

  await env.NOTIFY_STATE.put(verificationKey(normalizedUserId), JSON.stringify(record), { expirationTtl: 11 * 60 });

  const safeEmail = escapeEmailHtml(normalizedEmail);
  await sendEmailMessage(env, {
    to: normalizedEmail,
    subject: `【美股策略助手】邮箱验证码 ${code}`,
    text: `你正在绑定美股策略助手的邮件提醒。\n\n验证码：${code}\n\n10 分钟内有效。如果没有进行此操作，请忽略此邮件。`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#111827"><h2 style="font-size:18px">邮箱验证</h2><p>你正在为 ${safeEmail} 绑定美股策略助手的邮件提醒。</p><div style="font-size:30px;font-weight:700;letter-spacing:8px;margin:20px 0">${code}</div><p>验证码 10 分钟内有效。如果没有进行此操作，请忽略此邮件。</p></div>`
  });

  return { email: normalizedEmail, expiresAt: record.expiresAt };
}

async function readVerificationRecord(env, userId = '') {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return { key: '', record: null };
  const key = verificationKey(normalizedUserId);
  const raw = await env.NOTIFY_STATE.get(key);
  let record = null;
  try { record = raw ? JSON.parse(raw) : null; } catch { record = null; }
  return { key, record };
}

export async function verifyEmailCode(env, { userId, email, code, now = Date.now() } = {}) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedEmail = normalizeEmailAddress(email);
  const normalizedCode = String(code || '').trim();
  if (!normalizedUserId || !normalizedEmail || !/^\d{6}$/.test(normalizedCode)) {
    const error = new Error('邮箱或验证码格式不正确。');
    error.status = 400;
    throw error;
  }

  const { key, record } = await readVerificationRecord(env, normalizedUserId);
  if (!record || record.email !== normalizedEmail) {
    const error = new Error('验证码不存在或已失效，请重新发送。');
    error.status = 400;
    throw error;
  }
  if (Date.parse(record.expiresAt || '') <= now) {
    await env.NOTIFY_STATE.delete(key);
    const error = new Error('验证码已过期，请重新发送。');
    error.status = 400;
    throw error;
  }
  if (Number(record.attempts || 0) >= EMAIL_MAX_ATTEMPTS) {
    await env.NOTIFY_STATE.delete(key);
    const error = new Error('验证码错误次数过多，请重新发送。');
    error.status = 429;
    throw error;
  }

  const candidateHash = await hashText(`${normalizedUserId}:${normalizedEmail}:${normalizedCode}:${record.nonce}`);
  if (candidateHash !== record.codeHash) {
    record.attempts = Number(record.attempts || 0) + 1;
    if (record.attempts >= EMAIL_MAX_ATTEMPTS) {
      await env.NOTIFY_STATE.delete(key);
    } else {
      await env.NOTIFY_STATE.put(key, JSON.stringify(record), { expirationTtl: 11 * 60 });
    }
    const error = new Error(record.attempts >= EMAIL_MAX_ATTEMPTS ? '验证码错误次数过多，请重新发送。' : '验证码错误。');
    error.status = record.attempts >= EMAIL_MAX_ATTEMPTS ? 429 : 400;
    throw error;
  }

  record.verifiedAt = record.verifiedAt || new Date(now).toISOString();
  await env.NOTIFY_STATE.put(key, JSON.stringify(record), { expirationTtl: 11 * 60 });
  return { email: normalizedEmail, verifiedAt: record.verifiedAt, expiresAt: record.expiresAt };
}

export async function getVerifiedEmailVerification(env, { userId, email, now = Date.now() } = {}) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedEmail = normalizeEmailAddress(email);
  const { key, record } = await readVerificationRecord(env, normalizedUserId);
  if (!key || !record || record.email !== normalizedEmail || !record.verifiedAt) {
    const error = new Error('邮箱尚未完成验证码验证，请重新验证。');
    error.status = 400;
    throw error;
  }
  if (Date.parse(record.expiresAt || '') <= now) {
    await env.NOTIFY_STATE.delete(key);
    const error = new Error('邮箱验证已过期，请重新发送验证码。');
    error.status = 400;
    throw error;
  }
  return { email: normalizedEmail, verifiedAt: String(record.verifiedAt || '') };
}

export async function clearEmailVerification(env, userId = '') {
  const key = verificationKey(userId);
  if (key !== 'email-verification:') {
    await env.NOTIFY_STATE.delete(key);
  }
}
