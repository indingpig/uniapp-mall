<script setup lang="ts">
import type { IconKey } from '@/utils/icons';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { getIcon } from '@/utils/icons';

/* ------------------------------------------------------------------ */
/*  类型定义                                                            */
/* ------------------------------------------------------------------ */

type Status = 'sleeping' | 'awake' | 'crying' | 'playing' | 'offline';

interface BabyStatus {
  status: Status;
  durationSec: number;
  statusText: string;
  iconColor: string;
  iconKey: IconKey;
}

interface DeviceInfo {
  name: string;
  connectionText: string;
  batteryPercent: number;
}

/* ------------------------------------------------------------------ */
/*  状态数据                                                            */
/* ------------------------------------------------------------------ */

const STATUS_MAP: Record<Status, Omit<BabyStatus, 'durationSec'>> = {
  sleeping: { status: 'sleeping', statusText: '正在安睡', iconColor: '#7ea279', iconKey: 'face-cry' },
  awake: { status: 'awake', statusText: '清醒中', iconColor: '#7ea279', iconKey: 'face-cry' },
  crying: { status: 'crying', statusText: '正在哭泣', iconColor: '#d8896a', iconKey: 'face-cry' },
  playing: { status: 'playing', statusText: '在玩耍', iconColor: '#7ea279', iconKey: 'face-cry' },
  offline: { status: 'offline', statusText: '设备离线', iconColor: '#b3b3b3', iconKey: 'face-cry' },
};

/* ------------------------------------------------------------------ */
/*  响应式数据                                                          */
/* ------------------------------------------------------------------ */

const greeting = ref<string>('晚上好');
const userName = ref<string>('Sheldon');
const isOnline = ref<boolean>(true);
const capsuleTopGap = ref<number>(0); // 小程序胶囊避让高度

const baby = ref<BabyStatus>({
  ...STATUS_MAP.crying,
  durationSec: 2 * 60 + 35, // 设计稿：02:35
});

const volume = ref<number>(68); // dB
const MAX_DB = 100; // 进度条映射上限
const device = ref<DeviceInfo>({
  name: '婴儿监护器 Pro',
  connectionText: '已连接 · 信号强',
  batteryPercent: 86,
});

/* ------------------------------------------------------------------ */
/*  计算属性                                                            */
/* ------------------------------------------------------------------ */

const volumePercent = computed<number>(() =>
  Math.min(100, Math.round((volume.value / MAX_DB) * 100)),
);

const durationText = computed<string>(() => formatDuration(baby.value.durationSec));

/* ------------------------------------------------------------------ */
/*  方法                                                                */
/* ------------------------------------------------------------------ */

/** 秒数 -> mm:ss / hh:mm:ss */
function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

/** 问候语：根据本地小时返回「早上好/下午好/晚上好」 */
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

let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  greeting.value = buildGreeting();

  // 小程序胶囊按钮避让：顶栏整体下移，不被胶囊遮挡
  // #ifdef MP-WEIXIN
  try {
    const menuButton = uni.getMenuButtonBoundingClientRect();
    console.warn('menuButton', menuButton.bottom);
    // 胶囊底部到页面顶部的距离 + 额外间距
    capsuleTopGap.value = menuButton.bottom - 23;
  }
  catch {
    // 非微信环境或 API 不可用，保持默认值
  }
  // #endif

  timer = setInterval(() => {
    baby.value = { ...baby.value, durationSec: baby.value.durationSec + 1 };
  }, 1000);
});

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
});
</script>

<template>
  <view class="page">
    <!-- ============== 主体内容 ============== -->
    <view
      class="main"
      :style="{ paddingTop: `${capsuleTopGap}px` }"
    >
      <!-- 头部：问候语 + 设备在线徽章 -->
      <view class="header">
        <text class="header__greeting">{{ greeting }}，{{ userName }}</text>
        <view v-if="isOnline" class="badge">
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
            :src="getIcon(baby.iconKey)"
            mode="aspectFit"
          />
        </view>
        <text class="card__title" :style="{ color: baby.iconColor }">
          {{ baby.statusText }}
        </text>
        <text class="card__subtitle">已持续 {{ durationText }}</text>
      </view>

      <!-- 实时音量卡片 -->
      <view class="card card--volume">
        <view class="row-between">
          <text class="card__title card__title--dark">实时音量</text>
          <text class="volume-value">{{ volume }} dB</text>
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
  overflow: hidden;
}
</style>

<style lang="scss" scoped>
/* ------------------------------------------------------------------ */
/*  页面骨架                                                            */
/* ------------------------------------------------------------------ */
.page {
  height: 100%;
  background-color: $color-bg;
  padding-top: var(--status-bar-height);
  /* padding-bottom: env(safe-area-inset-bottom); */
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

/* ------------------------------------------------------------------ */
/*  主体                                                                */
/* ------------------------------------------------------------------ */
.main {
  flex: 1;
  padding: 12rpx 40rpx 0;
  display: flex;
  flex-direction: column;
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
