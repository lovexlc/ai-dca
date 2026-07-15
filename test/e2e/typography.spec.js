import { expect, test } from '@playwright/test';
import { mockAcceptanceNetwork } from './acceptance-helpers.js';

test('UI, Data and Code roles keep their computed font semantics', async ({ page }) => {
  await mockAcceptanceNetwork(page);
  await page.goto('./index.html?tab=holdings');
  await page.locator('#root').waitFor();

  const styles = await page.evaluate(async () => {
    await document.fonts.ready;

    const probe = document.createElement('section');
    probe.dataset.typographyProbe = 'true';
    probe.innerHTML = `
      <button data-probe="button">按钮</button>
      <input data-probe="input" value="普通输入" />
      <span class="type-data tabular-nums" data-probe="data">¥ 1.111 / 8.888%</span>
      <code data-probe="native-code">raw-id</code>
      <span class="type-code" data-probe="code">client_01</span>
      <input class="font-mono" data-probe="mono-input" value="abcdef" />
      <code class="font-sans" data-probe="sans-code">界面文本</code>
      <div class="markets-experience" data-probe="market">
        <span>513100</span>
        <span class="type-code" data-probe="market-code">raw_market_id</span>
      </div>
      <div class="recharts-wrapper">
        <svg><text data-probe="chart-text">图表标签</text></svg>
      </div>
    `;
    document.body.append(probe);

    const portal = document.createElement('div');
    portal.dataset.probe = 'portal';
    portal.textContent = 'Portal 文本';
    document.body.append(portal);

    const computed = (selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return {
        family: style.fontFamily,
        numeric: style.fontVariantNumeric
      };
    };

    return {
      body: computed('body'),
      button: computed('[data-probe="button"]'),
      input: computed('[data-probe="input"]'),
      data: computed('[data-probe="data"]'),
      nativeCode: computed('[data-probe="native-code"]'),
      code: computed('[data-probe="code"]'),
      monoInput: computed('[data-probe="mono-input"]'),
      sansCode: computed('[data-probe="sans-code"]'),
      portal: computed('[data-probe="portal"]'),
      market: computed('[data-probe="market"]'),
      marketCode: computed('[data-probe="market-code"]'),
      chartText: computed('[data-probe="chart-text"]')
    };
  });

  expect(styles.button.family).toBe(styles.body.family);
  expect(styles.input.family).toBe(styles.body.family);
  expect(styles.portal.family).toBe(styles.body.family);
  expect(styles.market.family).toBe(styles.body.family);
  expect(styles.data.family).toBe(styles.body.family);
  expect(styles.chartText.family).toBe(styles.body.family);
  expect(styles.data.numeric).toContain('lining-nums');
  expect(styles.data.numeric).toContain('tabular-nums');

  expect(styles.nativeCode.family).toBe(styles.code.family);
  expect(styles.monoInput.family).toBe(styles.code.family);
  expect(styles.marketCode.family).toBe(styles.code.family);
  expect(styles.code.family).not.toBe(styles.body.family);
  expect(styles.sansCode.family).toBe(styles.body.family);
});
