import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  FileImage,
  LoaderCircle,
  Save,
  Search,
  X
} from 'lucide-react';
import { summarizeTransactionErrors } from '../../app/holdingsLedgerCore.js';
import { GHOST_BTN, PRIMARY_BTN, SUBTLE_BTN } from '../../app/holdingsHelpers.js';
import { cx, tableInputClass } from '../../components/experience-ui.jsx';

function validRowCount(rows = []) {
  return rows.filter((row) => Object.keys(row.errors || {}).length === 0).length;
}

function hasValidRow(rows = []) {
  return rows.some((row) => Object.keys(row.errors || {}).length === 0);
}

function TransactionPreviewEditor({
  rows = [],
  previewIndex = 0,
  setPreviewIndex,
  onRowFieldChange,
}) {
  if (!rows.length) return null;
  const totalRows = rows.length;
  const safeIndex = Math.min(Math.max(previewIndex, 0), totalRows - 1);
  const row = rows[safeIndex];
  const ok = Object.keys(row.errors || {}).length === 0;
  const invalidCount = rows.filter((item) => Object.keys(item.errors || {}).length > 0).length;
  const goPrev = () => setPreviewIndex((index) => Math.max(0, index - 1));
  const goNext = () => setPreviewIndex((index) => Math.min(totalRows - 1, index + 1));

  return (
    <div className="space-y-3">
      {totalRows > 1 ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-1.5">
          <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={goPrev} disabled={safeIndex <= 0} aria-label="上一条">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex flex-col items-center text-center">
            <div className="text-xs font-semibold text-slate-700 tabular-nums">第 {safeIndex + 1} / {totalRows} 条</div>
            <div className="text-[10px] text-slate-500">{invalidCount > 0 ? `含 ${invalidCount} 行无效将被跳过` : '全部有效'}</div>
          </div>
          <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={goNext} disabled={safeIndex >= totalRows - 1} aria-label="下一条">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        {ok ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />有效，将导入</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600"><AlertTriangle className="h-3.5 w-3.5" />仅试用，将被跳过</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-1 text-xs text-slate-500">
          代码
          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3 font-mono')} value={row.draft.code || ''} onChange={(event) => onRowFieldChange(row.index, 'code', event.target.value)} placeholder="6 位" inputMode="numeric" maxLength={6} />
        </label>
        <label className="col-span-1 text-xs text-slate-500">
          名称
          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.name || ''} onChange={(event) => onRowFieldChange(row.index, 'name', event.target.value)} placeholder="基金名称" />
        </label>
        <label className="col-span-1 text-xs text-slate-500">
          标签
          <select className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.kind || 'otc'} onChange={(event) => onRowFieldChange(row.index, 'kind', event.target.value)}>
            <option value="otc">场外</option>
            <option value="exchange">场内</option>
            <option value="qdii">QDII</option>
          </select>
        </label>
        <label className="col-span-1 text-xs text-slate-500">
          类型
          <select className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.type || 'BUY'} onChange={(event) => onRowFieldChange(row.index, 'type', event.target.value)}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </label>
        <label className="col-span-2 text-xs text-slate-500">
          日期
          <input type="date" className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3', row.draft.date ? '' : 'border-amber-200 text-amber-700')} value={row.draft.date || ''} onChange={(event) => onRowFieldChange(row.index, 'date', event.target.value)} />
        </label>
        <label className="col-span-1 text-xs text-slate-500">
          价格（净值）
          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.price || ''} onChange={(event) => onRowFieldChange(row.index, 'price', event.target.value)} placeholder="0.0000" inputMode="decimal" />
        </label>
        <label className="col-span-1 text-xs text-slate-500">
          份额
          <input className={cx(tableInputClass, 'mt-1 h-10 rounded-xl bg-slate-50 px-3')} value={row.draft.shares || ''} onChange={(event) => onRowFieldChange(row.index, 'shares', event.target.value)} placeholder="0.0000" inputMode="decimal" />
        </label>
      </div>
      {!ok ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          {summarizeTransactionErrors(row.errors)}
        </div>
      ) : null}
    </div>
  );
}

