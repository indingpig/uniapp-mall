<script setup lang="ts">
import type { BLEDevice } from '@/hooks/useBLE';
import { ref } from 'vue';
import { useBLE } from '@/hooks/useBLE';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';

const {
  scanning,
  devices,
  connectedDevice,
  statusText,
  paired,
  deviceInfo,
  startScan,
  connectDevice,
  pair,
  close,
} = useBLE();

// #ifdef H5
const bleNotSupported = true;
// #else
const bleNotSupported = false;
// #endif

const { capsuleTopGap } = useCapsuleGap();

const currentStep = ref<'scan' | 'wifi' | 'pairing' | 'done'>('scan');
const wifiSSID = ref('');
const wifiPass = ref('');
const serverUrl = ref('ws://192.168.3.5:3001/ws?esp32');

async function onSelectDevice(device: BLEDevice) {
  try {
    const dev = await connectDevice(device);
    currentStep.value = 'wifi';
  }
  catch {
    // connectDevice 已设置 statusText
  }
}

async function onStartPair() {
  if (!wifiSSID.value) {
    statusText.value = '请输入 WiFi 名称';
    return;
  }
  currentStep.value = 'pairing';
  const result = await pair(wifiSSID.value, wifiPass.value, serverUrl.value);
  if (result.success) {
    currentStep.value = 'done';
  }
}

function onDone() {
  uni.navigateBack();
}

function onRescan() {
  close();
  currentStep.value = 'scan';
  connectedDevice.value = null;
  paired.value = false;
  startScan();
}
</script>

