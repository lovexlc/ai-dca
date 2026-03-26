import { detectTradeType, isHeaderLike, normalizeDate, normalizeOcrText, parseAmountToken, parseCountToken, parsePriceToken, pickNameToken } from './utils.js';

function parseSummaryGroup(group) {
  const tokens = [...group.tokens].sort((left, right) => left.left - right.left);
  const typeToken = tokens.find((token) => detectTradeType(token.text));
  const nameToken = pickNameToken(tokens);
  const priceToken = tokens.find((token) => token.left >= 320 && token.left <= 700 && parsePriceToken(token.text) !== null);
  const sharesToken = tokens.find((token) => token.left >= 700 && token.left <= 940 && parseCountToken(token.text) !== null);
  const type = detectTradeType(typeToken?.text || group.text);

  if (!nameToken || !priceToken || !sharesToken || !type) {
    return null;
  }

  const name = normalizeOcrText(nameToken.text);
  if (!name || isHeaderLike(name)) {
    return null;
  }

  return {
    name,
    type,
    price: parsePriceToken(priceToken.text),
    shares: parseCountToken(sharesToken.text),
    centerY: group.centerY
  };
}

function parseDetailGroup(group) {
  const tokens = [...group.tokens].sort((left, right) => left.left - right.left);
  const rowText = tokens.map((token) => normalizeOcrText(token.text)).join(' ');
  const type = detectTradeType(rowText || group.text);
  const date = normalizeDate(rowText || group.text);
  const amountToken = [...tokens].reverse().find((token) => token.left >= 880 && parseAmountToken(token.text) !== null);

  if (!type || !date) {
    return null;
  }

  return {
    type,
    date,
    amount: amountToken ? parseAmountToken(amountToken.text) : null,
    centerY: group.centerY
  };
}

export function parsePairedRowsTemplate(context) {
  const rows = [];

  for (let index = 0; index < context.groups.length; index += 1) {
    const summary = parseSummaryGroup(context.groups[index]);
    if (!summary) {
      continue;
    }

    const detail = parseDetailGroup(context.groups[index + 1]);
    const isPair = Boolean(detail) && detail.type === summary.type && Math.abs(detail.centerY - summary.centerY) <= 90;

    rows.push({
      id: 'switch-ocr-' + Date.now() + '-' + index,
      date: isPair ? detail.date : '',
      code: summary.name,
      type: summary.type,
      price: summary.price,
      shares: summary.shares,
      amount: isPair ? detail.amount : summary.price * summary.shares
    });

    if (isPair) {
      index += 1;
    }
  }

  return {
    rows,
    warnings: rows.length ? [] : ['paired_rows_mobile 未识别到交易记录']
  };
}
