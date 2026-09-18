import {
  getTransactionErrors,
  hasMeaningfulTransaction,
  isGhostTransaction,
  normalizeTransaction,
  round
} from './holdingsLedgerBasics.js';

const EXCEL_HEADER_KEYWORDS = {
  code: ['代码', '基金代码', '证券代码', '标的代码', '产品代码', '合约代码', 'code', 'symbol'],
  name: ['名称', '基金名称', '证券名称', '标的名称', '产品名称', 'name'],
  kind: ['场内场外', '场内/场外', '场内外', '类别', 'kind'],
  type: ['类型', '方向', '交易类型', '买卖', '操作', '业务名称', '买卖标志', '委托方向', 'type', 'side', 'action'],
  date: ['日期', '交易日', '交易日期', '成交日期', '发生日期', '确认日期', '时间', '成交时间', '委托时间', '业务时间', 'date', 'time'],
  price: ['价', '净值', '单价', '价格', '交易价', '成交价', '成交均价', '确认净值', '结算价', 'price', 'nav'],
  shares: ['份额', '数量', '成交数量', '成交份额', '发生数量', '确认份额', 'shares', 'qty', 'volume'],
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
  if (lower === 'otc' || raw.includes('场外')) return 'otc';
  if (lower === 'exchange' || raw.includes('场内') || raw.includes('ETF') || raw.includes('etf')) return 'exchange';
  if (lower === 'qdii' || raw.includes('qdii') || raw.includes('QDII')) return 'qdii';
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

/**
 * 启发式无表头推断：通过抽样前 10 行的数据模式，自动识别各列语义。
 * 杜绝将日期列死板绑定为基金代码导致的「202691 买入」问题。
 */
function inferColumnMapFromContent(lines, delimiter) {
  const sampleLines = lines.slice(0, 10);
  const colScores = {};
  const maxCols = Math.max(...sampleLines.map((l) => splitPasteLine(l, delimiter).length));

  for (let c = 0; c < maxCols; c += 1) {
    colScores[c] = { date: 0, code: 0, type: 0, kind: 0, num: 0, text: 0 };
  }

  for (const line of sampleLines) {
    const cells = splitPasteLine(line, delimiter);
    cells.forEach((cell, c) => {
      const v = String(cell || '').trim();
      if (!v) return;
      if (isLikelyDateCell(v)) colScores[c].date += 2;
      if (isLikelyCodeCell(v)) colScores[c].code += 2;
      if (isLikelyTypeCell(v)) colScores[c].type += 2;
      if (v.includes('场外') || v.includes('场内') || v.includes('QDII') || v.includes('qdii')) colScores[c].kind += 2;
      const num = Number(v.replace(/[,¥$]/g, ''));
      if (Number.isFinite(num) && num > 0) colScores[c].num += 1;
      if (/[\u4e00-\u9fa5]/.test(v) && v.length >= 2 && !isLikelyTypeCell(v)) colScores[c].text += 1;
    });
  }

  const map = {};
  const usedCols = new Set();

  // 1. 优先定位日期列
  let bestDateCol = -1, maxDate = 0;
  for (let c = 0; c < maxCols; c += 1) {
    if (colScores[c].date > maxDate) {
      maxDate = colScores[c].date;
      bestDateCol = c;
    }
  }
  if (bestDateCol >= 0 && maxDate > 0) {
    map.date = bestDateCol;
    usedCols.add(bestDateCol);
  }

  // 2. 定位基金代码列（排查已作为日期的列）
  let bestCodeCol = -1, maxCode = 0;
  for (let c = 0; c < maxCols; c += 1) {
    if (usedCols.has(c)) continue;
    if (colScores[c].code > maxCode) {
      maxCode = colScores[c].code;
      bestCodeCol = c;
    }
  }
  if (bestCodeCol >= 0 && maxCode > 0) {
    map.code = bestCodeCol;
    usedCols.add(bestCodeCol);
  }

  // 3. 定位买卖方向列
  let bestTypeCol = -1, maxType = 0;
  for (let c = 0; c < maxCols; c += 1) {
    if (usedCols.has(c)) continue;
    if (colScores[c].type > maxType) {
      maxType = colScores[c].type;
      bestTypeCol = c;
    }
  }
  if (bestTypeCol >= 0 && maxType > 0) {
    map.type = bestTypeCol;
    usedCols.add(bestTypeCol);
  }

  // 4. 定位场内/场外类别列
  let bestKindCol = -1, maxKind = 0;
  for (let c = 0; c < maxCols; c += 1) {
    if (usedCols.has(c)) continue;
    if (colScores[c].kind > maxKind) {
      maxKind = colScores[c].kind;
      bestKindCol = c;
    }
  }
  if (bestKindCol >= 0 && maxKind > 0) {
    map.kind = bestKindCol;
    usedCols.add(bestKindCol);
  }

  // 5. 定位基金名称列（中文文本）
  let bestNameCol = -1, maxName = 0;
  for (let c = 0; c < maxCols; c += 1) {
    if (usedCols.has(c)) continue;
    if (colScores[c].text > maxName) {
      maxName = colScores[c].text;
      bestNameCol = c;
    }
  }
  if (bestNameCol >= 0 && maxName > 0) {
    map.name = bestNameCol;
    usedCols.add(bestNameCol);
  }

  // 6. 分配数值列（价格与份额）
  const remainingNumCols = [];
  for (let c = 0; c < maxCols; c += 1) {
    if (!usedCols.has(c) && colScores[c].num > 0) {
      remainingNumCols.push(c);
    }
  }
  if (remainingNumCols.length === 1) {
    map.shares = remainingNumCols[0];
  } else if (remainingNumCols.length >= 2) {
    map.price = remainingNumCols[0];
    map.shares = remainingNumCols[1];
  }

  // 兜底回退：若未能识别出有效代码列，且第 0 列不是日期，才使用默认序列
  if (map.code === undefined) {
    const fallbackCodeCol = map.date === 0 ? 1 : 0;
    map.code = fallbackCodeCol;
  }

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
    columnMap = inferColumnMapFromContent(lines, delimiter);
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
