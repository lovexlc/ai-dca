import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '../../styles/markdown.css';
import { ArrowUp, Edit3, History, Loader2, Plus, Send, Sparkles, X } from 'lucide-react';
import { askMarkets, askMarketsStream, loadWatchlist } from '../../app/marketsApi.js';
import { buildStockAnalysisPrompt } from '../../app/stockAnalysisPrompt.js';
import { MarketsChartCodeBlock } from '../../components/markets/MarketsChartBlock.jsx';
import { cx } from '../../components/experience-ui.jsx';
import { formatNumber, formatPercent, formatSymbolDisplay } from './marketDisplayUtils.js';

export function MarketsResearchPanel({ market, mode, onModeChange, watchSymbols = [], watchQuotes = {}, selectedSymbol = '', selectedQuote = null, pendingAnalysis = null, onAnalysisConsumed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const searchDepth = 'fast';
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const displaySelectedSymbol = formatSymbolDisplay(selectedSymbol);

  const send = useCallback(
    async (raw, opts = {}) => {
      const question = String(raw || '').trim();
      if (!question || pending) return;
      const useDepth = 'fast';
      const focusContext = displaySelectedSymbol ? `当前标的：${displaySelectedSymbol}${selectedQuote?.name ? ` / ${selectedQuote.name}` : ''}；价格 ${formatNumber(selectedQuote?.price)} ${formatPercent(selectedQuote?.changePercent)}。` : '';
      const useContext = [focusContext, typeof opts.context === 'string' ? opts.context : ''].filter(Boolean).join('\n');
      setInput('');
      onModeChange?.('conversation');
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: question, depth: useDepth, ts: Date.now() },
        { role: 'assistant', content: '', pending: true },
      ]);
      setPending(true);
      try {
        const wl = loadWatchlist() || {};
        const focusSymbol = String(selectedSymbol || '').trim();
        const listSymbols = Array.isArray(wl[market]) ? wl[market] : [];
        const symbols = Array.from(new Set([focusSymbol, ...listSymbols].filter(Boolean))).slice(0, 10);
        if (useDepth === 'deep') {
          // 研究模式走 SSE 流式 agent，可实时拉取工具调用 / token / sources。
          let streamed = '';
          const streamedSources = [];
          const seenSourceUrls = new Set();
          let stage = '研究启动中…';
          const renderPending = () => {
            setMessages((prev) => {
              const next = prev.slice();
              const last = next[next.length - 1];
              if (!last || !last.pending) return prev;
              next[next.length - 1] = {
                ...last,
                content: streamed,
                stage,
                sources: streamedSources.slice(),
              };
              return next;
            });
          };
          const onEvent = ({ type, payload }) => {
            if (type === 'token' && payload && typeof payload.delta === 'string') {
              streamed += payload.delta;
              renderPending();
            } else if (type === 'progress' && payload && typeof payload.message === 'string') {
              stage = payload.message;
              renderPending();
            } else if (type === 'tool_start' && payload && typeof payload.name === 'string') {
              stage = '调用工具：' + payload.name;
              renderPending();
            } else if (type === 'source' && payload && payload.url) {
              if (!seenSourceUrls.has(payload.url)) {
                seenSourceUrls.add(payload.url);
                streamedSources.push(payload);
                renderPending();
              }
            } else if (type === 'started') {
              stage = '已启动研究模式…';
              renderPending();
            }
          };
          const done = await askMarketsStream({
            question,
            symbols,
            depth: 'deep',
            context: useContext,
            onEvent,
          });
          const finalAnswer = (done && done.answer) || streamed || '抱歉，未获取到回答。';
          const finalSources = (done && Array.isArray(done.sources) && done.sources.length)
            ? done.sources
            : streamedSources;
          setMessages((prev) => {
            const next = prev.slice(0, -1);
            return [...next, { role: 'assistant', content: finalAnswer, sources: finalSources, depth: 'deep' }];
          });
        } else {
          const res = await askMarkets({ question, symbols, depth: 'fast', context: useContext });
          const answer = (res && (res.answer || res.text)) || '抱歉，未获取到回答。';
          const sources = (res && Array.isArray(res.sources)) ? res.sources : [];
          setMessages((prev) => {
            const next = prev.slice(0, -1);
            return [...next, { role: 'assistant', content: answer, sources }];
          });
        }
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        setMessages((prev) => {
          const next = prev.slice(0, -1);
          return [...next, { role: 'assistant', content: '请求失败：' + msg, error: true }];
        });
      } finally {
        setPending(false);
      }
    },
    [market, pending, onModeChange, displaySelectedSymbol, selectedSymbol, selectedQuote],
  );

  const onSubmit = useCallback(
    (e) => {
      if (e && e.preventDefault) e.preventDefault();
      send(input);
    },
    [input, send],
  );

  // 外部（侧边自选行）点击「AI 分析」时会设置 pendingAnalysis，
  // 这里接收后拼金渐成 prompt，并通知父级清除标记。
  useEffect(() => {
    if (!pendingAnalysis || !pendingAnalysis.symbol) return;
    if (pending) return; // 上一轮还在跑，等它结束后下个 effect cycle 再试
    const prompt = buildStockAnalysisPrompt({
      symbol: pendingAnalysis.symbol,
      name: pendingAnalysis.name,
      market,
    });
    if (prompt) {
      send(prompt, { depth: 'fast' });
    }
    onAnalysisConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAnalysis]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && messages.length > 0) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 主题探索按钮触发：在右栏自动提问。
  useEffect(() => {
    const onResearch = (event) => {
      const detail = event && event.detail ? event.detail : {};
      const q = String(detail.question || '').trim();
      if (!q) return;
      send(q, { depth: 'fast', context: detail.context || '' });
    };
    window.addEventListener('markets:research', onResearch);
    return () => window.removeEventListener('markets:research', onResearch);
  }, [send]);

  // focus input on conversation open
  useEffect(() => {
    if ((mode === 'conversation' || mode === 'search') && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [mode]);

  const fmtTime = (ts) => {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  const mdComponents = useMemo(() => ({
    a: ({ node, ...props }) => (
      <a {...props} target="_blank" rel="noreferrer noopener" />
    ),
    code: ({ inline, className, children, ...props }) => {
      const match = /^language-(\w+)/.exec(className || '');
      const lang = match ? match[1].toLowerCase() : '';
      const text = String(children || '').replace(/\n$/, '');
      if (!inline && (lang === 'kline' || lang === 'candle' || lang === 'candlestick' || lang === 'chart' || lang === 'linechart')) {
        const rendered = <MarketsChartCodeBlock lang={lang} value={text} />;
        if (rendered) return rendered;
      }
      return <code className={className} {...props}>{children}</code>;
    },
  }), []);


  const conversationUI = (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-5 pb-2">
            {selectedSymbol ? (
              <div className="rounded-xl border border-[#e8eaed] bg-[#f8fafd] px-4 py-3">
                <div className="text-[12px] font-medium text-[#5f6368]">当前研究标的</div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-semibold text-[#1f1f1f]">{displaySelectedSymbol}</div>
                    {selectedQuote?.name ? <div className="truncate text-[12px] text-[#5f6368]">{selectedQuote.name}</div> : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[14px] font-medium tabular-nums text-[#1f1f1f]">{formatNumber(selectedQuote?.price)}</div>
                    <div className={cx('text-[12px] font-medium tabular-nums', Number(selectedQuote?.changePercent) > 0 ? 'text-[#a50e0e]' : Number(selectedQuote?.changePercent) < 0 ? 'text-[#137333]' : 'text-[#5f6368]')}>
                      {formatPercent(selectedQuote?.changePercent)}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            <div>
              <p className="text-[18px] font-medium leading-snug text-[#1f1f1f]">您好！试试以下常见问题，或直接输入您的问题</p>
            </div>
            <div className="flex flex-col gap-2">
              {(selectedSymbol ? [
                `${displaySelectedSymbol} 最新行情怎么看？`,
                `${displaySelectedSymbol} 最近有哪些关键变化？`,
                `${displaySelectedSymbol} 和我的监控列表相比表现如何？`,
              ] : [
                '今日市场行情如何？',
                '哪些板块涨幅居前？',
                '我的监控列表近期有哪些关键变化？',
              ]).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q, { depth: 'fast' })}
                  disabled={pending}
                  title="点击提问"
                  className="group flex w-full items-center justify-between gap-3 rounded-xl border border-[#e8eaed] bg-white px-4 py-3 text-left text-[14px] text-[#1f1f1f] transition hover:border-[#d2e3fc] hover:bg-[#f8fafd] disabled:opacity-60 disabled:hover:border-[#e8eaed] disabled:hover:bg-white"
                >
                  <span className="flex-1">{q}</span>
                  <Send size={16} className="shrink-0 text-slate-400 transition group-hover:text-indigo-600" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m, i) => (
              <div key={i}>
                {m.role === 'user' ? (
                  <div className="flex flex-col items-end gap-1">
                    <div className="max-w-[85%] rounded-2xl bg-[#f1f3f4] px-4 py-2.5 text-[14px] leading-relaxed text-[#1f1f1f]">
                      {m.content}
                    </div>
                    {m.ts ? <span className="text-[11px] text-[#9aa0a6]">{fmtTime(m.ts)}</span> : null}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {m.pending ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-[14px] text-[#5f6368]">
                          <Loader2 size={14} className="animate-spin" />
                          <span>{m.stage || '正在思考…'}</span>
                        </div>
                        {m.content ? (
                          <div className="ai-chat-md text-[14px] leading-relaxed text-[#1f1f1f]">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={mdComponents}
                            >
                              {m.content}
                            </ReactMarkdown>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      m.error ? (
                        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-rose-600">{m.content}</p>
                      ) : (
                        <div className="ai-chat-md text-[14px] leading-relaxed text-[#1f1f1f]">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={mdComponents}
                          >
                            {m.content || ''}
                          </ReactMarkdown>
                        </div>
                      )
                    )}
                    {!m.pending && Array.isArray(m.sources) && m.sources.length > 0 ? (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {m.sources.slice(0, 3).map((s, si) => (
                          <li key={si}>
                            <a href={s.url} target="_blank" rel="noreferrer" className="text-[11px] text-[#1a73e8] hover:underline">
                              {s.title || s.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {selectedSymbol ? (
        <div className="mx-3 mt-1 flex justify-end">
          <span className="truncate text-[11px] text-[#5f6368]">已注入 {displaySelectedSymbol}</span>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="mx-3 mb-3 mt-2 flex h-12 items-center gap-2 rounded-full bg-[#f1f3f4] px-3">
        <button type="button" aria-label="添加上下文或附件" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#e8eaed]">
          <Plus size={16} />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="搜索或提问"
          className="flex-1 bg-transparent text-[14px] text-[#1f1f1f] placeholder:text-[#5f6368] focus:outline-none"
          disabled={pending}
        />
        <button
          type="submit"
          aria-label="发送"
          disabled={pending || !input.trim()}
          className={cx(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition',
            !input.trim() || pending ? 'text-[#9aa0a6]' : 'bg-[#1a73e8] text-white hover:bg-[#1557b0]',
          )}
        >
          {pending ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
        </button>
      </form>
    </>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white lg:h-full lg:min-h-0 lg:rounded-2xl lg:border lg:border-slate-200">
      {pending && (
        <div className="relative h-0.5 w-full shrink-0 overflow-hidden bg-[#e8f0fe]">
          <div className="gf-progress-bar absolute inset-y-0 left-0 bg-[#1a73e8]" />
        </div>
      )}
      <div className="flex items-center justify-between border-b border-[#e8eaed] px-4 py-3 lg:border-slate-200">
        <h2 className="text-base font-semibold text-[#1f1f1f]">研究</h2>
        <div className="flex items-center gap-0.5 text-[#5f6368]">
          <button
            type="button"
            aria-label="新对话"
            onClick={() => { setMessages([]); onModeChange?.('peek'); }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#f1f3f4]"
          >
            <Edit3 size={16} />
          </button>
          <button
            type="button"
            aria-label="历史"
            disabled
            className="inline-flex h-8 w-8 items-center justify-center rounded-full opacity-40"
          >
            <History size={16} />
          </button>
          {mode === 'conversation' && (
            <button
              type="button"
              aria-label="关闭"
              onClick={() => onModeChange?.('peek')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#f1f3f4] lg:hidden"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      {mode === 'peek' && (
        <button
          type="button"
          onClick={() => onModeChange?.('search')}
          className="mx-3 mt-3 flex h-12 items-center gap-2 rounded-full bg-[#f1f3f4] px-4 text-left lg:hidden"
        >
          <Sparkles size={16} className="shrink-0 text-[#1a73e8]" />
          <span className="flex-1 text-[14px] text-[#5f6368]">搜索或提问</span>
        </button>
      )}
      {mode === 'search' && (
        <div className="flex flex-1 flex-col overflow-hidden lg:hidden">
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles size={14} className="text-[#1a73e8]" />
              <span className="text-[13px] font-semibold text-[#1f1f1f]">AI 研究</span>
            </div>
            <p className="text-[12px] text-[#5f6368]">📈 关于您监控列表的最新数据洞见</p>
          </div>
          {watchSymbols.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {watchSymbols.slice(0, 8).map((sym) => {
                const displaySym = formatSymbolDisplay(sym);
                const q = watchQuotes[sym] || {};
                const pct = Number(q.changePercent);
                const pos = pct >= 0;
                return (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => { onModeChange?.('conversation'); send(displaySym + ' 最新行情分析'); }}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#e8eaed] bg-white px-3 py-1.5"
                  >
                    <span className="text-[12px] font-semibold text-[#1f1f1f]">{displaySym}</span>
                    {q.changePercent != null && (
                      <span className={cx('text-[11px] font-medium tabular-nums', pos ? 'text-[#34a853]' : 'text-[#ea4335]')}>
                        {pos ? '+' : ''}{pct.toFixed(2)}%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-auto px-3 pb-3">
            <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-2xl bg-[#f1f3f4] px-4 py-2.5">
              <input
                ref={inputRef}
                autoFocus
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="询问相关问题或进行搜索"
                className="flex-1 bg-transparent text-[14px] text-[#1f1f1f] placeholder:text-[#5f6368] focus:outline-none"
                disabled={pending}
              />
              <button
                type="submit"
                aria-label="发送"
                disabled={pending || !input.trim()}
                className={cx(
                  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition',
                  !input.trim() || pending ? 'text-[#9aa0a6]' : 'bg-[#1a73e8] text-white hover:bg-[#1557b0]',
                )}
              >
                {pending ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
              </button>
            </form>
          </div>
        </div>
      )}
      <div className={cx('flex min-h-0 flex-1 flex-col', mode === 'peek' || mode === 'search' ? 'hidden lg:flex' : 'flex')}>
        {conversationUI}
      </div>
    </div>
  );
}
