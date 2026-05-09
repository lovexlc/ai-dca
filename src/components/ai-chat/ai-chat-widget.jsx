import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  X,
  Send,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '../../styles/ai-chat.css';

const CHAT_ENDPOINT = '/api/ai-chat';
const STORAGE_KEY = 'aiDcaChatHistory_v1';
const MAX_HISTORY = 30;

const NUDGE_TEXT = '遇到问题了？点我给你解答';
const NUDGE_INITIAL_DELAY_MS = 6000;
const NUDGE_VISIBLE_MS = 7000;
const NUDGE_HIDDEN_MS = 30000;
const NUDGE_DISMISS_KEY = 'aiDcaChatNudgeDismissed_v1';

function isNudgeDismissed() {
  try {
    return sessionStorage.getItem(NUDGE_DISMISS_KEY) === '1';
  } catch (err) {
    return false;
  }
}

function markNudgeDismissed() {
  try {
    sessionStorage.setItem(NUDGE_DISMISS_KEY, '1');
  } catch (err) {
    /* ignore */
  }
}

const SYSTEM_PROMPT =
  '你是 ai-dca 内置的 AI 助手，帮助用户理解定投策略、持仓回测、基金切换等功能，' +
  '回答简洁、准确、用中文。涉及具体投资建议时提醒用户自行判断风险，不要给出绝对收益承诺。';

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && typeof m.role === 'string' && typeof m.content === 'string')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));
  } catch (err) {
    return [];
  }
}

function persistHistory(messages) {
  try {
    const trimmed = messages.slice(-MAX_HISTORY).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    /* ignore quota */
  }
}

const TAB_LABELS = {
  home: '首页',
  holdings: '持仓',
  tradePlans: '交易计划',
  fundSwitch: '基金切换',
  history: '交易历史',
  notify: '提醒中心',
  backup: '数据备份',
};

// 解析一条 SSE frame，返回 {event, data}。
function parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  let event = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  return { event, data: dataLines.join('\n') };
}

// 从 LLM 流 chunk 中抽出 token delta。
function extractDelta(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj.response === 'string') return obj.response;
  if (typeof obj.delta === 'string') return obj.delta;
  if (Array.isArray(obj.choices) && obj.choices[0]) {
    const c = obj.choices[0];
    if (c.delta && typeof c.delta.content === 'string') return c.delta.content;
    if (c.message && typeof c.message.content === 'string') return c.message.content;
  }
  if (typeof obj.text === 'string') return obj.text;
  return '';
}

