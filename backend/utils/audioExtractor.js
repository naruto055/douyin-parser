const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

// 配置 ffmpeg 可执行文件路径，确保 fluent-ffmpeg 在各环境下都能正确调用。
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * 确保临时目录存在，用于存放音频提取过程中生成的文件。
 *
 * @returns {string} 临时目录绝对路径
 */
function ensureTempDir() {
  const tempDir = path.join(__dirname, '..', config.tempDir);
  if (!fs.existsSync(tempDir)) {
    // 使用递归创建，避免父级目录不存在导致创建失败。
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * 将视频流中的音频轨道提取为 mp3 文件。
 *
 * @param {string} videoUrl 视频资源地址
 * @param {string} outputPath 输出音频文件路径
 * @returns {Promise<string>} 提取成功后的输出路径
 */
async function extractAudio(videoUrl, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoUrl)
      // 仅保留音频，避免无意义的视频转码开销。
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate(config.ffmpeg.audioBitrate)
      .audioFrequency(config.ffmpeg.audioFrequency)
      .audioChannels(config.ffmpeg.audioChannels)
      .on('start', (cmd) => {
        console.log('FFmpeg command started:', cmd);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log('Audio extraction progress:', Math.round(progress.percent) + '%');
        }
      })
      .on('end', () => {
        console.log('Audio extraction completed');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Audio extraction failed:', err);
        reject(err);
      })
      .save(outputPath);
  });
}

/**
 * 从视频地址提取音频，并生成唯一的临时文件名。
 *
 * @param {string} videoUrl 视频资源地址
 * @returns {Promise<{path: string, filename: string}>} 生成的音频文件信息
 */
async function extractAudioFromUrl(videoUrl) {
  const tempDir = ensureTempDir();
  // 使用 UUID 避免并发请求时临时文件重名。
  const outputFilename = `${uuidv4()}.mp3`;
  const outputPath = path.join(tempDir, outputFilename);

  try {
    await extractAudio(videoUrl, outputPath);
    return {
      path: outputPath,
      filename: outputFilename
    };
  } catch (error) {
    // 提取失败时主动清理已生成的残留文件，避免临时目录不断膨胀。
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    throw error;
  }
}

/**
 * 清理超过指定存活时间的临时文件。
 *
 * @param {number} [maxAge=3600000] 文件最大保留时长，单位毫秒
 */
function cleanupOldFiles(maxAge = 3600000) {
  const tempDir = ensureTempDir();
  const now = Date.now();

  try {
    const files = fs.readdirSync(tempDir);
    let deletedCount = 0;

    for (const file of files) {
      if (file === '.gitkeep') continue;

      const filePath = path.join(tempDir, file);
      try {
        const stats = fs.statSync(filePath);
        // 依据最后修改时间判断文件是否过期。
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      } catch (err) {
        console.error('Error cleaning up file:', filePath, err);
      }
    }

    if (deletedCount > 0) {
      console.log(`Cleaned up ${deletedCount} old temporary files`);
    }
  } catch (err) {
    console.error('Error during cleanup:', err);
  }
}

// 定时回收过期临时文件，防止音频提取任务长期运行后占满磁盘。
const cleanupTimer = setInterval(() => cleanupOldFiles(), 3600000);
if (typeof cleanupTimer.unref === 'function') {
  // 允许 Node.js 在没有其他任务时自然退出，不被定时器阻塞。
  cleanupTimer.unref();
}

module.exports = {
  extractAudio,
  extractAudioFromUrl,
  cleanupOldFiles,
  ensureTempDir
};
