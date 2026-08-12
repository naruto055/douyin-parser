export interface ParseRequest {
  url: string
}

export interface ParseResult {
  source: string
  title: string
  author: string
  cover: string
  duration: number
  videoUrl: string
  videoBackupUrls?: string[]
  videoCodec?: string
  videoFormat?: string
  videoWidth?: number
  videoHeight?: number
  videoBitRate?: number
  videoSource?: string
  videoExpiresAt?: number
  videoWatermarkRisk?: boolean
  video265Url?: string
  video265BackupUrls?: string[]
  video265Codec?: string
  audioUrl?: string
  audioBackupUrls?: string[]
  audioType?: string
  audioTitle?: string
  audioAuthor?: string
  audioReady: boolean
  shareUrl: string
}

export type MediaType = 'video' | 'audio'
