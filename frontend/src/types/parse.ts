export type Platform = 'douyin' | 'bilibili'

export interface BilibiliMetadata {
  bvid?: string
  aid?: number
  cid?: number
  page?: number
  part?: string
  quality?: number
}

export interface ParseRequest {
  url: string
}

export interface ParseResult {
  platform?: Platform
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
  videoMimeType?: string
  video265Url?: string
  video265BackupUrls?: string[]
  video265Codec?: string
  audioUrl?: string
  audioBackupUrls?: string[]
  audioType?: string
  audioTitle?: string
  audioAuthor?: string
  audioReady: boolean
  audioMimeType?: string
  audioFormat?: string
  requiresMuxing?: boolean
  bilibili?: BilibiliMetadata
  shareUrl: string
}

export type MediaType = 'video' | 'audio'
