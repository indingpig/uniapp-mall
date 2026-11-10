import type { RequestInterceptor } from './type';
import { resolveApiBaseUrl } from '@/utils/server';
import { joinURL } from '../tools';

export const defaultInterceptor: RequestInterceptor = {
  onRequest(config) {
    // 配对/加入后的 server 地址：REST 与 WS 同源，相对路径补全为绝对地址
    // （joiner 的地址来自扫码/手填，owner 的来自配对回填；空串走环境默认不动）
    if (config.url.startsWith('/')) {
      const base = resolveApiBaseUrl();
      if (base)
        config.url = joinURL(base, config.url);
    }
    return config;
  },
};
