import type { RequestFactoryConfig, RequestInstance, RequestOptions } from './type';
import type { ApiResponse } from '@/api/type';
import { clearFamilyIdentity, getFamilyRole } from '@/utils/family';
import { joinURL } from '../tools';
import { requestConfig } from './config';

/* ================================================================== */
/*  全局 401 收敛（方案-接口状态码与业务码设计.md §3）                    */
/* ================================================================== */

/** 无身份时仍允许发出的开放端点（server 侧同样豁免鉴权） */
const OPEN_API_PATTERNS = [
  /^\/api\/health$/,
  /^\/api\/family\/claim$/,
  /^\/api\/family\/join$/,
  /^\/api\/family\/invites\/[^/]+\/accept$/,
  // 账号体系（2026-11-28 登录/注册页，规范 5.6）：登录前无任何身份，天然开放
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/register$/,
];

/** 401 清身份去重窗口：轮询类调用（设置页 5s/首页兜底）失败时只收敛一次 */
let lastAuthResetAt = 0;

function handleUnauthorized(): void {
  if (getFamilyRole() === 'none' || Date.now() - lastAuthResetAt < 10_000)
    return;
  lastAuthResetAt = Date.now();
  clearFamilyIdentity();
  uni.showToast({ title: '登录已失效，请重新认领或扫码加入', icon: 'none' });
  setTimeout(() => uni.reLaunch({ url: '/pages/home/index' }), 600);
}

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

    // 拦截器可能已把相对路径补成绝对地址（见 interceptor.ts 的 resolveApiBaseUrl）。
    // 此处必须跳过 baseURL，否则会拼成 http://<baseURL>/http://<真实地址>/api/...
    // ——H5 dev 的 VITE_API_BASE_URL 为空所以看不出来，打包进 App 才暴露（2026-11-19 实踩）
    const isAbsolute = /^https?:\/\//i.test(finalOptions.url);
    const targetUrl = isAbsolute ? finalOptions.url : joinURL(baseURL, finalOptions.url);

    // 无身份不发受保护请求（本地快速失败，省一次注定 401 的往返）。
    // 注意用字符串切片取 path 而非 new URL()：App 端 JS 引擎不保证有完整 WHATWG URL
    if (!finalOptions.headers?.['X-Family-Token']) {
      const idx = targetUrl.indexOf('/api');
      const path = idx >= 0 ? targetUrl.slice(idx) : '';
      if (path && !OPEN_API_PATTERNS.some(p => p.test(path))) {
        throw new Error('请先配对认领或扫码加入家庭共享');
      }
    }

    return new Promise((resolve, reject) => {
      uni.request({
        url: targetUrl,
        method: finalOptions.method || 'GET',
        header: finalOptions.headers,
        timeout: finalOptions.timeout,
        data: finalOptions.data,
        success: async (res) => {
          try {
            // HTTP 状态码检查：uni.request 只要服务器有响应（401/500 等）也走 success，
            // 不查状态码会把鉴权 401 的错误体当成功数据 resolve 出去——2026-11-28 实证：
            // /api/baby/device 收到 401 后调用方拿到 res.data.data = undefined，
            // 塞进 settings 页 device.value 直接炸渲染白屏。上线鉴权后 401 是常态分支，
            // 必须在这里统一转 reject，让各调用方的 catch 接住。
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const body = res.data as ApiResponse<T> | undefined;
              const err = new Error(body?.message || `HTTP ${res.statusCode}`) as Error & {
                statusCode: number;
                data?: unknown;
              };
              err.statusCode = res.statusCode;
              err.data = body;
              // 全局 401：身份失效（被移出/解散/服务端注册表重置）→ 清本地身份并
              // 引导重新认领或加入（复用 familyChanged 广播的收敛语义）
              if (res.statusCode === 401) {
                handleUnauthorized();
              }
              if (interceptors?.onResponseError) {
                reject(await interceptors.onResponseError(err));
              }
              else {
                reject(err);
              }
              return;
            }
            const result = res.data as ApiResponse<T>;
            // 业务码统一检查——两层错误通道的客户端收敛：
            //   HTTP 状态码 = 传输/鉴权层语义（上面已拦截非 2xx → reject）
            //   body.code   = 业务层语义（0 成功；非 0 失败，message 为中文文案）
            // 服务端契约「2xx 必 code:0」已全量核对（baby/family/history/stats，
            // 业务失败一律走 4xx + code:1），这里把隐含约定变成客户端硬契约：
            // **resolve 必有 data**，调用方无需再各自查 code
            // （family.ts 的 unwrap 因此变冗余但无害；2026-11-28 白屏事故的永久闭环）
            if (result && typeof result === 'object' && 'code' in result && result.code !== 0) {
              reject(new Error(result.message || '请求失败'));
              return;
            }
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
