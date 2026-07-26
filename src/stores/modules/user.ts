import { defineStore } from 'pinia';
import { CACHE_KEY } from '@/constants/cache';
import { storage } from '@/utils/storage';

export interface UserInfo {
  id: number;
  username: string;
  nickname?: string;
}

export const useUserStore = defineStore('user', {
  state: () => ({
    token: storage.get<string>(CACHE_KEY.TOKEN) ?? '',
    userInfo: storage.get<UserInfo>(CACHE_KEY.USER_INFO),
  }),

  getters: {
    isLogin: state => !!state.token,
  },

  actions: {
    setToken(token: string) {
      this.token = token;
      storage.set(CACHE_KEY.TOKEN, token);
    },

    setUserInfo(userInfo: UserInfo | null) {
      this.userInfo = userInfo;
      if (userInfo) {
        storage.set(CACHE_KEY.USER_INFO, userInfo);
      }
      else {
        storage.remove(CACHE_KEY.USER_INFO);
      }
    },

    logout() {
      this.token = '';
      this.userInfo = null;
      storage.remove(CACHE_KEY.TOKEN);
      storage.remove(CACHE_KEY.USER_INFO);
    },

    initFromCache() {
      this.token = storage.get<string>(CACHE_KEY.TOKEN) ?? '';
      this.userInfo = storage.get<UserInfo>(CACHE_KEY.USER_INFO);
    },
  },
});
