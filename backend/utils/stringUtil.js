/**
 * 将任意字符串清洗为适合作为文件名的安全文本。
 *
 * @param {string} filename 原始文件名
 * @returns {string} 清洗后的文件名
 */
function sanitizeFilename(filename) {
  return String(filename || '')
    // 替换 Windows 等文件系统不允许的特殊字符。
    .replace(/[<>:"/\\|?*]/g, '_')
    // 限制长度，避免文件名过长导致跨平台兼容问题。
    .substring(0, 100);
}

module.exports = {
  sanitizeFilename
};
