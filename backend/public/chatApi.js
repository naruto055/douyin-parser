(function (globalScope) {
  const DEFAULT_API_ORIGIN = 'http://localhost:3000';

  function normalizePath(pathname) {
    if (!pathname) {
      return '/';
    }

    return pathname.startsWith('/') ? pathname : `/${pathname}`;
  }

  function resolveApiOrigin(locationLike, fallbackOrigin = DEFAULT_API_ORIGIN) {
    if (!locationLike || locationLike.protocol === 'file:') {
      return fallbackOrigin;
    }

    return locationLike.origin || fallbackOrigin;
  }

  function buildApiUrl(pathname, locationLike, fallbackOrigin) {
    return `${resolveApiOrigin(locationLike, fallbackOrigin)}${normalizePath(pathname)}`;
  }

  const chatApi = {
    DEFAULT_API_ORIGIN,
    resolveApiOrigin,
    buildApiUrl
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = chatApi;
  }

  globalScope.ChatApi = chatApi;
})(typeof window !== 'undefined' ? window : globalThis);
