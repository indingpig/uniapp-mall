export const storage = {
  set(key: string, value: unknown): void {
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
