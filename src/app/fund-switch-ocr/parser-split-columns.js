import { detectTradeType, isHeaderLike, normalizeDate, normalizeOcrText, parseAmountToken, parseCountToken, parsePriceToken } from './utils.js';

function findNearestRow(candidates, centerY, maxDistance = 70) {
  let best = null;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate.centerY - centerY);
    if (distance > maxDistance) {
      continue;
    }

    if (!best || distance < best.distance) {
      best = { candidate, distance };
    }
  }

  return best?.candidate || null;
}

function extractAmountFromGroup(group) {
  if (!group) {
    return null;
  }

  const token = [...group.tokens].reverse().find((item) => item.left >= 560 && parseAmountToken(item.text) !== null);
  return token ? parseAmountToken(token.text) : null;
}

function extractDateOrTime(group) {
  if (!group) {
    return '';
  }

  const full = normalizeDate(group.text);
  if (full) {
    return full;
  }

  const match = normalizeOcrText(group.text).match(/(\d{2}:\d{2}:\d{2})/);
  return match?.[1] || '';
}

export function parseSplitColumnsTemplate(context) {
  const groups = context.groups;
  const nameRows = groups.filter((group) => {
    const nameToken = group.tokens.find((token) => token.left < 140 && !isHeaderLike(token.text));
    const priceToken = group.tokens.find((token) => token.left >= 240 && token.left <= 420 && parsePriceToken(token.text) !== null);
    const sharesToken = group.tokens.find((token) => token.left >= 420 && token.left <= 820 && parseCountToken(token.text) !== null);
    const typeToken = group.tokens.find((token) => token.left >= 620 && detectTradeType(token.text));
    return Boolean(nameToken && priceToken && sharesToken && typeToken);
  });
  const detailRows = groups.filter((group) => detectTradeType(group.text) && (normalizeDate(group.text) || /\d{2}:\d{2}:\d{2}/.test(group.text)));
  const amountRows = groups.filter((group) => group.tokens.some((token) => token.left >= 560 && parseAmountToken(token.text) !== null));

  const rows = nameRows.map((group, index) => {
    const nameToken = group.tokens.find((token) => token.left < 140 && !isHeaderLike(token.text));
    const priceToken = group.tokens.find((token) => token.left >= 240 && token.left <= 420 && parsePriceToken(token.text) !== null);
    const sharesToken = group.tokens.find((token) => token.left >= 420 && token.left <= 820 && parseCountToken(token.text) !== null);
    const typeToken = group.tokens.find((token) => token.left >= 620 && detectTradeType(token.text));
    const detail = findNearestRow(detailRows, group.centerY + 40, 85);
    const amountRow = findNearestRow(amountRows, group.centerY + 40, 85) || findNearestRow(amountRows, group.centerY, 85);

    return {
      id: 'switch-split-' + Date.now() + '-' + index,
      date: extractDateOrTime(detail),
      code: normalizeOcrText(nameToken?.text || ''),
      type: detectTradeType(typeToken?.text || detail?.text || group.text),
      price: parsePriceToken(priceToken?.text || '') || 0,
      shares: parseCountToken(sharesToken?.text || '') || 0,
      amount: extractAmountFromGroup(detail) ?? extractAmountFromGroup(amountRow)
    };
  }).filter((row) => row.code && row.type && row.price > 0 && row.shares > 0);

  return {
    rows,
    warnings: rows.length ? [] : ['split_columns_mobile 未识别到交易记录']
  };
}
