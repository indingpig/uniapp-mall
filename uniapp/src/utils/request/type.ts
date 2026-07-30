import type { ApiResponse } from '@/api/type';

export type RequestData = Record<string, unknown> | unknown[] | string;
export interface RequestOptions {
  url: string;
  method?: UniApp.RequestOptions['method'];
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  data?: RequestData;
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob';
  loading?: boolean;
}

/** 请求拦截器 */
export interface RequestInterceptor {
  onRequest?: (
    config: RequiredByKey<RequestOptions, 'url'>,
  ) => RequiredByKey<RequestOptions, 'url'> | Promise<RequiredByKey<RequestOptions, 'url'>>;
  onRequestError?: (error: unknown) => Promise<never>;
  onResponse?: <T = unknown>(
    response: ApiResponse<T>,
  ) => ApiResponse<T> | Promise<ApiResponse<T>>;
  onResponseError?: (error: unknown) => Promise<unknown>;
}

/** 工厂函数配置 */
export interface RequestFactoryConfig {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  interceptors?: RequestInterceptor;
}

/** 请求实例 */
export interface RequestInstance {
  request: <T = unknown>(options: RequestOptions) => Promise<ApiResponse<T>>;
  get: <T = unknown>(url: string, params?: Record<string, unknown>) => Promise<ApiResponse<T>>;
  post: <T = unknown>(url: string, data?: RequestData) => Promise<ApiResponse<T>>;
  put: <T = unknown>(url: string, data?: RequestData) => Promise<ApiResponse<T>>;
  delete: <T = unknown>(url: string, params?: Record<string, unknown>) => Promise<ApiResponse<T>>;
}

/** 将指定 key 变为必填 */
type RequiredByKey<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
