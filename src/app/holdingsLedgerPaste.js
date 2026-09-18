import {
  getTransactionErrors,
  hasMeaningfulTransaction,
  isGhostTransaction,
  normalizeFundCode,
  normalizeIsoDate,
  normalizeTransaction,
  round
} from './holdingsLedgerBasics.js';

const EXCEL_HEADER_KEYWORDS = {
  code: ['代码', '基金代码', '证券代码', '标的代码', '产品代码', '合约代码', 'code', 'symbol'],
  name: ['名称', '基金名称', '证券名称', '标的名称', '产品名称', '基金', 'name'],
  kind: ['场内场外', '场内/场外', '场内外', '类别', '标签', 'kind'],
  type: ['类型', '方向', '交易类型', '买卖', '操作', '业务名称', '买卖标志', '委托方向', 'type', 'side', 'action'],
  date: ['日期', '交易日', '交易日期', '成交日期', '发生日期', '确认日期', '时间', '成交时间', '委托时间', '业务时间', 'date', 'time'],
  price: ['价', '净值', '单价', '价格', '交易价', '成交价', '成交均价', '确认净值', '结算价', 'price', 'nav'],
  shares: ['份额', '数量', '成交数量', '成交份额', '发生数量', '确认份额', 'shares', 'volume', 'qty'],
  amount: ['金额', '成交金额', '发生金额', '买入金额', '卖出金额', '确认金额', '结算金额', 'amount', 'total'],
  note: ['备注', '说明', 'note', 'memo'],
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
  if (raw.includes('联接')) {
    return (lower.includes('qdii') || raw.includes('QDII')) ? 'qdii' : 'otc';
  }
  if (lower === 'qdii' || raw.includes('qdii') || raw.includes('QDII')) return 'qdii';
  if (lower === 'otc' || raw.includes('场外')) return 'otc';
  if (lower === 'exchange' || raw.includes('场内') || ((raw.includes('ETF') || raw.includes('etf')) && !raw.includes('联接'))) return 'exchange';
  return '';
}

function isLikelyDateCell(val) {
  const s = String(val || '').trim();
  if (!s) return false;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) return true;
  if (/^\d{2,4}年\d{1,2}月\d{1,2}/.test(s)) return true;
  if (/^20[123]\d[01]\d[0-3]\d$/.test(s)) return true;
  return false;
}

function isLikelyCodeCell(val) {
  const s = String(val || '').trim();
  if (!s) return false;
  if (!/^\d{6}$/.test(s)) return false;
  if (s.startsWith('202') || s.startsWith('203')) return false;
  return true;
}

function isLikelyTypeCell(val) {
  const s = String(val || '').trim();
  if (!s) return false;
  return ['买入', '卖出', '申购', '赎回', '定投', '清仓', 'BUY', 'SELL', '买', '卖'].some((w) => s.includes(w));
}

function detectPasteDelimiter(firstLine = '') {
  if (firstLine.includes('\t')) return '\t';
  if (firstLine.includes(',')) return ',';
  if (firstLine.includes(';')) return ';';
  if (/\s{2,}/.test(firstLine)) return /\s{2,}/;
  return '\t';
}

