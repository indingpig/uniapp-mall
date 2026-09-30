<route lang="json">
{ "layout": "tabbar" }
</route>

<script setup lang="ts">
import type { DeviceData } from '@/api/baby';
import { onShow } from '@dcloudio/uni-app';
import { onMounted, ref } from 'vue';
import { fetchDevice } from '@/api/baby';
import { CACHE_KEY } from '@/constants/cache';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';
import { getIcon } from '@/utils/icons';

const { capsuleTopGap } = useCapsuleGap();

/* ------------------------------------------------------------------ */
/*  设备信息                                                            */
/* ------------------------------------------------------------------ */

const device = ref<DeviceData>({
  name: '婴儿监护器',
  connectionText: '未连接',
  batteryPercent: 0,
  signalStrength: 0,
  isOnline: false,
});

function loadDevice() {
  fetchDevice().then((d) => {
    device.value = d;
  }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/*  监控设置（本地持久化，后端暂无对应接口）                              */
/* ------------------------------------------------------------------ */

interface MonitorSettings {
  cryAlert: boolean;
  sensitivity: string;
  alertVolume: string;
  pushNotify: boolean;
}

const SENSITIVITY_OPTIONS = ['低', '中等', '高'];
const VOLUME_OPTIONS = ['30%', '50%', '70%', '100%'];
const DEFAULT_SETTINGS: MonitorSettings = {
  cryAlert: true,
  sensitivity: '中等',
  alertVolume: '70%',
  pushNotify: true,
};

const settings = ref<MonitorSettings>({ ...DEFAULT_SETTINGS });

function loadSettings() {
  try {
    const saved = uni.getStorageSync(CACHE_KEY.MONITOR_SETTINGS);
    if (saved && typeof saved === 'object')
      settings.value = { ...DEFAULT_SETTINGS, ...saved };
  }
  catch { /* 忽略损坏的本地数据 */ }
}

function persistSettings() {
  try {
    uni.setStorageSync(CACHE_KEY.MONITOR_SETTINGS, { ...settings.value });
  }
  catch { /* 存储失败不阻塞 UI */ }
}

function onSwitchChange(key: 'cryAlert' | 'pushNotify', e: unknown) {
  const value = (e as { detail: { value: boolean } }).detail.value;
  settings.value[key] = value;
  persistSettings();
}

function pickSensitivity() {
  uni.showActionSheet({
    itemList: SENSITIVITY_OPTIONS,
    success: ({ tapIndex }) => {
      settings.value.sensitivity = SENSITIVITY_OPTIONS[tapIndex];
      persistSettings();
    },
  });
}

function pickAlertVolume() {
  uni.showActionSheet({
    itemList: VOLUME_OPTIONS,
    success: ({ tapIndex }) => {
      settings.value.alertVolume = VOLUME_OPTIONS[tapIndex];
      persistSettings();
    },
  });
}

/* ------------------------------------------------------------------ */
/*  开发者选项（连续点击"关于与帮助"5 次开启，每次进入页面重新隐藏）       */
/* ------------------------------------------------------------------ */

const devVisible = ref<boolean>(false);
let devTaps = 0;
let devTapTimer: ReturnType<typeof setTimeout> | null = null;

function onAboutTap() {
  devTaps++;
  if (devTapTimer)
    clearTimeout(devTapTimer);
  devTapTimer = setTimeout(() => {
    devTaps = 0;
  }, 1500);
  if (devTaps >= 5) {
    devVisible.value = true;
    devTaps = 0;
    uni.showToast({ title: '已开启开发者选项', icon: 'none' });
  }
}

/* ------------------------------------------------------------------ */
/*  导航与操作                                                          */
/* ------------------------------------------------------------------ */

function goPairing() {
  uni.navigateTo({ url: '/pages/pairing/index' });
}

function goBLETest() {
  uni.navigateTo({ url: '/pages/ble-test/index' });
}

function onDeviceTap() {
  uni.showToast({ title: '设备详情开发中', icon: 'none' });
}

function onAccountTap() {
  uni.showToast({ title: '账号功能开发中', icon: 'none' });
}

function onLogout() {
  uni.showModal({
    title: '退出登录',
    content: '确定要退出当前账号吗？',
    confirmColor: '#D96A5B',
    success: ({ confirm }) => {
      if (confirm)
        uni.showToast({ title: '已退出登录（演示）', icon: 'none' });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  生命周期                                                            */
/* ------------------------------------------------------------------ */

onMounted(() => {
  loadSettings();
  loadDevice();
});

onShow(() => {
  // 从配对页返回时刷新设备状态
  loadDevice();
});
</script>

<template>
  <view class="page h-full">
    <view class="main gap-4" :style="{ paddingTop: `${capsuleTopGap}px` }">
      <!-- 页面标题 -->
      <text class="page-title text-main font-bold">设置</text>

      <!-- ========= 设备管理 ========= -->
      <view class="section">
        <text class="section__title block mb-2">设备管理</text>
        <view class="group bg-card rounded-lg">
          <view class="row" @tap="onDeviceTap">
            <image class="row-icon" :src="getIcon('signal-bars', '#7BA05B')" mode="aspectFit" />
            <view class="row-body flex-1">
              <text class="row-title text-main">{{ device.name }}</text>
              <text class="row-desc text-secondary block">电量 {{ device.batteryPercent }}% · {{ device.connectionText }}</text>
            </view>
            <view class="online-badge rounded-pill" :class="device.isOnline ? 'online-badge--on' : 'online-badge--off'">
              {{ device.isOnline ? '在线' : '离线' }}
            </view>
            <image class="row-arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </view>
          <view class="row" @tap="goPairing">
            <view class="plus-chip rounded-full flex items-center justify-center shrink-0">
              <image class="plus-chip__icon" :src="getIcon('plus', '#8C8578')" mode="aspectFit" />
            </view>
            <view class="row-body flex-1 ml-3">
              <text class="row-title text-main">添加新设备</text>
              <text class="row-desc text-secondary block">通过蓝牙连接新设备</text>
            </view>
            <image class="row-arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </view>
        </view>
      </view>

      <!-- ========= 监控设置 ========= -->
      <view class="section">
        <text class="section__title block mb-2">监控设置</text>
        <view class="group bg-card rounded-lg">
          <view class="row">
            <text class="row-title text-main">哭声提醒</text>
            <view class="flex-1" />
            <switch
              :checked="settings.cryAlert"
              color="#7BA05B"
              class="row-switch"
              @change="onSwitchChange('cryAlert', $event)"
            />
          </view>
          <view class="row" @tap="pickSensitivity">
            <text class="row-title text-main">灵敏度阈值</text>
            <view class="flex-1" />
            <text class="row-value text-secondary">{{ settings.sensitivity }}</text>
            <image class="row-arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </view>
          <view class="row" @tap="pickAlertVolume">
            <text class="row-title text-main">提醒音量</text>
            <view class="flex-1" />
            <text class="row-value text-secondary">{{ settings.alertVolume }}</text>
            <image class="row-arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </view>
          <view class="row">
            <text class="row-title text-main">推送通知</text>
            <view class="flex-1" />
            <switch
              :checked="settings.pushNotify"
              color="#7BA05B"
              class="row-switch"
              @change="onSwitchChange('pushNotify', $event)"
            />
          </view>
        </view>
      </view>

      <!-- ========= 通用 ========= -->
      <view class="section">
        <text class="section__title block mb-2">通用</text>
        <view class="group bg-card rounded-lg">
          <view class="row" @tap="onAccountTap">
            <text class="row-title text-main">账号管理</text>
            <view class="flex-1" />
            <text class="row-value text-secondary">Sheldon</text>
            <image class="row-arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </view>
          <view class="row" @tap="onAboutTap">
            <text class="row-title text-main">关于与帮助</text>
            <view class="flex-1" />
            <text class="row-value text-secondary">v1.2.0</text>
            <image class="row-arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </view>
          <view class="row row--center" @tap="onLogout">
            <text class="logout-text">退出登录</text>
          </view>
        </view>
        <text class="footnote text-secondary block">调试工具已移入开发者选项（连续点击版本号 5 次开启）</text>
      </view>

      <!-- ========= 开发者选项（隐藏） ========= -->
      <view v-if="devVisible" class="section">
        <text class="section__title block mb-2">开发者选项</text>
        <view class="group bg-card rounded-lg">
          <view class="row" @tap="goBLETest">
            <text class="row-title text-main">BLE 串口测试</text>
            <view class="flex-1" />
            <text class="row-value text-secondary">蓝牙收发调试</text>
            <image class="row-arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </view>
        </view>
      </view>
    </view>

    <!-- 底部导航由 layouts/tabbar.vue 布局统一挂载 -->
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
  box-sizing: border-box;
  padding: 1.25rem; // 基础页边距（设计稿屏幕左右边距 20px）
  padding-top: var(--status-bar-height); // 重新声明：简写会覆盖 mixin 的状态栏避让
}

.main {
  @include main-layout;
  padding-top: 12rpx;
  padding-bottom: 160rpx;
}

.page-title {
  padding: 16rpx 4rpx 0;
  font-size: 56rpx;
}

.section__title {
  @include section-title;
  padding-left: 4rpx;
}

/* ------------------------------------------------------------------ */
/*  卡片分组与行                                                        */
/* ------------------------------------------------------------------ */
.group {
  box-shadow: 0 4rpx 24rpx rgba(60, 50, 30, 0.04);
}

.row {
  display: flex;
  align-items: center;
  min-height: 1.1rem;
  padding: 20rpx 32rpx;

  & + .row {
    border-top: 1rpx solid #f2ecdf;
  }

  &--center {
    justify-content: center;
  }
}

.row-icon {
  width: 40rpx;
  height: 40rpx;
  margin-right: 20rpx;
}

.row-body {
  min-width: 0;
  margin-right: 16rpx;
}

.row-title {
  font-size: 30rpx;
  font-weight: 500;
}

.row-desc {
  margin-top: 6rpx;
  font-size: 24rpx;
}

.row-value {
  font-size: 26rpx;
}

.row-arrow {
  width: 28rpx;
  height: 28rpx;
  margin-left: 8rpx;
}

.row-switch {
  transform: scale(0.88);
}

/* ------------------------------------------------------------------ */
/*  在线徽章 / 添加设备                                                 */
/* ------------------------------------------------------------------ */
.online-badge {
  padding: 6rpx 20rpx;
  font-size: 22rpx;
  font-weight: 500;

  &--on {
    color: $color-primary-deep;
    background-color: $color-primary-soft;
  }

  &--off {
    color: $color-warm-gray;
    background-color: #f0ebdf;
  }
}

.plus-chip {
  width: 64rpx;
  height: 64rpx;
  background-color: #f2ebdc;

  &__icon {
    width: 28rpx;
    height: 28rpx;
  }
}

.logout-text {
  font-size: 30rpx;
  font-weight: 500;
  color: $color-danger;
}

.footnote {
  margin-top: 20rpx;
  padding: 0 4rpx;
  font-size: 24rpx;
}
</style>
