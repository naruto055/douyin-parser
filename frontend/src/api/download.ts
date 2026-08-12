import { API_BASE_URL } from './request'
import type { DownloadRequest } from '@/types/download'

const PUBLIC_DOWNLOAD_BASE_URL = (
  import.meta.env.VITE_PUBLIC_DOWNLOAD_BASE_URL ||
  API_BASE_URL
).replace(/\/$/, '')

export function buildDownloadUrl(params: DownloadRequest): string {
  const query = [
    `type=${encodeURIComponent(params.type)}`,
    `url=${encodeURIComponent(params.url)}`,
  ]

  if (params.title) {
    query.push(`title=${encodeURIComponent(params.title)}`)
  }

  return `${PUBLIC_DOWNLOAD_BASE_URL}/api/download?${query.join('&')}`
}

export function hasPublicDownloadBaseUrl(): boolean {
  return Boolean(PUBLIC_DOWNLOAD_BASE_URL)
}
