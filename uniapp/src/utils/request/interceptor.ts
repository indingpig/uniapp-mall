import type { RequestInterceptor } from './type';
import { familyTokenHeader } from '@/utils/family';
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
    // 家人身份令牌统一注入（2026-11-26 上公网加固）：
    // server 的业务端点全部要求有效 token，这里兜住所有 api/*，
    // 避免每个调用点各写一遍 header 而漏配。
    // 显式传入的同名 header 优先（family.ts 已自带，不会冲突）。
    const tokenHeader = familyTokenHeader();
    if (tokenHeader['X-Family-Token']) {
      config.headers = { ...tokenHeader, ...(config.headers || {}) };
    }
    return config;
  },
};
