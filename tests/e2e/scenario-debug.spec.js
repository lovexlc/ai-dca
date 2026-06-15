import { test, expect } from '@playwright/test';

test('场景切换器基本渲染测试', async ({ page }) => {
  // 设置管理员身份
  await page.addInitScript(() => {
    localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify({
      username: 'lovexl',
      userId: 'test-admin',
      accessToken: 'test-token'
    }));
  });

  await page.goto('http://localhost:5173/');
  await page.waitForLoadState('networkidle');

  // 等待页面完全加载
  await page.waitForTimeout(2000);

  // 调试：打印页面内容
  const content = await page.content();
  console.log('页面包含 "美股交易":', content.includes('美股交易'));
  console.log('页面包含 "ScenarioSwitcher":', content.includes('ScenarioSwitcher'));

  // 截图
  await page.screenshot({ path: '/tmp/page-screenshot.png', fullPage: true });

  // 查找所有按钮并打印
  const buttons = await page.locator('button').all();
  console.log('页面按钮总数:', buttons.length);

  for (let i = 0; i < Math.min(buttons.length, 15); i++) {
    const text = await buttons[i].textContent().catch(() => '');
    const classes = await buttons[i].getAttribute('class').catch(() => '');
    if (text || classes) {
      console.log(`按钮 ${i}:`, text.trim().substring(0, 40), '| class:', classes.substring(0, 50));
    }
  }

  // 查找 topbar
  const topbar = page.locator('.console-topbar');
  const hasTopbar = await topbar.count();
  console.log('console-topbar 数量:', hasTopbar);

  if (hasTopbar > 0) {
    const topbarHTML = await topbar.innerHTML();
    console.log('Topbar HTML 片段:', topbarHTML.substring(0, 200));
  }
});
