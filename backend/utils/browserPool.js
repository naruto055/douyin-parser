const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../config');

puppeteer.use(StealthPlugin());

let browserInstance = null;
let poolInitPromise = null;
let closingPromise = null;
let closingRequested = false;
let workerStates = [];
let taskQueue = [];
let dispatching = false;
let nextTaskId = 0;

const DETAIL_API_PATH = '/aweme/v1/web/aweme/detail/';
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media']);
const MAX_RECORDED_HOSTS = 8;

// 这个模块维护一个长生命周期的浏览器进程，以及少量可复用的 Page worker。
// 这样 Chromium 的启动成本只需要支付一次。
/**
 * 初始化 Puppeteer 浏览器池单例，用于复用 Chromium 和 Page。
 *
 * @returns {Promise<import('puppeteer').Browser>} 浏览器实例
 */
async function initCluster() {
  if (closingRequested) {
    throw new Error('Browser pool is closing');
  }

  if (poolInitPromise) {
    return poolInitPromise;
  }

  if (browserInstance) {
    return browserInstance;
  }

  console.log('Initializing browser pool...');

  poolInitPromise = (async () => {
    let launchedBrowser = null;

    try {
      launchedBrowser = await launchBrowser();
      if (closingRequested) {
        throw new Error('Browser pool is closing');
      }

      browserInstance = launchedBrowser;
      workerStates = [];
      const workerCount = getWorkerCount();
      for (let index = 0; index < workerCount; index += 1) {
        if (closingRequested) {
          throw new Error('Browser pool is closing');
        }
        workerStates.push(await createWorkerState(browserInstance, index));
      }

      if (closingRequested) {
        throw new Error('Browser pool is closing');
      }

      console.log('Browser pool initialized');
      return browserInstance;
    } catch (error) {
      await cleanupFailedInitialization(launchedBrowser);
      throw error;
    }
  })().finally(() => {
    poolInitPromise = null;
  });

  return poolInitPromise;
}

// 将 worker 数量控制在一个小而有界的范围内，避免请求突发时内存暴涨，
// 也避免并发浏览器工作过多。
function getWorkerCount() {
  const rawCount = Number(config.browserPool.maxConcurrency);
  return Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 1;
}

// 浏览器的启动参数集中在这里，便于初始化和重建逻辑复用同一套配置。
function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });
}

// 每个 worker 只持有一个 Page 实例用于复用。页面只做一次预处理，
// 然后在清理后循环服务多个任务。
async function createWorkerState(browser, index) {
  const page = await browser.newPage();
  if (closingRequested) {
    await page.close().catch(() => null);
    throw new Error('Browser pool is closing');
  }

  await page.setUserAgent(getDefaultUserAgent());
  await page.setRequestInterception(true);

  return {
    index,
    page,
    busy: false,
    activeTaskId: null,
    healthy: true
  };
}

// 固定 User-Agent 可以让重复任务的行为更可比，也能避免浏览器复用时
// 产生一些细微差异。
function getDefaultUserAgent() {
  return (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Safari/537.36'
  );
}

// 先把任务放入队列，再由调度器分配给空闲 worker。
// 这样可以显式表达背压，也把浏览器生命周期和请求生命周期分开。
function enqueueTask(url) {
  return new Promise((resolve, reject) => {
    taskQueue.push({
      id: ++nextTaskId,
      url,
      enqueuedAt: Date.now(),
      resolve,
      reject,
      retries: 0
    });
    void dispatchQueue();
  });
}

// 只有 worker 空闲时才发放任务，避免同一个 Page 被并发使用。
// 对独立解析来说，Puppeteer 并不支持安全地共享同一个 Page。
async function dispatchQueue() {
  if (dispatching) {
    return;
  }

  dispatching = true;
  try {
    while (taskQueue.length > 0) {
      const worker = await getAvailableWorker();
      if (!worker) {
        if (closingRequested || workerStates.length === 0) {
          failQueuedTasks(new Error(
            closingRequested ? 'Browser pool is closing' : 'Browser pool has no available workers'
          ));
        }
        return;
      }

      const task = taskQueue.shift();
      if (!task) {
        return;
      }

      worker.busy = true;
      worker.activeTaskId = task.id;

      void runTaskOnWorker(worker, task)
        .then((result) => {
          task.resolve(result);
        })
        .catch((error) => {
          task.reject(error);
        })
        .finally(() => {
          worker.busy = false;
          worker.activeTaskId = null;
          void dispatchQueue();
        });
    }
  } catch (error) {
    failQueuedTasks(error);
  } finally {
    dispatching = false;
  }
}

