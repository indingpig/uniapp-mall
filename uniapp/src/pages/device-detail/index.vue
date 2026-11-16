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

/** 固件更新信息（规范 5.5 固件更新条）：OTA/版本比对（todo-产品 P1-5）落地前
 *  恒为 null → 琥珀条整条隐藏；有数据时渲染「发现新版本 v{x}，建议更新」 */
const firmwareUpdate = ref<{ version: string } | null>(null);

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
 * hasLocalPairing() 自动回空态/占位态。正文含 E-09 要求的分享成员后果子句。
 */
function onUnpair() {
  uni.showModal({
    title: '解除配对',
    content: `将清除本机与 ${deviceName.value} 的配对记录及服务器地址，设备本身不受影响；已分享的家庭成员将同步失去访问权限。可随时重新扫描并配对接回。`,
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

    <view class="flex flex-col flex-1 gap-3">
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
        <text class="group__title text-main font-bold block">连接信息</text>
        <view class="info-row">
          <text class="row-label text-secondary">WiFi 网络</text>
          <view class="flex-1" />
          <text class="row-value text-muted">--</text>
        </view>
        <view class="info-row">
          <text class="row-label text-secondary">设备 IP</text>
          <view class="flex-1" />
          <text class="row-value text-muted">--</text>
        </view>
        <view class="info-row">
          <text class="row-label text-secondary">信号强度</text>
          <view class="flex-1" />
          <text class="row-value text-muted">--</text>
        </view>
      </view>

      <!-- 固件更新条（规范 5.5 琥珀条，ic-download 16px）：OTA/版本比对（todo-产品
           P1-5）落地前恒无版本数据，v-if 整条隐藏 —— 结构按设计稿先行实现 -->
      <view v-if="firmwareUpdate" class="firmware-bar flex items-center">
        <image class="firmware-bar__icon" :src="getIcon('download', 'amberInk')" mode="aspectFit" />
        <text class="firmware-bar__text block">发现新版本 v{{ firmwareUpdate.version }}，建议更新</text>
        <view class="flex-1" />
        <text class="firmware-bar__action font-medium">立即更新</text>
        <image class="firmware-bar__chevron" :src="getIcon('chevron-right', 'amberInk')" mode="aspectFit" />
      </view>

      <!-- ========= 监测设置卡（r16） ========= -->
      <view class="group bg-card rounded-card">
        <text class="group__title text-main font-bold block">监测设置</text>
        <view class="row">
          <text class="row-title text-main">哭声灵敏度</text>
          <view class="flex-1" />
          <!-- 灵敏度二级页 v1.2 待补（规范 5.5），暂只读展示；可在设置页 ActionSheet 调整 -->
          <text class="row-value text-secondary">{{ settings.sensitivity }}</text>
          <image class="row-chevron" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
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
  display: flex; // 纵向 flex + 内容区 flex-1，让底部危险操作贴页底（设计稿 17）
  flex-direction: column;
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
  box-shadow: $shadow-card;
}

.card--overview {
  padding: 48rpx 32rpx 40rpx;
}

/* 卡内单行 cell（list-item.scss：相邻行自动分割线） */
.row {
  @include list-row();
}

/* 连接信息卡的键值信息行：设计稿无行分割线 */
.info-row {
  @include list-row($divider: false);
}

/* ------------------------------------------------------------------ */
/*  设备概览卡                                                          */
/* ------------------------------------------------------------------ */

.overview {
  /* 注意：rpx() 入参是设计稿基准（390 画布）的 px 值，函数内部自己乘
   * 750/390 ≈ 1.923 —— 不要传 2x 导出图的像素值（会放大近一倍） */
  &__icon {
    width: rpx(68); // 68px 浅绿圈
    height: rpx(68);
    background-color: $color-primary-soft;
  }

  &__icon-img {
    width: rpx(40); // 40px 监护器图标
    height: rpx(40);
  }

  &__name {
    margin-top: 24rpx;
    font-size: rpx(19); // 19px
  }

  &__status {
    gap: 12rpx;
    margin-top: 12rpx;
  }

  &__dot {
    width: rpx(8);
    height: rpx(8);
  }

  &__status-text {
    font-size: rpx(12); // 12px
  }

  &__stats {
    align-self: stretch;
    margin-top: 32rpx;
  }

  &__stat-value {
    font-size: rpx(15); // 15px
    line-height: 1.3;
  }

  &__stat-label {
    margin-top: 4rpx;
    font-size: rpx(12); // 12px
  }

  &__divider {
    width: 1px;
    height: rpx(32);
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

/* 卡内组标题（规范 5.5：「连接信息」「监测设置」17px Bold） */
.group__title {
  padding: 28rpx 32rpx 4rpx;
  font-size: 34rpx;
}

.row-chevron {
  width: 32rpx;
  height: 32rpx;
}

/* 固件更新条（规范 5.5：琥珀 #F7EBD4 r12，ic-download 染 #B07A28） */
.firmware-bar {
  gap: 12rpx;
  padding: 22rpx 24rpx;
  border-radius: 12rpx;
  background-color: $color-amber-soft;

  &__icon {
    width: 32rpx;
    height: 32rpx;
  }

  &__text {
    font-size: 26rpx;
    color: $color-amber-ink;
  }

  &__action {
    font-size: 26rpx;
    color: $color-amber-ink;
  }

  &__chevron {
    width: 24rpx;
    height: 24rpx;
  }
}

/* ------------------------------------------------------------------ */
/*  底部危险操作                                                        */
/* ------------------------------------------------------------------ */

.unpair {
  margin-top: auto; // 吸收剩余空间贴底；内容超高时退化为 gap-3 的最小间距

  &__hint {
    margin-top: 16rpx;
    font-size: 22rpx; // 11px
  }
}
</style>
