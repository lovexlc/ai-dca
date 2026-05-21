import { useEffect, useMemo, useState } from 'react';
import {
  Bell, BookOpen, CloudUpload, ListChecks, Wallet, Trash2, X,
  Sparkles, Calendar, ChevronRight, Clock, Layers, ShieldCheck, Target,
  Activity, FileText, Settings, TrendingUp, Repeat
} from 'lucide-react';
import { clearDemoData, hasPotentialUserData, installDemoData, readDemoDataMeta } from '../app/demoData.js';
import { persistWorkspacePrefs, readWorkspacePrefs } from '../app/workspacePrefs.js';
import { Card, Pill, SectionHeading, SelectField, cx, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';

const HOME_OPTIONS = [
  { value: 'strategy', label: '策略指南' },
  { value: 'holdings', label: '持仓总览' },
  { value: 'tradePlans', label: '交易计划' },
  { value: 'notify', label: '通知设置' },
  { value: 'markets', label: '行情中心' },
  { value: 'fundSwitch', label: '基金切换' },
  { value: 'backup', label: '数据同步' }
];

const ACCOUNT_CARDS = [
  {
    id: 'agg', title: '进取型', tone: 'rose',
    sentence: '追求高收益，承受高波动',
    examples: 'AAPL / MSFT / GOOGL / AMZN / NVDA / META / TSLA / TSM',
    details: [
      ['进取型账户', ['清一色美股七巨头 + 台积电 + 博通 + AMD。', '英伟达占比最大，其次是谷歌，苹果/亚马逊/台积电/Meta 各占一部分。', '特斯拉仓位较小，280 美元以内再考虑加仓。', '追求高收益，承受高波动，是"改变未来的资产"。']]
    ]
  },
  {
    id: 'steady', title: '稳健型', tone: 'indigo',
    sentence: '长期持有，只买不卖，金字塔加仓',
    examples: 'QQQ / SPY / VOO / IVV',
    details: [
      ['稳健型账户', ['纳指100和标普500 ETF 为核心，目标占比约 70%。', '叠加消费龙头，如 Costco、沃尔玛、麦当劳、宝洁。', '叠加医药保健，如礼来、强生、联合健康、诺和诺德。', '只买不卖，金字塔加仓，是资产配置的压舱石。']]
    ]
  },
  {
    id: 'defend', title: '防守型', tone: 'emerald',
    sentence: '稳定分红，抗跌防御，构筑现金流',
    examples: 'BRK.B / KO / JNJ / SCHD / 国债 ETF',
    details: [
      ['防守型账户', ['美债及相关 ETF 占比较高，核心是吃利息。', '伯克希尔、可口可乐、强生、SCHD、VISA 构成防守权益资产。', '核心作用：吃派息分红 + 防守。', '每个月产生的现金流，用于机会出现时加仓宽基指数和科技股。']],
      ['为什么要配置防守型？', ['成功的交易员，不是赚得最多，是市场转向的时候还能活下来。', '具备足够多的心理安全感，才能没有顾虑地去做进取型。', '进取型、稳健型、防守型三者平衡，层层递进。']],
      ['设计哲学', ['从保单、不动产、宽基指数、伯克希尔等防守型资产起步。', '有了安全垫之后，才配置七巨头 + 台积电等进取型资产。', '层层递进，构筑现金流：主业、副业、投资收益的高位套现。', '不是一成不变的，要结合自身情况实时调整。']]
    ]
  }
];

const INDEX_DETAILS = [
  ['金字塔加仓法详解', ['事先算好准备用在标普500和纳指100上的总资金。', '跌到首买线后开始买入，之后每跌一个档位加仓一次。', '倍数 1-1-1.5-1.5-2-2-3，最后的"3"会动用额外资金，属于大跌大买。', '资金安排从小到大：小跌小买，大跌大买，把握重大机会。']],
  ['VIX 恐慌指数信号', ['VIX 达到 30：捞一些宽基指数进来。', 'VIX 达到 40：开始买入个股和两个宽基指数 ETF。', 'VIX 达到 50：重点加仓，资金最少打掉 50% 以上。', 'VIX 在 50-90：属于很好的买入节点，但不是唯一参考指标。']]
];

const STOCK_DETAILS = [
  ['"第一兼唯一"选股原则', ['投资选个股，跟选伴侣一样难：优秀特质很难全部兼得。', '龙头个股是少数兼具规模和市场地位领先（第一），同时拥有核心技术/壁垒/不可替代性（唯一）的资产。', '最好兼具"第一和唯一"，这样的个股买入后有信心长期持有。']],
  ['买入规则详解', ['先看基本面有没有恶化，如果没有，个股下跌 30% 左右开始买入。', '之后每下跌 4-5% 左右加仓一次，买入次数一般大于 6 次。', '拄底时出手，资金至少分 5 次，从少到多，不贪多。']]
];

const T_DETAILS = [
  ['做T的核心目的', ['最重要的目的，是腾出资金和仓位，其次才是降低成本。', '这样能不断加固安全边际，让自己长久地留在牌桌上。']],
  ['做T的规则', ['7 成的底仓不做 T，只有 3 成可以用于波段套利。', '尽量在震荡行情中做 T，不要在单边上涨行情中做 T。', '一般做正 T（先买后卖），不做反 T。']],
  ['倒金字塔卖出法（负成本路径）', ['一般在股价上涨 30% 以上再考虑卖出。', '上涨 40% 卖 15%，上涨 50% 卖 20%，如此直至低成本或负成本。']]
];

const DISCIPLINE_DETAILS = [
  ['安全边际三要素：资金、仓位、成本', ['不满仓，控制好安全边际，能不断提升资金利用率。', '永远不满仓，就是给自己留机会。']],
  ['7-7.5成仓规则', ['一般 7-7.5 成仓，最少留足 30% 备用金。', '极个别情况下会 8 成仓。']],
  ['止损条件', ['基本面恶化 = 一票否决，无论价格多便宜都不买。', '连续亏损 3 年且看不到盈利希望 = 一票否决。']]
];

const LEARN_CARDS = [
  { id: 'guide-index-etf', title: '金字塔加仓法', meta: '6 分钟阅读', icon: Layers, tint: 'from-amber-50 to-amber-100/40', accent: 'text-amber-500' },
  { id: 'guide-stock', title: '个股投资策略', meta: '7 分钟阅读', icon: Target, tint: 'from-rose-50 to-rose-100/40', accent: 'text-rose-500' },
  { id: 'guide-t', title: '做 T 与负成本', meta: '4 分钟阅读', icon: Activity, tint: 'from-violet-50 to-violet-100/40', accent: 'text-violet-500' },
  { id: 'guide-discipline', title: '操作纪律', meta: '5 分钟阅读', icon: ShieldCheck, tint: 'from-emerald-50 to-emerald-100/40', accent: 'text-emerald-500' },
  { id: 'guide-readme', title: '全站 README', meta: '8 分钟阅读', icon: FileText, tint: 'from-slate-50 to-slate-100/40', accent: 'text-slate-500' }
];

const TAB_RECENT_META = {
  'tab:strategy': { title: '策略指南', icon: BookOpen, tint: 'from-slate-50 to-slate-100/40', accent: 'text-slate-500' },
  'tab:holdings': { title: '持仓总览', icon: Wallet, tint: 'from-indigo-50 to-indigo-100/40', accent: 'text-indigo-500' },
  'tab:tradePlans': { title: '交易计划', icon: ListChecks, tint: 'from-emerald-50 to-emerald-100/40', accent: 'text-emerald-500' },
  'tab:fundSwitch': { title: '基金切换', icon: Repeat, tint: 'from-sky-50 to-sky-100/40', accent: 'text-sky-500' },
  'tab:markets': { title: '行情中心', icon: TrendingUp, tint: 'from-amber-50 to-amber-100/40', accent: 'text-amber-500' },
  'tab:notify': { title: '通知设置', icon: Bell, tint: 'from-rose-50 to-rose-100/40', accent: 'text-rose-500' },
  'tab:backup': { title: '数据同步', icon: CloudUpload, tint: 'from-violet-50 to-violet-100/40', accent: 'text-violet-500' }
};

const ACCOUNT_RECENT_META = {
  agg: { title: '进取型', icon: Activity, tint: 'from-rose-50 to-rose-100/40', accent: 'text-rose-500' },
  steady: { title: '稳健型', icon: ShieldCheck, tint: 'from-indigo-50 to-indigo-100/40', accent: 'text-indigo-500' },
  defend: { title: '防守型', icon: Wallet, tint: 'from-emerald-50 to-emerald-100/40', accent: 'text-emerald-500' }
};

function lookupRecent(id) {
  if (!id) return null;
  if (id.startsWith('tab:')) {
    const m = TAB_RECENT_META[id];
    if (!m) return null;
    return { kind: 'tab', id, target: id.slice(4), ...m };
  }
  if (id.startsWith('account:')) {
    const key = id.slice(8);
    const m = ACCOUNT_RECENT_META[key];
    if (!m) return null;
    return { kind: 'account', id, accountId: key, ...m };
  }
  const card = LEARN_CARDS.find((c) => c.id === id);
  if (card) return { kind: 'chapter', id, title: card.title, icon: card.icon, tint: card.tint, accent: card.accent };
  return null;
}

export const RECENT_KEY = 'aiDcaRecentGuideAnchors';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function readRecent() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(Boolean).slice(0, 12) : [];
  } catch { return []; }
}

