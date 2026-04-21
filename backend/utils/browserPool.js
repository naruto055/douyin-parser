const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../config');

puppeteer.use(StealthPlugin());

let clusterInstance = null;

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
    // 伪装为常规浏览器 UA，降低被站点识别为自动化访问的概率。
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
    );

    let apiData = null;
    page.on('response', async (response) => {
      // 优先监听抖音详情接口响应，直接获取结构化数据。
      if (response.url().includes('/aweme/v1/web/aweme/detail/')) {
        try {
          apiData = await response.json();
        } catch (e) {
          // 某些响应可能不是合法 JSON，这里忽略并继续走页面兜底解析。
        }
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: config.browserPool.timeout });

    if (!apiData) {
      // 页面接口响应可能存在延迟，额外等待一小段时间提升捕获成功率。
      await page.waitForTimeout(2000);
    }

    // 如果没有拿到接口数据，则回退到页面元信息提取。
    return apiData || await parseFromPage(page);
  });

  console.log('Browser pool initialized');
  return clusterInstance;
}

/**
 * 从页面 DOM 中提取基础信息，作为接口抓取失败时的兜底方案。
 *
 * @param {import('puppeteer').Page} page Puppeteer 页面对象
 * @returns {Promise<{title: string, cover: string, description: string} | null>} 页面解析结果
 */
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
  close
};
