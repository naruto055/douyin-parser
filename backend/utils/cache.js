const config = require('../config');

// 使用内存 Map 存储短生命周期数据，适合当前轻量级缓存场景。
const cache = new Map();

/**
 * 写入缓存，并记录过期时间。
 *
 * @param {string} key 缓存键
 * @param {*} value 缓存值
 * @param {number} [ttl=config.cacheTTL] 过期时间，单位毫秒
 */
function set(key, value, ttl = config.cacheTTL) {
  if (!config.cacheEnabled) return;

  const expiry = Date.now() + ttl;
  cache.set(key, { value, expiry });
}

/**
 * 读取缓存；若缓存已过期则顺带清理。
 *
 * @param {string} key 缓存键
 * @returns {* | null} 缓存值或 null
 */
function get(key) {
  if (!config.cacheEnabled) return null;

  const item = cache.get(key);
  if (!item) return null;

  if (Date.now() > item.expiry) {
    // 访问时顺手淘汰过期项，避免脏数据继续留在内存中。
    cache.delete(key);
    return null;
  }

  return item.value;
}

/**
 * 清空全部缓存项。
 */
function clear() {
  cache.clear();
}

/**
 * 批量移除所有已过期的缓存项。
 */
function cleanup() {
  const now = Date.now();
  for (const [key, item] of cache.entries()) {
    if (now > item.expiry) {
      cache.delete(key);
    }
  }
}

// 周期性清理过期缓存，防止长时间运行时 Map 持续增长。
const cleanupTimer = setInterval(cleanup, 60000);
if (typeof cleanupTimer.unref === 'function') {
  // 避免定时器成为进程退出的唯一阻塞条件。
  cleanupTimer.unref();
}

module.exports = {
  set,
  get,
  clear,
  cleanup
};
