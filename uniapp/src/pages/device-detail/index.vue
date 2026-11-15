<script setup lang="ts">
import type { DeviceData } from '@/api/baby';
import type { MonitorSettings } from '@/utils/monitorSettings';
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import { fetchDevice, fetchStatsSummary } from '@/api/baby';
import { CACHE_KEY } from '@/constants/cache';
import { colors } from '@/constants/colors';
import { getIcon } from '@/utils/icons';
import { loadMonitorSettings, persistMonitorSettings } from '@/utils/monitorSettings';
import { clearPairingRecords } from '@/utils/storage';

/* ------------------------------------------------------------------ */
/*  设备信息                                                            */
/* ------------------------------------------------------------------ */

const device = ref<DeviceData>({
  name: '婴儿监护器',
  connectionText: '未连接',
  signalStrength: 0,
  isOnline: false,
});

/** 今日事件数（哭闹样本计数，server /api/stats/summary 实时口径） */
const todayCryCount = ref(0);

/** 配对记录里的设备名（BLE 广播名，如 BabyMonitor-3004） */
const pairedName = ref('');

/** 本机重命名昵称（规范 5.5「重命名」；server 注册表落地前先存本机偏好） */
const nickname = ref('');

/** 显示名：本机昵称 > 配对记录设备名 > server 设备名 */
const deviceName = computed(() => nickname.value || pairedName.value || device.value.name);

const isOnline = computed(() => device.value.isOnline);

function loadDevice() {
  fetchDevice().then((d) => {
    device.value = d;
  }).catch(() => {});
}

function loadSummary() {
  fetchStatsSummary().then((s) => {
    todayCryCount.value = s.today.cryCount;
  }).catch(() => {});
}

function loadLocalRecords() {
  nickname.value = (uni.getStorageSync(CACHE_KEY.DEVICE_NAME_OVERRIDE) as string) || '';
  const paired = uni.getStorageSync(CACHE_KEY.PAIRED_DEVICE);
  pairedName.value = paired && typeof paired === 'object' && paired.name ? paired.name : '';
}

/* ------------------------------------------------------------------ */
/*  监测设置（与设置页共用同一份本机偏好，见 utils/monitorSettings.ts）     */
/* ------------------------------------------------------------------ */

const settings = ref<MonitorSettings>(loadMonitorSettings());

function onSettingChange() {
  persistMonitorSettings(settings.value);
}

onShow(() => {
  loadDevice();
  loadSummary();
  loadLocalRecords();
  settings.value = loadMonitorSettings();
});

/* ------------------------------------------------------------------ */
/*  导航与操作                                                          */
/* ------------------------------------------------------------------ */

function goBack() {
  uni.navigateBack();
}

/** 重命名（规范 5.5：输入弹框；清空输入 = 恢复默认显示名） */
function onRename() {
  uni.showModal({
    title: '重命名设备',
    editable: true,
    placeholderText: '输入设备名称',
    content: deviceName.value,
    success: ({ confirm, content }) => {
      if (!confirm)
        return;
      const name = (content || '').trim();
      if (!name) {
        nickname.value = '';
        uni.removeStorageSync(CACHE_KEY.DEVICE_NAME_OVERRIDE);
        uni.showToast({ title: '已恢复默认名称', icon: 'none' });
        return;
      }
      if (name === deviceName.value)
        return;
      nickname.value = name;
      uni.setStorageSync(CACHE_KEY.DEVICE_NAME_OVERRIDE, name);
      uni.showToast({ title: '已重命名', icon: 'none' });
    },
  });
}

/**
 * 解除配对（规范 5.5 底部危险操作）：与设置页「删除设备」同口径——仅清
 * App 端记录（配对记录 + 服务器地址 + 本机昵称），设备本身不受影响，
 * 恢复出厂只能走设备 BOOT 长按 10s 硬件手势。首页/设置页经 onShow 重读
 * hasLocalPairing() 自动回空态/占位态。
 */
