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
