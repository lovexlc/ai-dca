const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const PREFERRED_MODELS = [
  'gpt-5.4-nano',
  'gemini-2.5-flash-lite',
  'gpt-5.4-mini',
  'claude-3-5-haiku',
  'claude-sonnet-4-5',
];
const PUTER_SCRIPT_URL = 'https://js.puter.com/v2/';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CHAT_TIMEOUT_MS = 12000;

let puterLoadPromise = null;
let modelListPromise = null;

export class PuterAuthRequiredError extends Error {
  constructor(message = '需要登录 Puter 后才能使用可选 AI 通道。') {
    super(message);
    this.name = 'PuterAuthRequiredError';
    this.code = 'PUTER_AUTH_REQUIRED';
  }
}

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

function getEnvModel() {
  return String(import.meta.env?.VITE_PUTER_GLM_MODEL || '').trim();
}

async function ensurePuterSession(puter) {
  const isSignedIn = puter?.auth?.isSignedIn;
  if (typeof isSignedIn !== 'function') return;

  const signedIn = await isSignedIn.call(puter.auth);
  if (!signedIn) {
    throw new PuterAuthRequiredError();
  }
}

function normalizeModelId(model) {
  if (typeof model === 'string') return model.trim();
  if (model && typeof model === 'object') return String(model.id || model.name || '').trim();
  return '';
}

export function selectPuterModelFromList(models, requestedModel = '') {
  const requested = String(requestedModel || '').trim();
  const available = (Array.isArray(models) ? models : [])
    .map((model) => ({
      id: normalizeModelId(model),
      aliases: Array.isArray(model?.aliases) ? model.aliases.map(normalizeModelId).filter(Boolean) : [],
    }))
    .filter((model) => model.id);

  if (!available.length) return requested || FALLBACK_MODEL;

  const allIds = new Set();
  for (const model of available) {
    allIds.add(model.id);
    for (const alias of model.aliases) allIds.add(alias);
  }

  if (requested && allIds.has(requested)) return requested;

  for (const preferred of PREFERRED_MODELS) {
    if (allIds.has(preferred)) return preferred;
  }

  const lightweight = available.find((model) => /(?:nano|flash-lite|mini|haiku)/i.test(model.id));
  return lightweight?.id || available[0].id;
}

async function listPuterModels(puter) {
  if (typeof puter?.ai?.listModels !== 'function') return [];
  if (!modelListPromise) {
    modelListPromise = Promise.resolve()
      .then(() => puter.ai.listModels())
      .then((models) => (Array.isArray(models) ? models : []))
      .catch((error) => {
        modelListPromise = null;
        throw error;
      });
  }
  return modelListPromise;
}

async function resolvePuterModel(puter, requestedModel = '') {
  const configuredModel = String(requestedModel || getEnvModel()).trim();
  try {
    const models = await withTimeout(
      listPuterModels(puter),
      'Puter 模型列表获取超时。',
      DEFAULT_TIMEOUT_MS
    );
    return selectPuterModelFromList(models, configuredModel);
  } catch (error) {
    console.warn('[puter] model discovery failed, using fallback model', error);
    return configuredModel || FALLBACK_MODEL;
  }
}

function readContentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        return item.text || item.content || item.value || '';
      })
      .filter(Boolean)
      .join('');
  }
  if (content && typeof content === 'object') {
    return content.text || content.content || content.value || '';
  }
  return '';
}

export function extractPuterText(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';

  const candidates = [
    payload.text,
    payload.delta,
    payload.response,
    payload.answer,
    readContentText(payload.message?.content),
    payload.choices?.[0]?.message?.content,
    payload.output?.[0]?.content?.[0]?.text,
    payload.output_text
  ];

  for (const candidate of candidates) {
    const text = readContentText(candidate);
    if (text.trim()) return text;
  }

  if (typeof payload.toString === 'function' && payload.toString !== Object.prototype.toString) {
    const text = payload.toString();
    if (typeof text === 'string' && text.trim() && text !== '[object Object]') return text;
  }

  return '';
}

function withTimeout(promise, message, timeoutMs = DEFAULT_CHAT_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

function readPuterError(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (payload.error) {
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error.message) return payload.error.message;
  }
  if (payload.type === 'error' && payload.message) return payload.message;
  return '';
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

export async function askPuterGlm({ question, symbols = [], context = '', model = '' } = {}) {
  if (!isPuterGlmEnabled()) {
    throw new Error('Puter AI 已关闭。');
  }

  const prompt = buildMarketsPrompt({ question, symbols, context });
  const puter = await waitForPuter();
  await ensurePuterSession(puter);
  const resolvedModel = await resolvePuterModel(puter, model);
  const payload = await withTimeout(
    puter.ai.chat(prompt, { model: resolvedModel, stream: false }),
    'Puter AI 响应超时。'
  );
  const answer = extractPuterText(payload).trim();

  if (!answer) {
    throw new Error('Puter AI 返回了空响应。');
  }

  return {
    answer,
    text: answer,
    model: resolvedModel,
    provider: 'puter',
    sources: []
  };
}

export async function askPuterGlmStream({
  question,
  symbols = [],
  context = '',
  model = '',
  onEvent
} = {}) {
  if (!isPuterGlmEnabled()) {
    throw new Error('Puter AI 已关闭。');
  }

  const prompt = buildMarketsPrompt({ question, symbols, context });
  const puter = await waitForPuter();
  await ensurePuterSession(puter);
  const resolvedModel = await resolvePuterModel(puter, model);
  onEvent?.({ type: 'progress', payload: { message: `正在连接 Puter AI（${resolvedModel}）…` } });

  const streamOrPayload = await withTimeout(
    puter.ai.chat(prompt, { model: resolvedModel, stream: true }),
    'Puter AI 建立流式响应超时。'
  );

  if (!streamOrPayload || typeof streamOrPayload[Symbol.asyncIterator] !== 'function') {
    const answer = extractPuterText(streamOrPayload).trim();
    if (!answer) throw new Error('Puter AI 返回了空响应。');
    onEvent?.({ type: 'token', payload: { delta: answer } });
    return { answer, text: answer, model: resolvedModel, provider: 'puter', sources: [] };
  }

  let answer = '';
  const iterator = streamOrPayload[Symbol.asyncIterator]();
  for (;;) {
    const next = await withTimeout(iterator.next(), 'Puter AI 流式响应超时。');
    if (next.done) break;
    const chunkError = readPuterError(next.value);
    if (chunkError) throw new Error('Puter AI 返回错误：' + chunkError);
    const delta = extractPuterText(next.value);
    if (!delta) continue;
    answer += delta;
    onEvent?.({ type: 'token', payload: { delta } });
  }

  const cleaned = answer.trim();
  if (!cleaned) {
    throw new Error('Puter AI 返回了空响应。');
  }

  return {
    answer: cleaned,
    text: cleaned,
    model: resolvedModel,
    provider: 'puter',
    sources: []
  };
}
