const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

ffmpeg.setFfmpegPath(ffmpegStatic);

function ensureTempDir() {
  const tempDir = path.join(__dirname, '..', config.tempDir);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

async function extractAudio(videoUrl, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoUrl)
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

async function extractAudioFromUrl(videoUrl) {
  const tempDir = ensureTempDir();
  const outputFilename = `${uuidv4()}.mp3`;
  const outputPath = path.join(tempDir, outputFilename);

  try {
    await extractAudio(videoUrl, outputPath);
    return {
      path: outputPath,
      filename: outputFilename
    };
  } catch (error) {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    throw error;
  }
}

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

const cleanupTimer = setInterval(() => cleanupOldFiles(), 3600000);
if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

module.exports = {
  extractAudio,
  extractAudioFromUrl,
  cleanupOldFiles,
  ensureTempDir
};
