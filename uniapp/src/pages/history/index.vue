<script setup lang="ts">
import { useCapsuleGap } from '@/hooks/useCapsuleGap';

const { capsuleTopGap } = useCapsuleGap();
</script>

<template>
  <view class="page h-full">
    <view class="main px-5 gap-3 items-center justify-center" :style="{ paddingTop: `${capsuleTopGap}px` }">
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
}

.title {
  @include empty-title;
}

.placeholder {
  @include empty-desc;
}
</style>