export function PasteImportModal({
  open,
  pasteText,
  pasteResult,
  pastePreviewIndex,
  setPastePreviewIndex,
  onClose,
  onPasteTextChange,
  onParse,
  onRowFieldChange,
  onImport,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4 py-6" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-sm font-bold text-slate-900">从 Excel 粘贴交易流水</div>
            <div className="mt-0.5 text-xs text-slate-500">支持 TSV / CSV；自动识别表头（代码 / 名称 / 类型 / 日期 / 价 / 份额），没有表头则按列序映射。</div>
          </div>
          <button type="button" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <textarea
            className="h-40 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 outline-none transition-colors focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            placeholder={'从 Excel 选中单元格复制后粘贴在这里。\n例：\n代码\t名称\t场内场外\t类型\t日期\t价\t份额\n021000\t景顺长城纳斯达克\t场外\tBUY\t2026-04-16\t1.5345\t100'}
            value={pasteText}
            onChange={(event) => onPasteTextChange(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={GHOST_BTN} onClick={onParse}>
              <Search className="h-4 w-4" />
              解析预览
            </button>
            {pasteResult ? (
              <div className="text-xs text-slate-500">
                共 {pasteResult.rows.length} 行，分隔符 {pasteResult.delimiter}，{pasteResult.headerDetected ? '已识别表头' : '按位置映射'}。
              </div>
            ) : (
              <div className="text-xs text-slate-400">默认列顺序：代码 · 名称 · 场内场外 · 类型 · 日期 · 价 · 份额 · 备注</div>
            )}
          </div>
          {pasteResult && pasteResult.rows.length ? (
            <TransactionPreviewEditor
              rows={pasteResult.rows}
              previewIndex={pastePreviewIndex}
              setPreviewIndex={setPastePreviewIndex}
              onRowFieldChange={onRowFieldChange}
            />
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <div className="text-xs text-slate-500">
            {pasteResult ? `将导入 ${validRowCount(pasteResult.rows)} 笔有效交易` : ''}
          </div>
          <div className="flex gap-2">
            <button type="button" className={GHOST_BTN} onClick={onClose}>取消</button>
            <button
              type="button"
              className={PRIMARY_BTN}
              onClick={onImport}
              disabled={!pasteResult || !hasValidRow(pasteResult.rows)}
            >
              <Save className="h-4 w-4" />
              导入有效行
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OcrImportModal({
  open,
  ocrState,
  ocrPreview,
  ocrPreviewIndex,
  setOcrPreviewIndex,
  ocrWarningsExpanded,
  setOcrWarningsExpanded,
  onClose,
  onTriggerOcr,
  onRowFieldChange,
  onImport,
}) {
  if (!open) return null;
  const warningRows = Array.isArray(ocrPreview?.warnings) ? ocrPreview.warnings : [];
  const visibleWarnings = ocrWarningsExpanded ? warningRows : warningRows.slice(0, 2);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4 py-6" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900">从截图识别交易流水</div>
            <div className="mt-0.5 text-[11px] text-slate-500">识别后可逐行编辑、补录字段，确认后再写入流水（默认 BUY）。</div>
          </div>
          <button type="button" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={SUBTLE_BTN}
              onClick={onTriggerOcr}
              disabled={ocrState.status === 'loading'}
            >
              {ocrState.status === 'loading' ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileImage className="h-3.5 w-3.5" />
              )}
              {ocrPreview ? '重新上传' : '选择截图文件'}
            </button>
            {ocrState.status === 'loading' ? (
              <div className="text-[11px] text-slate-500">{ocrState.message || '正在识别…'}{ocrState.progress ? ` · ${Math.round(ocrState.progress)}%` : ''}</div>
            ) : ocrPreview ? (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                {ocrPreview.fileName ? <span className="max-w-[180px] truncate font-mono text-slate-600" title={ocrPreview.fileName}>{ocrPreview.fileName}</span> : null}
                <span>{ocrPreview.rows.length} 行</span>
                {ocrPreview.model ? <span className="max-w-[180px] truncate text-slate-400" title={ocrPreview.model}>· {ocrPreview.model}</span> : null}
              </div>
            ) : (
              <div className="text-[11px] text-slate-400">支持 PNG / JPG；默认 BUY 草稿，可在下方逐行编辑、补录。</div>
            )}
          </div>
          {ocrState.status === 'error' && ocrState.error ? (
            <div className="rounded-lg border border-red-100 bg-red-50/70 px-3 py-1.5 text-[11px] text-red-600">{ocrState.error}</div>
          ) : null}
          {warningRows.length ? (
            <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-1.5 text-[11px] text-amber-700">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">识别提醒·{warningRows.length} 条</div>
                {warningRows.length > 2 ? (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-amber-700 underline-offset-2 hover:underline"
                    onClick={() => setOcrWarningsExpanded((prev) => !prev)}
                  >
                    {ocrWarningsExpanded ? '收起' : `展开全部 ${warningRows.length} 条`}
                  </button>
                ) : null}
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {visibleWarnings.map((warn, index) => (
                  <li key={index}>{String(warn)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {ocrPreview && ocrPreview.rows.length ? (
            <TransactionPreviewEditor
              rows={ocrPreview.rows}
              previewIndex={ocrPreviewIndex}
              setPreviewIndex={setOcrPreviewIndex}
              onRowFieldChange={onRowFieldChange}
            />
          ) : ocrPreview ? (
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-6 py-6 text-center text-[11px] text-slate-500">
              <FileImage className="h-6 w-6 text-slate-300" />
              <div>该截图未识别出有效行，请换一张更清晰的截图后重试。</div>
            </div>
          ) : (
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-6 py-6 text-center text-[11px] text-slate-500">
              <CloudUpload className="h-6 w-6 text-slate-300" />
              <div />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5">
          <div className="text-[11px] text-slate-500">
            {ocrPreview ? `将导入 ${validRowCount(ocrPreview.rows)} / ${ocrPreview.rows.length} 行` : ''}
          </div>
          <div className="flex gap-2">
            <button type="button" className={GHOST_BTN} onClick={onClose}>取消</button>
            <button
              type="button"
              className={PRIMARY_BTN}
              onClick={onImport}
              disabled={!ocrPreview || !hasValidRow(ocrPreview.rows)}
            >
              <Save className="h-4 w-4" />
              导入有效行
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
