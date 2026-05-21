import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Bell, BookOpen, CloudUpload, ListChecks, Wallet, Trash2, X,
  Sparkles, Calendar, ChevronRight, Clock, Layers, ShieldCheck, Target,
  Activity, FileText, Settings
} from 'lucide-react';
import { clearDemoData, hasPotentialUserData, installDemoData, readDemoDataMeta } from '../app/demoData.js';
import { persistWorkspacePrefs, readWorkspacePrefs } from '../app/workspacePrefs.js';
import { Card, Pill, SectionHeading, SelectField, cx, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';

const HOME_OPTIONS = [
  { value: 'strategy', label: '\u7b56\u7565\u6307\u5357' },
  { value: 'holdings', label: '\u6301\u4ed3\u603b\u89c8' },
  { value: 'tradePlans', label: '\u4ea4\u6613\u8ba1\u5212' },
  { value: 'notify', label: '\u901a\u77e5\u8bbe\u7f6e' },
  { value: 'markets', label: '\u884c\u60c5\u4e2d\u5fc3' },
  { value: 'fundSwitch', label: '\u57fa\u91d1\u5207\u6362' },
  { value: 'backup', label: '\u6570\u636e\u540c\u6b65' }
];

const ACCOUNT_CARDS = [
  {
    id: 'agg', title: '\u8fdb\u53d6\u578b', tone: 'rose',
    sentence: '\u8ffd\u6c42\u9ad8\u6536\u76ca\uff0c\u627f\u53d7\u9ad8\u6ce2\u52a8',
    examples: 'AAPL / MSFT / GOOGL / AMZN / NVDA / META / TSLA / TSM',
    details: [
      ['\u8fdb\u53d6\u578b\u8d26\u6237', ['\u6e05\u4e00\u8272\u7f8e\u80a1\u4e03\u5de8\u5934 + \u53f0\u79ef\u7535 + \u535a\u901a + AMD\u3002', '\u82f1\u4f1f\u8fbe\u5360\u6bd4\u6700\u5927\uff0c\u5176\u6b21\u662f\u8c37\u6b4c\uff0c\u82f9\u679c/\u4e9a\u9a6c\u900a/\u53f0\u79ef\u7535/Meta \u5404\u5360\u4e00\u90e8\u5206\u3002', '\u7279\u65af\u62c9\u4ed3\u4f4d\u8f83\u5c0f\uff0c280 \u7f8e\u5143\u4ee5\u5185\u518d\u8003\u8651\u52a0\u4ed3\u3002', '\u8ffd\u6c42\u9ad8\u6536\u76ca\uff0c\u627f\u53d7\u9ad8\u6ce2\u52a8\uff0c\u662f\u201c\u6539\u53d8\u672a\u6765\u7684\u8d44\u4ea7\u201d\u3002']]
    ]
  },
  {
    id: 'steady', title: '\u7a33\u5065\u578b', tone: 'indigo',
    sentence: '\u957f\u671f\u6301\u6709\uff0c\u53ea\u4e70\u4e0d\u5356\uff0c\u91d1\u5b57\u5854\u52a0\u4ed3',
    examples: 'QQQ / SPY / VOO / IVV',
    details: [
      ['\u7a33\u5065\u578b\u8d26\u6237', ['\u7eb3\u6307100\u548c\u6807\u666e500 ETF \u4e3a\u6838\u5fc3\uff0c\u76ee\u6807\u5360\u6bd4\u7ea6 70%\u3002', '\u53e0\u52a0\u6d88\u8d39\u9f99\u5934\uff0c\u5982 Costco\u3001\u6c83\u5c14\u739b\u3001\u9ea6\u5f53\u52b3\u3001\u5b9d\u6d01\u3002', '\u53e0\u52a0\u533b\u836f\u4fdd\u5065\uff0c\u5982\u793c\u6765\u3001\u5f3a\u751f\u3001\u8054\u5408\u5065\u5eb7\u3001\u8bfa\u548c\u8bfa\u5fb7\u3002', '\u53ea\u4e70\u4e0d\u5356\uff0c\u91d1\u5b57\u5854\u52a0\u4ed3\uff0c\u662f\u8d44\u4ea7\u914d\u7f6e\u7684\u538b\u8231\u77f3\u3002']]
    ]
  },
  {
    id: 'defend', title: '\u9632\u5b88\u578b', tone: 'emerald',
    sentence: '\u7a33\u5b9a\u5206\u7ea2\uff0c\u6297\u8dcc\u9632\u5fa1\uff0c\u6784\u7b51\u73b0\u91d1\u6d41',
    examples: 'BRK.B / KO / JNJ / SCHD / \u56fd\u503a ETF',
    details: [
      ['\u9632\u5b88\u578b\u8d26\u6237', ['\u7f8e\u503a\u53ca\u76f8\u5173 ETF \u5360\u6bd4\u8f83\u9ad8\uff0c\u6838\u5fc3\u662f\u5403\u5229\u606f\u3002', '\u4f2f\u514b\u5e0c\u5c14\u3001\u53ef\u53e3\u53ef\u4e50\u3001\u5f3a\u751f\u3001SCHD\u3001VISA \u6784\u6210\u9632\u5b88\u6743\u76ca\u8d44\u4ea7\u3002', '\u6838\u5fc3\u4f5c\u7528\uff1a\u5403\u6d3e\u606f\u5206\u7ea2 + \u9632\u5b88\u3002', '\u6bcf\u4e2a\u6708\u4ea7\u751f\u7684\u73b0\u91d1\u6d41\uff0c\u7528\u4e8e\u673a\u4f1a\u51fa\u73b0\u65f6\u52a0\u4ed3\u5bbd\u57fa\u6307\u6570\u548c\u79d1\u6280\u80a1\u3002']],
      ['\u4e3a\u4ec0\u4e48\u8981\u914d\u7f6e\u9632\u5b88\u578b\uff1f', ['\u6210\u529f\u7684\u4ea4\u6613\u5458\uff0c\u4e0d\u662f\u8d5a\u5f97\u6700\u591a\uff0c\u662f\u5e02\u573a\u8f6c\u5411\u7684\u65f6\u5019\u8fd8\u80fd\u6d3b\u4e0b\u6765\u3002', '\u5177\u5907\u8db3\u591f\u591a\u7684\u5fc3\u7406\u5b89\u5168\u611f\uff0c\u624d\u80fd\u6ca1\u6709\u987e\u8651\u5730\u53bb\u505a\u8fdb\u53d6\u578b\u3002', '\u8fdb\u53d6\u578b\u3001\u7a33\u5065\u578b\u3001\u9632\u5b88\u578b\u4e09\u8005\u5e73\u8861\uff0c\u5c42\u5c42\u9012\u8fdb\u3002']],
      ['\u8bbe\u8ba1\u54f2\u5b66', ['\u4ece\u4fdd\u5355\u3001\u4e0d\u52a8\u4ea7\u3001\u5bbd\u57fa\u6307\u6570\u3001\u4f2f\u514b\u5e0c\u5c14\u7b49\u9632\u5b88\u578b\u8d44\u4ea7\u8d77\u6b65\u3002', '\u6709\u4e86\u5b89\u5168\u57ab\u4e4b\u540e\uff0c\u624d\u914d\u7f6e\u4e03\u5de8\u5934 + \u53f0\u79ef\u7535\u7b49\u8fdb\u53d6\u578b\u8d44\u4ea7\u3002', '\u5c42\u5c42\u9012\u8fdb\uff0c\u6784\u7b51\u73b0\u91d1\u6d41\uff1a\u4e3b\u4e1a\u3001\u526f\u4e1a\u3001\u6295\u8d44\u6536\u76ca\u7684\u9ad8\u4f4d\u5957\u73b0\u3002', '\u4e0d\u662f\u4e00\u6210\u4e0d\u53d8\u7684\uff0c\u8981\u7ed3\u5408\u81ea\u8eab\u60c5\u51b5\u5b9e\u65f6\u8c03\u6574\u3002']]
    ]
  }
];

const INDEX_DETAILS = [
  ['\u91d1\u5b57\u5854\u52a0\u4ed3\u6cd5\u8be6\u89e3', ['\u4e8b\u5148\u7b97\u597d\u51c6\u5907\u7528\u5728\u6807\u666e500\u548c\u7eb3\u6307100\u4e0a\u7684\u603b\u8d44\u91d1\u3002', '\u8dcc\u5230\u9996\u4e70\u7ebf\u540e\u5f00\u59cb\u4e70\u5165\uff0c\u4e4b\u540e\u6bcf\u8dcc\u4e00\u4e2a\u6863\u4f4d\u52a0\u4ed3\u4e00\u6b21\u3002', '\u500d\u6570 1-1-1.5-1.5-2-2-3\uff0c\u6700\u540e\u7684\u201c3\u201d\u4f1a\u52a8\u7528\u989d\u5916\u8d44\u91d1\uff0c\u5c5e\u4e8e\u5927\u8dcc\u5927\u4e70\u3002', '\u8d44\u91d1\u5b89\u6392\u4ece\u5c0f\u5230\u5927\uff1a\u5c0f\u8dcc\u5c0f\u4e70\uff0c\u5927\u8dcc\u5927\u4e70\uff0c\u628a\u63e1\u91cd\u5927\u673a\u4f1a\u3002']],
  ['VIX \u6050\u614c\u6307\u6570\u4fe1\u53f7', ['VIX \u8fbe\u5230 30\uff1a\u635e\u4e00\u4e9b\u5bbd\u57fa\u6307\u6570\u8fdb\u6765\u3002', 'VIX \u8fbe\u5230 40\uff1a\u5f00\u59cb\u4e70\u5165\u4e2a\u80a1\u548c\u4e24\u4e2a\u5bbd\u57fa\u6307\u6570 ETF\u3002', 'VIX \u8fbe\u5230 50\uff1a\u91cd\u70b9\u52a0\u4ed3\uff0c\u8d44\u91d1\u6700\u5c11\u6253\u6389 50% \u4ee5\u4e0a\u3002', 'VIX \u5728 50-90\uff1a\u5c5e\u4e8e\u5f88\u597d\u7684\u4e70\u5165\u8282\u70b9\uff0c\u4f46\u4e0d\u662f\u552f\u4e00\u53c2\u8003\u6307\u6807\u3002']]
];

const STOCK_DETAILS = [
  ['\u201c\u7b2c\u4e00\u517c\u552f\u4e00\u201d\u9009\u80a1\u539f\u5219', ['\u6295\u8d44\u9009\u4e2a\u80a1\uff0c\u8ddf\u9009\u4f34\u4fa3\u4e00\u6837\u96be\uff1a\u4f18\u79c0\u7279\u8d28\u5f88\u96be\u5168\u90e8\u517c\u5f97\u3002', '\u9f99\u5934\u4e2a\u80a1\u662f\u5c11\u6570\u517c\u5177\u89c4\u6a21\u548c\u5e02\u573a\u5730\u4f4d\u9886\u5148\uff08\u7b2c\u4e00\uff09\uff0c\u540c\u65f6\u62e5\u6709\u6838\u5fc3\u6280\u672f/\u58c1\u5792/\u4e0d\u53ef\u66ff\u4ee3\u6027\uff08\u552f\u4e00\uff09\u7684\u8d44\u4ea7\u3002', '\u6700\u597d\u517c\u5177\u201c\u7b2c\u4e00\u548c\u552f\u4e00\u201d\uff0c\u8fd9\u6837\u7684\u4e2a\u80a1\u4e70\u5165\u540e\u6709\u4fe1\u5fc3\u957f\u671f\u6301\u6709\u3002']],
  ['\u4e70\u5165\u89c4\u5219\u8be6\u89e3', ['\u5148\u770b\u57fa\u672c\u9762\u6709\u6ca1\u6709\u6076\u5316\uff0c\u5982\u679c\u6ca1\u6709\uff0c\u4e2a\u80a1\u4e0b\u8dcc 30% \u5de6\u53f3\u5f00\u59cb\u4e70\u5165\u3002', '\u4e4b\u540e\u6bcf\u4e0b\u8dcc 4-5% \u5de6\u53f3\u52a0\u4ed3\u4e00\u6b21\uff0c\u4e70\u5165\u6b21\u6570\u4e00\u822c\u5927\u4e8e 6 \u6b21\u3002', '\u62c4\u5e95\u65f6\u51fa\u624b\uff0c\u8d44\u91d1\u81f3\u5c11\u5206 5 \u6b21\uff0c\u4ece\u5c11\u5230\u591a\uff0c\u4e0d\u8d2a\u591a\u3002']]
];

const T_DETAILS = [
  ['\u505aT\u7684\u6838\u5fc3\u76ee\u7684', ['\u6700\u91cd\u8981\u7684\u76ee\u7684\uff0c\u662f\u817e\u51fa\u8d44\u91d1\u548c\u4ed3\u4f4d\uff0c\u5176\u6b21\u624d\u662f\u964d\u4f4e\u6210\u672c\u3002', '\u8fd9\u6837\u80fd\u4e0d\u65ad\u52a0\u56fa\u5b89\u5168\u8fb9\u9645\uff0c\u8ba9\u81ea\u5df1\u957f\u4e45\u5730\u7559\u5728\u724c\u684c\u4e0a\u3002']],
  ['\u505aT\u7684\u89c4\u5219', ['7 \u6210\u7684\u5e95\u4ed3\u4e0d\u505a T\uff0c\u53ea\u6709 3 \u6210\u53ef\u4ee5\u7528\u4e8e\u6ce2\u6bb5\u5957\u5229\u3002', '\u5c3d\u91cf\u5728\u9707\u8361\u884c\u60c5\u4e2d\u505a T\uff0c\u4e0d\u8981\u5728\u5355\u8fb9\u4e0a\u6da8\u884c\u60c5\u4e2d\u505a T\u3002', '\u4e00\u822c\u505a\u6b63 T\uff08\u5148\u4e70\u540e\u5356\uff09\uff0c\u4e0d\u505a\u53cd T\u3002']],
  ['\u5012\u91d1\u5b57\u5854\u5356\u51fa\u6cd5\uff08\u8d1f\u6210\u672c\u8def\u5f84\uff09', ['\u4e00\u822c\u5728\u80a1\u4ef7\u4e0a\u6da8 30% \u4ee5\u4e0a\u518d\u8003\u8651\u5356\u51fa\u3002', '\u4e0a\u6da8 40% \u5356 15%\uff0c\u4e0a\u6da8 50% \u5356 20%\uff0c\u5982\u6b64\u76f4\u81f3\u4f4e\u6210\u672c\u6216\u8d1f\u6210\u672c\u3002']]
];

const DISCIPLINE_DETAILS = [
  ['\u5b89\u5168\u8fb9\u9645\u4e09\u8981\u7d20\uff1a\u8d44\u91d1\u3001\u4ed3\u4f4d\u3001\u6210\u672c', ['\u4e0d\u6ee1\u4ed3\uff0c\u63a7\u5236\u597d\u5b89\u5168\u8fb9\u9645\uff0c\u80fd\u4e0d\u65ad\u63d0\u5347\u8d44\u91d1\u5229\u7528\u7387\u3002', '\u6c38\u8fdc\u4e0d\u6ee1\u4ed3\uff0c\u5c31\u662f\u7ed9\u81ea\u5df1\u7559\u673a\u4f1a\u3002']],
  ['7-7.5\u6210\u4ed3\u89c4\u5219', ['\u4e00\u822c 7-7.5 \u6210\u4ed3\uff0c\u6700\u5c11\u7559\u8db3 30% \u5907\u7528\u91d1\u3002', '\u6781\u4e2a\u522b\u60c5\u51b5\u4e0b\u4f1a 8 \u6210\u4ed3\u3002']],
  ['\u6b62\u635f\u6761\u4ef6', ['\u57fa\u672c\u9762\u6076\u5316 = \u4e00\u7968\u5426\u51b3\uff0c\u65e0\u8bba\u4ef7\u683c\u591a\u4fbf\u5b9c\u90fd\u4e0d\u4e70\u3002', '\u8fde\u7eed\u4e8f\u635f 3 \u5e74\u4e14\u770b\u4e0d\u5230\u76c8\u5229\u5e0c\u671b = \u4e00\u7968\u5426\u51b3\u3002']]
];

const LEARN_CARDS = [
  { id: 'guide-index-etf', title: '\u91d1\u5b57\u5854\u52a0\u4ed3\u6cd5', meta: '6 \u5206\u949f\u9605\u8bfb', icon: Layers, tint: 'from-amber-50 to-amber-100/40', accent: 'text-amber-500' },
  { id: 'guide-stock', title: '\u4e2a\u80a1\u6295\u8d44\u7b56\u7565', meta: '7 \u5206\u949f\u9605\u8bfb', icon: Target, tint: 'from-rose-50 to-rose-100/40', accent: 'text-rose-500' },
  { id: 'guide-t', title: '\u505a T \u4e0e\u8d1f\u6210\u672c', meta: '4 \u5206\u949f\u9605\u8bfb', icon: Activity, tint: 'from-violet-50 to-violet-100/40', accent: 'text-violet-500' },
  { id: 'guide-discipline', title: '\u64cd\u4f5c\u7eaa\u5f8b', meta: '5 \u5206\u949f\u9605\u8bfb', icon: ShieldCheck, tint: 'from-emerald-50 to-emerald-100/40', accent: 'text-emerald-500' },
  { id: 'guide-readme', title: '\u5168\u7ad9 README', meta: '8 \u5206\u949f\u9605\u8bfb', icon: FileText, tint: 'from-slate-50 to-slate-100/40', accent: 'text-slate-500' }
];

const RECENT_KEY = 'aiDcaRecentGuideAnchors';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5) return '\u591c\u6df1\u4e86';
  if (h < 11) return '\u65e9\u4e0a\u597d';
  if (h < 14) return '\u4e2d\u5348\u597d';
  if (h < 18) return '\u4e0b\u5348\u597d';
  return '\u665a\u4e0a\u597d';
}

