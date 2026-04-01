const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../config');

puppeteer.use(StealthPlugin());

let clusterInstance = null;

async function initCluster() {
  if (clusterInstance) {
    return clusterInstance;
  }

  console.log('Initializing browser pool...');

  const clusterConfig = {
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: config.browserPool.maxConcurrency,
    puppeteerOptions: {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    },
    puppeteer,
    retryLimit: config.browserPool.retryLimit,
    retryDelay: config.browserPool.retryDelay,
    timeout: config.browserPool.timeout
  };

  clusterInstance = await Cluster.launch(clusterConfig);

  clusterInstance.task(async ({ page, data: url }) => {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
    );

    let apiData = null;
    page.on('response', async (response) => {
      if (response.url().includes('/aweme/v1/web/aweme/detail/')) {
        try {
          apiData = await response.json();
        } catch (e) {
        }
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: config.browserPool.timeout });

    if (!apiData) {
      await page.waitForTimeout(2000);
    }

    return apiData || await parseFromPage(page);
  });

  console.log('Browser pool initialized');
  return clusterInstance;
}

async function parseFromPage(page) {
  try {
    const data = await page.evaluate(() => {
      const getMeta = (name) => {
        const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
        return el ? el.content : '';
      };

      return {
        title: getMeta('og:title') || document.title,
        cover: getMeta('og:image'),
        description: getMeta('og:description')
      };
    });
    return data;
  } catch (error) {
    console.error('Failed to parse from page:', error);
    return null;
  }
}

async function execute(url) {
  const cluster = await initCluster();
  return await cluster.execute(url);
}

async function close() {
  if (clusterInstance) {
    await clusterInstance.close();
    clusterInstance = null;
    console.log('Browser pool closed');
  }
}

module.exports = {
  initCluster,
  execute,
  close
};
