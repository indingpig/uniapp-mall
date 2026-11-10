import { CACHE_KEY } from '@/constants/cache';
import { storage } from '@/utils/storage';

/**
 * server 地址单一解析口：已配对/加入的地址优先（PAIRED_SERVER_URL），
 * 环境变量兜底（开发默认 / H5 vite 代理）。
 * 家庭共享（2026-11-10 决策）：家人手机不配对设备，直接写入 PAIRED_SERVER_URL
 * 即成为「观众」，WS 与 REST 同源解析。
 */
export function resolveServerUrl(): string {
  return storage.get<string>(CACHE_KEY.PAIRED_SERVER_URL) || import.meta.env.VITE_WS_URL || '';
}

/** REST 基址：ws(s)://host:port/ws → http(s)://host:port；空串=走环境默认 */
export function resolveApiBaseUrl(): string {
  const url = resolveServerUrl();
  if (!url)
    return '';
  return url.replace(/^ws(s):\/\//i, 'http$1://').replace(/\/ws\/?$/i, '');
}

/** server 地址格式校验（与固件改进点 3 的校验口径对齐：前缀 + 长度） */
export function isValidServerUrl(url: string): boolean {
  return /^wss?:\/\/.+/i.test(url) && url.length <= 100;
}
