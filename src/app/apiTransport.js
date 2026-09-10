const DEFAULT_GET_RETRY_DELAY_MS = 180;

export function isTransientNetworkError(error) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();
  if (name === 'aborterror') return false;
  return name === 'typeerror'
    || /failed to fetch|load failed|network request failed|network error|econnreset|econnrefused|enotfound|socket|timeout/.test(message);
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

/** Retry one idempotent GET only when fetch itself fails before an HTTP response exists. */
export async function fetchWithGetRetry(input, init = {}, { retryDelayMs = DEFAULT_GET_RETRY_DELAY_MS } = {}) {
  const method = String(init?.method || 'GET').toUpperCase();
  try {
    return await fetch(input, init);
  } catch (error) {
    if (method !== 'GET' || init?.signal?.aborted || !isTransientNetworkError(error)) throw error;
    await delay(retryDelayMs, init?.signal);
    return fetch(input, init);
  }
}
