import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import {
  appendTrade,
  deleteTrade,
  readTradeLedger,
  MAX_LEDGER_PER_SYMBOL
} from '../app/tradeLedger.js';
import { groupCostBasisBySymbol } from '../app/costTracker.js';
import { formatCurrency } from '../app/accumulation.js';
import { EXTRA_SYMBOL_GROUPS } from '../app/extraSymbols.js';
import {
  Card,
  Field,
  NumberInput,
  Pill,
  SectionHeading,
  SelectField,
  StatCard,
  TextInput,
  cx,
  primaryButtonClass,
  secondaryButtonClass,
  subtleButtonClass
} from '../components/experience-ui.jsx';

// PR 3：交易台账页面。
// 与 HoldingsExperience.jsx 集成抽到 PR 3.5（该文件 3336 行，需小步改）。

const SIDE_OPTIONS = [
  { value: 'buy', label: '买入' },
  { value: 'sell', label: '卖出' }
];

function defaultDraft() {
  return {
    symbol: 'NVDA',
    side: 'buy',
    shares: '',
    price: '',
    date: new Date().toISOString().slice(0, 10),
    fee: '',
    note: ''
  };
}

export function TradeLedgerExperience({ embedded = false }) {
  const [draft, setDraft] = useState(defaultDraft);
  const [trades, setTrades] = useState(() => readTradeLedger());
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  // 对多标獣存储同步起见，使用 storage 事件同步跳到本页。
  useEffect(() => {
    function handle(e) {
      if (e.key === 'aiDcaTradeLedger') setTrades(readTradeLedger());
    }
    window.addEventListener('storage', handle);
    return () => window.removeEventListener('storage', handle);
  }, []);

  const grouped = useMemo(() => groupCostBasisBySymbol(trades), [trades]);
  const symbols = useMemo(() => Object.keys(grouped).sort(), [grouped]);
  const activeSymbol = filter || (symbols.length ? symbols[0] : '');
  const active = activeSymbol ? grouped[activeSymbol] : null;

  function update(patch) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function handleAdd() {
    setError('');
    const result = appendTrade({
      symbol: draft.symbol,
      side: draft.side,
      shares: Number(draft.shares),
      price: Number(draft.price),
      date: draft.date,
      fee: Number(draft.fee) || 0,
      note: draft.note
    });
    if (!result.ok) {
      setError('记录不合法：检查 symbol / 股数 / 价格。');
      return;
    }
    setTrades(result.list);
    setDraft((prev) => ({ ...prev, shares: '', price: '', fee: '', note: '' }));
    setFilter(result.trade.symbol);
  }

  function handleDelete(id) {
    setTrades(deleteTrade(id));
  }

  const summaryAll = useMemo(() => {
    const totals = { realized: 0, marketRecover: 0, openPositions: 0 };
    for (const [, payload] of Object.entries(grouped)) {
      totals.realized += payload.summary.realizedPnl || 0;
      totals.marketRecover += payload.summary.totalSellCash || 0;
      if ((payload.summary.remainingShares || 0) > 0) totals.openPositions += 1;
    }
    return totals;
  }, [grouped]);

  return (
    <div className={cx('space-y-6', embedded ? '' : 'mx-auto max-w-6xl px-6 pt-8')}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard accent="indigo" eyebrow="记录总数" value={String(trades.length)} note={`最多每标獣 ${MAX_LEDGER_PER_SYMBOL} 条`} />
        <StatCard eyebrow="活跳持仓" value={String(summaryAll.openPositions)} note={`${symbols.length} 个标獣有记录`} />
        <StatCard
          accent={summaryAll.realized >= 0 ? 'emerald' : 'rose'}
          eyebrow="已实现盈亏总计"
          value={`${summaryAll.realized >= 0 ? '+' : '−'}${formatCurrency(Math.abs(summaryAll.realized), '$ ')}`}
        />
        <StatCard eyebrow="卖出回收总额" value={formatCurrency(summaryAll.marketRecover, '$ ')} note="累计卖出现金流" />
      </div>

      <Card className="min-w-0">
        <SectionHeading
          eyebrow="新增交易"
          title="记一笔买入或卖出"
          description="手动录入。未来 PR 3.5 会从持仓 / 加仓计划 调取。"
        />
        <div className="mt-5 space-y-4">
          <Field label="标的代码" helper="chip 快选或手动输入。">
            <div className="mb-2 space-y-2">
              {EXTRA_SYMBOL_GROUPS.map((group) => (
                <div key={group.key} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">{group.label}</span>
                  {group.symbols.map((s) => (
                    <button
                      key={s.code}
                      type="button"
                      onClick={() => update({ symbol: s.code })}
                      className={cx(
                        'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                        draft.symbol === s.code
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-600'
                      )}
                    >
                      {s.code}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <TextInput value={draft.symbol} onChange={(e) => update({ symbol: e.target.value })} placeholder="NVDA / QQQ …" />
          </Field>

          <div className="grid gap-3 md:grid-cols-5">
            <Field label="方向">
              <SelectField
                options={SIDE_OPTIONS}
                value={draft.side}
                onChange={(e) => update({ side: e.target.value })}
              />
            </Field>
            <Field label="股数">
              <NumberInput step="0.0001" min="0" value={draft.shares} onChange={(e) => update({ shares: e.target.value })} placeholder="如 50" />
            </Field>
            <Field label="价格">
              <NumberInput step="0.01" min="0" value={draft.price} onChange={(e) => update({ price: e.target.value })} placeholder="如 120.5" />
            </Field>
            <Field label="日期">
              <TextInput type="date" value={draft.date} onChange={(e) => update({ date: e.target.value })} />
            </Field>
            <Field label="手续费（可选）">
              <NumberInput step="0.01" min="0" value={draft.fee} onChange={(e) => update({ fee: e.target.value })} placeholder="0" />
            </Field>
          </div>

          <Field label="备注（可选）">
            <TextInput value={draft.note} onChange={(e) => update({ note: e.target.value })} placeholder="如 反弹减仓 / 底仓加仓" />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={cx(primaryButtonClass, 'inline-flex items-center gap-1.5')} onClick={handleAdd}>
              <Plus className="h-4 w-4" />
              记录交易
            </button>
            <button type="button" className={cx(subtleButtonClass)} onClick={() => setDraft(defaultDraft())}>
              清空表单
            </button>
            {error ? <span className="text-xs text-rose-600">{error}</span> : null}
          </div>
        </div>
      </Card>

      {symbols.length > 0 ? (
        <Card className="min-w-0">
          <SectionHeading
            eyebrow="各标獣"
            title="成本 & 负成本划分"
            description="双口径：加权平均（不会负） + 「买减卖」成本（可负）。"
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {symbols.map((sym) => {
              const isNeg = grouped[sym].summary.isNegativeCost;
              return (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setFilter(sym)}
                  className={cx(
                    'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                    activeSymbol === sym
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-600'
                  )}
                >
                  {sym}{isNeg ? ' · 负成本' : ''}
                </button>
              );
            })}
          </div>

          {active ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <StatCard eyebrow="剩余股数" value={String(active.summary.remainingShares)} note={`买 ${active.summary.totalBuys} / 卖 ${active.summary.totalSells}`} />
                <StatCard eyebrow="加权均价" value={formatCurrency(active.summary.textbookCost, '$ ')} note="不会低于 0" />
                <StatCard
                  accent={active.summary.isNegativeCost ? 'emerald' : 'slate'}
                  eyebrow="「买减卖」成本"
                  value={formatCurrency(active.summary.effectiveCost, '$ ')}
                  note={active.summary.isNegativeCost ? '已达成负成本' : `净现金流 ${formatCurrency(active.summary.netCash, '$ ')}`}
                />
                <StatCard
                  accent={active.summary.realizedPnl >= 0 ? 'emerald' : 'rose'}
                  eyebrow="已实现盈亏"
                  value={`${active.summary.realizedPnl >= 0 ? '+' : '−'}${formatCurrency(Math.abs(active.summary.realizedPnl), '$ ')}`}
                />
              </div>

              {active.summary.isNegativeCost ? (
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                  <Pill tone="emerald">负成本</Pill>
                  剩余仓位的「买减卖」成本为 {formatCurrency(active.summary.effectiveCost, '$ ')}，后续下跳不再是亏损。
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">日期</th>
                      <th className="px-3 py-2 text-left">方向</th>
                      <th className="px-3 py-2 text-right">股数</th>
                      <th className="px-3 py-2 text-right">价格</th>
                      <th className="px-3 py-2 text-right">现金流</th>
                      <th className="px-3 py-2 text-right">股数后</th>
                      <th className="px-3 py-2 text-right">均价后</th>
                      <th className="px-3 py-2 text-right">买减卖后</th>
                      <th className="px-3 py-2 text-right">已实现</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {active.annotated.map((t) => (
                      <tr key={t.id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5">{t.date}</td>
                        <td className="px-3 py-1.5">
                          <Pill tone={t.side === 'buy' ? 'indigo' : 'amber'}>{t.side === 'buy' ? '买' : '卖'}</Pill>
                        </td>
                        <td className="px-3 py-1.5 text-right">{t.shares}</td>
                        <td className="px-3 py-1.5 text-right">{formatCurrency(t.price, '$ ')}</td>
                        <td className="px-3 py-1.5 text-right">{t.side === 'buy' ? '−' : '+'}{formatCurrency(t.cash, '$ ')}</td>
                        <td className="px-3 py-1.5 text-right">{t.sharesAfter}</td>
                        <td className="px-3 py-1.5 text-right">{formatCurrency(t.textbookCostAfter, '$ ')}</td>
                        <td className="px-3 py-1.5 text-right">{formatCurrency(t.effectiveCostAfter, '$ ')}</td>
                        <td className="px-3 py-1.5 text-right">{formatCurrency(t.realizedAfter, '$ ')}</td>
                        <td className="px-3 py-1.5 text-right">
                          <button type="button" className={cx(secondaryButtonClass, 'h-7 px-2')} onClick={() => handleDelete(t.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card className="min-w-0">
          <div className="flex flex-col items-center gap-2 py-10 text-center text-slate-500">
            <BookOpen className="h-8 w-8 text-slate-400" />
            <div className="text-sm">还没有记录。记一笔买入或卖出后会按标獣汇总。</div>
          </div>
        </Card>
      )}
    </div>
  );
}
