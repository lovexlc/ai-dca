// LLM 工具调用循环。
// 两个入口:
//   runAgent({question, depth, context})        — 同步，返回完整 JSON。
//   runAgentStream({question, depth, context, emit}) — 调用 emit() 发 SSE 事件。
//
// emit 事件类型:
//   {type:'progress', step, total, brief}
//   {type:'tool_start', name, args, iter}
//   {type:'tool_end',   name, ok, ms, iter, error?}
//   {type:'source',     title, url, source}
//   {type:'token',      delta}
//   {type:'done',       answer, sources, iterations, model, models_used, used_fallback, elapsed_ms}
//   {type:'error',      message, detail?, trace?, sources?}
//
// 限流 / 网络抖动时：指数退避重试 3 次，依然失败则降级到非 thinking 备用模型。

import { SYSTEM_PROMPT, DEEP_DIVE_PROMPT, AGENT_GUIDE_PROMPT } from './prompts.js';
import { TOOL_DEFS, TOOL_HANDLERS, hostFromUrl } from './tools.js';

const MAX_ITERATIONS = 8;
const LLM_TIMEOUT_MS = 180_000;
const FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || 'LongCat-Flash-Chat';
const RETRY_DELAYS_MS = [3000, 8000, 15000];

function stripThinking(text) {
	let t = String(text || '');
	t = t.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
	t = t.replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/gi, '');
	t = t.replace(/<reasoning>[\s\S]*?(?:<\/reasoning>|$)/gi, '');
	t = t.replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, '');
	t = t.replace(/\u25C1think\u25B7[\s\S]*?(?:\u25C1\/think\u25B7|$)/gi, '');
	t = t.replace(/```\s*(?:thinking|think|reasoning)[\s\S]*?```/gi, '');
	t = t.replace(/^\s*(?:\[?\s*(?:Thinking|Reasoning|思考|推理)\s*\]?)[:\uFF1A]?[\s\S]*?\n\s*\n/i, '');
	return t.trim();
}

function stripTrailingSources(text) {
	const HEADING_RE = /(?:^|\n)\s*(?:#{1,6}\s*)?\**\s*(?:参考来源|来源|引用|资料来源|sources|references)\s*\**\s*[:\u3002\uFF1A]?\s*\n/gi;
	let cleaned = text;
	let lastIdx = -1;
	let m;
	while ((m = HEADING_RE.exec(cleaned)) !== null) lastIdx = m.index;
	if (lastIdx >= 0) cleaned = cleaned.slice(0, lastIdx).replace(/\s+$/, '');
	return cleaned;
}

function safeJsonParse(s) {
	if (typeof s !== 'string') return s || {};
	try { return JSON.parse(s); } catch { return { __raw: s.slice(0, 400), __parse_error: true }; }
}

function dedupeSources(list) {
	const seen = new Set();
	const out = [];
	for (const s of list || []) {
		if (!s || !s.url) continue;
		if (seen.has(s.url)) continue;
		seen.add(s.url);
		out.push({ title: s.title || null, url: s.url, source: s.source || hostFromUrl(s.url) });
	}
	return out;
}

function summarizeToolResult(name, result) {
	if (!result) return 'null';
	let str = '';
	try { str = JSON.stringify(result); } catch { str = String(result); }
	if (str.length > 3000) str = str.slice(0, 3000) + '...[truncated]';
	return str;
}

// -------- Non-streaming LLM call --------
async function callLLMOnce({ baseUrl, apiKey, model, messages, signal }) {
	const localCtrl = new AbortController();
	const tid = setTimeout(() => localCtrl.abort(), LLM_TIMEOUT_MS);
	const combinedSignal = signal ? anySignal([signal, localCtrl.signal]) : localCtrl.signal;
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
			body: JSON.stringify({
				model, messages, tools: TOOL_DEFS, tool_choice: 'auto',
				temperature: 0.3, max_tokens: 4096,
			}),
			signal: combinedSignal,
		});
		const text = await res.text();
		if (!res.ok) {
			const retryable = [429, 502, 503, 504].includes(res.status);
			return { ok: false, status: res.status, error: text.slice(0, 600), retryable };
		}
		let data;
		try { data = JSON.parse(text); } catch { return { ok: false, error: 'invalid_json_from_llm', raw: text.slice(0, 400), retryable: false }; }
		const msg = data?.choices?.[0]?.message || {};
		return {
			ok: true,
			content: msg.content || '',
			tool_calls: msg.tool_calls || [],
			finish_reason: data?.choices?.[0]?.finish_reason || null,
		};
	} catch (err) {
		return { ok: false, error: String(err?.message || err), retryable: false };
	} finally {
		clearTimeout(tid);
	}
}

