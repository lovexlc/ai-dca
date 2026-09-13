import { loadCloudSession } from './authClient.js';
import { apiUrl } from './apiBase.js';
import { normalizeSwitchConfigShape } from './switchStrategySync.js';

const TEST_ENDPOINT = '/api/notify/switch/test';
const FEEDBACK_EVENT = 'ai-dca-switch-test-feedback';

function emitFeedback(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT, { detail }));
}

async function readJsonResponse(response) {
  const rawText = await response.text();
  if (!rawText) return {};
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return { error: rawText };
  }
}

export async function testSwitchConfig(config) {
  const showFeedback = config?.enabled === false;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (showFeedback) emitFeedback({ status: 'loading' });
  try {
    const session = loadCloudSession();
    const accessToken = String(session?.accessToken || '').trim();
    if (!accessToken) {
      const error = new Error('请先登录账户后测试换基配置。');
      error.status = 401;
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    const normalizedConfig = normalizeSwitchConfigShape(config);
    const response = await fetch(apiUrl(TEST_ENDPOINT), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ config: normalizedConfig })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error || `换基测试失败：状态 ${response.status}`);
      error.status = response.status;
      error.code = String(payload?.code || '');
      throw error;
    }
    if (showFeedback) emitFeedback({ status: 'success', payload, config: normalizedConfig, elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt });
    return payload;
  } catch (error) {
    if (showFeedback) emitFeedback({ status: 'error', message: error?.message || '测试失败', elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt });
    throw error;
  }
}