function onUnpair() {
  uni.showModal({
    title: '解除配对',
    content: `将清除本机与 ${deviceName.value} 的配对记录及服务器地址，设备本身不受影响，可随时重新配对接回。`,
    confirmText: '解除配对',
    confirmColor: colors.danger,
    success: ({ confirm }) => {
      if (!confirm)
        return;
      clearPairingRecords();
      uni.showToast({ title: '已解除配对', icon: 'none' });
      setTimeout(() => uni.navigateBack(), 600);
    },
  });
}
</script>

<template>
  <view class="page">
    <!-- 吸顶导航行（规范 5.5）：返回 + 标题 + 重命名 -->
    <view class="navbar sticky-top flex items-center">
      <view class="navbar__back flex items-center justify-center" @tap="goBack">
        <image class="navbar__back-icon" :src="getIcon('chevron-left', 'ink')" mode="aspectFit" />
      </view>
      <text class="navbar__title text-main font-semibold">设备详情</text>
      <text class="navbar__action font-medium" @tap="onRename">重命名</text>
    </view>

    <view class="flex flex-col gap-3">
      <!-- ========= 设备概览卡（r20） ========= -->
      <view class="card card--overview bg-card rounded-card-lg flex flex-col items-center">
        <view class="overview__icon rounded-full flex items-center justify-center">
          <image class="overview__icon-img" :src="getIcon('device', 'primary')" mode="aspectFit" />
        </view>
        <text class="overview__name text-main font-bold block">{{ deviceName }}</text>
        <view class="overview__status flex items-center">
          <view class="overview__dot rounded-full" :class="isOnline ? 'bg-primary' : 'bg-card-soft'" />
          <text class="overview__status-text" :style="{ color: isOnline ? colors.primaryDeep : colors.warmGray }">
            {{ isOnline ? '设备在线 · 运行正常' : '设备离线' }}
          </text>
        </view>
        <!-- 三栏指标（值 15px Bold，1px 竖分隔线）：
             已连接时长待固件遥测（todolist 改进点 8）上报 uptime 后接真数据 -->
        <view class="overview__stats flex items-center">
          <view class="overview__stat flex flex-col items-center flex-1">
            <text class="overview__stat-value text-main font-bold block">--</text>
            <text class="overview__stat-label text-secondary block">已连接</text>
          </view>
          <view class="overview__divider" />
          <view class="overview__stat flex flex-col items-center flex-1">
            <text class="overview__stat-value text-main font-bold block">{{ todayCryCount }}</text>
            <text class="overview__stat-label text-secondary block">今日事件</text>
          </view>
          <view class="overview__divider" />
          <view class="overview__stat flex flex-col items-center flex-1">
            <text class="overview__stat-value text-main font-bold block">{{ settings.sensitivity }}</text>
            <text class="overview__stat-label text-secondary block">灵敏度</text>
          </view>
        </view>
      </view>

      <!-- ========= 连接信息卡（r16）：WiFi/IP/信号待固件遥测（改进点 8）接真数据 ========= -->
      <view class="group bg-card rounded-card">
        <view class="row">
          <text class="row-label text-secondary">WiFi 网络</text>
          <view class="flex-1" />
          <text class="row-value text-muted">--</text>
        </view>
        <view class="row">
          <text class="row-label text-secondary">设备 IP</text>
          <view class="flex-1" />
          <text class="row-value text-muted">--</text>
        </view>
        <view class="row">
          <text class="row-label text-secondary">信号强度</text>
          <view class="flex-1" />
          <text class="row-value text-muted">--</text>
        </view>
      </view>

      <!-- 固件更新条：琥珀横幅（ic-download + 立即更新），规范 5.5「无新版本整条隐藏」；
           版本比对/OTA 链路（todo-产品 P1-5）落地前恒无数据，暂不渲染 -->

      <!-- ========= 监测设置卡（r16） ========= -->
      <view class="group bg-card rounded-card">
        <view class="row">
          <text class="row-title text-main">哭声灵敏度</text>
          <view class="flex-1" />
          <!-- 灵敏度二级页 v1.2 待补（规范 5.5），暂只读展示；可在设置页 ActionSheet 调整 -->
          <text class="row-value text-secondary">{{ settings.sensitivity }}</text>
        </view>
        <view class="row">
          <text class="row-title text-main">哭声提醒</text>
          <view class="flex-1" />
          <AppSwitch v-model="settings.cryAlert" @change="onSettingChange" />
        </view>
        <view class="row">
          <text class="row-title text-main">状态变化提醒</text>
          <view class="flex-1" />
          <AppSwitch v-model="settings.stateChangeAlert" @change="onSettingChange" />
        </view>
      </view>

      <!-- ========= 底部危险操作 ========= -->
      <view class="unpair flex flex-col items-center">
        <AppButton variant="danger-outline" @tap="onUnpair">
          解除配对
        </AppButton>
        <text class="unpair__hint text-secondary block">解除后需重新扫描并配对设备</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