function splitPasteLine(line, delimiter) {
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

function looksLikeDateCell(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  return Boolean(normalizeIsoDate(raw));
}

function looksLikeCodeCell(value = '') {
  const raw = String(value || '').trim();
  return /^\d{6}$/.test(raw) && normalizeFundCode(raw) === raw;
}

function looksLikeTypeCell(value = '') {
  const type = normalizeTypeCell(value);
  return type === 'BUY' || type === 'SELL';
}

function looksLikeNameCell(value = '') {
  const raw = String(value || '').trim();
  if (!raw || looksLikeDateCell(raw) || looksLikeCodeCell(raw) || looksLikeTypeCell(raw)) return false;
  if (/[-+]?[\d,.%¥￥$]+/.test(raw) && !/[\u3400-\u9fffA-Za-z]/.test(raw)) return false;
  return /[\u3400-\u9fffA-Za-z]/.test(raw);
}

function numericValue(value) {
  const normalized = String(value || '').replace(/[,\s¥￥$元]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function numericStats(values = []) {
  const rawValues = values.map((value) => String(value || '').trim()).filter(Boolean);
  const numbers = rawValues.map(numericValue).filter((value) => value !== null);
  const sorted = [...numbers].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const integerRatio = numbers.length
    ? numbers.filter((value) => Number.isInteger(value)).length / numbers.length
    : 0;
  const fractionRatio = numbers.length
    ? numbers.filter((value) => !Number.isInteger(value)).length / numbers.length
    : 0;
  const hasMoneyMarker = rawValues.some((value) => /[,\s¥￥$元]/.test(value));
  return { numbers, median, integerRatio, fractionRatio, hasMoneyMarker };
}

function inferNumericColumns(samples, used) {
  const columnCount = samples.reduce((max, row) => Math.max(max, row.length), 0);
  const candidates = [];
  for (let index = 0; index < columnCount; index += 1) {
    if (used.has(index)) continue;
    const values = samples.map((row) => row[index] || '').filter(Boolean);
    const stats = numericStats(values);
    if (stats.numbers.length > 0) candidates.push({ index, stats });
  }
  if (!candidates.length) return {};

  const map = {};
  const priceCandidates = candidates.filter(({ stats }) => stats.median > 0 && stats.median <= 1000 && (stats.fractionRatio > 0 || stats.integerRatio > 0));
  const price = [...priceCandidates].sort((a, b) => a.stats.median - b.stats.median)[0] || candidates[0];
  map.price = price.index;
  used.add(price.index);

  const remaining = candidates.filter((candidate) => candidate.index !== price.index);
  if (!remaining.length) return map;

  if (remaining.length === 1) {
    const candidate = remaining[0];
    // 无表头时默认把价格后面的整数列当份额；带货币符号或明显金额列则当金额。
    if (candidate.stats.hasMoneyMarker && candidate.stats.median > price.stats.median * 2) {
      map.amount = candidate.index;
    } else {
      map.shares = candidate.index;
    }
    used.add(candidate.index);
    return map;
  }

  const amountCandidate = [...remaining]
    .filter(({ stats }) => stats.hasMoneyMarker || stats.median > 1000)
    .sort((a, b) => b.stats.median - a.stats.median)[0];
  if (amountCandidate) {
    map.amount = amountCandidate.index;
    used.add(amountCandidate.index);
  }

  const sharesCandidate = remaining
    .filter(({ index }) => !used.has(index))
    .sort((a, b) => a.index - b.index)[0];
  if (sharesCandidate) {
    map.shares = sharesCandidate.index;
    used.add(sharesCandidate.index);
  }

  for (const candidate of remaining) {
    if (used.has(candidate.index)) continue;
    if (map.amount === undefined) map.amount = candidate.index;
    else if (map.shares === undefined) map.shares = candidate.index;
    used.add(candidate.index);
  }
  return map;
}

function inferPasteColumnMap(dataLines, delimiter) {
  const samples = dataLines.slice(0, 5).map((line) => splitPasteLine(line, delimiter));
  const columnCount = samples.reduce((max, row) => Math.max(max, row.length), 0);
  const map = {};
  const used = new Set();

  const pickBy = (predicate) => {
    let best = null;
    let bestScore = 0;
    for (let index = 0; index < columnCount; index += 1) {
      if (used.has(index)) continue;
      const values = samples.map((row) => row[index] || '').filter(Boolean);
      const score = values.filter(predicate).length;
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    }
    if (best === null || bestScore === 0) return undefined;
    used.add(best);
    return best;
  };

  map.date = pickBy(looksLikeDateCell);
  map.code = pickBy(looksLikeCodeCell);
  map.type = pickBy(looksLikeTypeCell);
  map.name = pickBy(looksLikeNameCell);
  map.kind = pickBy((value) => Boolean(normalizeKindCell(value)));

  const numericMap = inferNumericColumns(samples, used);
  Object.assign(map, numericMap);
  return map;
}

function inferColumnMapWithFallback(lines, delimiter) {
  const inferred = inferPasteColumnMap(lines, delimiter);
  const fallback = { code: 0, name: 1, kind: 2, type: 3, date: 4, price: 5, shares: 6, amount: 7, note: 8, switch: 9 };
  return {
    ...fallback,
    ...inferred
  };
}

export function parseExcelPaste(text = '') {
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/\u3000/g, ' ').trimEnd())
    .filter((line) => line.trim().length > 0);
  if (!lines.length) {
    return { rows: [], headerDetected: false, inferred: false, columnMap: null, delimiter: null, totalLines: 0 };
  }

  const delimiter = detectPasteDelimiter(lines[0]);
  const firstCells = splitPasteLine(lines[0], delimiter);
  const headerMap = detectPasteHeader(firstCells);
  const headerDetected = headerMap.code !== undefined && Object.keys(headerMap).length >= 2;

  let columnMap;
  let dataStart;
  let inferred = false;
  if (headerDetected) {
    columnMap = headerMap;
    dataStart = 1;
  } else {
    columnMap = inferColumnMapWithFallback(lines, delimiter);
    dataStart = 0;
    inferred = Object.keys(columnMap).some((field) => !['note', 'switch'].includes(field) && columnMap[field] !== undefined);
  }

  const rows = [];
  for (let i = dataStart; i < lines.length; i += 1) {
    const cells = splitPasteLine(lines[i], delimiter);
    const pick = (field) => {
      const idx = columnMap[field];
      if (idx === undefined || idx === null) return '';
      return cells[idx] !== undefined ? cells[idx] : '';
    };

    const priceVal = Number(String(pick('price') || '').replace(/[,¥$]/g, ''));
    const amountVal = Number(String(pick('amount') || '').replace(/[,¥$]/g, ''));
    let sharesVal = pick('shares');
    if (!sharesVal && amountVal > 0 && priceVal > 0) {
      sharesVal = String(round(amountVal / priceVal, 4));
    }

    const rawDraft = {
      code: pick('code'),
      name: pick('name'),
      kind: normalizeKindCell(pick('kind')),
      type: normalizeTypeCell(pick('type')) || 'BUY',
      date: pick('date'),
      price: pick('price'),
      shares: sharesVal,
      amount: pick('amount'),
      note: pick('note')
    };
    if (!hasMeaningfulTransaction(rawDraft)) continue;

    const draft = normalizeTransaction(rawDraft);
    const errors = getTransactionErrors(draft);
    if (!draft.date) {
      errors.date = '交易日期未识别或缺失。';
    }
    if (isGhostTransaction(draft)) {
      errors.code = '异常幽灵记录（疑似日期被误识别为代码）。';
    }
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
      if (sameDate) {
        bestIdx = j;
        break;
      }
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
    inferred,
    columnMap,
    delimiter: delimiter instanceof RegExp ? 'whitespace' : delimiter === '\t' ? 'tab' : delimiter,
    totalLines: lines.length
  };
}
