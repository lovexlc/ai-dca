import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const panel = await readFile(new URL('../src/pages/markets/MarketsFullTablePanel.jsx', import.meta.url), 'utf8');
const list = await readFile(new URL('../src/pages/markets/MobileFundList.jsx', import.meta.url), 'utf8');
const metrics = await readFile(new URL('../src/pages/markets/mobileFundMetrics.js', import.meta.url), 'utf8');

test('mobile market list mounts the test-style interaction surface', () => {
  assert.match(panel, /<MobileFundList/);
  assert.match(list, /mobile-fund-filter/);
  assert.match(list, /mobile-fund-sort/);
  assert.match(list, /MobileMetricsDrawer/);
  assert.match(list, /仅看持仓/);
  assert.match(list, /搜索列表内基金/);
});

test('mobile market list stays on cn local row data', () => {
  const source = `${panel}\n${list}\n${metrics}`;
  assert.match(panel, /data-market-data-source="fund-collector-local"/);
  assert.doesNotMatch(source, /useOtcD1ListQuery/);
  assert.doesNotMatch(source, /useExchangeFundListQuery/);
  assert.doesNotMatch(source, /fetchListRows/);
  assert.doesNotMatch(source, /fetchExchangeFundList/);
  assert.doesNotMatch(source, /serverMode/);
});
