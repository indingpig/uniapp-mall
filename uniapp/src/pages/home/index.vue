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
      class="main px-5 gap-3"
      :style="{ paddingTop: `${capsuleTopGap}px` }"
    >
      <!-- 头部：问候语 + 设备在线徽章 -->
      <view class="header flex items-center justify-between">
        <text class="header__greeting text-main font-bold">{{ greeting }}，{{ userName }}</text>
        <view v-if="status.isOnline" class="badge flex items-center gap-1 rounded-pill">
          <view class="badge__dot rounded-full bg-primary" />
          <text class="badge__text text-primary font-medium">设备在线</text>
        </view>
      </view>

      <!-- 当前状态卡片 -->
      <view class="card card--status bg-card rounded-lg">
        <text class="card__eyebrow block text-center text-secondary mb-2">当前状态</text>
        <view class="status-icon mx-auto mb-3 flex items-center justify-center">
          <image
            class="status-icon__img w-full h-full"
            :src="getIcon((status.iconKey as IconKey))"
            mode="aspectFit"
          />
        </view>
        <text class="card__title font-semibold text-center" :style="{ color: status.iconColor }">
          {{ status.statusText }}
        </text>
        <text class="card__subtitle block text-center text-secondary">已持续 {{ durationText }}</text>
      </view>

      <!-- 实时音量卡片 -->
      <view class="card bg-card rounded-lg">
        <view class="flex items-baseline justify-between">
          <text class="card__title font-semibold text-left text-main">实时音量</text>
          <text class="volume-value font-semibold text-primary">{{ volume.db }} dB</text>
        </view>
        <view class="progress mt-3 h-2 rounded-pill bg-primary-soft overflow-hidden">
          <view
            class="progress__fill h-full bg-primary rounded-pill"
            :style="{ width: `${volumePercent}%` }"
          />
        </view>
        <text class="card__hint block text-secondary mt-2">音量正常范围内</text>
      </view>

      <!-- 设备信息卡片 -->
      <view class="card card--device bg-card rounded-lg flex items-center">
        <view class="device-icon flex items-center justify-center shrink-0">
          <image class="device-icon__img w-full h-full" :src="getIcon('lock')" mode="aspectFit" />
        </view>
        <view class="device-info flex-1">
          <text class="card__title font-semibold text-left text-main">{{ device.name }}</text>
          <text class="card__hint card__hint--row block text-secondary">{{ device.connectionText }}</text>
        </view>
        <text class="device-battery text-primary font-bold shrink-0">{{ device.batteryPercent }}%</text>
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
  padding-top: 12rpx;
}

/* ------------------------------------------------------------------ */
/*  头部                                                                */
/* ------------------------------------------------------------------ */
.header {
  padding: 20rpx 0 16rpx;

  &__greeting {
    font-size: 44rpx;
    letter-spacing: 1rpx;
  }
}

.badge {
  padding: 8rpx 18rpx;
  background-color: rgba(126, 162, 121, 0.12);

  &__dot {
    width: 12rpx;
    height: 12rpx;
  }

  &__text {
    font-size: 24rpx;
  }
}

/* ------------------------------------------------------------------ */
/*  卡片通用                                                            */
/* ------------------------------------------------------------------ */
.card {
  padding: 36rpx 32rpx;
  box-shadow: 0 4rpx 24rpx rgba(60, 50, 30, 0.04);

  &__eyebrow {
    font-size: 28rpx;
  }

  &__title {
    font-size: 32rpx;
    line-height: 1.2;
  }

  &__subtitle {
    margin-top: 12rpx;
    font-size: 28rpx;
  }

  &__hint {
    margin-top: 16rpx;
    font-size: 24rpx;

    &--row {
      margin-top: 6rpx;
    }
  }
}

.card--status {
  padding: 40rpx 32rpx 48rpx;
}

.status-icon {
  width: 180rpx;
  height: 180rpx;
  margin-top: 12rpx;
}

/* ------------------------------------------------------------------ */
/*  音量卡片                                                            */
/* ------------------------------------------------------------------ */
.volume-value {
  font-size: 32rpx;
}

.progress__fill {
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

/* ------------------------------------------------------------------ */
/*  设备卡片                                                            */
/* ------------------------------------------------------------------ */
.card--device {
  gap: 20rpx;
  padding: 28rpx 32rpx;
}

.device-icon {
  width: 56rpx;
  height: 56rpx;
}

.device-info {
  min-width: 0;
}

.device-battery {
  font-size: 36rpx;
}
</style>
