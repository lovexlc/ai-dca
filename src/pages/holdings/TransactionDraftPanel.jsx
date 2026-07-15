import { Save, Search, Trash2, X, Plus } from 'lucide-react';
import { useState } from 'react';
import { FeatureHelp } from '../../components/FeatureHelp.jsx';
import {
  getTransactionErrors,
  normalizeFundCode,
  summarizeTransactionErrors
} from '../../app/holdingsLedgerCore.js';
import {
  ALL_TAGS,
  KIND_LABELS,
  KIND_PILL_TONES,
  TAG_LABELS,
  TAG_PILL_TONES,
  PRIMARY_BTN,
  SUBTLE_BTN,
  formatNav,
  formatShares
} from '../../app/holdingsHelpers.js';
import { Pill, cx, tableInputClass } from '../../components/experience-ui.jsx';
import { QuickTransactionButtons } from './QuickTransactionButtons.jsx';

export function TransactionDraftPanel({
  draft,
  draftMode,
  transactions,
  onDraftChange,
  onResetDraft,
  onSubmit,
  onDeleteTransaction,
  onDeleted,
  onOpenSwitchPicker
}) {
  const errors = getTransactionErrors({
    ...draft,
    code: normalizeFundCode(draft.code),
    price: Number(draft.price || 0),
    shares: Number(draft.shares || 0),
    amount: Number(draft.amount || 0)
  }, { ignoreBlank: true });
  const oppositeType = draft.type === 'BUY' ? 'SELL' : 'BUY';
  const draftCodeNormalized = normalizeFundCode(draft.code);
  const switchUsedIds = new Set(
    transactions
      .map((tx) => String(tx.switchPairId || '').trim())
      .filter(Boolean),
  );
  const switchCandidates = transactions
    .filter((tx) => (
      tx.id !== draft.id
      && tx.type === oppositeType
      && tx.code
      && tx.code !== draftCodeNormalized
      && !tx.switchPairId
      && !switchUsedIds.has(tx.id)
    ))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const isSwitchOn = Boolean(draft.switchPairId);
  const pairedCounterpart = draft.switchPairId ? transactions.find((tx) => tx.id === draft.switchPairId) : null;
  const pairedMissing = Boolean(draft.switchPairId) && !pairedCounterpart;
  const [showTagPicker, setShowTagPicker] = useState(false);
  const currentTags = Array.isArray(draft.tags) ? draft.tags : [];

  function addTag(tag) {
    if (!currentTags.includes(tag)) {
      onDraftChange('tags', [...currentTags, tag]);
    }
  }

  function removeTag(tag) {
    onDraftChange('tags', currentTags.filter((t) => t !== tag));
  }

  const availableTags = ALL_TAGS.filter((t) => !currentTags.includes(t));

  function handleQuickFill(fields) {
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined) {
        onDraftChange(key, value);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {draftMode === 'edit' ? '编辑交易' : '新增交易'}
          </div>
          <FeatureHelp topic="holdings-edit" />
        </div>
        {draftMode === 'edit' ? (
          <button type="button" className={SUBTLE_BTN} onClick={onResetDraft}>
            <X className="h-3.5 w-3.5" /> 取消
          </button>
        ) : null}
      </div>
      {draftMode === 'create' && <QuickTransactionButtons onFillDraft={handleQuickFill} />}
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-1 text-xs text-slate-500">
          代码
          <input
            className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
            value={draft.code}
            onChange={(event) => onDraftChange('code', event.target.value)}
            placeholder="如 021000"
            inputMode="numeric"
          />
        </label>
        <label className="col-span-1 text-xs text-slate-500">
          名称
          <input
            className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
            value={draft.name}
            onChange={(event) => onDraftChange('name', event.target.value)}
            placeholder="如 长信电子信息"
          />
        </label>
        <div className="col-span-2 text-xs text-slate-500">
          <div className="mb-1">标签</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {currentTags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                {TAG_LABELS[tag] || KIND_LABELS[tag] || tag}
                <button type="button" className="ml-0.5 text-indigo-400 hover:text-indigo-600" onClick={() => removeTag(tag)}>×</button>
              </span>
            ))}
            <div className="relative">
              <button type="button" className={SUBTLE_BTN} onClick={() => setShowTagPicker((v) => !v)}>
                <Plus className="h-3 w-3" /> 添加
              </button>
              {showTagPicker && availableTags.length > 0 ? (
                <div className="absolute left-0 top-full z-10 mt-1 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg" style={{ minWidth: 180 }}>
                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-indigo-100 hover:text-indigo-700"
                      onClick={() => { addTag(tag); setShowTagPicker(false); }}
                    >
                      {TAG_LABELS[tag] || KIND_LABELS[tag] || tag}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <label className="col-span-1 text-xs text-slate-500">
          类型
          <select
            className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
            value={draft.type}
            onChange={(event) => onDraftChange('type', event.target.value)}
          >
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </label>
        <div className="col-span-1 text-xs text-slate-500">
          交易场所
          <div className="mt-1 grid h-10 grid-cols-3 rounded-xl bg-slate-100 p-1">
            {[
              { value: 'otc', label: '场外' },
              { value: 'qdii', label: 'QDII' },
              { value: 'exchange', label: '场内' }
            ].map((item) => {
              const active = draft.kind === item.value || (item.value === 'otc' && draft.kind !== 'exchange' && draft.kind !== 'qdii');
              return (
                <button
                  key={item.value}
                  type="button"
                  className={cx(
                    'rounded-lg px-1 text-xs font-semibold transition',
                    active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  )}
                  onClick={() => onDraftChange('kind', item.value)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">LOF 可按实际下单渠道选择场内或场外。</div>
        </div>
        <label className="col-span-2 text-xs text-slate-500">
          日期
          <input
            type="date"
            className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
            value={draft.date}
            onChange={(event) => onDraftChange('date', event.target.value)}
          />
        </label>
        <label className="col-span-1 text-xs text-slate-500">
          {draft.kind === 'exchange' ? '价格（成交价·选填）' : '价格（净值·选填）'}
          <input
            className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
            value={draft.price}
            onChange={(event) => onDraftChange('price', event.target.value)}
            placeholder="0.0000"
            inputMode="decimal"
          />
        </label>
        {draft.kind !== 'exchange' && draft.type === 'BUY' ? (
          <label className="col-span-1 text-xs text-slate-500">
            金额 *
            <input
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.amount || ''}
              onChange={(event) => onDraftChange('amount', event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
            <span className="mt-1 block text-[10px] text-slate-400">净值确认后自动计算份额。</span>
          </label>
        ) : (
          <label className="col-span-1 text-xs text-slate-500">
            份额 *
            <input
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.shares}
              onChange={(event) => onDraftChange('shares', event.target.value)}
              placeholder="0.0000"
              inputMode="decimal"
            />
          </label>
        )}
        {draft.kind !== 'exchange' ? (
          <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={Boolean(draft.before3pm)}
                  onChange={(event) => onDraftChange('before3pm', event.target.checked)}
                />
                三点前交易
              </label>
            </div>
            <div className="mt-1.5 text-[10px] text-slate-500">
              {draft.kind === 'qdii'
                ? (draft.before3pm
                    ? 'QDII：T 日 15:00 前提交，按 T 日净值计算；T 日净值需等 T+1 晚公布，T+2 确认。'
                    : 'QDII：T 日 15:00 后提交，顺延为 T+1 申赎，按 T+1 净值计算（T+2 晚公布，T+3 确认）。')
                : (draft.before3pm
                    ? '场外：T 日 15:00 前提交，按 T 日净值（T 日晚公布），T+1 确认。'
                    : '场外：T 日 15:00 后提交，顺延为 T+1 申赎，按 T+1 净值（T+1 晚公布），T+2 确认。')}
            </div>
          </div>
        ) : null}
        {draft.type === 'SELL' ? (
          <label className="col-span-2 text-xs text-slate-500">
            买入成本价（可选，已卖出快速登记）
            <input
              className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
              value={draft.costPrice || ''}
              onChange={(event) => onDraftChange('costPrice', event.target.value)}
              placeholder="留空则按已有买入流水的加权平均成本"
              inputMode="decimal"
            />
            <span className="mt-1 block text-[10px] text-slate-400">未录入买入流水时填入此处，自动结算 (卖价 − 成本) × 份额，不占用持仓。</span>
          </label>
        ) : null}
        <div className="col-span-2 rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-indigo-700">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
              checked={isSwitchOn}
              onChange={(event) => {
                if (!event.target.checked) {
                  onDraftChange('switchPairId', '');
                } else if (switchCandidates.length) {
                  onDraftChange('switchPairId', switchCandidates[0].id);
                }
              }}
            />
            <span>这是一笔基金切换</span>
            <span className="ml-auto text-[10px] font-normal text-indigo-500/80">与反向交易配对</span>
          </label>
          {isSwitchOn ? (
            <div className="mt-2 space-y-1.5">
              {switchCandidates.length === 0 && !pairedCounterpart && !pairedMissing ? (
                <div className="rounded-lg bg-white px-2.5 py-2 text-[11px] text-slate-500">
                  暂无可配对的{oppositeType === 'BUY' ? '买入' : '卖出'}交易。需先创建一笔不同代码、未被配对的对手交易。
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {pairedCounterpart ? (
                    <div className="flex min-w-[200px] flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] text-slate-700 ring-1 ring-indigo-100">
                      <span className="type-data font-semibold text-slate-800">{pairedCounterpart.code}</span>
                      {pairedCounterpart.name ? <span className="truncate text-slate-500">{pairedCounterpart.name}</span> : null}
                      <Pill tone={KIND_PILL_TONES[pairedCounterpart.kind] || 'slate'}>{KIND_LABELS[pairedCounterpart.kind] || '未知'}</Pill>
                      <span className={cx('inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100', pairedCounterpart.type === 'BUY' ? 'text-slate-600' : 'text-slate-500')}>{pairedCounterpart.type === 'BUY' ? '↓ BUY' : '↑ SELL'}</span>
                      <span className="text-slate-500">{pairedCounterpart.date || '待补录'}</span>
                      <span className="ml-auto tabular-nums text-slate-600">{formatShares(pairedCounterpart.shares)}份 × {formatNav(pairedCounterpart.price)}</span>
                    </div>
                  ) : pairedMissing ? (
                    <div className="flex-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">原配对交易已丢失，请重新选择</div>
                  ) : (
                    <div className="flex-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] text-slate-500">尚未选择对手方交易</div>
                  )}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenSwitchPicker();
                    }}
                  >
                    <Search className="h-3 w-3" />
                    {pairedCounterpart || pairedMissing ? '更换' : '选择对手方'}
                  </button>
                  {pairedCounterpart || pairedMissing ? (
                    <button
                      type="button"
                      className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
                      onClick={() => onDraftChange('switchPairId', '')}
                    >
                      清除
                    </button>
                  ) : null}
                </div>
              )}
              <div className="px-1 text-[10px] text-slate-500">
                打开后两笔交易会互相关联，“已卖出”列表中会标识切换去向，从而能在持仓总览里看到资金流转。
              </div>
            </div>
          ) : null}
        </div>
        <label className="col-span-2 text-xs text-slate-500">
          备注
          <input
            className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')}
            value={draft.note}
            onChange={(event) => onDraftChange('note', event.target.value)}
            placeholder="可选"
          />
        </label>
      </div>
      {Object.keys(errors).length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          {summarizeTransactionErrors(errors)}
        </div>
      ) : null}
      <button type="button" className={PRIMARY_BTN + ' w-full'} onClick={onSubmit}>
        <Save className="h-4 w-4" />
        保存交易
      </button>
      {draftMode === 'edit' && draft.id ? (
        <button
          type="button"
          className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-white text-sm font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-50 hover:ring-red-300"
          onClick={() => {
            const ok = onDeleteTransaction(draft.id);
            if (ok) onDeleted();
          }}
        >
          <Trash2 className="h-4 w-4" />
          删除该交易
        </button>
      ) : null}
    </div>
  );
}
