const config = require('../config');
const { launchBrowser, configureUserAgent } = require('../utils/browserPool');

async function main() {
  if (!config.douyin.userDataDir) {
    throw new Error('请先在 backend/.env 设置 DOUYIN_BROWSER_USER_DATA_DIR');
  }

  const targetUrl = process.argv[2] || 'https://www.douyin.com/';
  const target = new URL(targetUrl);
  if (target.protocol !== 'https:' || (target.hostname !== 'douyin.com' && !target.hostname.endsWith('.douyin.com'))) {
    throw new Error('会话初始化请使用 HTTPS 抖音页面链接');
  }
  const browser = await launchBrowser({ headless: false });
  const disconnected = new Promise((resolve) => browser.once('disconnected', resolve));
  const stop = () => { void browser.close().catch(() => null); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const page = await browser.newPage();
    await configureUserAgent(page);
    console.log('请在浏览器中完成抖音验证或登录，确认视频可以播放后关闭整个浏览器。');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {
      console.log('页面加载未完成，可在浏览器中手动刷新。');
    });
    await disconnected;
    console.log('会话浏览器已关闭，现在可以运行 pnpm start。');
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await browser.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
