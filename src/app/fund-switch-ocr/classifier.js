import { detectTradeType, groupLinesByRow, normalizeDate, parseAmountToken, parseCountToken, parsePriceToken } from './utils.js';

function countMatches(groups, predicate) {
  return groups.reduce((count, group) => count + (predicate(group) ? 1 : 0), 0);
}

function buildSplitColumnsScore(groups) {
  const nameRows = countMatches(groups, (group) => group.tokens.some((token) => token.left < 120) && group.tokens.some((token) => token.left > 260 && parsePriceToken(token.text) !== null));
  const timeRows = countMatches(groups, (group) => detectTradeType(group.text) && normalizeDate(group.text));
  const amountRows = countMatches(groups, (group) => group.tokens.some((token) => token.left > 560 && parseAmountToken(token.text) !== null));
  return (nameRows * 2) + (timeRows * 2) + amountRows;
}

function buildPairedRowsScore(groups) {
  const summaryRows = countMatches(groups, (group) => group.tokens.some((token) => token.left < 120) && group.tokens.some((token) => token.left > 900 && detectTradeType(token.text)));
  const detailRows = countMatches(groups, (group) => detectTradeType(group.text) && normalizeDate(group.text) && group.tokens.some((token) => token.left > 860 && parseAmountToken(token.text) !== null));
  const shareRows = countMatches(groups, (group) => group.tokens.some((token) => token.left >= 700 && token.left <= 940 && parseCountToken(token.text) !== null));
  return (summaryRows * 2) + (detailRows * 2) + shareRows;
}

export function buildOcrContext(lines) {
  const groups = groupLinesByRow(lines);
  const pairedRowsScore = buildPairedRowsScore(groups);
  const splitColumnsScore = buildSplitColumnsScore(groups);
  const templateId = splitColumnsScore > pairedRowsScore ? 'split_columns_mobile' : 'paired_rows_mobile';
  const totalScore = Math.max(pairedRowsScore, splitColumnsScore);
  const confidence = totalScore >= 10 ? 0.9 : totalScore >= 6 ? 0.72 : totalScore >= 3 ? 0.55 : 0.35;

  return {
    groups,
    templateId,
    confidence,
    scores: {
      paired_rows_mobile: pairedRowsScore,
      split_columns_mobile: splitColumnsScore
    }
  };
}