// -------- Streaming LLM call (parses LongCat SSE -> deltas) --------
async function callLLMStream({ baseUrl, apiKey, model, messages, signal, onContentDelta }) {
	const localCtrl = new AbortController();
	const tid = setTimeout(() => localCtrl.abort(), LLM_TIMEOUT_MS);
	const combinedSignal = signal ? anySignal([signal, localCtrl.signal]) : localCtrl.signal;
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, accept: 'text/event-stream' },
			body: JSON.stringify({
				model, messages, tools: TOOL_DEFS, tool_choice: 'auto',
				temperature: 0.3, max_tokens: 4096, stream: true,
			}),
			signal: combinedSignal,
		});
		if (!res.ok) {
			const body = await res.text();
			const retryable = [429, 502, 503, 504].includes(res.status);
			return { ok: false, status: res.status, error: body.slice(0, 600), retryable };
		}
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		let content = '';
		const toolCalls = [];
		let finishReason = null;
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let nl;
			while ((nl = buf.indexOf('\n')) !== -1) {
				const line = buf.slice(0, nl).replace(/\r$/, '');
				buf = buf.slice(nl + 1);
				if (!line.startsWith('data:')) continue;
				const payload = line.slice(5).trim();
				if (!payload || payload === '[DONE]') continue;
				let chunk;
				try { chunk = JSON.parse(payload); } catch { continue; }
				const choice = chunk?.choices?.[0];
				if (!choice) continue;
				const delta = choice.delta || {};
				if (typeof delta.content === 'string' && delta.content.length > 0) {
					content += delta.content;
					if (onContentDelta) {
						try { onContentDelta(delta.content); } catch {}
					}
				}
				if (Array.isArray(delta.tool_calls)) {
					for (const tc of delta.tool_calls) {
						const idx = typeof tc.index === 'number' ? tc.index : 0;
						if (!toolCalls[idx]) toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
						if (tc.id) toolCalls[idx].id = tc.id;
						if (tc.type) toolCalls[idx].type = tc.type;
						if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
						if (typeof tc.function?.arguments === 'string') toolCalls[idx].function.arguments += tc.function.arguments;
					}
				}
				if (choice.finish_reason) finishReason = choice.finish_reason;
			}
		}
		return { ok: true, content, tool_calls: toolCalls.filter(Boolean), finish_reason: finishReason };
	} catch (err) {
		return { ok: false, error: String(err?.message || err), retryable: false };
	} finally {
		clearTimeout(tid);
	}
}

// Combine multiple AbortSignals so the first to abort wins.
function anySignal(signals) {
	const ctrl = new AbortController();
	for (const s of signals) {
		if (!s) continue;
		if (s.aborted) { ctrl.abort(); break; }
		s.addEventListener('abort', () => ctrl.abort(), { once: true });
	}
	return ctrl.signal;
}

// -------- Retry + fallback wrappers --------
async function withRetryFallback(callFn, modelInitial) {
	let lastErr = null;
	let model = modelInitial;
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
		const r = await callFn(model);
		if (r.ok) return { ...r, model_used: model, attempts: attempt + 1 };
		lastErr = r;
		const errStr = r.error || '';
		const rateLimited = r.retryable || /rate_limit|too_many_requests|超过限制|容量/i.test(errStr);
		if (!rateLimited || attempt === RETRY_DELAYS_MS.length) break;
		await new Promise((res) => setTimeout(res, RETRY_DELAYS_MS[attempt]));
	}
	if (modelInitial !== FALLBACK_MODEL) {
		const r2 = await callFn(FALLBACK_MODEL);
		if (r2.ok) return { ...r2, model_used: FALLBACK_MODEL, fallback: true };
		return { ok: false, model_used: FALLBACK_MODEL, error: r2.error || lastErr?.error, fallback_failed: true };
	}
	return { ok: false, model_used: model, error: lastErr?.error };
}