export function AiChatWidget({ currentTab, pageContext } = {}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(() => loadHistory());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [nudgeMuted, setNudgeMuted] = useState(() => isNudgeDismissed());
  const listRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    persistHistory(messages);
  }, [messages]);

  useEffect(() => {
    function onExternalOpen() { setOpen(true); }
    window.addEventListener('aichat:open', onExternalOpen);
    return () => window.removeEventListener('aichat:open', onExternalOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
    if (textareaRef.current) textareaRef.current.focus();
  }, [open, messages, pending]);

  useEffect(() => {
    if (open && !nudgeMuted) {
      setNudgeMuted(true);
      markNudgeDismissed();
    }
  }, [open, nudgeMuted]);

  useEffect(() => {
    if (open || nudgeMuted) {
      setNudgeOpen(false);
      return undefined;
    }
    let timer = null;
    let cancelled = false;
    const schedule = (delay, makeVisible) => {
      timer = setTimeout(() => {
        if (cancelled) return;
        setNudgeOpen(makeVisible);
        schedule(makeVisible ? NUDGE_VISIBLE_MS : NUDGE_HIDDEN_MS, !makeVisible);
      }, delay);
    };
    schedule(NUDGE_INITIAL_DELAY_MS, true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setNudgeOpen(false);
    };
  }, [open, nudgeMuted]);

  const handleNudgeOpen = useCallback(() => {
    setOpen(true);
    setNudgeOpen(false);
  }, []);

  const handleNudgeDismiss = useCallback((event) => {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    setNudgeOpen(false);
    setNudgeMuted(true);
    markNudgeDismissed();
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setError('');
  }, []);

  const handleReset = useCallback(() => {
    setMessages([]);
    setError('');
  }, []);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || pending) return;
    setError('');
    const userMessage = { role: 'user', content };
    const nextHistory = [...messages, userMessage];
    setMessages(nextHistory);
    // 占位的 assistant 流式气泡。
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
    setInput('');
    setPending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const tabLabel = currentTab ? (TAB_LABELS[currentTab] || currentTab) : '';
      const ctxParts = [];
      if (tabLabel) ctxParts.push(`用户当前所在页面：${tabLabel}`);
      if (typeof pageContext === 'string' && pageContext.trim()) {
        ctxParts.push(pageContext.trim().slice(0, 1500));
      }
      const payload = {
        system: SYSTEM_PROMPT,
        stream: true,
        messages: nextHistory.slice(-MAX_HISTORY).map((m) => ({
          role: m.role,
          content: m.content,
        })),
        ...(ctxParts.length > 0 ? { pageContext: ctxParts.join('\n\n') } : {}),
      };
      const res = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${text || ''}`.trim());
      }
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (!ctype.includes('text/event-stream') || !res.body) {
        // 非流式 fallback：当 JSON 返回时一次性渲染。
        const data = await res.json().catch(() => ({}));
        const reply =
          (typeof data?.reply === 'string' && data.reply) ||
          (typeof data?.response === 'string' && data.response) ||
          '';
        if (!reply) throw new Error(data?.error || '空响应');
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: reply };
          return next;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      let gotAny = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
          const m = buf.slice(idx).match(/^\r?\n\r?\n/);
          const sepLen = m ? m[0].length : 2;
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + sepLen);
          if (!frame.trim()) continue;
          const { event, data } = parseSseFrame(frame);
          if (!data) continue;
          if (data === '[DONE]') {
            buf = '';
            break;
          }
          if (event === 'meta') continue; // 携带 sources/model，暂不展示
          if (event === 'error') {
            try {
              const obj = JSON.parse(data);
              throw new Error(obj?.error || '上游流错误');
            } catch (e) {
              throw e instanceof Error ? e : new Error(String(e));
            }
          }
          let obj = null;
          try { obj = JSON.parse(data); } catch (_) { /* 非 JSON 的纯文本 chunk */ }
          const delta = obj ? extractDelta(obj) : data;
          if (delta) {
            acc += delta;
            gotAny = true;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') {
                next[next.length - 1] = { ...last, content: acc };
              }
              return next;
            });
          }
        }
      }
      if (!gotAny && !acc.trim()) {
        throw new Error('空响应');
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // 用户主动取消，不视为错误。
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`AI 服务暂不可用：${msg}`);
        // 回滚占位 assistant 气泡（仅当它仍是空的时候）。
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && !last.content) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  }, [input, messages, pending, currentTab, pageContext]);

  const handleStop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const placeholder = useMemo(
    () => (pending ? 'AI 正在思考…' : '问点什么，例如：定投策略怎么开始？'),
    [pending],
  );

  const canSend = !pending && !!input.trim();

  return (
    <>
      {!open ? (
        <>
          {nudgeOpen ? (
            <button
              type="button"
              className="ai-chat-nudge"
              onClick={handleNudgeOpen}
              aria-label={`${NUDGE_TEXT}（点击打开 AI 问答）`}
            >
              <span className="ai-chat-nudge__text">{NUDGE_TEXT}</span>
              <span
                className="ai-chat-nudge__close"
                role="button"
                tabIndex={0}
                aria-label="不再提示"
                onClick={handleNudgeDismiss}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    handleNudgeDismiss(event);
                  }
                }}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="ai-chat-launcher"
            aria-label="打开 AI 问答"
            onClick={() => setOpen(true)}
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span className="ai-chat-launcher__label">AI 问答</span>
          </button>
        </>
      ) : null}

      {open ? (
        <div
          className="ai-chat-panel"
          role="dialog"
          aria-label="AI 问答"
          aria-modal="false"
        >
          <header className="ai-chat-panel__header">
            <div className="ai-chat-panel__title">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span>AI 问答</span>
            </div>
            <div className="ai-chat-panel__actions">
              <button
                type="button"
                className="ai-chat-iconbtn"
                aria-label="清空对话"
                onClick={handleReset}
                disabled={pending || messages.length === 0}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ai-chat-iconbtn"
                aria-label="关闭"
                onClick={handleClose}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="ai-chat-panel__list" ref={listRef}>
            {messages.length === 0 ? (
              <div className="ai-chat-empty">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
                <p>有什么可以帮你的？</p>
                <ul>
                  <li>“纳指定投目前应该加仓还是观望？”</li>
                  <li>“持仓页里 NAV 怎么自动更新？”</li>
                  <li>“基金切换的限额逻辑是什么？”</li>
                </ul>
              </div>
            ) : (
              messages.map((m, idx) => {
                const isAssistant = m.role === 'assistant';
                const showLoading = isAssistant && idx === messages.length - 1 && pending && !m.content;
                return (
                  <div
                    key={idx}
                    className={`ai-chat-msg ai-chat-msg--${m.role}`}
                  >
                    <div className="ai-chat-msg__bubble">
                      {showLoading ? (
                        <span className="ai-chat-msg__bubble--loading">
                          <Loader2 className="h-4 w-4 ai-chat-spin" aria-hidden="true" />
                          <span>AI 正在思考…</span>
                        </span>
                      ) : isAssistant ? (
                        <div className="ai-chat-md">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: ({ node, ...props }) => (
                                <a
                                  {...props}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                />
                              ),
                            }}
                          >
                            {m.content || ''}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                );
              })
            )}
            {error ? <div className="ai-chat-error">{error}</div> : null}
          </div>

          <footer className="ai-chat-panel__footer">
            <textarea
              ref={textareaRef}
              className="ai-chat-panel__input"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={pending}
            />
            {pending ? (
              <button
                type="button"
                className="ai-chat-send ai-chat-send--stop"
                onClick={handleStop}
                aria-label="停止生成"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="ai-chat-send"
                onClick={handleSend}
                disabled={!canSend}
                aria-label="发送"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </footer>
        </div>
      ) : null}
    </>
  );
}

export default AiChatWidget;
