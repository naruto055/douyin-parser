import { request } from './request'
import type { ParseRequest, ParseResult } from '@/types/parse'

type BackendParseResult = Omit<ParseResult, 'shareUrl'>

export async function parseVideo(params: ParseRequest): Promise<ParseResult> {
  const result = await request<BackendParseResult, ParseRequest>({
    url: '/api/parse',
    method: 'POST',
    data: params,
  })

  return {
    ...result,
    shareUrl: params.url,
  }
}

export async function parseAudio(params: ParseRequest): Promise<ParseResult> {
  const result = await parseVideo(params)

  if (!result.audioReady || !result.audioUrl) {
    throw {
      message: '当前作品未返回可用音频',
      code: 'AUDIO_NOT_READY',
      detail: result,
    }
  }

  return result
}