// 优先复用任意空闲 worker。如果 Page 已经退出或会话丢失，
// 先重建 worker，再派发新任务。
async function getAvailableWorker() {
  if (closingRequested) {
    return null;
  }

  const worker = workerStates.find((item) => item && !item.busy);
  if (!worker) {
    return null;
  }

  if (!worker.healthy || isPageClosed(worker.page)) {
    await rebuildWorker(worker);
  }

  return worker;
}

// 已关闭的页面不能复用。显式检查比等到任务开始后再发现失败更便宜。
function isPageClosed(page) {
  return Boolean(page && typeof page.isClosed === 'function' && page.isClosed());
}

// 当 Page 崩溃或浏览器连接丢失时重建 worker。
// 浏览器进程本身是共享的，所以能只换坏掉的 Page 就不重启整个浏览器。
async function rebuildWorker(worker) {
  if (closingRequested) {
    throw new Error('Browser pool is closing');
  }

  worker.healthy = false;

  try {
    if (worker.page && typeof worker.page.close === 'function' && !isPageClosed(worker.page)) {
      await worker.page.close().catch(() => null);
    }
  } catch (error) {
    // 关闭失败不影响重建流程。
  }

  if (!browserInstance || isBrowserClosed(browserInstance)) {
    browserInstance = await launchBrowser();
    if (closingRequested) {
      await browserInstance.close().catch(() => null);
      throw new Error('Browser pool is closing');
    }
  }

  const newWorker = await createWorkerState(browserInstance, worker.index);
  worker.page = newWorker.page;
  worker.healthy = true;
}

// 一旦浏览器断开连接，旧的 Browser 句柄就不再可用，即使外层对象还在。
function isBrowserClosed(browser) {
  return Boolean(browser && typeof browser.isConnected === 'function' && !browser.isConnected());
}

// 在单个 worker 上执行一个任务，并配一个小的重试循环。
// 这样临时性的 Page 故障只会影响当前 worker，而不会让整个队列立刻失败。
async function runTaskOnWorker(worker, task) {
  const retryLimit = getTaskRetryLimit();
  const retryDelay = getTaskRetryDelayMs();

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      return await executeTask({
        page: worker.page,
        data: {
          url: task.url,
          enqueuedAt: task.enqueuedAt
        }
      });
    } catch (error) {
      if (closingRequested) {
        throw new Error('Browser pool is closing');
      }

      if (attempt < retryLimit && isRecoverablePageError(error)) {
        await rebuildWorker(worker);
        if (retryDelay > 0) {
          await sleep(retryDelay);
        }
        continue;
      }

      throw error;
    }
  }

  throw new Error('Puppeteer task retries exhausted');
}

// 重试次数保持保守，因为目标是恢复短暂的浏览器异常，
// 不是掩盖重复性的解析失败。
function getTaskRetryLimit() {
  const rawLimit = Number(config.browserPool.retryLimit);
  return Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 0;
}

// 重试之间加一个短延迟，可以减少目标页面或会话还没稳定时的连续抖动。
function getTaskRetryDelayMs() {
  const rawDelay = Number(config.browserPool.retryDelay);
  return Number.isFinite(rawDelay) && rawDelay > 0 ? Math.floor(rawDelay) : 0;
}

// 这里放一个很小的 sleep 工具，既能让重试流程更清晰，也不用额外引依赖。
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 这些错误通常意味着 Page 或协议会话已经没了，因此重建 worker
// 比在同一页上直接重试更有价值。
function isRecoverablePageError(error) {
  const message = error?.message || String(error);
  return [
    /Target closed/i,
    /Protocol error/i,
    /Page crashed/i,
    /Session closed/i,
    /Cannot find context/i,
    /Execution context was destroyed/i
  ].some((pattern) => pattern.test(message));
}

/**
 * 执行一个浏览器解析任务，并记录任务进入执行阶段前的排队耗时。
 *
 * @param {{page: import('puppeteer').Page, data: {url: string, enqueuedAt: number}}} context 任务上下文
 * @returns {Promise<any>} 解析结果
 */