function pushRecent(id) {
  if (typeof window === 'undefined' || !id) return;
  try {
    const list = readRecent();
    list.unshift({ id, ts: Date.now() });
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    // 最近访问写入失败时不阻塞章节打开。
  }
}

function formatSince(ts) {
  const diff = Date.now() - (ts || 0);
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

function SectionLabel({ icon: Icon, children, action }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        {Icon ? <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" /> : null}
        <span className="font-medium">{children}</span>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

function WelcomeHero() {
  const greeting = getGreeting();
  return (
    <div className="relative px-5 pt-10 pb-8 sm:px-6 sm:pt-14 sm:pb-10">
      <h1 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-[36px]">{greeting}，dudu</h1>
    </div>
  );
}

function NotionCard({ children, onClick, className = '' }) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cx(
          'group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
          className
        )}
      >
        {children}
      </button>
    );
  }
  return (
    <div className={cx('flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>
      {children}
    </div>
  );
}

function LearnCard({ card, onOpen }) {
  const Icon = card.icon;
  return (
    <NotionCard onClick={() => onOpen(card.id)} className="h-[210px] w-[136px] flex-shrink-0 snap-start sm:h-[230px] sm:w-[220px]">
      <div className={cx('flex flex-1 items-center justify-center bg-gradient-to-br', card.tint)}>
        <Icon className={cx('h-8 w-8 transition-transform group-hover:scale-110 sm:h-12 sm:w-12', card.accent)} strokeWidth={1.4} aria-hidden="true" />
      </div>
      <div className="border-t border-slate-100 px-3 py-2 sm:px-4 sm:py-3">
        <div className="truncate text-xs font-semibold text-slate-900 group-hover:text-indigo-600 sm:text-sm">{card.title}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400 sm:text-xs"><BookOpen className="h-3 w-3" aria-hidden="true" />{card.meta}</div>
      </div>
    </NotionCard>
  );
}

function RecentCard({ entry, onActivate }) {
  const meta = lookupRecent(entry.id);
  if (!meta) return null;
  const Icon = meta.icon || BookOpen;
  const kindLabel = meta.kind === 'tab' ? '页面' : meta.kind === 'account' ? '账户' : '章节';
  return (
    <NotionCard onClick={() => onActivate(meta)} className="h-[150px] w-[118px] flex-shrink-0 snap-start sm:h-[150px] sm:w-[170px]">
      <div className={cx('flex flex-1 items-center justify-center bg-gradient-to-br', meta.tint)}>
        <Icon className={cx('h-7 w-7 sm:h-10 sm:w-10', meta.accent)} strokeWidth={1.4} aria-hidden="true" />
      </div>
      <div className="border-t border-slate-100 px-2.5 py-1.5 sm:px-3 sm:py-2">
        <div className="truncate text-[11px] font-semibold text-slate-900 sm:text-xs">{meta.title}</div>
        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400 sm:text-[11px]">
          <span>{kindLabel}</span>
          <span>{formatSince(entry.ts)}</span>
        </div>
      </div>
    </NotionCard>
  );
}

function AccountTeaserCard({ account, onOpen }) {
  const tints = {
    rose: 'from-rose-50 via-white to-white',
    indigo: 'from-indigo-50 via-white to-white',
    emerald: 'from-emerald-50 via-white to-white'
  };
  const dots = { rose: 'bg-rose-400', indigo: 'bg-indigo-400', emerald: 'bg-emerald-400' };
  return (
    <button
      type="button"
      onClick={() => onOpen(account.id)}
      className={cx('group flex w-full flex-col gap-3 overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-br px-5 py-5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300', tints[account.tone] || 'from-slate-50')}
    >
      <div className="flex items-center gap-2">
        <span className={cx('h-2 w-2 rounded-full', dots[account.tone] || 'bg-slate-400')} aria-hidden="true" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{account.title}</span>
      </div>
      <div className="text-base font-semibold leading-6 text-slate-900">{account.sentence}</div>
      <div className="font-mono text-[11px] leading-5 text-slate-500">{account.examples}</div>
      <div className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 group-hover:text-indigo-500">查看详情<ChevronRight className="h-3 w-3" aria-hidden="true" /></div>
    </button>
  );
}

function buildUpcomingEvents() {
  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmt(d) { return `${months[d.getMonth()]} ${d.getDate()}`; }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = today.getDay();
  const isWeekend = day === 0 || day === 6;
  const items = [];
  if (!isWeekend) {
    items.push({ day: '今日', date: fmt(today), title: 'A 股开盘 / 收盘', time: '09:30 — 15:00' });
    items.push({ day: '今日', date: fmt(today), title: '美股开盘（夏令时）', time: '21:30' });
  }
  const next = new Date(today.getTime() + 86400000);
  const nextDay = next.getDay();
  if (nextDay !== 0 && nextDay !== 6) {
    items.push({ day: '明日', date: fmt(next), title: 'A 股开盘检查计划', time: '09:30' });
  } else {
    const daysToMon = (8 - day) % 7 || 7;
    const mon = new Date(today.getTime() + daysToMon * 86400000);
    items.push({ day: '周一', date: fmt(mon), title: 'A 股开盘检查计划', time: '09:30' });
  }
  return items.slice(0, 3);
}

function UpcomingEvents() {
  const events = useMemo(() => buildUpcomingEvents(), []);
  if (!events.length) {
    return <div className="rounded-2xl border border-slate-100 bg-white p-5 text-sm text-slate-500">本周末暂无交易日提醒。</div>;
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {events.map((ev, i) => (
        <div key={`${ev.day}-${ev.title}`} className={cx('flex items-start gap-4 px-5 py-4', i > 0 && 'border-t border-slate-100')}>
          <div className="w-16 flex-shrink-0 text-xs leading-5">
            <div className="font-semibold text-slate-900">{ev.day}</div>
            <div className="text-slate-400">{ev.date}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-900">{ev.title}</div>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><Clock className="h-3 w-3" aria-hidden="true" />{ev.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolEntry({ icon: Icon, title, value, note, onClick }) {
  return (
    <button type="button" onClick={onClick} className="group flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">{value}{note ? ` · ${note}` : ''}</div>
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300 group-hover:text-indigo-400" aria-hidden="true" />
    </button>
  );
}

function FloatingAi({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-6 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg shadow-slate-900/30 transition-all hover:scale-105 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:bottom-8 sm:right-8"
      aria-label="AI 助手"
    >
      <Sparkles className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}

function InfoSections({ sections }) {
  return (
    <div className="space-y-4 text-sm text-slate-600">
      {sections.map(([heading, bullets]) => (
        <div key={heading}>
          <div className="text-sm font-semibold text-slate-900">{heading}</div>
          <ul className="mt-2 space-y-1.5 leading-6">{bullets.map((item) => <li key={item}>· {item}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

function GuideButton({ children, onClick, variant = 'primary' }) {
  return (
    <button type="button" onClick={onClick} className={variant === 'primary' ? primaryButtonClass : secondaryButtonClass}>
      {children}
    </button>
  );
}

function SimpleTable({ headers, rows }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
          <tr>{headers.map((header) => <th key={header} className="px-4 py-3.5">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-600">
          {rows.map((row, index) => <tr key={index} className="even:bg-slate-50/70">{row.map((cell, cellIndex) => <td key={cellIndex} className={cx('px-4 py-3.5 leading-6', cellIndex > 0 && 'tabular-nums')}>{cell}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function ScreenshotImage({ src, alt, caption }) {
  const [zoomed, setZoomed] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs leading-5 text-slate-500">截图占位：{caption}</div>;
  }
  return (
    <>
      <figure className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button type="button" onClick={() => setZoomed(true)} className="group block w-full cursor-zoom-in" aria-label={`点击放大查看：${alt}`}>
          <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="mx-auto block max-h-44 w-auto object-contain transition group-hover:opacity-90" />
        </button>
        {caption ? <figcaption className="px-4 py-2 text-xs text-slate-500">{caption}</figcaption> : null}
      </figure>
      {zoomed ? (
        <div role="dialog" aria-modal="true" onClick={() => setZoomed(false)} className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <img src={src} alt={alt} className="max-h-[92vh] max-w-[92vw] cursor-zoom-out rounded-lg object-contain shadow-2xl" onClick={(event) => event.stopPropagation()} />
          <button type="button" onClick={() => setZoomed(false)} className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-slate-700 shadow hover:bg-white">关闭</button>
        </div>
      ) : null}
    </>
  );
}

function ReadmeCard({ title, description, bullets = [], cta, onClick }) {
  return (
    <Card className="flex h-full flex-col justify-between">
      <div>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
        {bullets.length ? (
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            {bullets.map((item) => <li key={item} className="flex gap-2"><span className="text-indigo-500">·</span><span>{item}</span></li>)}
          </ul>
        ) : null}
      </div>
      <button type="button" onClick={onClick} className={cx(subtleButtonClass, 'mt-5 w-full')}>{cta}</button>
    </Card>
  );
}

function DetailModal({ open, title, eyebrow, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="relative flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-7">
          <div className="min-w-0">
            {eyebrow ? <div className="text-xs font-semibold uppercase tracking-wider text-indigo-500">{eyebrow}</div> : null}
            <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900 sm:text-xl">{title}</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {children}
        </div>
      </div>
    </div>
  );
}

function AccountModalBody({ account }) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
        <div className="text-sm font-semibold text-slate-900">一句话定位</div>
        <div className="mt-1 text-sm leading-6 text-slate-600">{account.sentence}</div>
        <div className="mt-2 font-mono text-[11px] leading-5 text-slate-500">{account.examples}</div>
      </div>
      <InfoSections sections={account.details} />
    </div>
  );
}

function ChapterModalBody({ id, navigate, closeModal }) {
  function go(tab, options) { closeModal(); navigate(tab, options); }
  if (id === 'guide-notify') {
    return (
      <div className="space-y-6">
        <SectionHeading eyebrow="刚需功能" title="先把手机通知配好" description="策略触发时能不能提醒到手机，是这个工具从「看板」变成「执行助手」的关键。" />
        <div className="grid gap-5 lg:grid-cols-3">
          <Card>
            <Pill tone="indigo">iOS Bark</Pill>
            <h3 className="mt-3 text-base font-bold text-slate-900">复制完整 Bark 链接</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">打开 Bark，复制 api.day.app 开头的完整链接，或只复制 Device Key。系统会自动提取可用 Key。</p>
            <ScreenshotImage src="/strategy-guide/bark-example.png" alt="iOS Bark 复制推送链接示例" caption="很便捷，整段复制粘到通知页即可。" />
            <button type="button" className={cx(primaryButtonClass, 'mt-5 w-full')} onClick={() => go('notify')}>去配置 iOS 通知</button>
          </Card>
          <Card>
            <Pill tone="emerald">Android</Pill>
            <h3 className="mt-3 text-base font-bold text-slate-900">复制完整测试 URL</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">打开 Android 推送 App，复制灰色框里的消息推送 ID 或完整测试 URL，系统会自动提取。</p>
            <ScreenshotImage src="/strategy-guide/android-example.jpg" alt="Android 复制推送 ID 示例" caption="复制灰色框里的 android-... ID。" />
            <button type="button" className={cx(primaryButtonClass, 'mt-5 w-full')} onClick={() => go('notify')}>去绑定 Android 设备</button>
          </Card>
          <Card>
            <Pill tone="slate">PC 浏览器</Pill>
            <h3 className="mt-3 text-base font-bold text-slate-900">授权桌面通知</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">适合电脑常开网页。授权后前台轮询事件并弹出桌面提醒。</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-600"><li>1. 打开通知设置</li><li>2. 授权浏览器通知</li><li>3. 发送本地测试通知</li></ul>
            <button type="button" className={cx(primaryButtonClass, 'mt-5 w-full')} onClick={() => go('notify')}>去配置 PC 通知</button>
          </Card>
        </div>
      </div>
    );
  }
  if (id === 'guide-index-etf') {
    return (
      <div className="space-y-5">
        <p className="text-sm leading-6 text-slate-500">核心原则：长期持有、只买不卖，按回撤金字塔分批加仓；高位少买，低位多买。</p>
        <SimpleTable headers={['', 'QQQ（纳指100）', 'SPY/VOO（标普500）']} rows={[['首买跌幅', '9%', '6.5%（参考）'], ['每档间隔', '3.5%', '2.5-3%（参考）'], ['档数', '7', '6（参考）'], ['倍数', '1-1-1.5-1.5-2-2-3', '同左']]} />
        <SimpleTable headers={['VIX', '等级', '操作']} rows={[['<25', '平静', '常规定投，不追高'], ['25-30', '警戒', '保持定投 + 准备备用资金'], ['30-40', '中高恐慌', '加仓宽基'], ['40-50', '高恐慌', '宽基 + 个股全开'], ['≥50', '极端恐慌', '重仓，资金至少打 50%']]} />
        <InfoSections sections={INDEX_DETAILS} />
        <GuideButton onClick={() => go('tradePlans')}>前往交易计划 →</GuideButton>
      </div>
    );
  }
  if (id === 'guide-stock') {
    return (
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          {['第一兼唯一 — 行业第一或唯一性护城河', '营收/利润持续增长', '资产负债健康 — 现金 ≥ 负债', '经营现金流为正', '行业前景好', '估值合理 — PE 历史百分位 < 70%'].map((item) => <div key={item} className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{item}</div>)}
        </div>
        <SimpleTable headers={['规则', '参数']} rows={[['买入', '首买跌 30%（优质 20%+），每档 4-5%，≥6 档'], ['仓位', '单只上限 50%，总仓 7-8.5 成，70% 底仓 + 30% 做 T'], ['减仓', '+15% / +25% / +35% 分档减仓']]} />
        <InfoSections sections={STOCK_DETAILS} />
        <GuideButton onClick={() => go('tradePlans')}>前往交易计划 →</GuideButton>
      </div>
    );
  }
  if (id === 'guide-t') {
    return (
      <div className="space-y-5">
        <InfoSections sections={T_DETAILS} />
        <GuideButton onClick={() => go('holdings')}>查看持仓做 T 记录 →</GuideButton>
      </div>
    );
  }
  if (id === 'guide-discipline') {
    return (
      <div className="space-y-5">
        <InfoSections sections={DISCIPLINE_DETAILS} />
      </div>
    );
  }
  if (id === 'guide-readme') {
    return (
      <div className="grid gap-5 md:grid-cols-2">
        <ReadmeCard title="持仓总览" description="记录真实资产底账，管理交易流水、成本、收益、市值和三账户分配。" bullets={['新增或导入交易流水', '确认成本与收益', '分配三账户']} cta="前往持仓总览" onClick={() => go('holdings')} />
        <ReadmeCard title="交易计划" description="把策略变成可执行清单，包括加仓、定投和卖出计划。" bullets={['宽基金字塔加仓', '个股 checklist', 'Smart DCA 资金池']} cta="前往交易计划" onClick={() => go('tradePlans')} />
        <ReadmeCard title="通知设置" description="配置 iOS Bark、Android 推送或 PC 浏览器通知，策略触发时主动提醒你。" bullets={['复制完整链接自动解析', '发送测试通知', '同步交易计划规则']} cta="前往通知设置" onClick={() => go('notify')} />
        <ReadmeCard title="行情中心" description="查看关注标的、市场指数和 VIX 风险信号。" bullets={['维护美股关注列表', '观察指数和恐慌信号', '辅助判断是否进入加仓区']} cta="前往行情中心" onClick={() => go('markets')} />
        <ReadmeCard title="基金切换" description="辅助比较同类基金、ETF 或替代标的之间的切换机会。" bullets={['比较候选标的', '分析切换收益', '差异足够大时才执行']} cta="前往基金切换" onClick={() => go('fundSwitch')} />
        <ReadmeCard title="数据同步" description="备份和恢复本地数据，避免浏览器清理或换设备导致数据丢失。" bullets={['导出当前数据', '恢复历史备份', '换设备前先备份']} cta="前往备份" onClick={() => go('backup')} />
      </div>
    );
  }
  return null;
}

const CHAPTER_EYEBROW = {
  'guide-notify': '刚需功能',
  'guide-index-etf': '只买不卖',
  'guide-stock': '第一兼唯一',
  'guide-t': '终极目标',
  'guide-discipline': '铁律',
  'guide-readme': '全站 README'
};

export function StrategyGuideExperience({ links, onNavigate, onDemoDataChange }) {
  const [demoMeta, setDemoMeta] = useState(() => readDemoDataMeta());
  const [prefs, setPrefs] = useState(() => readWorkspacePrefs());
  const [message, setMessage] = useState('');
  const [showAi, setShowAi] = useState(false);
  const [recent, setRecent] = useState(() => readRecent());
  const [activeChapter, setActiveChapter] = useState(null);
  const [activeAccount, setActiveAccount] = useState(null);
  const hasUserData = useMemo(() => hasPotentialUserData(), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onStorage(e) {
      if (!e || e.key === RECENT_KEY || e.key === null) {
        setRecent(readRecent());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function navigate(tabKey, options) {
    if (onNavigate) { onNavigate(tabKey, options); return; }
    if (typeof window !== 'undefined') {
      window.location.href = links?.[tabKey] || './index.html';
    }
  }

  function handleOpenChapter(chapterId) {
    pushRecent(chapterId);
    setRecent(readRecent());
    setActiveAccount(null);
    setActiveChapter(chapterId);
  }

  function handleOpenAccount(accountId) {
    pushRecent(`account:${accountId}`);
    setRecent(readRecent());
    setActiveChapter(null);
    setActiveAccount(accountId);
  }

  function handleRecentActivate(meta) {
    if (meta.kind === 'tab') {
      navigate(meta.target);
      return;
    }
    if (meta.kind === 'account') {
      handleOpenAccount(meta.accountId);
      return;
    }
    if (meta.kind === 'chapter') {
      handleOpenChapter(meta.id);
    }
  }

  function refreshDemoMeta() {
    const next = readDemoDataMeta();
    setDemoMeta(next);
    onDemoDataChange?.(next);
    return next;
  }

  function handleInstallDemo() {
    if (hasUserData && !window.confirm('检测到已有本地数据。生成演示数据会覆盖当前持仓、计划和定投数据。建议先到「数据同步」导出备份。确认继续？')) return;
    const meta = installDemoData();
    setMessage('演示数据已生成。下一步建议配置手机通知，完整体验「计划触发 → 手机提醒」的流程。');
    setDemoMeta(meta);
    onDemoDataChange?.(meta);
  }

  function handleClearDemo() {
    if (!window.confirm('确认清除演示数据？这会删除由 Demo 生成的持仓、计划、定投、账户分配和关注列表。')) return;
    clearDemoData();
    setMessage('演示数据已清除。你可以重新生成 Demo，或开始录入真实数据。');
    refreshDemoMeta();
  }

  function handleSaveHome() {
    const next = persistWorkspacePrefs({ homepageTab: prefs.homepageTab });
    setPrefs(next);
    setMessage(`已将「${HOME_OPTIONS.find((item) => item.value === next.homepageTab)?.label || '策略指南'}」设为默认首页。`);
  }

  const dashboardStatus = useMemo(() => {
    if (typeof window === 'undefined') {
      return { holdings: '待录入', plans: '0 个', notify: '未配置', backup: '未配置' };
    }
    function readJson(key) {
      try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { return null; }
    }
    const ledger = readJson('aiDcaFundHoldingsLedger');
    const txCount = Array.isArray(ledger?.transactions) ? ledger.transactions.length : 0;
    const planStore = readJson('aiDcaPlanStore');
    const planCount = Array.isArray(planStore?.plans) ? planStore.plans.length : 0;
    const dca = readJson('aiDcaDcaState');
    const hasDca = Boolean(dca && dca.source);
    const notify = readJson('aiDcaNotifyClientConfig');
    const hasNotify = Boolean(notify?.barkDeviceKey || notify?.notifyClientId);
    const webdav = readJson('aiDcaWebDavConfig');
    const hasBackup = Boolean(webdav?.baseUrl || webdav?.username);
    return {
      holdings: txCount ? `${txCount} 笔` : '待录入',
      plans: `${planCount + (hasDca ? 1 : 0)} 个`,
      notify: hasNotify ? '已配置' : '未配置',
      backup: hasBackup ? '已配置' : '未配置'
    };
  }, []);

  const visibleRecent = useMemo(() => recent.filter((r) => r && r.id !== 'tab:strategy' && lookupRecent(r.id)).slice(0, 5), [recent]);
  const chapterMeta = activeChapter ? LEARN_CARDS.find((c) => c.id === activeChapter) : null;
  const accountMeta = activeAccount ? ACCOUNT_CARDS.find((a) => a.id === activeAccount) : null;

  return (
    <div className="min-h-screen bg-white">
      <WelcomeHero />

      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-5 pb-28 sm:px-6">
        {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

        {visibleRecent.length > 0 ? (
          <section className="space-y-3">
            <SectionLabel icon={BookOpen}>Recently visited</SectionLabel>
            <div className="-mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-2 sm:mx-0 sm:gap-3 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {visibleRecent.map((r, idx) => <RecentCard key={`${r.id}-${r.ts || idx}`} entry={r} onActivate={handleRecentActivate} />)}
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <SectionLabel icon={Target}>三账户体系</SectionLabel>
          <div className="grid gap-4 md:grid-cols-3">
            {ACCOUNT_CARDS.map((account) => <AccountTeaserCard key={account.id} account={account} onOpen={handleOpenAccount} />)}
          </div>
        </section>

        <section className="space-y-3">
          <SectionLabel icon={BookOpen}>策略章节</SectionLabel>
          <div className="-mx-5 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-5 pb-2 sm:mx-0 sm:gap-4 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {LEARN_CARDS.map((card) => <LearnCard key={card.id} card={card} onOpen={handleOpenChapter} />)}
          </div>
        </section>

        <section className="space-y-3">
          <SectionLabel icon={Calendar}>即将到来</SectionLabel>
          <UpcomingEvents />
        </section>

        <section className="space-y-3">
          <SectionLabel icon={Activity}>快速入口</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ToolEntry icon={Wallet} title="持仓总览" value={dashboardStatus.holdings} onClick={() => navigate('holdings')} />
            <ToolEntry icon={ListChecks} title="交易计划" value={dashboardStatus.plans} onClick={() => navigate('tradePlans', { hash: '#new' })} />
            <ToolEntry icon={Bell} title="通知设置" value={dashboardStatus.notify} onClick={() => navigate('notify')} />
            <ToolEntry icon={CloudUpload} title="数据同步" value={dashboardStatus.backup} onClick={() => navigate('backup')} />
          </div>
        </section>

        <details className="group rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
            <span>
              <SectionLabel icon={Settings}>工作台设置</SectionLabel>
              <span className="mt-1 block text-base font-semibold text-slate-900">演示数据 · 默认首页</span>
            </span>
            <ChevronRight className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true" />
          </summary>
          <div className="mt-5 space-y-5">
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
              <SectionHeading eyebrow="新手辅助" title="需要一套示例数据吗？" description="生成随机 Demo，快速理解持仓、交易计划、通知和账户体系。" />
              <div className="mt-3 flex flex-wrap gap-3">
                <GuideButton variant="secondary" onClick={handleInstallDemo}>{demoMeta ? '重新生成 Demo' : '生成演示数据'}</GuideButton>
                {demoMeta ? <GuideButton variant="secondary" onClick={handleClearDemo}><Trash2 className="h-4 w-4" />清除 Demo</GuideButton> : null}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px_auto] lg:items-end">
              <SectionHeading eyebrow="偏好设置" title="默认打开哪个页面？" description="带 ?tab= 的链接仍会优先打开指定页面。" />
              <SelectField options={HOME_OPTIONS} value={prefs.homepageTab} onChange={(event) => setPrefs((current) => ({ ...current, homepageTab: event.target.value }))} />
              <GuideButton onClick={handleSaveHome}>保存默认主页</GuideButton>
            </div>
          </div>
        </details>
      </main>

      <FloatingAi onClick={() => setShowAi(true)} />

      <DetailModal
        open={Boolean(accountMeta)}
        eyebrow="三账户体系"
        title={accountMeta ? `${accountMeta.title}账户` : ''}
        onClose={() => setActiveAccount(null)}
      >
        {accountMeta ? <AccountModalBody account={accountMeta} /> : null}
      </DetailModal>

      <DetailModal
        open={Boolean(chapterMeta)}
        eyebrow={chapterMeta ? (CHAPTER_EYEBROW[chapterMeta.id] || '策略章节') : ''}
        title={chapterMeta ? chapterMeta.title : ''}
        onClose={() => setActiveChapter(null)}
      >
        {chapterMeta ? <ChapterModalBody id={chapterMeta.id} navigate={navigate} closeModal={() => setActiveChapter(null)} /> : null}
      </DetailModal>



      {showAi ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" onClick={() => setShowAi(false)}>
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="关闭" className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setShowAi(false)}><X className="h-4 w-4" /></button>
            <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-indigo-500" /><h3 className="text-base font-bold text-slate-900">AI 快问（即将上线）</h3></div>
            <p className="mt-3 text-sm leading-6 text-slate-500">未来你可以在这里问：「今天该加仓哪些？」、「我的进取仓比例」、「VIX 现在多少」。</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => { setShowAi(false); navigate('markets'); }} className={cx(subtleButtonClass, 'text-xs')}>看 VIX</button>
              <button type="button" onClick={() => { setShowAi(false); navigate('tradePlans'); }} className={cx(subtleButtonClass, 'text-xs')}>看交易计划</button>
              <button type="button" onClick={() => { setShowAi(false); navigate('holdings'); }} className={cx(subtleButtonClass, 'text-xs')}>看持仓</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
