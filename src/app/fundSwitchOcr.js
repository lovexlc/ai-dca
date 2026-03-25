import { round } from './accumulation.js';
import { detectLocalTextFromFile, normalizeOcrText } from './localOcr.js';

const SELL_KEYWORDS = ['卖出', '赎回', '转出'];
const BUY_KEYWORDS = ['买入', '申购', '定投', '转入'];
const HEADER_KEYWORDS = ['日期', '时间', '基金', '代码', '单价', '份额', '金额', '交易'];

function normalizeDate(rawText = '') {
  const match = rawText.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) {
    return '';
  }

  const [, year, month, day, hour, minute, second] = match;
  const date = [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
  if (!hour || !minute) {
    return date;
  }

  const time = [hour.padStart(2, '0'), minute.padStart(2, '0'), (second || '00').padStart(2, '0')].join(':');
  return `${date} ${time}`;
}

function getLineMetrics(line, index) {
  if (!Array.isArray(line.box) || !line.box.length) {
    return {
      top: index * 24,
      left: 0,
      width: 0,
      height: 18,
      centerY: index * 24 + 9
    };
  }

  const xs = line.box.map((point) => Number(point?.[0]) || 0);
  const ys = line.box.map((point) => Number(point?.[1]) || 0);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const height = Math.max(bottom - top, 12);

  return {
    top,
    left,
    width: Math.max(right - left, 0),
    height,
    centerY: top + height / 2
  };
}

function groupLinesByRow(lines) {
  const tokens = lines
    .map((line, index) => ({
      ...line,
      ...getLineMetrics(line, index),
      text: normalizeOcrText(line.text)
    }))
    .filter((line) => line.text)
    .sort((left, right) => {
      if (Math.abs(left.top - right.top) > 10) {
        return left.top - right.top;
      }

      return left.left - right.left;
    });

  const groups = [];

  for (const token of tokens) {
    const current = groups[groups.length - 1];
    const threshold = current ? Math.max(current.avgHeight * 0.6, token.height * 0.6, 16) : 0;

    if (!current || Math.abs(token.centerY - current.centerY) > threshold) {
      groups.push({
        centerY: token.centerY,
        avgHeight: token.height,
        tokens: [token]
      });
      continue;
    }

    current.tokens.push(token);
    current.centerY = (current.centerY * (current.tokens.length - 1) + token.centerY) / current.tokens.length;
    current.avgHeight = (current.avgHeight * (current.tokens.length - 1) + token.height) / current.tokens.length;
  }

  return groups.map((group) => {
    const sortedTokens = [...group.tokens].sort((left, right) => left.left - right.left);
    return {
      text: sortedTokens.map((token) => token.text).join(' '),
      tokens: sortedTokens
    };
  });
}

function detectTradeType(text) {
  if (SELL_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return '卖出';
  }

  if (BUY_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return '买入';
  }

  return '';
}

function parseNumericToken(text) {
  const match = normalizeOcrText(text).match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const value = Number(match[0].replace(/,/g, ''));
  if (!Number.isFinite(value)) {
    return null;
  }

  return value;
}

function isHeaderLike(text) {
  return HEADER_KEYWORDS.some((keyword) => text.includes(keyword));
}

function parseTradeGroup(group, index) {
  const text = normalizeOcrText(group.text);
  if (!text) {
    return null;
  }

  const date = normalizeDate(text);
  const type = detectTradeType(text);
  const codeMatch = text.match(/(?:^|\D)(\d{6})(?:\D|$)/);
  const code = codeMatch?.[1] || '';

  if (!type && !code && isHeaderLike(text)) {
    return null;
  }

  const tokenRecords = group.tokens.map((token, tokenIndex) => ({
    index: tokenIndex,
    text: token.text,
    value: parseNumericToken(token.text)
  }));

  const typeIndex = tokenRecords.findIndex((token) => detectTradeType(token.text));
  const numericTokens = tokenRecords.filter((token) => {
    if (token.value === null || token.value <= 0) {
      return false;
    }

    if (date && token.text.includes(date.slice(0, 10))) {
      return false;
    }

    if (code && token.text.includes(code)) {
      return false;
    }

    if (detectTradeType(token.text)) {
      return false;
    }

    return true;
  });

  if (!type || !code || numericTokens.length < 2) {
    return null;
  }

  const orderedNumeric = [...numericTokens].sort((left, right) => left.index - right.index);
  const afterType = typeIndex >= 0 ? orderedNumeric.filter((token) => token.index > typeIndex) : orderedNumeric;
  const numericPool = afterType.length >= 2 ? afterType : orderedNumeric;
  const priceToken = numericPool.find((token) => token.value > 0 && token.value < 100) || numericPool[0];
  const shareToken = numericPool.find((token) => token.index > priceToken.index) || numericPool[numericPool.length - 1];

  if (!priceToken || !shareToken || shareToken.value <= 0) {
    return null;
  }

  return {
    id: `switch-ocr-${Date.now()}-${index}`,
    date,
    code,
    type,
    price: round(priceToken.value, 4),
    shares: round(shareToken.value, 2)
  };
}

function summarizeByCode(rows, type) {
  const byCode = new Map();

  for (const row of rows) {
    if (row.type !== type || !row.code) {
      continue;
    }

    const existing = byCode.get(row.code) || { code: row.code, shares: 0, amount: 0 };
    existing.shares += row.shares;
    existing.amount += row.price * row.shares;
    byCode.set(row.code, existing);
  }

  return [...byCode.values()].sort((left, right) => right.amount - left.amount || right.shares - left.shares);
}

function inferComparisonFromRows(rows, fallbackComparison) {
  const sellGroups = summarizeByCode(rows, '卖出');
  const buyGroups = summarizeByCode(rows, '买入');
  const totalSellAmount = round(sellGroups.reduce((sum, item) => sum + item.amount, 0), 2);
  const totalBuyAmount = round(buyGroups.reduce((sum, item) => sum + item.amount, 0), 2);
  const source = sellGroups[0];
  const target = buyGroups[0];

  return {
    ...fallbackComparison,
    sourceCode: source?.code || fallbackComparison.sourceCode,
    sourceSellShares: source ? round(source.shares, 2) : fallbackComparison.sourceSellShares,
    targetCode: target?.code || fallbackComparison.targetCode,
    targetBuyShares: target ? round(target.shares, 2) : fallbackComparison.targetBuyShares,
    switchCost: totalBuyAmount > 0 ? totalBuyAmount : fallbackComparison.switchCost,
    extraCash: round(Math.max(totalBuyAmount - totalSellAmount, 0), 2),
    feeTradeCount: rows.length || fallbackComparison.feeTradeCount
  };
}

export async function recognizeFundSwitchFile(file, fallbackComparison, onProgress) {
  onProgress?.({
    status: 'loading',
    progress: 18,
    message: '加载本地 OCR 模型'
  });

  const detected = await detectLocalTextFromFile(file);

  onProgress?.({
    status: 'loading',
    progress: 72,
    message: '识别完成，正在解析交易字段'
  });

  const groups = groupLinesByRow(detected.lines);
  const rows = groups
    .map((group, index) => parseTradeGroup(group, index))
    .filter(Boolean);

  return {
    ...detected,
    comparison: inferComparisonFromRows(rows, fallbackComparison),
    groups,
    previewLines: groups.map((group) => group.text).filter(Boolean).slice(0, 6),
    rows
  };
}