async function executeTask({ page, data }) {
  // 任务会拿到当前 Page 和入队时间戳，这样就能把排队耗时和页面耗时分开统计。
  const url = typeof data === 'string' ? data : data.url;
  const enqueuedAt = typeof data === 'object' ? data.enqueuedAt : 0;
  const diagnostics = createPuppeteerDiagnostics();
  diagnostics.queueWaitMs = getQueueWaitMs(enqueuedAt);

  let requestCleanup = null;
  let detailResponsePromise = null;

  const pagePrepareStartTime = Date.now();

  try {
    // 这里故意重复做任务级初始化，因为复用的页面可能残留旧监听器
    // 或前一个任务留下的状态。
    await page.setUserAgent(getDefaultUserAgent());
    requestCleanup = await enableLightweightRequestInterception(page, diagnostics);
    diagnostics.pagePrepareMs = Date.now() - pagePrepareStartTime;

    const gotoStartTime = Date.now();
    diagnostics.gotoStartAt = gotoStartTime;
    // 先注册 response 监听，再开始导航，避免错过页面启动阶段很早出现的
    // 详情响应。
    detailResponsePromise = waitForAwemeDetail(page, diagnostics);

    const pageLoadPromise = page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: config.browserPool.timeout
    }).then(() => {
      diagnostics.gotoMs = Date.now() - gotoStartTime;
      return null;
    }).catch((error) => {
      diagnostics.gotoMs = Date.now() - gotoStartTime;
      diagnostics.gotoError = error?.message || String(error);
      return null;
    });

    // 谁先结束就先走谁：detail 接口优先，其次是页面加载完成，
    // 再不行才走一个很短的 post-load 等待窗口。
    const apiData = await Promise.race([detailResponsePromise, pageLoadPromise]);
    if (apiData) {
      attachDiagnostics(apiData, diagnostics);
      logPuppeteerDiagnostics(diagnostics);
      return apiData;
    }

    // 额外补一个很短的窗口，用来接住刚过 DOMContentLoaded 才到的响应，
    // 但不用支付完整的页面 idle 超时。
    const delayedApiData = await Promise.race([
      detailResponsePromise,
      page.waitForTimeout(config.browserPool.postLoadDetailWaitMs).then(() => null)
    ]);

    if (delayedApiData) {
      attachDiagnostics(delayedApiData, diagnostics);
      logPuppeteerDiagnostics(diagnostics);
      return delayedApiData;
    }

    diagnostics.fallback = 'page_meta';
    // 如果 detail 接口始终不够用，DOM 元信息兜底至少还能返回一点内容，
    // 而不是直接空着。
    const pageData = await parseFromPage(page, diagnostics);
    logPuppeteerDiagnostics(diagnostics);
    return pageData;
  } finally {
    // 即使任务失败，清理也必须执行，因为复用页面会持续保留状态，
    // 直到我们显式移除监听器并重置文档。
    if (detailResponsePromise && typeof detailResponsePromise.cleanup === 'function') {
      await detailResponsePromise.cleanup();
    }

    if (typeof requestCleanup === 'function') {
      await requestCleanup();
    }

    await resetWorkerPage(page);
  }
}

// 排队耗时从任务入队那一刻开始算，而不是从真正开始执行时算。
/**
 * 计算任务从提交到开始执行的等待时间。
 *
 * @param {number} enqueuedAt 任务入队时间戳
 * @param {number} [now=Date.now()] 当前时间戳
 * @returns {number|null} 排队耗时，无法计算时返回 null
 */
function getQueueWaitMs(enqueuedAt, now = Date.now()) {
  if (!Number.isFinite(enqueuedAt)) {
    return null;
  }

  return Math.max(0, now - enqueuedAt);
}

// 诊断对象刻意保持成普通数据，这样日志和测试都能直接检查同一结构，
// 不需要额外转换。
/**
 * 创建 Puppeteer 诊断对象。
 *
 * @returns {object} 诊断信息
 */
