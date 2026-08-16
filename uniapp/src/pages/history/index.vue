<script setup lang="ts">
import { useCapsuleGap } from '@/hooks/useCapsuleGap';

const { capsuleTopGap } = useCapsuleGap();
</script>

<template>
  <view class="page h-full">
    <view class="main" :style="{ paddingTop: `${capsuleTopGap}px` }">
      <text class="title">历史记录</text>
      <text class="placeholder">暂无历史数据</text>
    </view>
  </view>
</template>

<style lang="scss">
.page {
  height: 100%;
}
</style>

<style lang="scss" scoped>
.page {
  @include page-layout;
  /* padding-bottom: env(safe-area-inset-bottom); */
}

.main {
  @include main-layout;
  padding: 0 40rpx;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
}

.title {
  @include empty-title;
}

.placeholder {
  @include empty-desc;
}
</style>