page {
  background-color: $color-bg;
}
</style>

<style lang="scss" scoped>
.page {
  box-sizing: border-box;
  padding: 1.25rem; // 基础页边距（设计稿屏幕左右边距 20px）
  padding-top: 0; // 状态栏避让移入吸顶 navbar 自身（滚动吸顶后由它的不透明背景盖住状态栏区域）
  min-height: 100vh;
  background-color: $color-bg;
}

/* ------------------------------------------------------------------ */
/*  导航行                                                              */
/* ------------------------------------------------------------------ */

.navbar {
  gap: 20rpx;
  // 吸顶（.sticky-top 原子类），状态栏避让放进自身 padding（写法同配对页）
  padding: calc(var(--status-bar-height) + 32rpx) 0 20rpx;

  &__back {
    width: 56rpx;
    height: 56rpx;
  }

  &__back-icon {
    width: 40rpx;
    height: 40rpx;
  }

  &__title {
    font-size: 33rpx; // nav-title 17px
  }

  &__action {
    margin-left: auto;
    padding: 12rpx 0;
    font-size: 30rpx; // 15px
    color: $color-primary-deep;
  }
}

/* ------------------------------------------------------------------ */
/*  卡片通用                                                            */
/* ------------------------------------------------------------------ */

.card {
  padding: 32rpx;
  box-shadow: 0 4rpx 24rpx rgba(60, 50, 30, 0.04);
}

.card--overview {
  padding: 48rpx 32rpx 40rpx;
}

/* 卡内单行 cell（list-item.scss：相邻行自动分割线） */
.row {
  @include list-row();
}

/* ------------------------------------------------------------------ */
/*  设备概览卡                                                          */
/* ------------------------------------------------------------------ */

.overview {
  &__icon {
    width: rpx(136); // 68px 浅绿圈
    height: rpx(136);
    background-color: $color-primary-soft;
  }

  &__icon-img {
    width: rpx(80); // 40px 监护器图标
    height: rpx(80);
  }

  &__name {
    margin-top: 24rpx;
    font-size: rpx(38); // 19px
  }

  &__status {
    gap: 12rpx;
    margin-top: 12rpx;
  }

  &__dot {
    width: rpx(16);
    height: rpx(16);
  }

  &__status-text {
    font-size: rpx(24); // 12px
  }

  &__stats {
    align-self: stretch;
    margin-top: 32rpx;
  }

  &__stat-value {
    font-size: rpx(30); // 15px
    line-height: 1.3;
  }

  &__stat-label {
    margin-top: 4rpx;
    font-size: rpx(24); // 12px
  }

  &__divider {
    width: 1px;
    height: rpx(64);
    background-color: $color-divider;
  }
}

/* ------------------------------------------------------------------ */
/*  连接信息 / 监测设置卡                                               */
/* ------------------------------------------------------------------ */

.row-label,
.row-value {
  font-size: 28rpx; // 14px
}

.row-title {
  font-size: 30rpx; // 15px
}

/* ------------------------------------------------------------------ */
/*  底部危险操作                                                        */
/* ------------------------------------------------------------------ */

.unpair {
  margin-top: 16rpx;

  &__hint {
    margin-top: 16rpx;
    font-size: 22rpx; // 11px
  }
}
</style>
