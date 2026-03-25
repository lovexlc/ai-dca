import Ocr from '@gutenye/ocr-browser';
import * as ort from 'onnxruntime-web';

let ocrPromise;

function resolveOcrAsset(path) {
  if (typeof window === 'undefined') {
    return path;
  }

  return new URL(`../ocr/${path}`, window.location.href).href;
}

function getNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

function configureOrt() {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.simd = true;
  ort.env.wasm.wasmPaths = {
    'ort-wasm-simd.wasm': resolveOcrAsset('ort/ort-wasm-simd.wasm'),
    'ort-wasm.wasm': resolveOcrAsset('ort/ort-wasm.wasm')
  };
}

export function normalizeOcrText(text = '') {
  return text
    .replace(/\u3000/g, ' ')
    .replace(/[，]/g, ',')
    .replace(/[：]/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function getLocalOcrEngine() {
  if (!ocrPromise) {
    configureOrt();
    ocrPromise = Ocr.create({
      models: {
        detectionPath: resolveOcrAsset('models/ch_PP-OCRv4_det_infer.onnx'),
        recognitionPath: resolveOcrAsset('models/ch_PP-OCRv4_rec_infer.onnx'),
        dictionaryPath: resolveOcrAsset('models/ppocr_keys_v1.txt')
      }
    }).catch((error) => {
      ocrPromise = undefined;
      throw error;
    });
  }

  return ocrPromise;
}

export async function detectLocalTextFromFile(file) {
  if (!file || typeof file !== 'object') {
    throw new Error('未找到要识别的文件。');
  }

  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('当前仅支持图片 OCR，请上传 PNG、JPG、JPEG 或 WebP。');
  }

  const ocr = await getLocalOcrEngine();
  const objectUrl = URL.createObjectURL(file);
  const startedAt = getNow();

  try {
    const lines = await ocr.detect(objectUrl);
    return {
      durationMs: Math.round(getNow() - startedAt),
      lines: lines.map((line) => ({
        ...line,
        text: normalizeOcrText(line.text)
      }))
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
