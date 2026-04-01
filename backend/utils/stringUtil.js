function sanitizeFilename(filename) {
  return String(filename || '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .substring(0, 100);
}

module.exports = {
  sanitizeFilename
};
