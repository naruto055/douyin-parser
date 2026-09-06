const DEFAULT_PARSE_RESULT = {
  // 平台维度用于区分抖音和 B 站，默认仍沿用抖音兼容行为。
  platform: 'douyin',
  source: '',
  // 这些字段用于下载阶段重放请求头和来源地址，不能省略到调用方自己猜。
  shareUrl: '',
  referer: '',
  userAgent: '',
  cookie: '',
  title: '',
  author: '',
  cover: '',
  duration: 0,

  videoUrl: '',
  videoBackupUrls: [],
  videoCodec: '',
  videoFormat: '',
  videoWidth: 0,
  videoHeight: 0,
  videoBitRate: 0,
  videoSource: '',
  videoExpiresAt: 0,
  videoWatermarkRisk: false,
  videoMimeType: '',

  video265Url: '',
  video265BackupUrls: [],
  video265Codec: '',
  video265Format: '',
  video265Width: 0,
  video265Height: 0,
  video265BitRate: 0,
  video265Source: '',

  audioUrl: '',
  audioBackupUrls: [],
  audioType: '',
  audioTitle: '',
  audioAuthor: '',
  audioReady: false,
  audioMimeType: '',
  audioFormat: '',

  // B 站视频是音视频分离流，下载前需要显式走合并逻辑。
  requiresMuxing: false,
  bilibili: null,

  puppeteerDiagnostics: null,
  fallbackReason: ''
};

function normalizeString(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === 'string' && item.trim());
}

function normalizeParseResult(result = {}) {
  const normalized = {
    ...DEFAULT_PARSE_RESULT,
    ...result
  };

  normalized.platform = normalizeString(normalized.platform) || 'douyin';
  // 只保留字符串和基础数值，避免服务层拿到半结构化对象后继续分支判断。
  normalized.source = normalizeString(normalized.source);
  normalized.shareUrl = normalizeString(normalized.shareUrl);
  normalized.referer = normalizeString(normalized.referer);
  normalized.userAgent = normalizeString(normalized.userAgent);
  normalized.cookie = normalizeString(normalized.cookie);
  normalized.title = normalizeString(normalized.title);
  normalized.author = normalizeString(normalized.author);
  normalized.cover = normalizeString(normalized.cover);
  normalized.duration = normalizeNumber(normalized.duration);

  normalized.videoUrl = normalizeString(normalized.videoUrl);
  normalized.videoBackupUrls = normalizeStringArray(normalized.videoBackupUrls);
  normalized.videoCodec = normalizeString(normalized.videoCodec);
  normalized.videoFormat = normalizeString(normalized.videoFormat);
  normalized.videoWidth = normalizeNumber(normalized.videoWidth);
  normalized.videoHeight = normalizeNumber(normalized.videoHeight);
  normalized.videoBitRate = normalizeNumber(normalized.videoBitRate);
  normalized.videoSource = normalizeString(normalized.videoSource);
  normalized.videoExpiresAt = normalizeNumber(normalized.videoExpiresAt);
  normalized.videoWatermarkRisk = normalized.videoWatermarkRisk === true;
  normalized.videoMimeType = normalizeString(normalized.videoMimeType);

  normalized.video265Url = normalizeString(normalized.video265Url);
  normalized.video265BackupUrls = normalizeStringArray(normalized.video265BackupUrls);
  normalized.video265Codec = normalizeString(normalized.video265Codec);
  normalized.video265Format = normalizeString(normalized.video265Format);
  normalized.video265Width = normalizeNumber(normalized.video265Width);
  normalized.video265Height = normalizeNumber(normalized.video265Height);
  normalized.video265BitRate = normalizeNumber(normalized.video265BitRate);
  normalized.video265Source = normalizeString(normalized.video265Source);

  normalized.audioUrl = normalizeString(normalized.audioUrl);
  normalized.audioBackupUrls = normalizeStringArray(normalized.audioBackupUrls);
  normalized.audioType = normalizeString(normalized.audioType);
  normalized.audioTitle = normalizeString(normalized.audioTitle);
  normalized.audioAuthor = normalizeString(normalized.audioAuthor);
  normalized.audioReady = Boolean(normalized.audioReady || normalized.audioUrl);
  normalized.audioMimeType = normalizeString(normalized.audioMimeType);
  normalized.audioFormat = normalizeString(normalized.audioFormat);

  normalized.requiresMuxing = normalized.requiresMuxing === true;
  normalized.bilibili = normalized.bilibili || null;

  normalized.puppeteerDiagnostics = normalized.puppeteerDiagnostics || null;
  normalized.fallbackReason = normalizeString(normalized.fallbackReason);

  return normalized;
}

module.exports = {
  DEFAULT_PARSE_RESULT,
  normalizeParseResult
};
