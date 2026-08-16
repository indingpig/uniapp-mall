<script setup lang="ts">
import { useCapsuleGap } from '@/hooks/useCapsuleGap';

const { capsuleTopGap } = useCapsuleGap();

function goPairing() {
  uni.navigateTo({ url: '/pages/pairing/index' });
}

function goBLETest() {
  uni.navigateTo({ url: '/pages/ble-test/index' });
}
</script>

<template>
  <view class="page h-full">
    <view class="main" :style="{ paddingTop: `${capsuleTopGap}px` }">
      <view class="section">
        <text class="section__title">设备管理</text>
        <view class="menu-item" @tap="goPairing">
          <text class="menu-item__label">设备配对</text>
          <text class="menu-item__desc">通过蓝牙连接新设备</text>
          <text class="menu-item__arrow">›</text>
        </view>
        <view class="menu-item" @tap="goBLETest">
          <text class="menu-item__label">BLE 串口测试</text>
          <text class="menu-item__desc">蓝牙收发调试工具</text>
          <text class="menu-item__arrow">›</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
page {
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
  gap: 32rpx;
}

.section {
  &__title {
    @include section-title;
    padding-left: 4rpx;
    margin-bottom: 16rpx;
  }
}

.menu-item {
  @include list-card;
  flex-wrap: wrap;

  &__label {
    width: 100%;
    @include list-card-label;
  }
  &__desc {
    @include list-card-desc;
  }
  &__arrow {
    @include list-card-arrow;
  }
}
</style>
