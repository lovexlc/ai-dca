import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
const gaugeSource = readSource('src/pages/switch/SwitchStrategySpreadGauge.jsx');
const styleSource = readSource('src/styles/app.css');

test('切换标尺保留跑者、终点旗帜和方向动画，但不显示安全区间文字', () => {
  assert.doesNotMatch(gaugeSource, /安全区间/);
  assert.match(gaugeSource, /gauge-runner-bob/);
  assert.match(gaugeSource, /gauge-flag-wave/);
  assert.match(gaugeSource, /gauge-track-dash-right/);
  assert.match(gaugeSource, /gauge-track-dash-left/);
  assert.match(gaugeSource, /冲向终点触发切仓/);
  assert.match(styleSource, /@keyframes runnerBob/);
  assert.match(styleSource, /@keyframes flagWave/);
});
