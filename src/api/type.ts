/** 通用业务响应结构 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

/** 业务错误 */
export interface ResponseError {
  code: number;
  message: string;
  data?: unknown;
}
