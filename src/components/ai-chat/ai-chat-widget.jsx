import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  X,
  Send,
  Loader2,
  RotateCcw,
  LineChart as LineChartIcon,
  BookOpen,
  Globe,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  LineChart as RcLineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import '../../styles/ai-chat.css';
import { askMarkets, askMarketsStream, loadWatchlist } from '../../app/marketsApi.js';
import { trackAnalyticsEvent } from '../../app/analytics.js';

const CHAT_ENDPOINT = '/api/ai-chat';
const STORAGE_KEY = 'aiDcaChatHistory_v1';
const MODE_KEY = 'aiDcaChatMode_v1';
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

function loadMode() {
  // 市场行情模式已从 UI 移除，常驻在知识库问答。
  return 'chat';
}

function persistMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch (err) { /* ignore */ }
}

function stripTrailingSourcesBlock(text) {
  const s = String(text || '');
  if (!s) return s;
  const re = /\n?\s*(?:#{1,6}\s*)?\**\s*(?:参考来源|来源|引用|资料来源|sources|references)\s*\**\s*[:。：]?\s*\n/gi;
  let last = -1;
  let m;
  while ((m = re.exec(s)) !== null) last = m.index;
  return last >= 0 ? s.slice(0, last).replace(/\s+$/, '') : s;
}

// M4 polish：将正文里的 "[n]" 引用标号映射为 Unicode 上标的可点击链接，
// 指向 sources[n-1].url。无对应 source 时保留原文。
const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
function toSuperscript(n) {
  return String(n)
    .split('')
    .map((c) => SUPERSCRIPTS[Number(c)] || c)
    .join('');
}
function renderInlineCitations(content, sources) {
  const text = String(content || '');
  if (!text || !Array.isArray(sources) || sources.length === 0) return text;
  return text.replace(/\[(\d{1,2})\]/g, (raw, num) => {
    const n = Number(num);
    if (!Number.isFinite(n) || n < 1 || n > sources.length) return raw;
    const src = sources[n - 1];
    if (!src || !src.url) return raw;
    return `[${toSuperscript(n)}](${src.url})`;
  });
}

// Extract structured UI artifacts (e.g. fund_backtest chart_data) from
// the agent's tool trace. Returns Array<{type, ...payload}>.
function extractArtifactsFromTrace(trace) {
  if (!Array.isArray(trace)) return [];
  const out = [];
  for (const t of trace) {
    const a = t && t.ui_artifact;
    if (a && a.type) out.push(a);
  }
  return out;
}

const FB_CHART_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#0891b2'];
const FB_STYLE_ROOT = { marginBottom: 8 };
const FB_STYLE_TITLE = { fontSize: 12, color: '#475569', marginBottom: 4 };
const FB_STYLE_RANGE = { marginLeft: 6, color: '#94a3b8' };
const FB_STYLE_BOX = { width: '100%', height: 240 };
const FB_STYLE_MARGIN = { top: 8, right: 16, bottom: 4, left: 0 };
const FB_STYLE_TICK = { fontSize: 10, fill: '#64748b' };
const FB_STYLE_TOOLTIP = { fontSize: 12 };
const FB_STYLE_LEGEND = { fontSize: 11 };
const FB_STYLE_STATS = { fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.5 };
const FB_STYLE_STATITEM = { marginRight: 12 };
const FB_STYLE_STATSYM = { color: '#0f172a' };
const FB_STYLE_CORR = { display: 'block', marginTop: 2 };
const FB_Y_DOMAIN = ['auto', 'auto'];
const fbFmtNum2 = (v) => (typeof v === 'number' ? v.toFixed(2) : v);

function FundBacktestChart({ data }) {
  if (!data || !data.chart_data || !Array.isArray(data.chart_data.dates)) return null;
  const rebased = data.chart_data.rebased_to_100 || null;
  const dates = data.chart_data.dates;
  const symbols = rebased ? Object.keys(rebased) : [];
  if (!symbols.length) return null;
  const rows = dates.map((d, i) => {
    const row = { date: d };
    for (const s of symbols) row[s] = rebased[s][i];
    return row;
  });
  const win = data.window || null;
  const corr = data.correlation_matrix || null;
  const series = data.series || null;
  const corrEntries = corr ? Object.entries(corr) : [];
  return (
    <div className="ai-chat-artifact" style={FB_STYLE_ROOT}>
      <div className="ai-chat-artifact__title" style={FB_STYLE_TITLE}>
        基金回测·净值走势（起点 = 100）
        {win && win.start && win.end ? (
          <span style={FB_STYLE_RANGE}>
            {win.start} → {win.end} · {win.trading_points} 点 · {win.interval}
          </span>
        ) : null}
      </div>
      <div style={FB_STYLE_BOX}>
        <ResponsiveContainer width="100%" height="100%">
          <RcLineChart data={rows} margin={FB_STYLE_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={FB_STYLE_TICK} minTickGap={24} />
            <YAxis tick={FB_STYLE_TICK} domain={FB_Y_DOMAIN} width={36} />
            <Tooltip contentStyle={FB_STYLE_TOOLTIP} formatter={fbFmtNum2} />
            <Legend wrapperStyle={FB_STYLE_LEGEND} />
            {symbols.map((s, i) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                stroke={FB_CHART_COLORS[i % FB_CHART_COLORS.length]}
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ))}
          </RcLineChart>
        </ResponsiveContainer>
      </div>
      <div style={FB_STYLE_STATS}>
        {symbols.map((s) => {
          const st = (series && series[s]) || null;
          const cum = st && typeof st.cum_return === 'number' ? (st.cum_return * 100).toFixed(2) + '%' : '—';
          const sh = st && typeof st.sharpe === 'number' ? st.sharpe.toFixed(2) : '—';
          const dd = st && typeof st.max_dd === 'number' ? (st.max_dd * 100).toFixed(2) + '%' : '—';
          return (
            <span key={s} style={FB_STYLE_STATITEM}>
              <b style={FB_STYLE_STATSYM}>{s}</b>: 总收益 {cum} · 夏普 {sh} · 最大回撤 {dd}
            </span>
          );
        })}
        {corrEntries.length ? (
          <span style={FB_STYLE_CORR}>
            相关性：{corrEntries.map((p) => p[0] + '=' + (typeof p[1] === 'number' ? p[1].toFixed(3) : p[1])).join('  ')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function formatMarketsAnswer(res) {
  const answer = stripTrailingSourcesBlock(String((res && res.answer) || '').trim());
  const sources = Array.isArray(res && res.sources) ? res.sources.slice(0, 6) : [];
  const artifacts = extractArtifactsFromTrace(res && res.trace);
  const parts = [];
  if (answer) {
    parts.push(answer);
  } else if (res && res.aiError) {
    parts.push(`抱歉，生成回答时出错：${res.aiError}`);
  } else {
    parts.push('抱歉，本次未生成回答。可以试试重新提问或切换到深度模式。');
  }
  if (res && res.searchError) {
    parts.push(`\n_联网检索提示：${res.searchError}_`);
  }
  return {
    content: parts.join('\n\n') || '未获取到响应。',
    sources: sources
      .map((s) => ({
        title: (s && s.title) || (s && s.url) || '未命名来源',
        url: s && s.url ? String(s.url) : '',
      }))
      .filter((s) => s.title || s.url),
    artifacts,
  };
}

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
        ...(Array.isArray(m.sources) && m.sources.length
          ? { sources: m.sources.filter((s) => s && (s.title || s.url)) }
          : {}),
        ...(Array.isArray(m.artifacts) && m.artifacts.length
          ? { artifacts: m.artifacts.filter((a) => a && a.type) }
          : {}),
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
      ...(Array.isArray(m.sources) && m.sources.length ? { sources: m.sources } : {}),
      ...(Array.isArray(m.artifacts) && m.artifacts.length ? { artifacts: m.artifacts } : {}),
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
  notify: '提醒中心',
};

// 市场行情模式首屏热门问题（固定 6 条）。后续可换为从 worker /hot-questions 拉取。
const MARKETS_HOT_QUESTIONS = [
  '今晚美股看什么？',
  '纳指定投现在该加仓还是观望？',
  '英伟达最近为什么波动这么大？',
  '今天 A 股大盘怎么看？',
  '贵州茅台近期走势主要驱动是什么？',
  '本周有哪些重要财报和宏观数据？',
];

const CHAT_HOT_QUESTIONS = [
  '定投策略怎么开始？',
  '持仓页里 NAV 怎么自动更新？',
  '基金切换的限额逻辑是什么？',
  '交易计划如何生成提醒？',
  '如何备份和恢复我的数据？',
  '为什么我的收益与预期不一致？',
];

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
  const [mode, setMode] = useState(() => loadMode());
  const [marketsDepth, setMarketsDepth] = useState('fast');
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [nudgeMuted, setNudgeMuted] = useState(() => isNudgeDismissed());
  // 参考来源是否展开：key 是消息在列表里的 index。
  const [openSources, setOpenSources] = useState(() => new Set());
  // 下一次 askMarkets 调用携带的额外上下文（来自主题深入按钮等外部触发），使用后自动清空。
  const pendingMarketsContextRef = useRef('');
  const listRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);
  const panelRef = useRef(null);
  const dragStartY = useRef(null);
  const dragDeltaY = useRef(0);
  // 退场动画期间暂停 visualViewport 跟随，避免键盘收起与 transform 同时改面板 bottom。
  const closingRef = useRef(false);

  useEffect(() => {
    persistHistory(messages);
  }, [messages]);

  useEffect(() => { persistMode(mode); }, [mode]);

  useEffect(() => {
    function onExternalOpen() { setOpen(true); }
    window.addEventListener('aichat:open', onExternalOpen);
    return () => window.removeEventListener('aichat:open', onExternalOpen);
  }, []);

  // 外部页面（例如行情中心底部 ask bar）预填问题 + 可选切换模式。
  // detail: { question?: string, mode?: 'chat'|'markets', open?: boolean,
  //           depth?: 'fast'|'deep', context?: string }
  useEffect(() => {
    function onPrefill(event) {
      const detail = (event && event.detail) || {};
      // mode/depth/context 已不再采用：行情主题探索转为右栏研究面板 (markets:research)。
      if (typeof detail.question === 'string' && detail.question.trim()) {
        setInput(detail.question);
      }
      if (detail.open !== false) setOpen(true);
    }
    window.addEventListener('aichat:prefill', onPrefill);
    return () => window.removeEventListener('aichat:prefill', onPrefill);
  }, []);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
    if (textareaRef.current) textareaRef.current.focus();
  }, [open, messages, pending]);

  // 面板打开时锁定 body 滚动，避免背景随手指滑动。
  useEffect(() => {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevTouchAction = body.style.touchAction;
    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';
    return () => {
      body.style.overflow = prevOverflow;
      body.style.touchAction = prevTouchAction;
    };
  }, [open]);

  // 跟随 visualViewport：软键盘弹出时压缩面板高度，底部输入区始终可见。
  useEffect(() => {
    if (!open) return undefined;
    if (typeof window === 'undefined' || !window.visualViewport) return undefined;
    const vv = window.visualViewport;
    const update = () => {
      if (closingRef.current) return;
      const node = panelRef.current;
      if (!node) return;
      const bottomInset = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop,
      );
      node.style.setProperty('--ai-chat-kb', `${bottomInset}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [open]);

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

  // 下拉关闭：在手柄 / 头部区域向下拖超过阈值则关闭面板。
  const handleDragStart = useCallback((event) => {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    dragStartY.current = touch.clientY;
    dragDeltaY.current = 0;
    if (panelRef.current) {
      panelRef.current.style.transition = 'none';
    }
  }, []);

  const handleDragMove = useCallback((event) => {
    if (dragStartY.current == null) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const dy = touch.clientY - dragStartY.current;
    if (dy <= 0) {
      dragDeltaY.current = 0;
      if (panelRef.current) panelRef.current.style.transform = '';
      return;
    }
    dragDeltaY.current = dy;
    if (panelRef.current) {
      panelRef.current.style.transform = `translateY(${dy}px)`;
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragStartY.current == null) return;
    const dy = dragDeltaY.current;
    dragStartY.current = null;
    dragDeltaY.current = 0;
    const node = panelRef.current;
    if (dy > 100) {
      // 退场：先锁住 visualViewport 跟随，避免键盘收起与 transform 同时抽 panel bottom。
      closingRef.current = true;
      if (textareaRef.current) {
        try { textareaRef.current.blur(); } catch (_) { /* ignore */ }
      }
      if (node) {
        const h = node.offsetHeight || 600;
        // 打 dragMove 中 transition = none 的补丁：先设 transition，强制 reflow
        // 让浏览器提交新的 transition-property，再变 transform，才会动画。
        node.style.transition = 'transform 220ms ease-out';
        void node.offsetHeight; // force reflow
        node.style.transform = `translateY(${h + 32}px)`;
        node.style.pointerEvents = 'none';
      }
      setTimeout(() => {
        closingRef.current = false;
        handleClose();
      }, 220);
    } else if (node) {
      // 未达阈值：带动画回弹。同样需强制 reflow。
      node.style.transition = 'transform 180ms ease-out';
      void node.offsetHeight; // force reflow
      node.style.transform = '';
      setTimeout(() => {
        if (node) node.style.transition = '';
      }, 200);
    }
  }, [handleClose]);

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
    trackAnalyticsEvent('ai_used', { mode, currentTab, length: content.length });

    const controller = new AbortController();
    abortRef.current = controller;

    // 市场行情模式：调用独立的 markets/ask Worker（非流式 JSON）。
    if (mode === 'markets') {
      try {
        let symbols = [];
        try {
          const wl = loadWatchlist() || {};
          const us = Array.isArray(wl.us) ? wl.us : [];
          const cn = Array.isArray(wl.cn) ? wl.cn : [];
          symbols = [...us.slice(0, 4), ...cn.slice(0, 4)];
        } catch (_) { /* ignore */ }
        // 消费并清空额外上下文，仅本次提问生效。
        const extraContext = pendingMarketsContextRef.current || '';
        pendingMarketsContextRef.current = '';
        // M3：deep 深度问答走 SSE 流式（MoltWorker 容器）。fast 仍用同步 JSON。
        if (marketsDepth === 'deep') {
          let acc = '';
          let status = '深度搜索启动中…';
          const seenUrls = new Set();
          const liveSources = [];
          const liveArtifacts = [];
          const flush = () => {
            const head = status ? '_' + status + '_\n\n' : '';
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') {
                next[next.length - 1] = {
                  ...last,
                  content: head + acc,
                  sources: liveSources.slice(),
                  artifacts: liveArtifacts.slice(),
                };
              }
              return next;
            });
          };
          flush();
          const finalRes = await askMarketsStream({
            question: content,
            symbols,
            depth: 'deep',
            context: extraContext,
            signal: controller.signal,
            onEvent: ({ type, payload }) => {
              if (type === 'started') {
                status = '已启动…';
              } else if (type === 'progress') {
                const step = payload && payload.step;
                const total = payload && payload.total;
                const brief = payload && payload.brief ? '：' + payload.brief : '';
                status = '第 ' + (step != null ? step : '?') + ' / ' + (total != null ? total : '?') + ' 轮' + brief;
              } else if (type === 'tool_start') {
                const name = (payload && payload.name) || '工具';
                status = '调用工具 ' + name + '…';
              } else if (type === 'tool_end') {
                const name = (payload && payload.name) || '工具';
                status = (payload && payload.ok) ? '工具 ' + name + ' 已返回' : '工具 ' + name + ' 失败';
              } else if (type === 'source') {
                const u = payload && payload.url;
                if (u && !seenUrls.has(u)) {
                  seenUrls.add(u);
                  liveSources.push({
                    title: (payload && payload.title) || u,
                    url: String(u),
                  });
                }
              } else if (type === 'token') {
                const delta = payload && payload.delta;
                if (typeof delta === 'string') acc += delta;
              } else if (type === 'tool_artifact') {
                const a = payload && payload.payload;
                if (a && a.type) liveArtifacts.push(a);
              }
              flush();
            },
          });
          status = '';
          const fa = stripTrailingSourcesBlock(
            String((finalRes && finalRes.answer) || acc).trim(),
          );
          const finalSources =
            Array.isArray(finalRes && finalRes.sources) && finalRes.sources.length
              ? finalRes.sources.slice(0, 8).map((s) => ({
                  title: (s && (s.title || s.url)) || '未命名来源',
                  url: s && s.url ? String(s.url) : '',
                }))
              : liveSources.slice(0, 8);
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: 'assistant',
              content: fa || '抱歉，本次未生成回答。可以试试重新提问或切换到浅模式。',
              sources: finalSources,
              ...(liveArtifacts.length ? { artifacts: liveArtifacts.slice() } : {}),
            };
            return next;
          });
        } else {
        const res = await askMarkets({
          question: content,
          symbols,
          depth: marketsDepth,
          context: extraContext,
        });
        const out = formatMarketsAnswer(res);
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: 'assistant',
            content: out.content,
            sources: out.sources,
            ...(Array.isArray(out.artifacts) && out.artifacts.length ? { artifacts: out.artifacts } : {}),
          };
          return next;
        });
        }
      } catch (err) {
        if (err && err.name === 'AbortError') {
          // 用户取消
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`市场行情服务暂不可用：${msg}`);
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
      return;
    }

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
  }, [input, messages, pending, currentTab, pageContext, mode, marketsDepth]);

  const handleStop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const toggleSources = useCallback((idx) => {
    setOpenSources((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
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
    () => {
      if (pending) return 'AI 正在思考…';
      if (mode === 'markets') return '问点市场问题，例如：今晚美股看什么？';
      return '问点什么，例如：定投策略怎么开始？';
    },
    [pending, mode],
  );

  const canSend = !pending && !!input.trim();

  return (
    <>
      {false ? (
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
          ref={panelRef}
          className="ai-chat-panel"
          role="dialog"
          aria-label="AI 问答"
          aria-modal="false"
        >
          <div
            className="ai-chat-panel__grab"
            onTouchStart={handleDragStart}
            onTouchMove={handleDragMove}
            onTouchEnd={handleDragEnd}
            onTouchCancel={handleDragEnd}
          >
          <div className="ai-chat-panel__handle" aria-hidden="true" />
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
          </div>

          <div className="ai-chat-panel__list" ref={listRef}>
            {messages.length === 0 ? (
              <div className="ai-chat-empty">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
                <p>有什么可以帮你的？</p>
                <div className="ai-chat-hotqs" role="list">
                  {CHAT_HOT_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      role="listitem"
                      className="ai-chat-hotq"
                      onClick={() => {
                        setInput(q);
                        if (textareaRef.current) {
                          try { textareaRef.current.focus(); } catch (_) { /* ignore */ }
                        }
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, idx) => {
                const isAssistant = m.role === 'assistant';
                const showLoading = isAssistant && idx === messages.length - 1 && pending && !m.content;
                const sources = isAssistant && Array.isArray(m.sources) ? m.sources : [];
                const sourcesOpen = openSources.has(idx);
                return (
                  <div
                    key={idx}
                    className={`ai-chat-msg ai-chat-msg--${m.role}`}
                  >
                    <div className="ai-chat-msg__col">
                      {isAssistant && sources.length > 0 ? (
                        <div className="ai-chat-sources">
                          <button
                            type="button"
                            className="ai-chat-sources__chip"
                            onClick={() => toggleSources(idx)}
                            aria-expanded={sourcesOpen}
                          >
                            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{sources.length} 个网站</span>
                            {sourcesOpen ? (
                              <ChevronDown className="h-3 w-3" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="h-3 w-3" aria-hidden="true" />
                            )}
                          </button>
                          {sourcesOpen ? (
                            <ol className="ai-chat-sources__list">
                              {sources.map((s, i) => (
                                <li key={i}>
                                  {s.url ? (
                                    <a
                                      href={s.url}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                    >
                                      {s.title || s.url}
                                    </a>
                                  ) : (
                                    <span>{s.title}</span>
                                  )}
                                </li>
                              ))}
                            </ol>
                          ) : null}
                        </div>
                      ) : null}
                    <div className="ai-chat-msg__bubble">
                      {showLoading ? (
                        <span className="ai-chat-msg__bubble--loading">
                          <Loader2 className="h-4 w-4 ai-chat-spin" aria-hidden="true" />
                          <span>AI 正在思考…</span>
                        </span>
                      ) : isAssistant ? (
                        <div className="ai-chat-md">
                          {Array.isArray(m.artifacts) && m.artifacts.length
                            ? m.artifacts.map((a, ai) =>
                                a && a.type === 'fund_backtest'
                                  ? <FundBacktestChart key={'art-' + ai} data={a} />
                                  : null
                              )
                            : null}
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
                            {renderInlineCitations(m.content || '', sources)}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        m.content
                      )}
                    </div>
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