function createPuppeteerDiagnostics() {
  return {
    detailApiMatched: false,
    detailApiValid: false,
    detailHttpStatus: null,
    detailStatusCode: null,
    detailQueryKeys: [],
    gotoStartAt: 0,
    detailRequestSeenAt: 0,
    detailMatchedMs: 0,
    detailValidMs: 0,
    detailJsonMs: 0,
    detailWaitMs: 0,
    detailHasAweme: false,
    detailJsonParsed: false,
    detailJsonError: false,
    fallback: 'none',
    gotoMs: 0,
    pagePrepareMs: 0,
    gotoError: '',
    postLoadWaitMs: config.browserPool.postLoadDetailWaitMs,
    queueWaitMs: 0,
    totalRequestCount: 0,
    continuedRequestCount: 0,
    requestTypes: {},
    detailRequestResourceType: '',
    detailRequestHost: '',
    blockedRequestCount: 0,
    blockedRequests: {
      image: 0,
      font: 0,
      media: 0
    },
    blockedHosts: {},
    requestInterceptionErrors: 0,
    pageMetaTitleFound: false,
    pageMetaCoverFound: false,
    pageMetaError: false
  };
}

// 直接把诊断对象挂到返回数据上，这样调用方就能保留它，
// 又不用改解析结果的 schema。
function attachDiagnostics(data, diagnostics) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  data.__diagnostics = diagnostics;
  return data;
}

// 这里只打印紧凑摘要，而不是完整诊断对象；完整对象仍然保留在结果上，
// 供测试和需要它的调用方使用。
function logPuppeteerDiagnostics(diagnostics) {
  console.log(
    'Puppeteer diagnostics:',
    `queueWaitMs=${diagnostics.queueWaitMs}`,
    `pagePrepareMs=${diagnostics.pagePrepareMs}`,
    `gotoMs=${diagnostics.gotoMs}`,
    `detailMatchedMs=${diagnostics.detailMatchedMs || 'n/a'}`,
    `detailValidMs=${diagnostics.detailValidMs || 'n/a'}`,
    `fallback=${diagnostics.fallback}`,
    `requests=${diagnostics.totalRequestCount}`,
    `blocked=${diagnostics.blockedRequestCount}`
  );
}

// 这里只拦截那些通常只会增加成本、却不会帮助 detail 链路的资源类型。
// 目标是削减浪费，而不是破坏页面脚本。
/**
 * 拦截解析阶段不需要的重资源，减少页面加载耗时。
 *
 * @param {import('puppeteer').Page} page Puppeteer 页面对象
 * @param {object | null} diagnostics 诊断对象
 * @returns {Promise<Function>} 清理函数
 */
async function enableLightweightRequestInterception(page, diagnostics = null) {
  await page.setRequestInterception(true);

  // 让 request 处理器保持窄职责：统计流量、放行 detail 接口、
  // 只拦截我们已经确认没必要的重资源。
  const requestHandler = async (request) => {
    try {
      const resourceType = request.resourceType();
      const requestUrl = typeof request.url === 'function' ? request.url() : '';
      if (diagnostics) {
        diagnostics.totalRequestCount += 1;
        incrementCounter(diagnostics.requestTypes, resourceType);
      }

      if (isAwemeDetailUrl(requestUrl)) {
        if (diagnostics) {
          diagnostics.continuedRequestCount += 1;
          diagnostics.detailRequestSeenAt = Date.now();
          diagnostics.detailRequestResourceType = resourceType;
          try {
            diagnostics.detailRequestHost = new URL(requestUrl).hostname || 'unknown';
          } catch (error) {
            diagnostics.detailRequestHost = 'invalid_url';
          }
        }

        await request.continue();
        return;
      }

      if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
        if (diagnostics) {
          incrementCounter(diagnostics.blockedRequests, resourceType);
          diagnostics.blockedRequestCount += 1;
          recordHostname(diagnostics.blockedHosts, requestUrl);
        }
        await request.abort();
        return;
      }

      if (diagnostics) {
        diagnostics.continuedRequestCount += 1;
      }
      await request.continue();
    } catch (error) {
      if (diagnostics) {
        diagnostics.requestInterceptionErrors += 1;
      }
      // 请求可能已被浏览器取消，忽略单个资源失败，避免影响主解析链路。
    }
  };

  page.on('request', requestHandler);
  // 返回一个清理函数，这样复用的 Page 在每个任务结束后都能解除监听器，
  // 避免解析次数增加后处理器越挂越多。
  return async () => detachPageListener(page, 'request', requestHandler);
}

