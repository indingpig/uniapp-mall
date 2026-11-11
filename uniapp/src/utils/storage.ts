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

/**
 * 清除本机的设备配对与服务器地址记录（设置页「删除设备」用）。
 * 只删 App 端记录：设备 NVS 凭据不受影响（恢复出厂只能走设备 BOOT 长按 10s
 * 硬件手势），server 侧记录待设备注册表立项后再联动（todolist v1.2）。
 */
export function clearPairingRecords(): void {
  uni.removeStorageSync(CACHE_KEY.PAIRED_DEVICE);
  uni.removeStorageSync(CACHE_KEY.PAIRED_SERVER_URL);
}
