const DEFAULT_PARSE_RESULT = {
  source: '',
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

  normalized.source = normalizeString(normalized.source);
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

  normalized.puppeteerDiagnostics = normalized.puppeteerDiagnostics || null;
  normalized.fallbackReason = normalizeString(normalized.fallbackReason);

  return normalized;
}

module.exports = {
  DEFAULT_PARSE_RESULT,
  normalizeParseResult
};
