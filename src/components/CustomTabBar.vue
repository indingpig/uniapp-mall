<script setup lang="ts">
import type { IconKey } from '@/utils/icons';
import { getIcon } from '@/utils/icons';

defineProps<{
  current: string;
}>();

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
  <view class="tab-bar">
    <view
      v-for="tab in TABS"
      :key="tab.key"
      class="tab"
      :class="{ 'tab--active': current === tab.key }"
      @tap="onTap(tab.key)"
    >
      <image
        class="tab__icon"
        :src="getIcon(tab.icon, current === tab.key ? '#ffffff' : '#1f1f1f')"
        mode="aspectFit"
      />
      <text
        class="tab__label"
        :class="{ 'tab__label--active': current === tab.key }"
      >
        {{ tab.label }}
      </text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.tab-bar {
  position: fixed;
  left: 32rpx;
  right: 32rpx;
  bottom: calc(24rpx + env(safe-area-inset-bottom));
  height: 112rpx;
  background-color: $color-card;
  border-radius: 56rpx;
  display: flex;
  align-items: center;
  padding: 0 12rpx;
  box-shadow: 0 12rpx 32rpx rgba(60, 50, 30, 0.08);
  z-index: 10;
}

.tab {
  flex: 1;
  height: 88rpx;
  border-radius: 44rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  transition: background-color 0.25s ease;

  &__icon {
    width: 36rpx;
    height: 36rpx;
  }

  &__label {
    font-size: 22rpx;
    color: $color-text-primary;

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
