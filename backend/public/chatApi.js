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

  function parseSSEChunk(rawChunk) {
    return String(rawChunk || '')
      .split('\n\n')
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const lines = block.split('\n');
        const eventLine = lines.find((line) => line.startsWith('event:'));
        const dataLine = lines.find((line) => line.startsWith('data:'));

        return {
          event: eventLine ? eventLine.slice(6).trim() : 'message',
          data: JSON.parse(dataLine ? dataLine.slice(5).trim() : '{}')
        };
      });
  }

  const chatApi = {
    DEFAULT_API_ORIGIN,
    resolveApiOrigin,
    buildApiUrl,
    parseSSEChunk
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = chatApi;
  }

  globalScope.ChatApi = chatApi;
})(typeof window !== 'undefined' ? window : globalThis);