// 响应监听器一旦拿到有效的详情数据就会立刻返回结果。
// 这能让解析在页面完全稳定前就结束。
/**
 * 等待抖音详情接口返回有效 aweme_detail。
 *
 * @param {import('puppeteer').Page} page Puppeteer 页面对象
 * @param {object | null} diagnostics 诊断对象
 * @returns {Promise<any>} 详情接口原始响应
 */
function waitForAwemeDetail(page, diagnostics = null) {
  let responseHandler;

  const promise = new Promise((resolve) => {
    // 监听所有 response，但只检查我们已知的 detail 接口。
    responseHandler = async (response) => {
      if (!response.url().includes(DETAIL_API_PATH)) {
        return;
      }

      if (diagnostics) {
        diagnostics.detailApiMatched = true;
        diagnostics.detailHttpStatus = response.status();
        diagnostics.detailQueryKeys = extractQueryKeys(response.url());
        if (diagnostics.gotoStartAt) {
          diagnostics.detailMatchedMs = Date.now() - diagnostics.gotoStartAt;
        }
        if (diagnostics.detailRequestSeenAt) {
          diagnostics.detailWaitMs = Date.now() - diagnostics.detailRequestSeenAt;
        }
      }

      try {
        const jsonStartTime = Date.now();
        const apiData = await response.json();
        if (diagnostics) {
          diagnostics.detailJsonMs = Date.now() - jsonStartTime;
          diagnostics.detailJsonParsed = true;
          diagnostics.detailStatusCode = apiData?.status_code ?? null;
          diagnostics.detailHasAweme = Boolean(apiData?.aweme_detail);
        }

        if (apiData && apiData.status_code === 0 && apiData.aweme_detail) {
          if (diagnostics) {
            diagnostics.detailApiValid = true;
            diagnostics.fallback = 'detail_api';
            diagnostics.detailValidMs = diagnostics.gotoStartAt
              ? Date.now() - diagnostics.gotoStartAt
              : 0;
          }
          resolve(apiData);
        }
      } catch (error) {
        if (diagnostics) {
          diagnostics.detailJsonError = true;
        }
        // 某些响应可能不是合法 JSON，这里忽略并继续走页面兜底解析。
      }
    };

    page.on('response', responseHandler);
  });

  promise.cleanup = async () => detachPageListener(page, 'response', responseHandler);
  return promise;
}

// 页面兜底故意保持轻量，只抽取解析器在网络检查失败时还能安全使用的
// 元信息字段。
/**
 * 从页面 DOM 中提取基础信息，作为接口抓取失败时的兜底方案。
 *
 * @param {import('puppeteer').Page} page Puppeteer 页面对象
 * @param {object | null} diagnostics 诊断对象
 * @returns {Promise<{title: string, cover: string, description: string} | null>} 页面解析结果
 */
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
    return null;
  }
}

// 这里用简单的字符串匹配就够了，因为解析器到这里之前已经把目标域名
// 规范化过。
function isAwemeDetailUrl(url) {
  return typeof url === 'string' && url.includes(DETAIL_API_PATH);
}

// 用简单计数器可以让诊断对象更便宜，也更容易在日志里看懂。
function incrementCounter(counter, key) {
  const counterKey = key || 'unknown';
  counter[counterKey] = (counter[counterKey] || 0) + 1;
}

// 只记录有限数量的 hostname，这样即使页面发出很多无关请求，
// 调试输出也不会失控。
function recordHostname(counter, url) {
  try {
    const hostname = new URL(url).hostname || 'unknown';
    if (counter[hostname] || Object.keys(counter).length < MAX_RECORDED_HOSTS) {
      incrementCounter(counter, hostname);
    } else {
      incrementCounter(counter, '__other');
    }
  } catch (error) {
    incrementCounter(counter, 'invalid_url');
  }
}

// 把 query key 快照下来，可以帮助判断 detail 响应里有没有带上解析器
// 期待的动态字段。
function extractQueryKeys(url) {
  try {
    return Array.from(new URL(url).searchParams.keys()).sort();
  } catch (error) {
    return [];
  }
}

