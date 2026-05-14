// LLM 工具调用循环：对接 OpenAI 兼容 /v1/chat/completions。
// 允许模型运行多轮 tool_calls，最多 8 轮。

import { SYSTEM_PROMPT, DEEP_DIVE_PROMPT, AGENT_GUIDE_PROMPT } from './prompts.js';
import { TOOL_DEFS, TOOL_HANDLERS, hostFromUrl } from './tools.js';

const MAX_ITERATIONS = 8;
const LLM_TIMEOUT_MS = 90_000;

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

async function callLLM({ baseUrl, apiKey, model, messages }) {
	const ctrl = new AbortController();
	const tid = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
	try {
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
			body: JSON.stringify({
				model,
				messages,
				tools: TOOL_DEFS,
				tool_choice: 'auto',
				temperature: 0.3,
				max_tokens: 4096,
			}),
			signal: ctrl.signal,
		});
		const text = await res.text();
		if (!res.ok) {
			return { ok: false, status: res.status, error: text.slice(0, 600) };
		}
		let data;
		try { data = JSON.parse(text); } catch { return { ok: false, error: 'invalid_json_from_llm', raw: text.slice(0, 400) }; }
		return { ok: true, data };
	} catch (err) {
		return { ok: false, error: String(err?.message || err) };
	} finally {
		clearTimeout(tid);
	}
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
	// Keep tool messages compact: at most ~3KB per message. The full data is
	// kept in our accumulator (so we can build sources) but the LLM only sees
	// a truncated JSON view to avoid blowing the context.
	if (!result) return 'null';
	let str = '';
	try { str = JSON.stringify(result); } catch { str = String(result); }
	if (str.length > 3000) str = str.slice(0, 3000) + '...[truncated]';
	return str;
}

export async function runAgent({ question, depth = 'fast', context = '' } = {}) {
	const started = Date.now();
	const baseUrl = process.env.OPENAI_BASE_URL;
	const apiKey = process.env.OPENAI_API_KEY;
	const model = process.env.OPENAI_MODEL || 'LongCat-Flash-Thinking-2601';
	if (!baseUrl || !apiKey) return { ok: false, error: 'missing_llm_env', baseUrlSet: !!baseUrl, apiKeySet: !!apiKey };
	if (!question || typeof question !== 'string') return { ok: false, error: 'question_required' };

	const systemContent = depth === 'deep' ? `${SYSTEM_PROMPT}\n\n${DEEP_DIVE_PROMPT}\n\n${AGENT_GUIDE_PROMPT}` : `${SYSTEM_PROMPT}\n\n${AGENT_GUIDE_PROMPT}`;
	const userContent = context && context.trim() ? `## 上下文\n${context.trim()}\n\n## 问题\n${question}` : `## 问题\n${question}`;

	const messages = [
		{ role: 'system', content: systemContent },
		{ role: 'user', content: userContent },
	];

	const trace = [];
	let aggregatedSources = [];
	let answer = '';
	let finalReason = 'unknown';
	let iterations = 0;

	for (let i = 0; i < MAX_ITERATIONS; i++) {
		iterations = i + 1;
		const llmRes = await callLLM({ baseUrl, apiKey, model, messages });
		if (!llmRes.ok) {
			return { ok: false, error: 'llm_call_failed', detail: llmRes.error, iterations, trace };
		}
		const choice = llmRes.data?.choices?.[0];
		const msg = choice?.message || {};
		const toolCalls = msg.tool_calls || [];

		// Push assistant message (drop reasoning_content; keep content + tool_calls).
		const assistantPush = { role: 'assistant', content: msg.content || '' };
		if (toolCalls.length) assistantPush.tool_calls = toolCalls;
		messages.push(assistantPush);

		if (!toolCalls.length) {
			answer = msg.content || '';
			finalReason = choice?.finish_reason || 'stop';
			break;
		}

		for (const call of toolCalls) {
			const name = call.function?.name;
			const args = safeJsonParse(call.function?.arguments);
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
			trace.push({ iter: i + 1, tool: name, args, ok: !!result?.ok, ms: tMs, error: result?.error });
			if (result?.sources) aggregatedSources.push(...result.sources);
			messages.push({
				role: 'tool',
				tool_call_id: call.id,
				content: summarizeToolResult(name, result),
			});
		}
	}

	if (!answer) {
		return {
			ok: false,
			error: 'no_answer',
			reason: finalReason,
			iterations,
			sources: dedupeSources(aggregatedSources),
			trace,
			elapsed_ms: Date.now() - started,
		};
	}

	const cleaned = stripTrailingSources(stripThinking(answer));
	return {
		ok: true,
		phase: 'M2-agent',
		depth,
		model,
		answer: cleaned,
		sources: dedupeSources(aggregatedSources),
		iterations,
		finish_reason: finalReason,
		elapsed_ms: Date.now() - started,
		trace,
	};
}
