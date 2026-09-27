<script setup lang="ts">
import type { IconKey } from '@/utils/icons';
import { getIcon } from '@/utils/icons';

defineProps<{
  current: string;
}>();

// App/H5 端隐藏原生 TabBar（小程序端 custom:true 已自动隐藏）
// #ifdef APP-PLUS || H5
uni.hideTabBar();
// #endif

interface TabItem {
  key: string;
  label: string;
  icon: IconKey;
}

const TABS: readonly TabItem[] = [
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'history', label: '历史', icon: 'clock' },
  { key: 'stats', label: '统计', icon: 'chart' },
  { key: 'settings', label: '设置', icon: 'gear' },
];

function onTap(key: string) {
  uni.switchTab({ url: `/pages/${key}/index` });
}
</script>

<template>
  <view class="tab-bar fixed flex items-center bg-card z-10">
    <view
      v-for="tab in TABS"
      :key="tab.key"
      class="tab flex-1 flex flex-col items-center justify-center"
      :class="{ 'tab--active': current === tab.key }"
      @tap="onTap(tab.key)"
    >
      <image
        class="tab__icon"
        :src="getIcon(tab.icon, current === tab.key ? '#ffffff' : '#1f1f1f')"
        mode="aspectFit"
      />
      <text
        class="tab__label text-xs text-main"
        :class="{ 'tab__label--active': current === tab.key }"
      >
        {{ tab.label }}
      </text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.tab-bar {
  left: 32rpx;
  right: 32rpx;
  bottom: calc(24rpx + env(safe-area-inset-bottom));
  height: 112rpx;
  border-radius: 56rpx;
  padding: 0 12rpx;
  box-shadow: 0 12rpx 32rpx rgba(60, 50, 30, 0.08);
}

.tab {
  height: 88rpx;
  border-radius: 44rpx;
  gap: 4rpx;
  transition: background-color 0.25s ease;

  &__icon {
    width: 36rpx;
    height: 36rpx;
  }

  &__label {
    &--active {
      color: #ffffff;
      font-weight: 500;
    }
  }

  &--active {
    background-color: $color-primary;
  }
}
</style>