// 解绑监听器要小心，因为复用的 Page 否则可能把同一个处理器挂很多次。
function detachPageListener(page, eventName, handler) {
  if (!page || !handler) {
    return;
  }

  if (typeof page.off === 'function') {
    page.off(eventName, handler);
    return;
  }

  if (typeof page.removeListener === 'function') {
    page.removeListener(eventName, handler);
  }
}

// 在任务之间重置页面，可以防止 cookie、storage 或残留 DOM 内容
// 把跨请求状态带过去。
async function resetWorkerPage(page) {
  if (!page || isPageClosed(page)) {
    return;
  }

  try {
    // 先在页面上下文里清掉 storage，避免后续任务继承前一次解析的应用状态。
    await page.evaluate(() => {
      try {
        window.localStorage.clear();
      } catch (error) {}
      try {
        window.sessionStorage.clear();
      } catch (error) {}
    });
  } catch (error) {
    // 页面可能已切换到不可执行上下文，忽略即可。
  }

  try {
    // 空白页是一个便宜且中性的文档：它保留页面对象存活，
    // 但会清掉上一个站点的脚本和监听器。
    await page.goto('about:blank', {
      waitUntil: 'domcontentloaded',
      timeout: 3000
    });
  } catch (error) {
    // 复位失败不阻断下一个任务的重试或 worker 重建。
  }
}

// 初始化过程中如果失败，必须把已经启动的 browser 和残留 worker 清理掉，
// 这样后续 execute 才不会把半成品池子当成可用状态。
async function cleanupFailedInitialization(browser) {
  if (browser && typeof browser.close === 'function') {
    await browser.close().catch(() => null);
  }

  if (browserInstance === browser) {
    browserInstance = null;
  }

  workerStates = [];
}

// 关闭时把所有排队任务都拒绝掉，避免调用方继续等待一个正在停机的池子。
function cleanupTaskQueue() {
  const pendingTasks = taskQueue.splice(0);
  for (const task of pendingTasks) {
    task.reject(new Error('Browser pool is closed'));
  }
}

// 关闭后把内存里的池子句柄清空，这样下一次 execute 才能懒加载出新的
// 浏览器和新的 worker。
function resetPoolState() {
  browserInstance = null;
  workerStates = [];
  taskQueue = [];
  dispatching = false;
}

// 如果池子已经没有 worker 了，就把排队任务一次性失败掉，避免 promise 悬空。
function failQueuedTasks(error) {
  const pendingTasks = taskQueue.splice(0);
  for (const task of pendingTasks) {
    task.reject(error);
  }
}

// `execute()` 故意写得很薄：它只负责确保池子存在，然后把任务交给队列。
/**
 * 提交一个解析任务到浏览器池执行。
 *
 * @param {string} url 待解析页面地址
 * @returns {Promise<any>} 解析结果
 */
async function execute(url) {
  const browser = await initCluster();
  if (!browser) {
    throw new Error('Browser pool failed to initialize');
  }

  const taskPromise = enqueueTask(url);
  void dispatchQueue();
  return taskPromise;
}

// `close()` 必须按“清队列 -> 关页面 -> 关浏览器”的顺序执行，
// 这样调用方才不会留下悬空 promise 或泄漏页面。
/**
 * 关闭浏览器池并释放资源。
 *
 * @returns {Promise<void>}
 */
async function close() {
  if (closingPromise) {
    return closingPromise;
  }

  closingRequested = true;
  closingPromise = (async () => {
    try {
      if (poolInitPromise) {
        await poolInitPromise.catch(() => null);
      }

      cleanupTaskQueue();

      for (const worker of workerStates) {
        if (worker?.page && typeof worker.page.close === 'function' && !isPageClosed(worker.page)) {
          await worker.page.close().catch(() => null);
        }
      }

      workerStates = [];

      if (browserInstance && typeof browserInstance.close === 'function') {
        await browserInstance.close().catch(() => null);
      }

      resetPoolState();
      console.log('Browser pool closed');
    } finally {
      closingRequested = false;
    }
  })().finally(() => {
    closingPromise = null;
  });

  return closingPromise;
}

module.exports = {
  initCluster,
  execute,
  close,
  executeTask,
  getQueueWaitMs,
  enableLightweightRequestInterception,
  waitForAwemeDetail,
  createPuppeteerDiagnostics
};
