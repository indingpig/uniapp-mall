export interface RequestOptions {
  url: string;
  method?: UniApp.RequestOptions['method'];
  headers?: Record<string, string>;
  params?: Record<string, any>;
  data?: Record<string, unknown> | unknown[] | string;
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob';
  loading?: boolean;
}

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export interface ResponseError {
  code: number;
  message: string;
  data?: unknown;
}
