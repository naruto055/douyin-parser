import type { ApiError, ApiResponse, HealthData } from '@/types/api'

const DEFAULT_BASE_URL = import.meta.env.DEV ? 'http://localhost:3000' : ''
const DEFAULT_TIMEOUT = 30000

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')

type RequestData = NonNullable<UniApp.RequestOptions['data']>

export interface RequestOptions<TData extends RequestData = AnyObject> {
  url: string
  method?: UniApp.RequestOptions['method']
  data?: TData
  header?: Record<string, string>
  timeout?: number
}

function normalizeError(error: unknown): ApiError {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return error as ApiError
  }

  return {
    message: '请求失败，请稍后重试',
    detail: error,
  }
}

export function request<TResponse, TData extends RequestData = AnyObject>(
  options: RequestOptions<TData>,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${API_BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      timeout: options.timeout || DEFAULT_TIMEOUT,
      header: {
        'Content-Type': 'application/json',
        ...options.header,
      },
      success(response) {
        const statusCode = response.statusCode
        const body = response.data as ApiResponse<TResponse> | undefined

        if (statusCode < 200 || statusCode >= 300) {
          reject({
            message: body?.message || `请求异常，状态码：${statusCode}`,
            statusCode,
            code: body?.code,
            detail: body,
          } satisfies ApiError)
          return
        }

        if (!body || typeof body.code !== 'number') {
          reject({
            message: '后端响应格式异常',
            statusCode,
            detail: response.data,
          } satisfies ApiError)
          return
        }

        if (body.code !== 200) {
          reject({
            message: body.message || '业务处理失败',
            statusCode,
            code: body.code,
            detail: body.data,
          } satisfies ApiError)
          return
        }

        resolve(body.data)
      },
      fail(error) {
        reject(normalizeError(error))
      },
    })
  })
}

export function getHealth() {
  return request<HealthData>({
    url: '/api/health',
  })
}
