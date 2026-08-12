export interface ApiResponse<TData> {
  code: number
  message: string
  data: TData
}

export interface HealthData {
  timestamp: string
}

export interface ApiError {
  message: string
  statusCode?: number
  code?: string | number
  detail?: unknown
}
