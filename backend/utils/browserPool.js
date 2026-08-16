const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../config');

puppeteer.use(StealthPlugin());

let clusterInstance = null;
const DETAIL_API_PATH = '/aweme/v1/web/aweme/detail/';
const POST_LOAD_DETAIL_WAIT_MS = 5000;
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media']);

/**
 * 初始化 Puppeteer Cluster 单例，用于复用浏览器页解析抖音链接。
 *
 * @returns {Promise<import('puppeteer-cluster').Cluster>} 浏览器集群实例
 */
async function initCluster() {
  if (clusterInstance) {
    return clusterInstance;
  }

  console.log('Initializing browser pool...');

  clusterInstance = await Cluster.launch({
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
  });

  clusterInstance.task(async ({ page, data: url }) => {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
    );

    await enableLightweightRequestInterception(page);

    const detailResponsePromise = waitForAwemeDetail(page);
    const pageLoadPromise = page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: config.browserPool.timeout
    }).catch(() => null);

    const apiData = await Promise.race([detailResponsePromise, pageLoadPromise]);
    if (apiData) {
      return apiData;
    }

    const delayedApiData = await Promise.race([
      detailResponsePromise,
      page.waitForTimeout(POST_LOAD_DETAIL_WAIT_MS).then(() => null)
    ]);

    if (delayedApiData) {
      return delayedApiData;
    }

    return parseFromPage(page);
  });

  console.log('Browser pool initialized');
  return clusterInstance;
}

/**
 * 拦截解析阶段不需要的重资源，减少页面加载耗时。
 *
 * @param {import('puppeteer').Page} page Puppeteer 页面对象
 * @returns {Promise<void>}
 */
async function enableLightweightRequestInterception(page) {
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    try {
      if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
        await request.abort();
        return;
      }
      await request.continue();
    } catch (error) {
      // 请求可能已被浏览器取消，忽略单个资源失败，避免影响主解析链路。
    }
  });
}

/**
 * 等待抖音详情接口返回有效 aweme_detail。
 *
 * @param {import('puppeteer').Page} page Puppeteer 页面对象
 * @returns {Promise<any>} 详情接口原始响应
 */
function waitForAwemeDetail(page) {
  return new Promise((resolve) => {
    page.on('response', async (response) => {
      if (!response.url().includes(DETAIL_API_PATH)) {
        return;
      }

      try {
        const apiData = await response.json();
        if (apiData && apiData.status_code === 0 && apiData.aweme_detail) {
          resolve(apiData);
        }
      } catch (e) {
        // 某些响应可能不是合法 JSON，这里忽略并继续走页面兜底解析。
      }
    });
  });
}

/**
 * 从页面 DOM 中提取基础信息，作为接口抓取失败时的兜底方案。
 *
 * @param {import('puppeteer').Page} page Puppeteer 页面对象
 * @returns {Promise<{title: string, cover: string, description: string} | null>} 页面解析结果
 */
async function parseFromPage(page) {
  try {
    return await page.evaluate(() => {
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
  } catch (error) {
    return null;
  }
}

/**
 * 提交一个解析任务到浏览器池执行。
 *
 * @param {string} url 待解析页面地址
 * @returns {Promise<any>} 解析结果
 */
async function execute(url) {
  const cluster = await initCluster();
  return await cluster.execute(url);
}

/**
 * 关闭浏览器池并释放资源。
 *
 * @returns {Promise<void>}
 */
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
  close,
  enableLightweightRequestInterception,
  waitForAwemeDetail
};
