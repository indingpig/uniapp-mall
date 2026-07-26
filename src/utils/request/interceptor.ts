import type { RequestInterceptor } from './type';
import { CACHE_KEY } from '@/constants/cache';
import { storage } from '@/utils/storage';

export const defaultInterceptor: RequestInterceptor = {
  onRequest(config) {
    const token = storage.get<string>(CACHE_KEY.TOKEN);
    if (token) {
      config.headers = {
        ...config.headers,
        Authorization: `Bearer ${token}`,
      };
    }
    return config;
  },

  onResponse(response) {
    if (response.code === 401) {
      storage.remove(CACHE_KEY.TOKEN);
      storage.remove(CACHE_KEY.USER_INFO);
      uni.reLaunch({ url: '/pages/login/index' });
    }
    return response;
  },
};