function readRecent() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(Boolean).slice(0, 5) : [];
  } catch { return []; }
}

function pushRecent(id) {
  if (typeof window === 'undefined') return;
  try {
    const list = readRecent().filter((item) => item && item.id !== id);
    list.unshift({ id, ts: Date.now() });
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
  } catch {}
}

function formatSince(ts) {
  const diff = Date.now() - (ts || 0);
  const m = Math.floor(diff / 60000);
  if (m < 1) return '\u521a\u521a';
  if (m < 60) return `${m} \u5206\u949f\u524d`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} \u5c0f\u65f6\u524d`;
  const d = Math.floor(h / 24);
  return `${d} \u5929\u524d`;
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

function WelcomeHero({ onShowDisclaimer, onJoinGroup }) {
  const greeting = getGreeting();
  return (
    <div className="relative px-5 pt-10 pb-8 sm:px-6 sm:pt-14 sm:pb-10">
      <div className="absolute right-4 top-4 flex items-center gap-2 sm:right-6 sm:top-6">
        <button type="button" onClick={onJoinGroup} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-600">\u52a0\u5165\u7fa4\u804a</button>
        <button type="button" onClick={onShowDisclaimer} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200 transition-colors hover:bg-amber-100"><AlertCircle className="h-3 w-3" aria-hidden="true" />\u514d\u8d23</button>
      </div>
      <h1 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-[36px]">{greeting}\uff0cdudu</h1>
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
          'group flex w-full flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
          className
        )}
      >
        {children}
      </button>
    );
  }
  return (
    <div className={cx('flex w-full flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>
      {children}
    </div>
  );
}

function LearnCard({ card, onOpen }) {
  const Icon = card.icon;
  return (
    <NotionCard onClick={() => onOpen(card.id)} className="h-[210px] w-[200px] flex-shrink-0 snap-start sm:h-[230px] sm:w-[220px]">
      <div className={cx('flex flex-1 items-center justify-center bg-gradient-to-br', card.tint)}>
        <Icon className={cx('h-12 w-12 transition-transform group-hover:scale-110', card.accent)} strokeWidth={1.4} aria-hidden="true" />
      </div>
      <div className="border-t border-slate-100 px-4 py-3">
        <div className="text-sm font-semibold text-slate-900 group-hover:text-indigo-600">{card.title}</div>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-400"><BookOpen className="h-3 w-3" aria-hidden="true" />{card.meta}</div>
      </div>
    </NotionCard>
  );
}

function RecentCard({ anchorId, ts, onOpen }) {
  const card = LEARN_CARDS.find((c) => c.id === anchorId);
  if (!card) return null;
  const Icon = card.icon;
  return (
    <NotionCard onClick={() => onOpen(card.id)} className="h-[160px] w-[180px] flex-shrink-0 snap-start">
      <div className={cx('flex flex-1 items-center justify-center bg-gradient-to-br', card.tint)}>
        <Icon className={cx('h-10 w-10', card.accent)} strokeWidth={1.4} aria-hidden="true" />
      </div>
      <div className="border-t border-slate-100 px-3 py-2">
        <div className="truncate text-xs font-semibold text-slate-900">{card.title}</div>
        <div className="text-[11px] text-slate-400">{formatSince(ts)}</div>
      </div>
    </NotionCard>
  );
}

function AccountHeroCard({ account }) {
  const tints = {
    rose: 'from-rose-50 via-white to-white',
    indigo: 'from-indigo-50 via-white to-white',
    emerald: 'from-emerald-50 via-white to-white'
  };
  const dots = { rose: 'bg-rose-400', indigo: 'bg-indigo-400', emerald: 'bg-emerald-400' };
  return (
    <details className={cx('group overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-br shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-200', tints[account.tone] || 'from-slate-50')}>
      <summary className="flex cursor-pointer list-none flex-col gap-3 px-5 py-5">
        <div className="flex items-center gap-2">
          <span className={cx('h-2 w-2 rounded-full', dots[account.tone] || 'bg-slate-400')} aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{account.title}</span>
        </div>
        <div className="text-base font-semibold leading-6 text-slate-900">{account.sentence}</div>
        <div className="font-mono text-[11px] leading-5 text-slate-500">{account.examples}</div>
        <div className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 group-open:hidden">\u67e5\u770b\u8be6\u60c5<ChevronRight className="h-3 w-3" aria-hidden="true" /></div>
      </summary>
      <div className="space-y-4 border-t border-slate-100 bg-white/80 px-5 py-4 text-sm text-slate-600">
        {account.details.map(([heading, bullets]) => (
          <div key={heading}>
            <div className="text-sm font-semibold text-slate-900">{heading}</div>
            <ul className="mt-2 space-y-1.5 leading-6">{bullets.map((item) => <li key={item}>\u00b7 {item}</li>)}</ul>
          </div>
        ))}
      </div>
    </details>
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
    items.push({ day: '\u4eca\u65e5', date: fmt(today), title: 'A \u80a1\u5f00\u76d8 / \u6536\u76d8', time: '09:30 \u2014 15:00' });
    items.push({ day: '\u4eca\u65e5', date: fmt(today), title: '\u7f8e\u80a1\u5f00\u76d8\uff08\u590f\u4ee4\u65f6\uff09', time: '21:30' });
  }
  const next = new Date(today.getTime() + 86400000);
  const nextDay = next.getDay();
  if (nextDay !== 0 && nextDay !== 6) {
    items.push({ day: '\u660e\u65e5', date: fmt(next), title: 'A \u80a1\u5f00\u76d8\u68c0\u67e5\u8ba1\u5212', time: '09:30' });
  } else {
    const daysToMon = (8 - day) % 7 || 7;
    const mon = new Date(today.getTime() + daysToMon * 86400000);
    items.push({ day: '\u5468\u4e00', date: fmt(mon), title: 'A \u80a1\u5f00\u76d8\u68c0\u67e5\u8ba1\u5212', time: '09:30' });
  }
  return items.slice(0, 3);
}

function UpcomingEvents() {
  const events = useMemo(() => buildUpcomingEvents(), []);
  if (!events.length) {
    return <div className="rounded-2xl border border-slate-100 bg-white p-5 text-sm text-slate-500">\u672c\u5468\u672b\u6682\u65e0\u4ea4\u6613\u65e5\u63d0\u9192\u3002</div>;
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
        <div className="text-xs text-slate-500">{value}{note ? ` \u00b7 ${note}` : ''}</div>
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
      aria-label="AI \u52a9\u624b"
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
          <ul className="mt-2 space-y-1.5 leading-6">{bullets.map((item) => <li key={item}>\u00b7 {item}</li>)}</ul>
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
    return <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs leading-5 text-slate-500">\u622a\u56fe\u5360\u4f4d\uff1a{caption}</div>;
  }
  return (
    <>
      <figure className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button type="button" onClick={() => setZoomed(true)} className="group block w-full cursor-zoom-in" aria-label={`\u70b9\u51fb\u653e\u5927\u67e5\u770b\uff1a${alt}`}>
          <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="mx-auto block max-h-44 w-auto object-contain transition group-hover:opacity-90" />
        </button>
        {caption ? <figcaption className="px-4 py-2 text-xs text-slate-500">{caption}</figcaption> : null}
      </figure>
      {zoomed ? (
        <div role="dialog" aria-modal="true" onClick={() => setZoomed(false)} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <img src={src} alt={alt} className="max-h-[92vh] max-w-[92vw] cursor-zoom-out rounded-lg object-contain shadow-2xl" onClick={(event) => event.stopPropagation()} />
          <button type="button" onClick={() => setZoomed(false)} className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-slate-700 shadow hover:bg-white">\u5173\u95ed</button>
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
            {bullets.map((item) => <li key={item} className="flex gap-2"><span className="text-indigo-500">\u00b7</span><span>{item}</span></li>)}
          </ul>
        ) : null}
      </div>
      <button type="button" onClick={onClick} className={cx(subtleButtonClass, 'mt-5 w-full')}>{cta}</button>
    </Card>
  );
}

export function StrategyGuideExperience({ links, onNavigate, onDemoDataChange }) {
  const [demoMeta, setDemoMeta] = useState(() => readDemoDataMeta());
  const [prefs, setPrefs] = useState(() => readWorkspacePrefs());
  const [message, setMessage] = useState('');
  const [showQrModal, setShowQrModal] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [recent, setRecent] = useState(() => readRecent());
  const detailsRef = useRef(null);
  const hasUserData = useMemo(() => hasPotentialUserData(), []);

  function navigate(tabKey, options) {
    if (onNavigate) { onNavigate(tabKey, options); return; }
    if (typeof window !== 'undefined') {
      window.location.href = links?.[tabKey] || './index.html';
    }
  }

  function scrollToGuideSection(targetId) {
    if (typeof window === 'undefined') return;
    const target = document.getElementById(targetId);
    if (!target) return;
    const offset = window.matchMedia('(max-width: 639px)').matches ? 96 : 24;
    const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - offset);
    window.scrollTo({ top, behavior: 'smooth' });
  }

  function handleOpenLearn(anchorId) {
    pushRecent(anchorId);
    setRecent(readRecent());
    if (detailsRef.current && !detailsRef.current.open) {
      detailsRef.current.open = true;
    }
    setTimeout(() => scrollToGuideSection(anchorId), 60);
  }

  function refreshDemoMeta() {
    const next = readDemoDataMeta();
    setDemoMeta(next);
    onDemoDataChange?.(next);
    return next;
  }

  function handleInstallDemo() {
    if (hasUserData && !window.confirm('\u68c0\u6d4b\u5230\u5df2\u6709\u672c\u5730\u6570\u636e\u3002\u751f\u6210\u6f14\u793a\u6570\u636e\u4f1a\u8986\u76d6\u5f53\u524d\u6301\u4ed3\u3001\u8ba1\u5212\u548c\u5b9a\u6295\u6570\u636e\u3002\u5efa\u8bae\u5148\u5230\u201c\u6570\u636e\u540c\u6b65\u201d\u5bfc\u51fa\u5907\u4efd\u3002\u786e\u8ba4\u7ee7\u7eed\uff1f')) return;
    const meta = installDemoData();
    setMessage('\u6f14\u793a\u6570\u636e\u5df2\u751f\u6210\u3002\u4e0b\u4e00\u6b65\u5efa\u8bae\u914d\u7f6e\u624b\u673a\u901a\u77e5\uff0c\u5b8c\u6574\u4f53\u9a8c\u201c\u8ba1\u5212\u89e6\u53d1 \u2192 \u624b\u673a\u63d0\u9192\u201d\u7684\u6d41\u7a0b\u3002');
    setDemoMeta(meta);
    onDemoDataChange?.(meta);
  }

  function handleClearDemo() {
    if (!window.confirm('\u786e\u8ba4\u6e05\u9664\u6f14\u793a\u6570\u636e\uff1f\u8fd9\u4f1a\u5220\u9664\u7531 Demo \u751f\u6210\u7684\u6301\u4ed3\u3001\u8ba1\u5212\u3001\u5b9a\u6295\u3001\u8d26\u6237\u5206\u914d\u548c\u5173\u6ce8\u5217\u8868\u3002')) return;
    clearDemoData();
    setMessage('\u6f14\u793a\u6570\u636e\u5df2\u6e05\u9664\u3002\u4f60\u53ef\u4ee5\u91cd\u65b0\u751f\u6210 Demo\uff0c\u6216\u5f00\u59cb\u5f55\u5165\u771f\u5b9e\u6570\u636e\u3002');
    refreshDemoMeta();
  }

  function handleSaveHome() {
    const next = persistWorkspacePrefs({ homepageTab: prefs.homepageTab });
    setPrefs(next);
    setMessage(`\u5df2\u5c06\u201c${HOME_OPTIONS.find((item) => item.value === next.homepageTab)?.label || '\u7b56\u7565\u6307\u5357'}\u201d\u8bbe\u4e3a\u9ed8\u8ba4\u9996\u9875\u3002`);
  }

  const dashboardStatus = useMemo(() => {
    if (typeof window === 'undefined') {
      return { holdings: '\u5f85\u5f55\u5165', plans: '0 \u4e2a', notify: '\u672a\u914d\u7f6e', backup: '\u672a\u914d\u7f6e' };
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
      holdings: txCount ? `${txCount} \u7b14` : '\u5f85\u5f55\u5165',
      plans: `${planCount + (hasDca ? 1 : 0)} \u4e2a`,
      notify: hasNotify ? '\u5df2\u914d\u7f6e' : '\u672a\u914d\u7f6e',
      backup: hasBackup ? '\u5df2\u914d\u7f6e' : '\u672a\u914d\u7f6e'
    };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <WelcomeHero onJoinGroup={() => setShowQrModal(true)} onShowDisclaimer={() => setShowDisclaimer(true)} />

      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-5 pb-28 sm:px-6">
        {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

        {recent.length > 0 ? (
          <section className="space-y-3">
            <SectionLabel icon={BookOpen}>Recently visited</SectionLabel>
            <div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {recent.map((r) => <RecentCard key={r.id} anchorId={r.id} ts={r.ts} onOpen={handleOpenLearn} />)}
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <SectionLabel icon={Target}>\u4e09\u8d26\u6237\u4f53\u7cfb</SectionLabel>
          <div className="grid gap-4 md:grid-cols-3">
            {ACCOUNT_CARDS.map((account) => <AccountHeroCard key={account.id} account={account} />)}
          </div>
        </section>

        <section className="space-y-3">
          <SectionLabel icon={BookOpen}>\u7b56\u7565\u7ae0\u8282</SectionLabel>
          <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {LEARN_CARDS.map((card) => <LearnCard key={card.id} card={card} onOpen={handleOpenLearn} />)}
          </div>
        </section>

        <section className="space-y-3">
          <SectionLabel icon={Calendar}>\u5373\u5c06\u5230\u6765</SectionLabel>
          <UpcomingEvents />
        </section>

        <section className="space-y-3">
          <SectionLabel icon={Activity}>\u5feb\u901f\u5165\u53e3</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ToolEntry icon={Wallet} title="\u6301\u4ed3\u603b\u89c8" value={dashboardStatus.holdings} onClick={() => navigate('holdings')} />
            <ToolEntry icon={ListChecks} title="\u4ea4\u6613\u8ba1\u5212" value={dashboardStatus.plans} onClick={() => navigate('tradePlans', { hash: '#new' })} />
            <ToolEntry icon={Bell} title="\u901a\u77e5\u8bbe\u7f6e" value={dashboardStatus.notify} onClick={() => navigate('notify')} />
            <ToolEntry icon={CloudUpload} title="\u6570\u636e\u540c\u6b65" value={dashboardStatus.backup} onClick={() => navigate('backup')} />
          </div>
        </section>

        <details ref={detailsRef} className="group rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
            <span>
              <SectionLabel icon={BookOpen}>\u7ae0\u8282\u8be6\u60c5</SectionLabel>
              <span className="mt-1 block text-lg font-semibold tracking-tight text-slate-900">\u70b9\u51fb\u5c55\u5f00\u5b8c\u6574\u6307\u5357</span>
            </span>
            <ChevronRight className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true" />
          </summary>
          <div className="mt-6 space-y-10">
            <section id="guide-notify" className="scroll-mt-24 space-y-5">
              <SectionHeading eyebrow="\u521a\u9700\u529f\u80fd" title="\u5148\u628a\u624b\u673a\u901a\u77e5\u914d\u597d" description="\u7b56\u7565\u89e6\u53d1\u65f6\u80fd\u4e0d\u80fd\u63d0\u9192\u5230\u624b\u673a\uff0c\u662f\u8fd9\u4e2a\u5de5\u5177\u4ece\u201c\u770b\u677f\u201d\u53d8\u6210\u201c\u6267\u884c\u52a9\u624b\u201d\u7684\u5173\u952e\u3002" />
              <div className="grid gap-6 lg:grid-cols-3">
                <Card>
                  <Pill tone="indigo">iOS Bark</Pill>
                  <h3 className="mt-4 text-lg font-bold text-slate-900">\u590d\u5236\u5b8c\u6574 Bark \u94fe\u63a5</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">\u6253\u5f00 Bark\uff0c\u590d\u5236 api.day.app \u5f00\u5934\u7684\u5b8c\u6574\u94fe\u63a5\uff0c\u6216\u53ea\u590d\u5236 Device Key\u3002\u7cfb\u7edf\u4f1a\u81ea\u52a8\u63d0\u53d6\u53ef\u7528 Key\u3002</p>
                  <ScreenshotImage src="/strategy-guide/bark-example.png" alt="iOS Bark \u590d\u5236\u63a8\u9001\u94fe\u63a5\u793a\u4f8b" caption="\u5f88\u4fbf\u6377\uff0c\u6574\u6bb5\u590d\u5236\u7c98\u5230\u901a\u77e5\u9875\u5373\u53ef\u3002" />
                  <button type="button" className={cx(primaryButtonClass, 'mt-5 w-full')} onClick={() => navigate('notify')}>\u53bb\u914d\u7f6e iOS \u901a\u77e5</button>
                </Card>
                <Card>
                  <Pill tone="emerald">Android</Pill>
                  <h3 className="mt-4 text-lg font-bold text-slate-900">\u590d\u5236\u5b8c\u6574\u6d4b\u8bd5 URL</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">\u6253\u5f00 Android \u63a8\u9001 App\uff0c\u590d\u5236\u7070\u8272\u6846\u91cc\u7684\u6d88\u606f\u63a8\u9001 ID \u6216\u5b8c\u6574\u6d4b\u8bd5 URL\uff0c\u7cfb\u7edf\u4f1a\u81ea\u52a8\u63d0\u53d6\u3002</p>
                  <ScreenshotImage src="/strategy-guide/android-example.jpg" alt="Android \u590d\u5236\u63a8\u9001 ID \u793a\u4f8b" caption="\u590d\u5236\u7070\u8272\u6846\u91cc\u7684 android-... ID\u3002" />
                  <button type="button" className={cx(primaryButtonClass, 'mt-5 w-full')} onClick={() => navigate('notify')}>\u53bb\u7ed1\u5b9a Android \u8bbe\u5907</button>
                </Card>
                <Card>
                  <Pill tone="slate">PC \u6d4f\u89c8\u5668</Pill>
                  <h3 className="mt-4 text-lg font-bold text-slate-900">\u6388\u6743\u684c\u9762\u901a\u77e5</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">\u9002\u5408\u7535\u8111\u5e38\u5f00\u7f51\u9875\u3002\u6388\u6743\u540e\u524d\u53f0\u8f6e\u8be2\u4e8b\u4ef6\u5e76\u5f39\u51fa\u684c\u9762\u63d0\u9192\u3002</p>
                  <ul className="mt-4 space-y-2 text-sm text-slate-600"><li>1. \u6253\u5f00\u901a\u77e5\u8bbe\u7f6e</li><li>2. \u6388\u6743\u6d4f\u89c8\u5668\u901a\u77e5</li><li>3. \u53d1\u9001\u672c\u5730\u6d4b\u8bd5\u901a\u77e5</li></ul>
                  <button type="button" className={cx(primaryButtonClass, 'mt-5 w-full')} onClick={() => navigate('notify')}>\u53bb\u914d\u7f6e PC \u901a\u77e5</button>
                </Card>
              </div>
            </section>

            <section id="guide-index-etf" className="scroll-mt-24 space-y-5">
              <SectionHeading eyebrow="\u53ea\u4e70\u4e0d\u5356" title="\u91d1\u5b57\u5854\u52a0\u4ed3\u6cd5 \u00b7 \u5bbd\u57fa\u6307\u6570 ETF" />
              <Card className="space-y-5">
                <p className="text-sm leading-6 text-slate-500">\u6838\u5fc3\u539f\u5219\uff1a\u957f\u671f\u6301\u6709\u3001\u53ea\u4e70\u4e0d\u5356\uff0c\u6309\u56de\u649e\u91d1\u5b57\u5854\u5206\u6279\u52a0\u4ed3\uff1b\u9ad8\u4f4d\u5c11\u4e70\uff0c\u4f4e\u4f4d\u591a\u4e70\u3002</p>
                <SimpleTable headers={['', 'QQQ\uff08\u7eb3\u6307100\uff09', 'SPY/VOO\uff08\u6807\u666e500\uff09']} rows={[['\u9996\u4e70\u8dcc\u5e45', '9%', '6.5%\uff08\u53c2\u8003\uff09'], ['\u6bcf\u6863\u95f4\u9694', '3.5%', '2.5-3%\uff08\u53c2\u8003\uff09'], ['\u6863\u6570', '7', '6\uff08\u53c2\u8003\uff09'], ['\u500d\u6570', '1-1-1.5-1.5-2-2-3', '\u540c\u5de6']]} />
                <SimpleTable headers={['VIX', '\u7b49\u7ea7', '\u64cd\u4f5c']} rows={[['<25', '\u5e73\u9759', '\u5e38\u89c4\u5b9a\u6295\uff0c\u4e0d\u8ffd\u9ad8'], ['25-30', '\u8b66\u6212', '\u4fdd\u6301\u5b9a\u6295 + \u51c6\u5907\u5907\u7528\u8d44\u91d1'], ['30-40', '\u4e2d\u9ad8\u6050\u614c', '\u52a0\u4ed3\u5bbd\u57fa'], ['40-50', '\u9ad8\u6050\u614c', '\u5bbd\u57fa + \u4e2a\u80a1\u5168\u5f00'], ['\u226550', '\u6781\u7aef\u6050\u614c', '\u91cd\u4ed3\uff0c\u8d44\u91d1\u81f3\u5c11\u6253 50%']]} />
                <InfoSections sections={INDEX_DETAILS} />
                <GuideButton onClick={() => navigate('tradePlans')}>\u524d\u5f80\u4ea4\u6613\u8ba1\u5212 \u2192</GuideButton>
              </Card>
            </section>

            <section id="guide-stock" className="scroll-mt-24 space-y-5">
              <SectionHeading eyebrow="\u7b2c\u4e00\u517c\u552f\u4e00" title="\u4e2a\u80a1\u6295\u8d44\u7b56\u7565" />
              <Card className="space-y-5">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {['\u7b2c\u4e00\u517c\u552f\u4e00 \u2014 \u884c\u4e1a\u7b2c\u4e00\u6216\u552f\u4e00\u6027\u62a4\u57ce\u6cb3', '\u8425\u6536/\u5229\u6da6\u6301\u7eed\u589e\u957f', '\u8d44\u4ea7\u8d1f\u503a\u5065\u5eb7 \u2014 \u73b0\u91d1 \u2265 \u8d1f\u503a', '\u7ecf\u8425\u73b0\u91d1\u6d41\u4e3a\u6b63', '\u884c\u4e1a\u524d\u666f\u597d', '\u4f30\u503c\u5408\u7406 \u2014 PE \u5386\u53f2\u767e\u5206\u4f4d < 70%'].map((item) => <div key={item} className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{item}</div>)}
                </div>
                <SimpleTable headers={['\u89c4\u5219', '\u53c2\u6570']} rows={[['\u4e70\u5165', '\u9996\u4e70\u8dcc 30%\uff08\u4f18\u8d28 20%+\uff09\uff0c\u6bcf\u6863 4-5%\uff0c\u22656 \u6863'], ['\u4ed3\u4f4d', '\u5355\u53ea\u4e0a\u9650 50%\uff0c\u603b\u4ed3 7-8.5 \u6210\uff0c70% \u5e95\u4ed3 + 30% \u505a T'], ['\u51cf\u4ed3', '+15% / +25% / +35% \u5206\u6863\u51cf\u4ed3']]} />
                <InfoSections sections={STOCK_DETAILS} />
                <GuideButton onClick={() => navigate('tradePlans')}>\u524d\u5f80\u4ea4\u6613\u8ba1\u5212 \u2192</GuideButton>
              </Card>
            </section>

            <section id="guide-t" className="scroll-mt-24 space-y-5">
              <SectionHeading eyebrow="\u7ec8\u6781\u76ee\u6807" title="\u505a T \u4e0e\u8d1f\u6210\u672c\u6301\u80a1" />
              <Card>
                <InfoSections sections={T_DETAILS} />
              </Card>
            </section>

            <section id="guide-discipline" className="scroll-mt-24 space-y-5">
              <SectionHeading eyebrow="\u94c1\u5f8b" title="\u64cd\u4f5c\u7eaa\u5f8b" />
              <Card>
                <InfoSections sections={DISCIPLINE_DETAILS} />
              </Card>
            </section>

            <section id="guide-readme" className="scroll-mt-24 space-y-5">
              <SectionHeading eyebrow="\u5168\u7ad9 README" title="\u6bcf\u4e2a\u529f\u80fd\u9875\u80fd\u505a\u4ec0\u4e48" />
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                <ReadmeCard title="\u6301\u4ed3\u603b\u89c8" description="\u8bb0\u5f55\u771f\u5b9e\u8d44\u4ea7\u5e95\u8d26\uff0c\u7ba1\u7406\u4ea4\u6613\u6d41\u6c34\u3001\u6210\u672c\u3001\u6536\u76ca\u3001\u5e02\u503c\u548c\u4e09\u8d26\u6237\u5206\u914d\u3002" bullets={['\u65b0\u589e\u6216\u5bfc\u5165\u4ea4\u6613\u6d41\u6c34', '\u786e\u8ba4\u6210\u672c\u4e0e\u6536\u76ca', '\u5206\u914d\u4e09\u8d26\u6237']} cta="\u524d\u5f80\u6301\u4ed3\u603b\u89c8" onClick={() => navigate('holdings')} />
                <ReadmeCard title="\u4ea4\u6613\u8ba1\u5212" description="\u628a\u7b56\u7565\u53d8\u6210\u53ef\u6267\u884c\u6e05\u5355\uff0c\u5305\u62ec\u52a0\u4ed3\u3001\u5b9a\u6295\u548c\u5356\u51fa\u8ba1\u5212\u3002" bullets={['\u5bbd\u57fa\u91d1\u5b57\u5854\u52a0\u4ed3', '\u4e2a\u80a1 checklist', 'Smart DCA \u8d44\u91d1\u6c60']} cta="\u524d\u5f80\u4ea4\u6613\u8ba1\u5212" onClick={() => navigate('tradePlans')} />
                <ReadmeCard title="\u901a\u77e5\u8bbe\u7f6e" description="\u914d\u7f6e iOS Bark\u3001Android \u63a8\u9001\u6216 PC \u6d4f\u89c8\u5668\u901a\u77e5\uff0c\u7b56\u7565\u89e6\u53d1\u65f6\u4e3b\u52a8\u63d0\u9192\u4f60\u3002" bullets={['\u590d\u5236\u5b8c\u6574\u94fe\u63a5\u81ea\u52a8\u89e3\u6790', '\u53d1\u9001\u6d4b\u8bd5\u901a\u77e5', '\u540c\u6b65\u4ea4\u6613\u8ba1\u5212\u89c4\u5219']} cta="\u524d\u5f80\u901a\u77e5\u8bbe\u7f6e" onClick={() => navigate('notify')} />
                <ReadmeCard title="\u884c\u60c5\u4e2d\u5fc3" description="\u67e5\u770b\u5173\u6ce8\u6807\u7684\u3001\u5e02\u573a\u6307\u6570\u548c VIX \u98ce\u9669\u4fe1\u53f7\u3002" bullets={['\u7ef4\u62a4\u7f8e\u80a1\u5173\u6ce8\u5217\u8868', '\u89c2\u5bdf\u6307\u6570\u548c\u6050\u614c\u4fe1\u53f7', '\u8f85\u52a9\u5224\u65ad\u662f\u5426\u8fdb\u5165\u52a0\u4ed3\u533a']} cta="\u524d\u5f80\u884c\u60c5\u4e2d\u5fc3" onClick={() => navigate('markets')} />
                <ReadmeCard title="\u57fa\u91d1\u5207\u6362" description="\u8f85\u52a9\u6bd4\u8f83\u540c\u7c7b\u57fa\u91d1\u3001ETF \u6216\u66ff\u4ee3\u6807\u7684\u4e4b\u95f4\u7684\u5207\u6362\u673a\u4f1a\u3002" bullets={['\u6bd4\u8f83\u5019\u9009\u6807\u7684', '\u5206\u6790\u5207\u6362\u6536\u76ca', '\u5dee\u5f02\u8db3\u591f\u5927\u65f6\u624d\u6267\u884c']} cta="\u524d\u5f80\u57fa\u91d1\u5207\u6362" onClick={() => navigate('fundSwitch')} />
                <ReadmeCard title="\u6570\u636e\u540c\u6b65" description="\u5907\u4efd\u548c\u6062\u590d\u672c\u5730\u6570\u636e\uff0c\u907f\u514d\u6d4f\u89c8\u5668\u6e05\u7406\u6216\u6362\u8bbe\u5907\u5bfc\u81f4\u6570\u636e\u4e22\u5931\u3002" bullets={['\u5bfc\u51fa\u5f53\u524d\u6570\u636e', '\u6062\u590d\u5386\u53f2\u5907\u4efd', '\u6362\u8bbe\u5907\u524d\u5148\u5907\u4efd']} cta="\u524d\u5f80\u5907\u4efd" onClick={() => navigate('backup')} />
              </div>
            </section>
          </div>
        </details>

        <details className="group rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
            <span>
              <SectionLabel icon={Settings}>\u5de5\u4f5c\u53f0\u8bbe\u7f6e</SectionLabel>
              <span className="mt-1 block text-base font-semibold text-slate-900">\u6f14\u793a\u6570\u636e \u00b7 \u9ed8\u8ba4\u9996\u9875</span>
            </span>
            <ChevronRight className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true" />
          </summary>
          <div className="mt-5 space-y-5">
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
              <SectionHeading eyebrow="\u65b0\u624b\u8f85\u52a9" title="\u9700\u8981\u4e00\u5957\u793a\u4f8b\u6570\u636e\u5417\uff1f" description="\u751f\u6210\u968f\u673a Demo\uff0c\u5feb\u901f\u7406\u89e3\u6301\u4ed3\u3001\u4ea4\u6613\u8ba1\u5212\u3001\u901a\u77e5\u548c\u8d26\u6237\u4f53\u7cfb\u3002" />
              <div className="mt-3 flex flex-wrap gap-3">
                <GuideButton variant="secondary" onClick={handleInstallDemo}>{demoMeta ? '\u91cd\u65b0\u751f\u6210 Demo' : '\u751f\u6210\u6f14\u793a\u6570\u636e'}</GuideButton>
                {demoMeta ? <GuideButton variant="secondary" onClick={handleClearDemo}><Trash2 className="h-4 w-4" />\u6e05\u9664 Demo</GuideButton> : null}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px_auto] lg:items-end">
              <SectionHeading eyebrow="\u504f\u597d\u8bbe\u7f6e" title="\u9ed8\u8ba4\u6253\u5f00\u54ea\u4e2a\u9875\u9762\uff1f" description="\u5e26 ?tab= \u7684\u94fe\u63a5\u4ecd\u4f1a\u4f18\u5148\u6253\u5f00\u6307\u5b9a\u9875\u9762\u3002" />
              <SelectField options={HOME_OPTIONS} value={prefs.homepageTab} onChange={(event) => setPrefs((current) => ({ ...current, homepageTab: event.target.value }))} />
              <GuideButton onClick={handleSaveHome}>\u4fdd\u5b58\u9ed8\u8ba4\u4e3b\u9875</GuideButton>
            </div>
          </div>
        </details>
      </main>

      <FloatingAi onClick={() => setShowAi(true)} />

      {showQrModal ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4" role="dialog" aria-modal="true" aria-label="\u52a0\u5165\u7fa4\u804a\u4e8c\u7ef4\u7801" onClick={() => setShowQrModal(false)}>
          <div className="relative w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="\u5173\u95ed" className="absolute -top-3 -right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 shadow-md transition-colors hover:bg-slate-100" onClick={() => setShowQrModal(false)}><X className="h-4 w-4" /></button>
            <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
              <img src="https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAAEUUA9qDZ5H_XnPECnDzzMGTTIc2b_5_gAC8B4AAtk5cFTHSrIufYF2bDsE.jpg" alt="\u52a0\u5165\u7fa4\u804a\u4e8c\u7ef4\u7801" className="block w-full" />
              <p className="px-4 py-3 text-center text-xs text-slate-600">\u4f7f\u7528\u5fae\u4fe1 / QQ \u626b\u7801\u52a0\u5165\u7fa4\u804a</p>
            </div>
          </div>
        </div>
      ) : null}

      {showDisclaimer ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" onClick={() => setShowDisclaimer(false)}>
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="\u5173\u95ed" className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setShowDisclaimer(false)}><X className="h-4 w-4" /></button>
            <SectionHeading eyebrow="\u514d\u8d23\u58f0\u660e" title="\u975e\u5b98\u65b9\u3001\u975e\u6295\u8d44\u5efa\u8bae" />
            <p className="mt-4 text-sm leading-7 text-slate-500">\u672c\u5de5\u5177\u4e2d\u7684\u7b56\u7565\u8bf4\u660e\u7531\u516c\u5f00\u7684\u91d1\u6e10\u6210\u516c\u4f17\u53f7\u6587\u7ae0\u6574\u7406\u3001\u603b\u7ed3\u548c\u7ed3\u6784\u5316\u800c\u6765\uff0c\u4ec5\u7528\u4e8e\u4e2a\u4eba\u5b66\u4e60\u3001\u8bb0\u5f55\u548c\u8f85\u52a9\u51b3\u7b56\u3002\u672c\u5de5\u5177\u4e0e\u91d1\u6e10\u6210\u672c\u4eba\u53ca\u5176\u516c\u4f17\u53f7\u65e0\u5b98\u65b9\u5173\u8054\u3001\u65e0\u6388\u6743\u5173\u7cfb\uff0c\u4e5f\u4e0d\u4ee3\u8868\u91d1\u6e10\u6210\u672c\u4eba\u89c2\u70b9\u6216\u670d\u52a1\u3002\u9875\u9762\u4e2d\u7684\u8ba1\u5212\u3001\u63d0\u9192\u3001\u6f14\u793a\u6570\u636e\u548c\u8ba1\u7b97\u7ed3\u679c\u5747\u4e3a\u8f85\u52a9\u5de5\u5177\u8f93\u51fa\uff0c\u4e0d\u6784\u6210\u4efb\u4f55\u6295\u8d44\u5efa\u8bae\u3002\u6295\u8d44\u6709\u98ce\u9669\uff0c\u8bf7\u72ec\u7acb\u5224\u65ad\u5e76\u81ea\u884c\u627f\u62c5\u51b3\u7b56\u7ed3\u679c\u3002</p>
          </div>
        </div>
      ) : null}

      {showAi ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" onClick={() => setShowAi(false)}>
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="\u5173\u95ed" className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setShowAi(false)}><X className="h-4 w-4" /></button>
            <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-indigo-500" /><h3 className="text-base font-bold text-slate-900">AI \u5feb\u95ee\uff08\u5373\u5c06\u4e0a\u7ebf\uff09</h3></div>
            <p className="mt-3 text-sm leading-6 text-slate-500">\u672a\u6765\u4f60\u53ef\u4ee5\u5728\u8fd9\u91cc\u95ee\uff1a\u201c\u4eca\u5929\u8be5\u52a0\u4ed3\u54ea\u4e9b\uff1f\u201d\u3001\u201c\u6211\u7684\u8fdb\u53d6\u4ed3\u6bd4\u4f8b\u201d\u3001\u201cVIX \u73b0\u5728\u591a\u5c11\u201d\u3002</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => { setShowAi(false); navigate('markets'); }} className={cx(subtleButtonClass, 'text-xs')}>\u770b VIX</button>
              <button type="button" onClick={() => { setShowAi(false); navigate('tradePlans'); }} className={cx(subtleButtonClass, 'text-xs')}>\u770b\u4ea4\u6613\u8ba1\u5212</button>
              <button type="button" onClick={() => { setShowAi(false); navigate('holdings'); }} className={cx(subtleButtonClass, 'text-xs')}>\u770b\u6301\u4ed3</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
