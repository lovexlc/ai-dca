import {
  getTransactionErrors,
  hasMeaningfulTransaction,
  normalizeTransaction
} from './holdingsLedgerBasics.js';

const EXCEL_HEADER_KEYWORDS = {
  code: ['代码', '基金代码', 'code'],
  name: ['名称', '基金名称', '基金', 'name'],
  kind: ['场内场外', '场内/场外', '场内外', '标签', 'kind'],
  type: ['类型', '方向', '交易类型', 'type'],
  date: ['日期', '交易日', '交易日期', 'date'],
  price: ['价', '净值', '单价', '价格', '交易价', 'price'],
  shares: ['份额', '数量', 'shares'],
  note: ['备注', '说明', 'note'],
  switch: ['基金切换', '切换标记', '切换', 'switch']
};

function normalizeTypeCell(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (upper === 'BUY' || upper === 'B' || upper === '买' || raw.includes('买')) return 'BUY';
  if (upper === 'SELL' || upper === 'S' || upper === '卖' || raw.includes('卖')) return 'SELL';
  if (raw.includes('申购') || raw.includes('定投')) return 'BUY';
  if (raw.includes('赎回') || raw.includes('清仓')) return 'SELL';
  return upper;
}

function normalizeKindCell(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower === 'otc' || raw.includes('场外')) return 'otc';
  if (lower === 'exchange' || raw.includes('场内') || raw.includes('ETF') || raw.includes('etf')) return 'exchange';
  return '';
}

function detectPasteDelimiter(firstLine = '') {
  if (firstLine.includes('\t')) return '\t';
  if (firstLine.includes(',')) return ',';
  if (firstLine.includes(';')) return ';';
  if (/\s{2,}/.test(firstLine)) return /\s{2,}/;
  return '\t';
}

function splitPasteLine(line, delimiter) {
  if (delimiter instanceof RegExp) {
    return line.split(delimiter).map((cell) => cell.trim());
  }
  return line.split(delimiter).map((cell) => cell.trim());
}

function detectPasteHeader(cells = []) {
  const map = {};
  cells.forEach((cell, index) => {
    const value = String(cell || '').trim();
    if (!value) return;
    const lower = value.toLowerCase();
    for (const [field, keywords] of Object.entries(EXCEL_HEADER_KEYWORDS)) {
      if (map[field] !== undefined) continue;
      const match = keywords.some((kw) => {
        const kwLower = kw.toLowerCase();
        return value === kw || lower === kwLower || value.includes(kw) || lower.includes(kwLower);
      });
      if (match) {
        map[field] = index;
        break;
      }
    }
  });
  return map;
}

export function parseExcelPaste(text = '') {
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/\u3000/g, ' ').trimEnd())
    .filter((line) => line.trim().length > 0);
  if (!lines.length) {
    return { rows: [], headerDetected: false, columnMap: null, delimiter: null, totalLines: 0 };
  }

  const delimiter = detectPasteDelimiter(lines[0]);
  const firstCells = splitPasteLine(lines[0], delimiter);
  const headerMap = detectPasteHeader(firstCells);
  const headerDetected = headerMap.code !== undefined && Object.keys(headerMap).length >= 2;

  let columnMap;
  let dataStart;
  if (headerDetected) {
    columnMap = headerMap;
    dataStart = 1;
  } else {
    columnMap = { code: 0, name: 1, kind: 2, type: 3, date: 4, price: 5, shares: 6, note: 7, switch: 8 };
    dataStart = 0;
  }

  const rows = [];
  for (let i = dataStart; i < lines.length; i += 1) {
    const cells = splitPasteLine(lines[i], delimiter);
    const pick = (field) => {
      const idx = columnMap[field];
      if (idx === undefined || idx === null) return '';
      return cells[idx] !== undefined ? cells[idx] : '';
    };

    const rawDraft = {
      code: pick('code'),
      name: pick('name'),
      kind: normalizeKindCell(pick('kind')),
      type: normalizeTypeCell(pick('type')) || 'BUY',
      date: pick('date'),
      price: pick('price'),
      shares: pick('shares'),
      note: pick('note')
    };
    if (!hasMeaningfulTransaction(rawDraft)) continue;

    const draft = normalizeTransaction(rawDraft);
    const errors = getTransactionErrors(draft);
    const switchHint = String(pick('switch') || '').trim();
    rows.push({ index: i, raw: lines[i], cells, draft, errors, switchHint });
  }

  const pairUsed = new Set();
  rows.forEach((row, idx) => {
    if (pairUsed.has(idx)) return;
    if (!row.switchHint) return;
    const hint = row.switchHint;
    const match = hint.match(/切换至\s*(\d{6})/)
      || hint.match(/由\s*(\d{6})\s*切换/)
      || hint.match(/→\s*(\d{6})/)
      || hint.match(/(\d{6})/);
    const target = match && match[1];
    if (!target || target === row.draft.code) return;
    let bestIdx = -1;
    for (let j = 0; j < rows.length; j += 1) {
      if (j === idx || pairUsed.has(j)) continue;
      const candidate = rows[j].draft;
      if (!candidate || candidate.code !== target) continue;
      if (candidate.type === row.draft.type) continue;
      const sameDate = candidate.date && row.draft.date && candidate.date === row.draft.date;
      if (sameDate) { bestIdx = j; break; }
      if (bestIdx < 0) bestIdx = j;
    }
    if (bestIdx >= 0) {
      row.draft.switchPairId = rows[bestIdx].draft.id;
      rows[bestIdx].draft.switchPairId = row.draft.id;
      pairUsed.add(idx);
      pairUsed.add(bestIdx);
    }
  });

  return {
    rows,
    headerDetected,
    columnMap,
    delimiter: delimiter instanceof RegExp ? 'whitespace' : delimiter === '\t' ? 'tab' : delimiter,
    totalLines: lines.length
  };
}
