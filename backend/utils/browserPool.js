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
    const diagnostics = createPuppeteerDiagnostics();

    // 伪装为常规浏览器 UA，降低被站点识别为自动化访问的概率。
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
    );

    await enableLightweightRequestInterception(page, diagnostics);

    const detailResponsePromise = waitForAwemeDetail(page, diagnostics);
    const gotoStartTime = Date.now();
    const pageLoadPromise = page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: config.browserPool.timeout
    }).then(() => {
      diagnostics.gotoMs = Date.now() - gotoStartTime;
      return null;
    }).catch((error) => {
      diagnostics.gotoMs = Date.now() - gotoStartTime;
      diagnostics.gotoError = error.message;
      return null;
    });

    const apiData = await Promise.race([detailResponsePromise, pageLoadPromise]);
    if (apiData) {
      attachDiagnostics(apiData, diagnostics);
      logPuppeteerDiagnostics(diagnostics);
      return apiData;
    }

    // 页面接口响应可能略晚于 DOMContentLoaded，保留短等待窗口后再兜底。
    const delayedApiData = await Promise.race([
      detailResponsePromise,
      page.waitForTimeout(POST_LOAD_DETAIL_WAIT_MS).then(() => null)
    ]);

    if (delayedApiData) {
      attachDiagnostics(delayedApiData, diagnostics);
      logPuppeteerDiagnostics(diagnostics);
      return delayedApiData;
    }

    diagnostics.fallback = 'page_meta';
    const pageData = await parseFromPage(page, diagnostics);
    logPuppeteerDiagnostics(diagnostics);
    return pageData;
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
async function enableLightweightRequestInterception(page, diagnostics = null) {
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    try {
      const resourceType = request.resourceType();
      if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
        if (diagnostics) {
          diagnostics.blockedRequests[resourceType] += 1;
          diagnostics.blockedRequestCount += 1;
        }
        await request.abort();
        return;
      }
      await request.continue();
    } catch (error) {
      if (diagnostics) {
        diagnostics.requestInterceptionErrors += 1;
      }
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
function waitForAwemeDetail(page, diagnostics = null) {
  return new Promise((resolve) => {
    page.on('response', async (response) => {
      if (!response.url().includes(DETAIL_API_PATH)) {
        return;
      }

      if (diagnostics) {
        diagnostics.detailApiMatched = true;
        diagnostics.detailHttpStatus = response.status();
      }

      try {
        const apiData = await response.json();
        if (diagnostics) {
          diagnostics.detailJsonParsed = true;
          diagnostics.detailStatusCode = apiData?.status_code ?? null;
          diagnostics.detailHasAweme = Boolean(apiData?.aweme_detail);
        }

        if (apiData && apiData.status_code === 0 && apiData.aweme_detail) {
          if (diagnostics) {
            diagnostics.detailApiValid = true;
            diagnostics.fallback = 'detail_api';
          }
          resolve(apiData);
        }
      } catch (e) {
        if (diagnostics) {
          diagnostics.detailJsonError = true;
        }
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
function createPuppeteerDiagnostics() {
  return {
    detailApiMatched: false,
    detailApiValid: false,
    detailHttpStatus: null,
    detailStatusCode: null,
    detailHasAweme: false,
    detailJsonParsed: false,
    detailJsonError: false,
    fallback: 'none',
    gotoMs: 0,
    gotoError: '',
    postLoadWaitMs: POST_LOAD_DETAIL_WAIT_MS,
    blockedRequestCount: 0,
    blockedRequests: {
      image: 0,
      font: 0,
      media: 0
    },
    requestInterceptionErrors: 0,
    pageMetaTitleFound: false,
    pageMetaCoverFound: false,
    pageMetaError: false
  };
}

function attachDiagnostics(data, diagnostics) {
  if (!diagnostics) {
    return data;
  }

  const target = data || {};
  target.__diagnostics = diagnostics;
  return target;
}

function logPuppeteerDiagnostics(diagnostics) {
  console.log(
    'Puppeteer diagnostics:',
    `detailMatched=${diagnostics.detailApiMatched}`,
    `detailValid=${diagnostics.detailApiValid}`,
    `httpStatus=${diagnostics.detailHttpStatus ?? 'n/a'}`,
    `statusCode=${diagnostics.detailStatusCode ?? 'n/a'}`,
    `hasAweme=${diagnostics.detailHasAweme}`,
    `gotoMs=${diagnostics.gotoMs}`,
    `fallback=${diagnostics.fallback}`,
    `blocked=${diagnostics.blockedRequestCount}`,
    `interceptionErrors=${diagnostics.requestInterceptionErrors}`
  );
}

async function parseFromPage(page, diagnostics = null) {
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

    if (diagnostics) {
      diagnostics.pageMetaTitleFound = Boolean(data.title);
      diagnostics.pageMetaCoverFound = Boolean(data.cover);
      attachDiagnostics(data, diagnostics);
    }

    return data;
  } catch (error) {
    if (diagnostics) {
      diagnostics.pageMetaError = true;
    }
    console.error('Failed to parse from page:', error);
    return attachDiagnostics(null, diagnostics);
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
  waitForAwemeDetail,
  createPuppeteerDiagnostics
};