// -------- Core loop, parameterized by call mode --------
async function runLoop({ question, depth = 'fast', context = '', emit, signal, streaming }) {
	const started = Date.now();
	const baseUrl = process.env.OPENAI_BASE_URL;
	const apiKey = process.env.OPENAI_API_KEY;
	const modelInitial = process.env.OPENAI_MODEL || 'LongCat-Flash-Thinking-2601';
	if (!baseUrl || !apiKey) return { ok: false, error: 'missing_llm_env' };
	if (!question || typeof question !== 'string') return { ok: false, error: 'question_required' };

	const systemContent = depth === 'deep'
		? `${SYSTEM_PROMPT}\n\n${DEEP_DIVE_PROMPT}\n\n${AGENT_GUIDE_PROMPT}`
		: `${SYSTEM_PROMPT}\n\n${AGENT_GUIDE_PROMPT}`;
	const userContent = context && context.trim()
		? `## 上下文\n${context.trim()}\n\n## 问题\n${question}`
		: `## 问题\n${question}`;

	const messages = [
		{ role: 'system', content: systemContent },
		{ role: 'user', content: userContent },
	];

	const trace = [];
	const aggregatedSources = [];
	const seenSourceUrls = new Set();
	let answer = '';
	let finalReason = 'unknown';
	let iterations = 0;
	const modelsUsed = new Set();
	let usedFallback = false;

	const safeEmit = (ev) => { if (emit) { try { emit(ev); } catch {} } };

	for (let i = 0; i < MAX_ITERATIONS; i++) {
		iterations = i + 1;
		safeEmit({ type: 'progress', step: iterations, total: MAX_ITERATIONS, brief: `第 ${iterations} 轮推理` });

		const callOnce = (model) => streaming
			? callLLMStream({ baseUrl, apiKey, model, messages, signal, onContentDelta: (d) => safeEmit({ type: 'token', delta: d }) })
			: callLLMOnce({ baseUrl, apiKey, model, messages, signal });
		const r = await withRetryFallback(callOnce, modelInitial);
		if (r.model_used) modelsUsed.add(r.model_used);
		if (r.fallback) usedFallback = true;
		if (!r.ok) {
			safeEmit({ type: 'error', message: 'llm_call_failed', detail: (r.error || '').slice(0, 400) });
			return {
				ok: false, error: 'llm_call_failed', detail: r.error,
				models_used: [...modelsUsed], iterations, trace,
				sources: dedupeSources(aggregatedSources), elapsed_ms: Date.now() - started,
			};
		}
		const toolCalls = r.tool_calls || [];

		const assistantPush = { role: 'assistant', content: r.content || '' };
		if (toolCalls.length) assistantPush.tool_calls = toolCalls;
		messages.push(assistantPush);

		if (!toolCalls.length) {
			answer = r.content || '';
			finalReason = r.finish_reason || 'stop';
			break;
		}

		for (const call of toolCalls) {
			const name = call.function?.name;
			const args = safeJsonParse(call.function?.arguments);
			safeEmit({ type: 'tool_start', iter: iterations, name, args });
			const handler = TOOL_HANDLERS[name];
			let result;
			const tStart = Date.now();
			if (!handler) {
				result = { ok: false, error: `unknown_tool:${name}` };
			} else if (args && args.__parse_error) {
				result = { ok: false, error: 'invalid_tool_arguments_json', raw: args.__raw };
			} else {
				try { result = await handler(args || {}); } catch (err) { result = { ok: false, error: String(err?.message || err) }; }
			}
			const tMs = Date.now() - tStart;
			trace.push({ iter: iterations, tool: name, args, ok: !!result?.ok, ms: tMs, error: result?.error });
			safeEmit({ type: 'tool_end', iter: iterations, name, ok: !!result?.ok, ms: tMs, error: result?.error });
			if (result?.sources) {
				for (const s of result.sources) {
					if (!s?.url || seenSourceUrls.has(s.url)) continue;
					seenSourceUrls.add(s.url);
					const src = { title: s.title || null, url: s.url, source: s.source || hostFromUrl(s.url) };
					aggregatedSources.push(src);
					safeEmit({ type: 'source', ...src });
				}
			}
			messages.push({
				role: 'tool',
				tool_call_id: call.id,
				content: summarizeToolResult(name, result),
			});
		}
	}

	if (!answer) {
		safeEmit({ type: 'error', message: 'no_answer', detail: finalReason });
		return {
			ok: false, error: 'no_answer', reason: finalReason,
			iterations, models_used: [...modelsUsed],
			sources: dedupeSources(aggregatedSources), trace,
			elapsed_ms: Date.now() - started,
		};
	}

	const cleaned = stripTrailingSources(stripThinking(answer));
	const doneEvent = {
		type: 'done',
		answer: cleaned,
		sources: dedupeSources(aggregatedSources),
		iterations,
		model: modelInitial,
		models_used: [...modelsUsed],
		used_fallback: usedFallback,
		elapsed_ms: Date.now() - started,
	};
	safeEmit(doneEvent);
	return {
		ok: true, phase: 'M2-agent', depth,
		model: modelInitial, models_used: [...modelsUsed], used_fallback: usedFallback,
		answer: cleaned, sources: dedupeSources(aggregatedSources),
		iterations, finish_reason: finalReason,
		elapsed_ms: Date.now() - started, trace,
	};
}

export async function runAgent(args = {}) {
	return runLoop({ ...args, streaming: false });
}

export async function runAgentStream(args = {}) {
	return runLoop({ ...args, streaming: true });
}
