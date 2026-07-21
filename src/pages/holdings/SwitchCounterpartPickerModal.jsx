import { CheckCircle2, Search, Wallet, X } from 'lucide-react';
import { formatCurrency } from '../../app/accumulation.js';
import {
  KIND_LABELS,
  KIND_PILL_TONES,
  GHOST_BTN,
  PRIMARY_BTN,
  formatNav,
  formatShares
} from '../../app/holdingsHelpers.js';
import { Pill, cx } from '../../components/experience-ui.jsx';
import { normalizeFundCode } from '../../app/holdingsLedgerCore.js';

function getTransactionAmount(tx) {
  const price = Number(tx?.price);
  const shares = Number(tx?.shares);
  return Number.isFinite(price) && Number.isFinite(shares) ? price * shares : 0;
}

function isValidSwitchCounterpart(sourceTx, targetTx) {
  if (!sourceTx || !targetTx) return false;
  if (sourceTx.id && targetTx.id && sourceTx.id === targetTx.id) return false;
  if (!sourceTx.type || !targetTx.type || sourceTx.type === targetTx.type) return false;
  const sourceCode = normalizeFundCode(sourceTx.code);
  const targetCode = normalizeFundCode(targetTx.code);
  return Boolean(sourceCode && targetCode && sourceCode !== targetCode);
}

function buildSwitchCounterpartCandidates({ transactions, draft, search }) {
  const oppType = draft.type === 'BUY' ? 'SELL' : 'BUY';
  const draftCode = normalizeFundCode(draft.code);
  const filterText = search.trim().toLowerCase();
  const orderedTransactions = [...(transactions || [])]
    .map((tx, index) => ({ tx, index }))
    .sort((a, b) => String(a.tx?.date || '').localeCompare(String(b.tx?.date || '')) || a.index - b.index)
    .map((item) => item.tx)
    .filter(Boolean);
  const currentDraftIndex = draft.id
    ? orderedTransactions.findIndex((tx) => tx.id === draft.id)
    : -1;
  const previousTx = currentDraftIndex > 0
    ? orderedTransactions[currentDraftIndex - 1]
    : (() => {
      const draftDate = String(draft.date || '').slice(0, 10);
      if (!draftDate) return null;
      return orderedTransactions.filter((tx) => String(tx?.date || '').slice(0, 10) < draftDate).pop() || null;
    })();
  const candidates = (transactions || [])
    .map((tx) => {
      if (tx.id === draft.id || tx.type !== oppType || !tx.code) return null;
      const amount = getTransactionAmount(tx);
      const sameCode = normalizeFundCode(tx.code) === draftCode;
      const canSelect = !sameCode;
      const reasons = [];
      if (sameCode) reasons.push('同代码不能配对');
      return { tx, amount, canSelect, reasons, isPrevious: previousTx ? tx.id === previousTx.id : false };
    })
    .filter(Boolean)
    .filter((item) => {
      if (!filterText) return true;
      const code = String(item.tx.code || '').toLowerCase();
      const name = String(item.tx.name || '').toLowerCase();
      return code.includes(filterText) || name.includes(filterText);
    })
    .sort((a, b) => {
      if (a.isPrevious && !b.isPrevious) return -1;
      if (!a.isPrevious && b.isPrevious) return 1;
      return String(b.tx.date || '').localeCompare(String(a.tx.date || '')) || String(b.tx.id || '').localeCompare(String(a.tx.id || ''));
    });

  if (previousTx && !candidates.some((row) => row.tx.id === previousTx.id)) {
    const amount = getTransactionAmount(previousTx);
    const sameCode = normalizeFundCode(previousTx.code) === draftCode;
    const canSelect = previousTx.type === oppType && previousTx.code && !sameCode;
    const reasons = [];
    if (previousTx.type !== oppType) reasons.push('类型不符');
    if (!previousTx.code) reasons.push('缺少代码');
    if (sameCode) reasons.push('同代码不能配对');
    candidates.unshift({ tx: previousTx, amount, canSelect, reasons, isPrevious: true });
  }

  return { candidates, filterText, oppType };
}

