import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 }, // iPhone SE 尺寸
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();

  console.log('正在打开行情中心页面...');
  await page.goto('http://localhost:5177/?tab=markets');

  console.log('等待页面加载...');
  await page.waitForTimeout(5000);

  // 点击关闭弹窗
  try {
    await page.mouse.click(323, 70);
    await page.waitForTimeout(500);
    console.log('已关闭弹窗');
  } catch (e) {
    console.log('关闭弹窗失败:', e.message);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  console.log('截取搜索前的完整页面...');
  await page.screenshot({ path: '/tmp/mobile-full-before.png', fullPage: true });
  console.log('搜索前完整页面截图已保存');

  console.log('截取搜索前的顶部区域...');
  await page.screenshot({ path: '/tmp/mobile-header-before.png', clip: { x: 0, y: 0, width: 375, height: 200 } });
  console.log('搜索前顶部截图已保存');

  console.log('尝试点击搜索按钮（坐标方式）...');
  await page.mouse.click(210, 90);
  await page.waitForTimeout(500);
  console.log('已点击搜索按钮');

  console.log('截取搜索后的完整页面...');
  await page.screenshot({ path: '/tmp/mobile-full-after.png', fullPage: true });
  console.log('搜索后完整页面截图已保存');

  console.log('截取搜索后的顶部区域...');
  await page.screenshot({ path: '/tmp/mobile-header-after.png', clip: { x: 0, y: 0, width: 375, height: 200 } });
  console.log('搜索后顶部截图已保存');

  console.log('完成测试，关闭浏览器');
  await browser.close();
})();
