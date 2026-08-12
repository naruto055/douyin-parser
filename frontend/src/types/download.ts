import type { MediaType } from './parse'

export interface DownloadRequest {
  type: MediaType
  url: string
  title?: string
}
