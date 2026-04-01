const config = require('../config');

const cache = new Map();

function set(key, value, ttl = config.cacheTTL) {
  if (!config.cacheEnabled) return;

  const expiry = Date.now() + ttl;
  cache.set(key, { value, expiry });
}

function get(key) {
  if (!config.cacheEnabled) return null;

  const item = cache.get(key);
  if (!item) return null;

  if (Date.now() > item.expiry) {
    cache.delete(key);
    return null;
  }

  return item.value;
}

function clear() {
  cache.clear();
}

function cleanup() {
  const now = Date.now();
  for (const [key, item] of cache.entries()) {
    if (now > item.expiry) {
      cache.delete(key);
    }
  }
}

const cleanupTimer = setInterval(cleanup, 60000);
if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

module.exports = {
  set,
  get,
  clear,
  cleanup
};
