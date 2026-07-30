import type { RequestFactoryConfig, RequestInstance, RequestOptions } from './type';
import type { ApiResponse } from '@/api/type';
import { joinURL } from '../tools';
import { requestConfig } from './config';

/**
 * 创建请求实例（工厂函数）
 *
 * @example
 * // 默认实例
 * const http = createRequest();
 *
 * // 带拦截器的实例
 * const http = createRequest({
 *   interceptors: {
 *     onRequest: (config) => { config.headers['Authorization'] = 'Bearer xxx'; return config; },
 *     onResponse: (res) => { if (res.code !== 200) throw res; return res; },
 *   },
 * });
 *
 * // 多实例场景
 * const upload = createRequest({ baseURL: 'https://upload.xxx.com', timeout: 30000 });
 */
export function createRequest(config?: RequestFactoryConfig): RequestInstance {
  const {
    baseURL = requestConfig.baseURL,
    timeout = requestConfig.timeout,
    headers: defaultHeaders = requestConfig.headers,
    interceptors,
  } = config || {};

  async function request<T = unknown>(options: RequestOptions): Promise<ApiResponse<T>> {
    const mergedHeaders = {
      ...defaultHeaders,
      ...options.headers,
    };

    let finalOptions: RequestOptions = {
      ...options,
      headers: mergedHeaders,
      timeout: options.timeout ?? timeout,
    };

    // 请求拦截
    if (interceptors?.onRequest) {
      try {
        finalOptions = await interceptors.onRequest(finalOptions);
      }
      catch (error) {
        if (interceptors?.onRequestError) {
          return interceptors.onRequestError(error);
        }
        throw error;
      }
    }

    return new Promise((resolve, reject) => {
      uni.request({
        url: joinURL(baseURL, finalOptions.url),
        method: finalOptions.method || 'GET',
        header: finalOptions.headers,
        timeout: finalOptions.timeout,
        data: finalOptions.data,
        success: async (res) => {
          try {
            const result = res.data as ApiResponse<T>;
            const finalResult = interceptors?.onResponse
              ? await interceptors.onResponse(result)
              : result;
            resolve(finalResult as ApiResponse<T>);
          }
          catch (error) {
            if (interceptors?.onResponseError) {
              reject(await interceptors.onResponseError(error as UniApp.GeneralCallbackResult));
            }
            else {
              reject(error);
            }
          }
        },
        fail: async (err) => {
          if (interceptors?.onResponseError) {
            reject(await interceptors.onResponseError(err));
          }
          else {
            reject(err);
          }
        },
        complete: () => {},
      });
    });
  }

  return {
    request,

    get<T = unknown>(url: string, params?: Record<string, unknown>): Promise<ApiResponse<T>> {
      return request<T>({ url, method: 'GET', data: params });
    },

    post<T = unknown>(url: string, data?: Record<string, unknown> | unknown[] | string): Promise<ApiResponse<T>> {
      return request<T>({ url, method: 'POST', data });
    },

    put<T = unknown>(url: string, data?: Record<string, unknown> | unknown[] | string): Promise<ApiResponse<T>> {
      return request<T>({ url, method: 'PUT', data });
    },

    delete<T = unknown>(url: string, params?: Record<string, unknown>): Promise<ApiResponse<T>> {
      return request<T>({ url, method: 'DELETE', data: params });
    },
  };
}
