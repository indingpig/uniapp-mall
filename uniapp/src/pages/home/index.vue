<script setup lang="ts">
import type { IconKey } from '@/utils/icons';
import { computed, onMounted, ref } from 'vue';
import { useBabyMonitor } from '@/hooks/useBabyMonitor';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';
import { getIcon } from '@/utils/icons';

/* ------------------------------------------------------------------ */
/*  服务端数据                                                          */
/* ------------------------------------------------------------------ */

const { status, volume, device, durationSec } = useBabyMonitor();

/* ------------------------------------------------------------------ */
/*  本地数据                                                            */
/* ------------------------------------------------------------------ */

const greeting = ref<string>('晚上好');
const userName = ref<string>('Sheldon');
const { capsuleTopGap } = useCapsuleGap();
const MAX_DB = 100;

/* ------------------------------------------------------------------ */
/*  计算属性                                                            */
/* ------------------------------------------------------------------ */

const volumePercent = computed<number>(() =>
  Math.min(100, Math.round((volume.value.db / MAX_DB) * 100)),
);

const durationText = computed<string>(() => formatDuration(durationSec.value));

/* ------------------------------------------------------------------ */
/*  方法                                                                */
/* ------------------------------------------------------------------ */

function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

function buildGreeting(): string {
  const h = new Date().getHours();
  if (h < 6)
    return '凌晨好';
  if (h < 11)
    return '早上好';
  if (h < 13)
    return '中午好';
  if (h < 18)
    return '下午好';
  return '晚上好';
}

/* ------------------------------------------------------------------ */
/*  生命周期                                                            */
/* ------------------------------------------------------------------ */

onMounted(() => {
  greeting.value = buildGreeting();
});
</script>

<template>
  <view class="page h-full">
    <!-- ============== 主体内容 ============== -->
    <view
      class="main"
      :style="{ paddingTop: `${capsuleTopGap}px` }"
    >
      <!-- 头部：问候语 + 设备在线徽章 -->
      <view class="header">
        <text class="header__greeting">{{ greeting }}，{{ userName }}</text>
        <view v-if="status.isOnline" class="badge">
          <view class="badge__dot" />
          <text class="badge__text">设备在线</text>
        </view>
      </view>

      <!-- 当前状态卡片 -->
      <view class="card card--status">
        <text class="card__eyebrow">当前状态</text>
        <view class="status-icon">
          <image
            class="status-icon__img"
            :src="getIcon((status.iconKey as IconKey))"
            mode="aspectFit"
          />
        </view>
        <text class="card__title" :style="{ color: status.iconColor }">
          {{ status.statusText }}
        </text>
        <text class="card__subtitle">已持续 {{ durationText }}</text>
      </view>

      <!-- 实时音量卡片 -->
      <view class="card card--volume">
        <view class="row-between">
          <text class="card__title card__title--dark">实时音量</text>
          <text class="volume-value">{{ volume.db }} dB</text>
        </view>
        <view class="progress">
          <view
            class="progress__fill"
            :style="{ width: `${volumePercent}%` }"
          />
        </view>
        <text class="card__hint">音量正常范围内</text>
      </view>

      <!-- 设备信息卡片 -->
      <view class="card card--device">
        <view class="device-icon">
          <image class="device-icon__img" :src="getIcon('lock')" mode="aspectFit" />
        </view>
        <view class="device-info">
          <text class="card__title card__title--dark">{{ device.name }}</text>
          <text class="card__hint card__hint--row">{{ device.connectionText }}</text>
        </view>
        <text class="device-battery">{{ device.batteryPercent }}%</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
/* 小程序根元素 — 100vh 在小程序中不准确，用 100% 继承 */
page {
  height: 100%;
}
</style>

<style lang="scss" scoped>
/* ------------------------------------------------------------------ */
/*  页面骨架                                                            */
/* ------------------------------------------------------------------ */
.page {
  @include page-layout;
  /* padding-bottom: env(safe-area-inset-bottom); */
}

/* ------------------------------------------------------------------ */
/*  主体                                                                */
/* ------------------------------------------------------------------ */
.main {
  @include main-layout;
  padding: 12rpx 40rpx 0;
  gap: 24rpx;
}

/* ------------------------------------------------------------------ */
/*  头部                                                                */
/* ------------------------------------------------------------------ */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0 16rpx;

  &__greeting {
    font-size: 44rpx;
    font-weight: 700;
    color: $color-text-primary;
    letter-spacing: 1rpx;
  }
}

.badge {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 8rpx 18rpx;
  background-color: rgba(126, 162, 121, 0.12);
  border-radius: $radius-pill;

  &__dot {
    width: 12rpx;
    height: 12rpx;
    border-radius: 50%;
    background-color: $color-primary;
  }

  &__text {
    font-size: 24rpx;
    color: $color-primary;
    font-weight: 500;
  }
}

/* ------------------------------------------------------------------ */
/*  卡片通用                                                            */
/* ------------------------------------------------------------------ */
.card {
  background-color: $color-card;
  border-radius: $radius-lg;
  padding: 36rpx 32rpx;
  box-shadow: 0 4rpx 24rpx rgba(60, 50, 30, 0.04);

  &__eyebrow {
    display: block;
    text-align: center;
    font-size: 28rpx;
    color: $color-text-secondary;
    margin-bottom: 16rpx;
  }

  &__title {
    font-size: 32rpx;
    font-weight: 600;
    text-align: center;
    line-height: 1.2;

    &--dark {
      color: $color-text-primary;
      text-align: left;
    }
  }

  &__subtitle {
    display: block;
    text-align: center;
    margin-top: 12rpx;
    font-size: 28rpx;
    color: $color-text-secondary;
  }

  &__hint {
    display: block;
    margin-top: 16rpx;
    font-size: 24rpx;
    color: $color-text-secondary;

    &--row {
      margin-top: 6rpx;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  当前状态卡片                                                        */
/* ------------------------------------------------------------------ */
.card--status {
  padding: 40rpx 32rpx 48rpx;
}

.status-icon {
  width: 180rpx;
  height: 180rpx;
  margin: 12rpx auto 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;

  &__img {
    width: 100%;
    height: 100%;
  }
}

/* ------------------------------------------------------------------ */
/*  音量卡片                                                            */
/* ------------------------------------------------------------------ */
.row-between {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.volume-value {
  font-size: 32rpx;
  font-weight: 600;
  color: $color-primary;
}

.progress {
  margin-top: 24rpx;
  height: 16rpx;
  border-radius: $radius-pill;
  background-color: $color-primary-soft;
  overflow: hidden;

  &__fill {
    height: 100%;
    background-color: $color-primary;
    border-radius: $radius-pill;
    transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  }
}

/* ------------------------------------------------------------------ */
/*  设备卡片                                                            */
/* ------------------------------------------------------------------ */
.card--device {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 28rpx 32rpx;
}

.device-icon {
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &__img {
    width: 100%;
    height: 100%;
  }
}

.device-info {
  flex: 1;
  min-width: 0;
}

.device-battery {
  font-size: 36rpx;
  font-weight: 700;
  color: $color-primary;
  flex-shrink: 0;
}
</style>
