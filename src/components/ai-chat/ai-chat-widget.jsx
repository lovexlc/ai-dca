import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X, Send, Loader2, RotateCcw } from 'lucide-react';
import '../../styles/ai-chat.css';

const CHAT_ENDPOINT = '/api/ai-chat';
const STORAGE_KEY = 'aiDcaChatHistory_v1';
const MAX_HISTORY = 30;

const SYSTEM_PROMPT =
  '你是 ai-dca 内置的 AI 助手，帮助用户理解定投策略、持仓回测、基金切换等功能，' +
  '回答简洁、准确、用中文。涉及具体投资建议时提醒用户自行判断风险，不要给出绝对收益承诺。';

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m) => m && typeof m.role === 'string' && typeof m.content === 'string',
    );
  } catch (err) {
    return [];
  }
}

function persistHistory(messages) {
  try {
    const trimmed = messages.slice(-MAX_HISTORY);
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

export function AiChatWidget({ currentTab, pageContext } = {}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(() => loadHistory());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    persistHistory(messages);
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open, messages, pending]);

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
    setInput('');
    setPending(true);
    try {
      const tabLabel = currentTab ? (TAB_LABELS[currentTab] || currentTab) : '';
      const ctxParts = [];
      if (tabLabel) ctxParts.push(`用户当前所在页面：${tabLabel}`);
      if (typeof pageContext === 'string' && pageContext.trim()) {
        ctxParts.push(pageContext.trim().slice(0, 1500));
      }
      const payload = {
        system: SYSTEM_PROMPT,
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
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${text || ''}`.trim());
      }
      const data = await res.json();
      const reply =
        (typeof data?.reply === 'string' && data.reply) ||
        (typeof data?.response === 'string' && data.response) ||
        '';
      if (!reply) {
        throw new Error('空响应');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`AI 服务暂不可用：${msg}`);
    } finally {
      setPending(false);
    }
  }, [input, messages, pending]);

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

  return (
    <>
      {!open ? (
        <button
          type="button"
          className="ai-chat-launcher"
          aria-label="打开 AI 问答"
          onClick={() => setOpen(true)}
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          <span className="ai-chat-launcher__label">AI 问答</span>
        </button>
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
              messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`ai-chat-msg ai-chat-msg--${m.role}`}
                >
                  <div className="ai-chat-msg__bubble">{m.content}</div>
                </div>
              ))
            )}
            {pending ? (
              <div className="ai-chat-msg ai-chat-msg--assistant">
                <div className="ai-chat-msg__bubble ai-chat-msg__bubble--loading">
                  <Loader2
                    className="h-4 w-4 ai-chat-spin"
                    aria-hidden="true"
                  />
                  <span>AI 正在思考…</span>
                </div>
              </div>
            ) : null}
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
            <button
              type="button"
              className="ai-chat-send"
              onClick={handleSend}
              disabled={pending || !input.trim()}
              aria-label="发送"
            >
              {pending ? (
                <Loader2
                  className="h-4 w-4 ai-chat-spin"
                  aria-hidden="true"
                />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </footer>
        </div>
      ) : null}
    </>
  );
}

export default AiChatWidget;
