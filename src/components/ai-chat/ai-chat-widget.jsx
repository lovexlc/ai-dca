import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  X,
  Send,
  Loader2,
  RotateCcw,
  Paperclip,
  Image as ImageIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '../../styles/ai-chat.css';

const CHAT_ENDPOINT = '/api/ai-chat';
const STORAGE_KEY = 'aiDcaChatHistory_v1';
const MAX_HISTORY = 30;
const MAX_IMAGES_PER_MESSAGE = 4;
// 单图原始字节上限 ~3MB；超过会做压缩（最长边 1280，jpeg 0.85）。
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_MAX_DIM = 1280;

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
        images: Array.isArray(m.images)
          ? m.images.filter((u) => typeof u === 'string').slice(0, MAX_IMAGES_PER_MESSAGE)
          : [],
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
      images: Array.isArray(m.images) ? m.images : [],
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

// 把 File 转成 dataURL；超过阈值时压缩。
async function fileToDataUrl(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new Error('仅支持图片');
  }
  const needCompress = file.size > IMAGE_MAX_BYTES;
  const rawDataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('读取图片失败'));
    fr.readAsDataURL(file);
  });
  if (!needCompress) return rawDataUrl;
  // 压缩：用 canvas 重新编码为 jpeg。
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('图片解码失败'));
    i.src = rawDataUrl;
  });
  const ratio = Math.min(1, IMAGE_MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.85);
}

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
  const [pendingImages, setPendingImages] = useState([]); // dataURL[]
  const [messages, setMessages] = useState(() => loadHistory());
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [nudgeMuted, setNudgeMuted] = useState(() => isNudgeDismissed());
  const listRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    persistHistory(messages);
  }, [messages]);

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
    setPendingImages([]);
    setError('');
  }, []);

  const handleAttachClick = useCallback(() => {
    if (pending) return;
    if (fileInputRef.current) fileInputRef.current.click();
  }, [pending]);

  const handleFilesChange = useCallback(
    async (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (files.length === 0) return;
      setError('');
      setUploading(true);
      try {
        const slots = MAX_IMAGES_PER_MESSAGE - pendingImages.length;
        const accepted = files.slice(0, Math.max(0, slots));
        const urls = [];
        for (const f of accepted) {
          try {
            const u = await fileToDataUrl(f);
            urls.push(u);
          } catch (err) {
            console.warn('[ai-chat] image read failed', err);
          }
        }
        if (urls.length > 0) {
          setPendingImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES_PER_MESSAGE));
        }
        if (files.length > slots) {
          setError(`一次最多附 ${MAX_IMAGES_PER_MESSAGE} 张图片，多余的已忽略。`);
        }
      } finally {
        setUploading(false);
      }
    },
    [pendingImages.length],
  );

  const handleRemoveImage = useCallback((idx) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    const imgs = pendingImages;
    if ((!content && imgs.length === 0) || pending) return;
    setError('');
    const userMessage = { role: 'user', content, images: imgs };
    const nextHistory = [...messages, userMessage];
    setMessages(nextHistory);
    // 占位的 assistant 流式气泡。
    setMessages((prev) => [...prev, { role: 'assistant', content: '', images: [] }]);
    setInput('');
    setPendingImages([]);
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
      // 历史 messages 中也带上各自的 images，最后一条 user 已含本次新图片。
      const payload = {
        system: SYSTEM_PROMPT,
        stream: true,
        messages: nextHistory.slice(-MAX_HISTORY).map((m) => ({
          role: m.role,
          content: m.content,
          ...(Array.isArray(m.images) && m.images.length ? { images: m.images } : {}),
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
          next[next.length - 1] = { role: 'assistant', content: reply, images: [] };
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
  }, [input, pendingImages, messages, pending, currentTab, pageContext]);

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

  const handlePaste = useCallback(
    async (event) => {
      const items = Array.from(event.clipboardData?.items || []);
      const files = items
        .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter(Boolean);
      if (files.length === 0) return;
      event.preventDefault();
      setError('');
      setUploading(true);
      try {
        const slots = MAX_IMAGES_PER_MESSAGE - pendingImages.length;
        const accepted = files.slice(0, Math.max(0, slots));
        const urls = [];
        for (const f of accepted) {
          try {
            const u = await fileToDataUrl(f);
            urls.push(u);
          } catch (err) {
            console.warn('[ai-chat] paste image failed', err);
          }
        }
        if (urls.length > 0) {
          setPendingImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES_PER_MESSAGE));
        }
      } finally {
        setUploading(false);
      }
    },
    [pendingImages.length],
  );

  const placeholder = useMemo(
    () => (pending ? 'AI 正在思考…' : '问点什么，例如：定投策略怎么开始？（可粘贴/上传截图）'),
    [pending],
  );

  const canSend = !pending && (!!input.trim() || pendingImages.length > 0);

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
                  <li>“把这张持仓截图识别成表格”（点 📎 上传截图）</li>
                </ul>
              </div>
            ) : (
              messages.map((m, idx) => {
                const isAssistant = m.role === 'assistant';
                const hasImgs = Array.isArray(m.images) && m.images.length > 0;
                const showLoading = isAssistant && idx === messages.length - 1 && pending && !m.content;
                return (
                  <div
                    key={idx}
                    className={`ai-chat-msg ai-chat-msg--${m.role}`}
                  >
                    <div className="ai-chat-msg__bubble">
                      {hasImgs ? (
                        <div className="ai-chat-msg__images">
                          {m.images.map((src, i) => (
                            <img
                              key={i}
                              src={src}
                              alt={`附图 ${i + 1}`}
                              className="ai-chat-msg__image"
                            />
                          ))}
                        </div>
                      ) : null}
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

          {pendingImages.length > 0 ? (
            <div className="ai-chat-attach-preview">
              {pendingImages.map((src, i) => (
                <div key={i} className="ai-chat-thumb">
                  <img src={src} alt={`待发送图片 ${i + 1}`} />
                  <button
                    type="button"
                    className="ai-chat-thumb__remove"
                    aria-label="移除该图片"
                    onClick={() => handleRemoveImage(i)}
                    disabled={pending}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
              <span className="ai-chat-attach-hint">
                {pendingImages.length}/{MAX_IMAGES_PER_MESSAGE}
              </span>
            </div>
          ) : null}

          <footer className="ai-chat-panel__footer">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={handleFilesChange}
            />
            <button
              type="button"
              className="ai-chat-iconbtn ai-chat-attach-btn"
              aria-label="上传图片"
              onClick={handleAttachClick}
              disabled={pending || uploading || pendingImages.length >= MAX_IMAGES_PER_MESSAGE}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 ai-chat-spin" aria-hidden="true" />
              ) : (
                <Paperclip className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <textarea
              ref={textareaRef}
              className="ai-chat-panel__input"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
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
