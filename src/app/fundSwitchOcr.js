const OCR_ENDPOINT = '/api/ocr';

function now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

function normalizePreviewLines(payload = {}) {
  if (Array.isArray(payload.previewLines) && payload.previewLines.length) {
    return payload.previewLines.filter(Boolean).slice(0, 6);
  }

  if (Array.isArray(payload.warnings) && payload.warnings.length) {
    return payload.warnings.filter(Boolean).slice(0, 6);
  }

  return [];
}

function ensureImageFile(file) {
  if (!file || typeof file !== 'object') {
    throw new Error('未找到要识别的文件。');
  }

  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('当前仅支持图片上传，请使用常见图片格式。');
  }
}

export async function recognizeFundSwitchFile(file, fallbackComparison, onProgress) {
  ensureImageFile(file);
  const startedAt = now();

  onProgress?.({
    status: 'loading',
    progress: 18,
    message: '正在上传截图'
  });

  const formData = new FormData();
  formData.append('file', file, file.name || 'fund-switch-upload');
  formData.append('fallbackComparison', JSON.stringify(fallbackComparison || {}));

  onProgress?.({
    status: 'loading',
    progress: 46,
    message: '正在识别交易明细'
  });

  const response = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json'
    },
    body: formData
  });

  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = {
        error: response.ok ? '识别服务返回了非标准响应。' : rawText
      };
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || `识别服务请求失败：状态 ${response.status}`);
  }

  onProgress?.({
    status: 'loading',
    progress: 84,
    message: '正在回填持仓明细'
  });

  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];

  return {
    rows,
    warnings,
    comparison: payload.comparison || fallbackComparison,
    previewLines: normalizePreviewLines(payload),
    recordCount: Number(payload.recordCount) || rows.length,
    confidence: Math.max(Math.min(Number(payload.confidence) || 0, 1), 0),
    provider: payload.provider || 'gemini-worker',
    model: payload.model || '',
    promptVersion: payload.promptVersion || '',
    durationMs: Number(payload.durationMs) || Math.round(now() - startedAt)
  };
}