export function SwitchCounterpartPickerModal({
  open,
  draft,
  transactions,
  selectedIds,
  search,
  onSearchChange,
  onToggle,
  onAutoSelect,
  onConfirm,
  onClose
}) {
  if (!open) return null;

  const { candidates, filterText, oppType } = buildSwitchCounterpartCandidates({ transactions, draft, search });

  function handleAutoSelect() {
    const next = new Set();
    for (const c of candidates) {
      if (!c.canSelect) continue;
      next.add(c.tx.id);
      break;
    }
    onAutoSelect(next);
  }

  function handleConfirm() {
    const validIds = candidates
      .filter((candidate) => candidate.canSelect && selectedIds.has(candidate.tx.id))
      .map((candidate) => candidate.tx.id);
    onConfirm({ pairIds: validIds });
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 px-4 py-6" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-sm font-bold text-slate-900">选择基金切换对手方</div>
            <div className="mt-0.5 text-xs text-slate-500">
              当前是 <span className="font-mono font-semibold text-slate-700">{draft.code || '—'}</span>{draft.name ? <> · {draft.name}</> : null} · {draft.type}，下方列出可配对的 <span className="font-semibold text-slate-700">{draft.type === 'BUY' ? '卖出' : '买入'}</span> 交易（仅要求不同代码，不校验金额）。
            </div>
          </div>
          <button type="button" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              placeholder="搜索代码或名称…"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {candidates.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 px-6 py-10 text-center text-xs text-slate-500">
              <Wallet className="h-8 w-8 text-slate-300" />
              {filterText
                ? `没有匹配 "${search}" 的对手方交易。`
                : `暂无可配对的${oppType === 'BUY' ? '买入' : '卖出'}交易。`}
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">代码</th>
                  <th className="px-3 py-2">名称</th>
                  <th className="px-3 py-2">标签</th>
                  <th className="px-3 py-2">类型</th>
                  <th className="px-3 py-2">日期</th>
                  <th className="px-3 py-2 text-right">价</th>
                  <th className="px-3 py-2 text-right">份额</th>
                  <th className="px-3 py-2 text-right">金额</th>
                  <th className="px-3 py-2 text-right">状态</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {candidates.map(({ tx, amount, canSelect, reasons, isPrevious }) => {
                  const isSelected = selectedIds.has(tx.id);
                  return (
                    <tr
                      key={tx.id}
                      className={cx(
                        'text-slate-700 transition-colors',
                        canSelect ? 'hover:bg-indigo-50/60' : 'cursor-not-allowed opacity-55 hover:bg-transparent',
                        isSelected && 'bg-indigo-50/80'
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-slate-800">
                        <span className="inline-flex items-center gap-1">
                          <span>{tx.code}</span>
                          {isPrevious ? <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">上一笔</span> : null}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{tx.name || <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2"><Pill tone={KIND_PILL_TONES[tx.kind] || 'slate'}>{KIND_LABELS[tx.kind] || '未知'}</Pill></td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        <span className={cx('inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100', tx.type === 'BUY' ? 'text-slate-600' : 'text-slate-500')}>{tx.type === 'BUY' ? '↓ BUY' : '↑ SELL'}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{tx.date || <span className="text-amber-600">待补录</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">{formatNav(tx.price)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">{formatShares(tx.shares)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-700">{formatCurrency(amount, '¥', 2)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-700">
                        {canSelect ? <div className="text-slate-500">可配对</div> : null}
                        {!canSelect && reasons.length ? <div className="mt-0.5 text-[10px] text-rose-500">{reasons.join(' · ')}</div> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {canSelect ? (
                          <label className="inline-flex items-center gap-2">
                            <input type="checkbox" checked={isSelected} onChange={() => onToggle(tx.id)} />
                            {isSelected ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white"><CheckCircle2 className="h-3 w-3" />已选</span>
                            ) : (
                              <span className="inline-flex items-center rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-indigo-600 ring-1 ring-indigo-100">选择</span>
                            )}
                          </label>
                        ) : (
                          <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-400">不可选</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <button type="button" className={GHOST_BTN} onClick={handleAutoSelect}>自动选择</button>
            <button type="button" className={PRIMARY_BTN} onClick={handleConfirm} disabled={selectedIds.size === 0}>确认选择</button>
          </div>
          <div>
            <button type="button" className={GHOST_BTN} onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  );
}