<template>
  <view class="page flex flex-col bg-page">
    <view
      class="main"
      :style="{ paddingTop: `${capsuleTopGap}px` }"
    >
      <!-- ========= 标题栏 ========= -->
      <view class="navbar p-3 px-5">
        <text class="navbar__title font-bold text-main">设备配对</text>
      </view>

      <!-- ========= H5 不支持提示 ========= -->
      <view v-if="bleNotSupported" class="empty">
        <text class="empty__title">当前平台不支持蓝牙</text>
        <text class="empty__desc">请使用 Android/iOS App 或微信小程序进行配对</text>
      </view>

      <!-- ========= 状态提示 ========= -->
      <view class="status-bar flex items-center gap-2 mx-5 mb-3 px-3 rounded-md bg-card">
        <view class="status-bar__dot w-2 h-2 rounded-full shrink-0" :class="{ 'status-bar__dot--active': scanning || currentStep === 'pairing' }" />
        <text class="status-bar__text text-secondary">{{ statusText }}</text>
      </view>
      <text class="status-bar__text text-secondary">{{ statusText }}</text>
      <input v-model="wifiSSID" class="form__input w-full h-10 px-3 rounded-md bg-card text-base text-main" placeholder="WiFi 名称">
      <!-- ========= 扫描阶段 ========= -->
      <template v-if="currentStep === 'scan' && !bleNotSupported">
        <view v-if="!scanning && devices.length === 0" class="empty">
          <text class="empty__desc">点击下方按钮扫描附近的宝宝监护器设备</text>
        </view>

        <view v-if="devices.length > 0" class="section px-5 pb-3">
          <text class="section__title">发现的设备</text>
          <view
            v-for="dev in devices"
            :key="dev.deviceId"
            class="device-card justify-between mx-5 mb-2"
            @tap="onSelectDevice(dev)"
          >
            <view class="device-card__left">
              <text class="device-card__name">{{ dev.name }}</text>
              <text class="device-card__rssi">信号强度: {{ dev.RSSI }} dBm</text>
            </view>
            <text class="device-card__arrow">›</text>
          </view>
        </view>

        <view class="bottom-btn">
          <button
            class="btn btn--primary"
            :disabled="scanning"
            @tap="scanning ? undefined : startScan()"
          >
            {{ scanning ? '扫描中...' : '开始扫描' }}
          </button>
        </view>
      </template>

      <!-- ========= WiFi 表单阶段 ========= -->
      <template v-if="currentStep === 'wifi'">
        <view class="section px-5 pb-3">
          <text class="section__title">已连接: {{ connectedDevice?.name }}</text>
          <text v-if="Object.keys(deviceInfo).length > 0" class="section__sub block text-secondary mt-1">
            固件版本: {{ deviceInfo.version || '未知' }}
          </text>
        </view>

        <view class="form px-5">
          <view class="form__group">
            <text class="form__label block text-secondary">WiFi 名称 (SSID)</text>
            <input
              v-model="wifiSSID"
              class="form__input w-full h-10 px-3 rounded-md bg-card text-base text-main"
              placeholder="请输入 2.4GHz WiFi 名称"
            >
          </view>

          <view class="form__group">
            <text class="form__label block text-secondary">WiFi 密码</text>
            <input
              v-model="wifiPass"
              class="form__input w-full h-10 px-3 rounded-md bg-card text-base text-main"
              password
              placeholder="请输入 WiFi 密码"
            >
          </view>

          <view class="form__group">
            <text class="form__label block text-secondary">服务器地址</text>
            <input
              v-model="serverUrl"
              class="form__input w-full h-10 px-3 rounded-md bg-card text-base text-main"
              placeholder="ws://192.168.3.5:3001/ws?esp32"
            >
          </view>
        </view>

        <view class="form__hint px-5 text-coral">
          <text>注意：ESP32 仅支持 2.4GHz WiFi, 不支持 5GHz</text>
        </view>

        <view class="bottom-btn">
          <button class="btn btn--secondary" @tap="onRescan">
            返回扫描
          </button>
          <button class="btn btn--primary" @tap="onStartPair">
            开始配对
          </button>
        </view>
      </template>

      <!-- ========= 配对中 ========= -->
      <template v-if="currentStep === 'pairing'">
        <view class="empty">
          <text class="empty__title">正在配网...</text>
          <text class="empty__desc">请稍候, 设备正在连接 WiFi 和服务器</text>
        </view>
      </template>

      <!-- ========= 完成 ========= -->
      <template v-if="currentStep === 'done'">
        <view class="empty">
          <text class="empty__title">配对成功</text>
          <text class="empty__desc">设备已连接到服务器, 可以开始使用了</text>
        </view>
        <view class="bottom-btn">
          <button class="btn btn--primary" @tap="onDone">
            完成
          </button>
        </view>
      </template>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  // @include page-layout;
  // height: 100vh;                // 非 Tab 二级页面用 vh，避免 App 端滚动条
  // padding-bottom: env(safe-area-inset-bottom);
  // overflow-y: visible;
  padding-top: var(--status-bar-height);
}

.main {
  @include main-layout;
}

.navbar {
  &__title {
    font-size: 40rpx;
  }
}

.status-bar {
  padding-top: 20rpx;
  padding-bottom: 20rpx;

  &__dot {
    background-color: #ccc;

    &--active {
      background-color: $color-primary;
      animation: pulse 1.5s infinite;
    }
  }

  &__text {
    font-size: 26rpx;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.empty {
  @include empty-state;
  &__title {
    @include empty-title;
  }
  &__desc {
    @include empty-desc;
  }
}

.section {
  &__title {
    @include section-title;
    font-size: $font-size-base;
  }

  &__sub {
    font-size: 24rpx;
  }
}

.device-card {
  @include list-card;

  &__left {
    @include list-card-body;
  }
  &__name {
    @include list-card-label;
  }
  &__rssi {
    @include list-card-desc;
  }
  &__arrow {
    @include list-card-arrow;
    font-size: 40rpx;
  }
}

.form {
  &__group {
    margin-bottom: 28rpx;
  }
  &__label {
    font-size: 26rpx;
    margin-bottom: 12rpx;
  }
  &__hint {
    font-size: 24rpx;
    margin-top: -8rpx;
  }
}

.bottom-btn {
  @include btn-row;
}

.btn {
  flex: 1;
  @include btn-base;
  &--primary {
    @include btn-primary;
  }
  &--secondary {
    @include btn-secondary;
  }
  &[disabled] {
    @include btn-disabled;
  }
}
</style>
