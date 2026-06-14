import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Search,
  Shuffle,
  Wallet,
  X,
} from 'lucide-react';
import { readLedgerState } from '../app/holdingsLedger.js';
import { readPlanList } from '../app/plan.js';

const TAB_ENTRIES = [
  { key: 'holdings', label: '持仓总览', desc: '基金持仓、汇总收益', icon: Wallet, keywords: 'holdings cangwei chicang' },
  { key: 'tradePlans', label: '交易计划', desc: '加仓 / 定投策略', icon: BarChart3, keywords: 'tradeplans plans jihua dca' },
  { key: 'quant', label: '量化研究', desc: '模拟盘、策略、交易、复盘', icon: Bot, keywords: 'quant lianghua moni backtest', adminOnly: true },
  { key: 'fundSwitch', label: '基金切换', desc: '切换链路与执行', icon: Shuffle, keywords: 'fundswitch switch qiehuan' },
  { key: 'notify', label: '通知', desc: '推送配置与状态', icon: Bell, keywords: 'notify push tongzhi' },
];

function pickFundsFromLedger(state) {
  const txs = state && Array.isArray(state.transactions) ? state.transactions : [];
  const map = new Map();
  for (const tx of txs) {
    const code = (tx && tx.code) || '';
    if (!code) continue;
    if (!map.has(code)) {
      map.set(code, { code, name: (tx && tx.name) || code, kind: (tx && tx.kind) || '' });
    } else {
      const cur = map.get(code);
      if ((!cur.name || cur.name === code) && tx.name) cur.name = tx.name;
      if (!cur.kind && tx.kind) cur.kind = tx.kind;
    }
  }
  return Array.from(map.values());
}

function kindLabel(kind) {
  if (kind === 'otc') return '场外';
  if (kind === 'exchange') return '场内';
  if (kind === 'qdii') return 'QDII';
  return kind || '';
}

export function GlobalSearch({ open, onClose, onSelectTab, onSelectFund, showAdminTabs = false }) {
  const [query, setQuery] = useState('');
  const [funds, setFunds] = useState([]);
  const [plans, setPlans] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    try {
      setFunds(pickFundsFromLedger(readLedgerState()));
    } catch (_err) {
      setFunds([]);
    }
    try {
      const list = readPlanList();
      setPlans(Array.isArray(list) ? list : []);
    } catch (_err) {
      setPlans([]);
    }
    function onKey(event) {
      if (event.key === 'Escape' && typeof onClose === 'function') onClose();
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 80);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  const q = query.trim().toLowerCase();

  const tabResults = useMemo(() => {
    const visibleEntries = TAB_ENTRIES.filter((tab) => !tab.adminOnly || showAdminTabs);
    if (!q) return visibleEntries;
    return visibleEntries.filter((tab) => {
      const hay = `${tab.label} ${tab.desc || ''} ${tab.key} ${tab.keywords || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [q, showAdminTabs]);

  const fundResults = useMemo(() => {
    if (!q) return [];
    return funds
      .filter((fund) => {
        const hay = `${fund.code} ${fund.name}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [funds, q]);

  const planResults = useMemo(() => {
    if (!q) return [];
    return plans
      .filter((plan) => {
        const hay = `${plan.name || ''} ${plan.code || ''} ${plan.id || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [plans, q]);

  if (!open) return null;

  function handlePickTab(key, options) {
    if (typeof onSelectTab === 'function') onSelectTab(key, options);
    if (typeof onClose === 'function') onClose();
  }
  function handlePickFund(code) {
    if (typeof onSelectFund === 'function') onSelectFund(code);
    if (typeof onClose === 'function') onClose();
  }

  const noResults =
    !!q && fundResults.length === 0 && planResults.length === 0 && tabResults.length === 0;

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="全局搜索"
    >
      <header className="flex items-center justify-between px-5 pb-3 pt-5">
        <h2 className="text-2xl font-bold text-slate-900">搜索</h2>
        <button
          type="button"
          className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100"
          onClick={onClose}
          aria-label="关闭"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 pb-28">
        {fundResults.length > 0 ? (
          <Section title="持仓基金">
            {fundResults.map((fund) => (
              <ResultRow
                key={`fund-${fund.code}`}
                icon={Wallet}
                title={fund.name}
                sub={`${fund.code}${fund.kind ? ` · ${kindLabel(fund.kind)}` : ''}`}
                onClick={() => handlePickFund(fund.code)}
              />
            ))}
          </Section>
        ) : null}

        {planResults.length > 0 ? (
          <Section title="交易计划">
            {planResults.map((plan) => (
              <ResultRow
                key={`plan-${plan.id || plan.name}`}
                icon={BarChart3}
                title={plan.name || '未命名计划'}
                sub={plan.code ? `代码 ${plan.code}` : '加仓 / 定投计划'}
                onClick={() => handlePickTab('tradePlans')}
              />
            ))}
          </Section>
        ) : null}

        <Section title={q ? '功能页' : '快捷入口'}>
          {tabResults.map((tab) => (
            <ResultRow
              key={`tab-${tab.key}`}
              icon={tab.icon}
              title={tab.label}
              sub={tab.desc}
              onClick={() => handlePickTab(tab.key)}
            />
          ))}
        </Section>

        {noResults ? (
          <div className="px-3 py-12 text-center text-sm text-slate-400">
            没有找到与「{query}」相关的结果
          </div>
        ) : null}
      </div>

      <div className="absolute bottom-0 left-0 right-0 border-t border-slate-100 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2.5">
          <Search className="h-5 w-5 text-slate-400" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="搜索任意内容..."
            className="min-w-0 flex-1 bg-transparent text-base text-slate-900 placeholder:text-slate-400 focus:outline-none"
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200"
              aria-label="清空"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-4">
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </div>
      <div className="overflow-hidden rounded-2xl bg-white">{children}</div>
    </section>
  );
}

function ResultRow({ icon: Icon, title, sub, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50"
    >
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-600">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{title}</span>
        {sub ? (
          <span className="mt-0.5 block truncate text-xs text-slate-500">{sub}</span>
        ) : null}
      </span>
      <ArrowRight className="h-4 w-4 flex-none text-slate-300" aria-hidden="true" />
    </button>
  );
}

export default GlobalSearch;
