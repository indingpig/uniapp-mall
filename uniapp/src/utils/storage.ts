import { CACHE_KEY } from '@/constants/cache';

export const storage = {
  set<T>(key: string, value: T): void {
    uni.setStorageSync(key, value);
  },
  get<T>(key: string): T | null {
    return uni.getStorageSync(key) ?? null;
  },
  remove(key: string): void {
    uni.removeStorageSync(key);
  },
  clear(): void {
    uni.clearStorageSync();
  },
};

/** 是否存在本地配对/加入记录（首页/设置等空态与设备卡门控的统一口径） */
export function hasLocalPairing(): boolean {
  const paired = uni.getStorageSync(CACHE_KEY.PAIRED_DEVICE);
  return !!(paired && typeof paired === 'object' && paired.name);
}
