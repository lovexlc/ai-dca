import { detectRemoteTextFromFile } from './ocrSpace.js';
import { buildOcrContext } from './fund-switch-ocr/classifier.js';
import { parsePairedRowsTemplate } from './fund-switch-ocr/parser-paired-rows.js';
import { parseSplitColumnsTemplate } from './fund-switch-ocr/parser-split-columns.js';
import { finalizeRows, inferComparisonFromRows } from './fund-switch-ocr/utils.js';

const TEMPLATE_PARSERS = {
  paired_rows_mobile: parsePairedRowsTemplate,
  split_columns_mobile: parseSplitColumnsTemplate
};

function scoreParsedRows(templateId, preferredTemplateId, rows, warnings) {
  let score = rows.length * 20;
  score += rows.filter((row) => row.date).length * 6;
  score += rows.filter((row) => Number(row.amount) > 100).length * 4;

  if (rows.some((row) => row.type === '买入')) {
    score += 4;
  }

  if (rows.some((row) => row.type === '卖出')) {
    score += 4;
  }

  const uniqueCodes = new Set(rows.map((row) => row.code).filter(Boolean));
  score += Math.min(uniqueCodes.size, 4) * 2;

  if (preferredTemplateId === templateId) {
    score += 2;
  }

  score -= (warnings || []).length * 3;
  return score;
}

function evaluateParser(templateId, preferredTemplateId, parser, context) {
  const parsed = parser(context);
  const rows = finalizeRows(parsed.rows || []);
  return {
    templateId,
    rows,
    warnings: parsed.warnings || [],
    score: scoreParsedRows(templateId, preferredTemplateId, rows, parsed.warnings || [])
  };
}

export async function recognizeFundSwitchFile(file, fallbackComparison, onProgress) {
  onProgress?.({
    status: 'loading',
    progress: 18,
    message: '上传截图到 OCR.Space'
  });

  const detected = await detectRemoteTextFromFile(file, onProgress);

  onProgress?.({
    status: 'loading',
    progress: 72,
    message: 'OCR.Space 已返回，正在匹配页面模板'
  });

  const context = buildOcrContext(detected.lines);
  const preferredTemplateId = context.templateId;
  const candidates = Object.entries(TEMPLATE_PARSERS).map(([templateId, parser]) => evaluateParser(templateId, preferredTemplateId, parser, context));
  candidates.sort((left, right) => right.score - left.score || right.rows.length - left.rows.length || (left.templateId === preferredTemplateId ? -1 : 1));
  const best = candidates[0];
  const confidence = Math.min(0.95, Math.max(context.confidence, best.rows.length ? 0.65 : 0.35) + (best.score >= 30 ? 0.08 : 0));

  return {
    ...detected,
    templateId: best.templateId,
    preferredTemplateId,
    confidence,
    warnings: best.warnings,
    scores: context.scores,
    parserScores: Object.fromEntries(candidates.map((item) => [item.templateId, item.score])),
    comparison: inferComparisonFromRows(best.rows, fallbackComparison),
    groups: context.groups,
    previewLines: context.groups.map((group) => group.text).filter(Boolean).slice(0, 6),
    rows: best.rows
  };
}
