import { test } from '@playwright/test';

test('检查页面控制台错误', async ({ page }) => {
  const errors = [];
  const consoleMessages = [];

  page.on('console', msg => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', err => {
    errors.push(err.message);
  });

  await page.addInitScript(() => {
    localStorage.setItem('aiDcaCloudSyncSession', JSON.stringify({
      username: 'lovexl',
      userId: 'test-admin',
      accessToken: 'test-token'
    }));
  });

  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(5000);

  console.log('\n=== 页面错误 ===');
  if (errors.length > 0) {
    errors.forEach(err => console.log('❌', err));
  } else {
    console.log('✅ 没有页面错误');
  }

  console.log('\n=== 控制台消息（最近20条）===');
  consoleMessages.slice(-20).forEach(msg => console.log(msg));

  console.log('\n=== 页面内容检查 ===');
  const html = await page.content();
  console.log('HTML 长度:', html.length);
  console.log('包含 React root:', html.includes('id="root"'));
  console.log('包含 Vite client:', html.includes('/@vite/client'));
});
