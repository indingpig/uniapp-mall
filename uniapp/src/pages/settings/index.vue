<script setup lang="ts">
</script>

<template>
  <view class="page">
    <view class="main">
      <text class="title">设置</text>
      <text class="placeholder">暂无设置项</text>
    </view>
  </view>
</template>

<style lang="scss">
page {
  height: 100%;
  overflow: hidden;
}
</style>

<style lang="scss" scoped>
.page {
  height: 100%;
  background-color: $color-bg;
  padding-top: var(--status-bar-height);
  /* padding-bottom: env(safe-area-inset-bottom); */
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.main {
  flex: 1;
  padding: 12rpx 40rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
}

.title {
  font-size: $font-size-lg;
  font-weight: 600;
  color: $color-text-primary;
}

.placeholder {
  font-size: $font-size-base;
  color: $color-text-secondary;
}
</style>
