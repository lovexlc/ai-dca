const DEFAULT_MODEL = 'z-ai/glm-5.2';
const PUTER_SCRIPT_URL = 'https://js.puter.com/v2/';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CHAT_TIMEOUT_MS = 12000;

let puterLoadPromise = null;

function readEnvFlag(name, fallback = true) {
  const value = String(import.meta.env?.[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  if (['0', 'false', 'off', 'no'].includes(value)) return false;
  if (['1', 'true', 'on', 'yes'].includes(value)) return true;
  return fallback;
}

export function isPuterGlmEnabled() {
  return readEnvFlag('VITE_PUTER_GLM_ENABLED', true);
}

function getPuter() {
  if (typeof window === 'undefined') return null;
  const puter = window.puter;
  return puter && puter.ai && typeof puter.ai.chat === 'function' ? puter : null;
}

function loadPuterScript() {
  const existing = getPuter();
  if (existing) return Promise.resolve(existing);
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Puter.js 仅能在浏览器端调用。'));
  }

  if (puterLoadPromise) return puterLoadPromise;

  puterLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${PUTER_SCRIPT_URL}"]`);
    const script = existingScript || document.createElement('script');
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Puter.js 加载超时。'));
    }, DEFAULT_TIMEOUT_MS);

    const waitUntilReady = () => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        const puter = getPuter();
        if (puter) {
          window.clearInterval(timer);
          window.clearTimeout(timeoutId);
          settled = true;
          resolve(puter);
          return;
        }
        if (Date.now() - startedAt > DEFAULT_TIMEOUT_MS) {
          window.clearInterval(timer);
          window.clearTimeout(timeoutId);
          settled = true;
          reject(new Error('Puter.js 已加载但 AI 接口未就绪。'));
        }
      }, 100);
    };

    script.addEventListener('load', waitUntilReady, { once: true });
    script.addEventListener('error', () => {
      if (settled) return;
      window.clearTimeout(timeoutId);
      settled = true;
      reject(new Error('Puter.js 加载失败。'));
    }, { once: true });

    if (!existingScript) {
      script.src = PUTER_SCRIPT_URL;
      script.async = true;
      script.dataset.puterSdk = 'true';
      document.head.appendChild(script);
    } else {
      waitUntilReady();
    }
  }).catch((error) => {
    puterLoadPromise = null;
    throw error;
  });

  return puterLoadPromise;
}

async function waitForPuter(timeoutMs = DEFAULT_TIMEOUT_MS) {
  await loadPuterScript();
  if (typeof window === 'undefined') {
    throw new Error('Puter.js 仅能在浏览器端调用。');
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    const puter = getPuter();
    if (puter) return puter;
  }

  throw new Error('Puter.js 加载超时。');
}

function extractText(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';

  const candidates = [
    payload.text,
    payload.delta,
    payload.response,
    payload.answer,
    payload.message?.content,
    payload.choices?.[0]?.message?.content,
    payload.output?.[0]?.content?.[0]?.text,
    payload.output_text
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }

  return '';
}

function withTimeout(promise, message, timeoutMs = DEFAULT_CHAT_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

function buildMarketsPrompt({ question, symbols = [], context = '' }) {
  const normalizedSymbols = (Array.isArray(symbols) ? symbols : [])
    .map((symbol) => String(symbol || '').trim())
    .filter(Boolean)
    .slice(0, 10);

  const lines = [
    '你是一个专注于金融市场的中文助手。',
    '要求：',
    '1. 使用中文回答，结论放在最前。',
    '2. 可以分析趋势、估值、风险和需要关注的信号，但不要给出买入、卖出或持有的明确指令。',
    '3. 涉及价格、涨跌幅和交易代码时，只能使用下方上下文中提供的数据；上下文没有的数据请明确说明无法确认。',
    '4. 不要编造最新新闻、实时价格或来源链接。',
    '',
    '## 上下文'
  ];

  if (context && String(context).trim()) {
    lines.push(String(context).trim());
  } else {
    lines.push('暂无额外上下文。');
  }

  if (normalizedSymbols.length) {
    lines.push('');
    lines.push(`监控标的：${normalizedSymbols.join(', ')}`);
  }

  lines.push('');
  lines.push('## 问题');
  lines.push(String(question || '').trim());

  return lines.join('\n');
}

export async function askPuterGlm({ question, symbols = [], context = '', model = DEFAULT_MODEL } = {}) {
  if (!isPuterGlmEnabled()) {
    throw new Error('Puter GLM 已关闭。');
  }

  const prompt = buildMarketsPrompt({ question, symbols, context });
  const puter = await waitForPuter();
  const payload = await withTimeout(
    puter.ai.chat(prompt, { model, stream: false }),
    'Puter GLM 响应超时。'
  );
  const answer = extractText(payload).trim();

  if (!answer) {
    throw new Error('Puter GLM 返回了空响应。');
  }

  return {
    answer,
    text: answer,
    model,
    provider: 'puter',
    sources: []
  };
}

export async function askPuterGlmStream({
  question,
  symbols = [],
  context = '',
  model = DEFAULT_MODEL,
  onEvent
} = {}) {
  if (!isPuterGlmEnabled()) {
    throw new Error('Puter GLM 已关闭。');
  }

  const prompt = buildMarketsPrompt({ question, symbols, context });
  const puter = await waitForPuter();
  onEvent?.({ type: 'progress', payload: { message: '正在连接 Puter GLM…' } });

  const streamOrPayload = await withTimeout(
    puter.ai.chat(prompt, { model, stream: true }),
    'Puter GLM 建立流式响应超时。'
  );

  if (!streamOrPayload || typeof streamOrPayload[Symbol.asyncIterator] !== 'function') {
    const answer = extractText(streamOrPayload).trim();
    if (!answer) throw new Error('Puter GLM 返回了空响应。');
    onEvent?.({ type: 'token', payload: { delta: answer } });
    return { answer, text: answer, model, provider: 'puter', sources: [] };
  }

  let answer = '';
  const iterator = streamOrPayload[Symbol.asyncIterator]();
  for (;;) {
    const next = await withTimeout(iterator.next(), 'Puter GLM 流式响应超时。');
    if (next.done) break;
    const delta = extractText(next.value);
    if (!delta) continue;
    answer += delta;
    onEvent?.({ type: 'token', payload: { delta } });
  }

  const cleaned = answer.trim();
  if (!cleaned) {
    throw new Error('Puter GLM 返回了空响应。');
  }

  return {
    answer: cleaned,
    text: cleaned,
    model,
    provider: 'puter',
    sources: []
  };
}
