import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const apiRequests = [];
  const apiResponses = new Map();

  // 监听所有网络请求
  page.on('request', request => {
    const url = request.url();
    if (url.includes('djapi') || url.includes('danjuan')) {
      apiRequests.push({
        method: request.method(),
        url: url
      });
    }
  });

  // 监听响应
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('djapi')) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const body = await response.json();
          apiResponses.set(url, body);
        }
      } catch (e) {
        // ignore
      }
    }
  });

  console.log('正在访问页面: https://danjuanfunds.com/funding/270042\n');

  try {
    await page.goto('https://danjuanfunds.com/funding/270042', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // 等待额外的异步请求
    await page.waitForTimeout(5000);

    console.log('\n=== 所有 djapi 请求列表 ===\n');
    apiRequests.forEach((req, i) => {
      console.log(`${i + 1}. ${req.method} ${req.url}`);
    });

    console.log('\n\n=== 查找最大回撤相关数据 ===\n');
    for (const [url, body] of apiResponses) {
      const jsonStr = JSON.stringify(body).toLowerCase();
      if (jsonStr.includes('retr') || jsonStr.includes('draw') || jsonStr.includes('max')) {
        console.log(`\n在 ${url} 中找到相关数据`);
        console.log(JSON.stringify(body, null, 2).substring(0, 800));
      }
    }

  } catch (error) {
    console.error('错误:', error.message);
  }

  await browser.close();
})();
