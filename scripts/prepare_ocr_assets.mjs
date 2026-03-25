import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const publicOcrDir = resolve(root, 'public', 'ocr');

const assetCopies = [
  {
    source: resolve(root, 'node_modules', '@gutenye', 'ocr-models', 'assets', 'ch_PP-OCRv4_det_infer.onnx'),
    target: resolve(publicOcrDir, 'models', 'ch_PP-OCRv4_det_infer.onnx')
  },
  {
    source: resolve(root, 'node_modules', '@gutenye', 'ocr-models', 'assets', 'ch_PP-OCRv4_rec_infer.onnx'),
    target: resolve(publicOcrDir, 'models', 'ch_PP-OCRv4_rec_infer.onnx')
  },
  {
    source: resolve(root, 'node_modules', '@gutenye', 'ocr-models', 'assets', 'ppocr_keys_v1.txt'),
    target: resolve(publicOcrDir, 'models', 'ppocr_keys_v1.txt')
  },
  {
    source: resolve(root, 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd.wasm'),
    target: resolve(publicOcrDir, 'ort', 'ort-wasm-simd.wasm')
  },
  {
    source: resolve(root, 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm.wasm'),
    target: resolve(publicOcrDir, 'ort', 'ort-wasm.wasm')
  }
];

rmSync(publicOcrDir, { recursive: true, force: true });

for (const asset of assetCopies) {
  if (!existsSync(asset.source)) {
    throw new Error(`Missing OCR asset: ${asset.source}`);
  }

  mkdirSync(dirname(asset.target), { recursive: true });
  cpSync(asset.source, asset.target, { force: true });
}

console.log(`Prepared ${assetCopies.length} OCR assets in ${publicOcrDir}`);
