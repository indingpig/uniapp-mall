<script setup lang="ts">
import { useUserStore } from '@/stores/modules/user';

const userStore = useUserStore();

userStore.setToken('abc123');
userStore.setUserInfo({
  id: 1,
  username: 'admin',
  nickname: '管理员',
});

console.warn(userStore.isLogin);
console.warn(userStore.token);
console.warn(userStore.userInfo);
</script>

<template>
  <view class="root-container">
    d
  </view>
</template>

<style scoped>
.root-container {
  padding: 5rem 2.5rem;
  text-align: center;
}
</style>
