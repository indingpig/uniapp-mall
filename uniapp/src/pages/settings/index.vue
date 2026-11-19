<route lang="json">
{ "layout": "tabbar" }
</route>

<script setup lang="ts">
import type { DeviceData } from '@/api/baby';
import type { MonitorSettings } from '@/utils/monitorSettings';
import { onShow } from '@dcloudio/uni-app';
import { computed, onMounted, ref } from 'vue';
import { fetchDevice } from '@/api/baby';
import { fetchFamilyOverview } from '@/api/family';
import { colors } from '@/constants/colors';
import { useBackToBackground } from '@/hooks/useBackToBackground';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';
import { getFamilyRole } from '@/utils/family';
import { getIcon } from '@/utils/icons';
import {
  isIgnoringBatteryOptimizations,
  isKeepAliveAvailable,
  isKeepAliveRunning,
  openAutoStartSettings,
  requestIgnoreBatteryOptimizations,
  startKeepAlive,
  stopKeepAlive,
} from '@/utils/keepalive';
import { loadMonitorSettings, persistMonitorSettings, SENSITIVITY_OPTIONS } from '@/utils/monitorSettings';
import { ensureNotificationEnabled, guideOffSystemNotification, isNotificationAuthorized } from '@/utils/notify';
import { hasLocalPairing } from '@/utils/storage';

const { capsuleTopGap } = useCapsuleGap();

// tab 页返回键拦截：后台保活开启时退到后台而非退出 App（见 hook 注释）
useBackToBackground();

/* ------------------------------------------------------------------ */
/*  设备信息                                                            */
/* ------------------------------------------------------------------ */

const device = ref<DeviceData>({
  name: '婴儿监护器',
  connectionText: '未连接',
  signalStrength: 0,
  isOnline: false,
});

/** 未配对时设备行显示占位态（server /device 是写死假数据，见 todolist v1.2 注册表项） */
const hasPairedDevice = ref(false);

function loadDevice() {
  fetchDevice().then((d) => {
    device.value = d;
  }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/*  监控设置（本地持久化，后端暂无对应接口）                              */
/*  偏好结构收敛在 utils/monitorSettings.ts（设备详情页监测设置卡共用）    */
/* ------------------------------------------------------------------ */

const VOLUME_OPTIONS = ['30%', '50%', '70%', '100%'];

const settings = ref<MonitorSettings>(loadMonitorSettings());

/* 系统通知授权状态：开关显示 = 用户偏好 ∧ 系统授权。
 * 偏好单独存（systemAuth 掉了不代表用户想关，授权恢复后开关自动回到开） */
const systemNotifyAuth = ref(true);
const pushNotifySwitch = computed({
  get: () => settings.value.pushNotify && systemNotifyAuth.value,
  set: (v: boolean) => {
    settings.value.pushNotify = v;
  },
});

function loadSettings() {
  settings.value = loadMonitorSettings();
}

function persistSettings() {
  persistMonitorSettings(settings.value);
}

/**
 * 推送通知开关：
 * - 打开：确保通知可用——系统通知被关则确认框引导去系统设置页
 *   （Android 13+ 且未授权时先弹运行时授权）；取消则回退开关。
 * - 关闭：保存偏好后，若系统通知仍开启则引导去系统设置一并关闭（主流 App 行为）。
 */
async function onPushNotifyChange() {
  if (!settings.value.pushNotify) {
    persistSettings();
    guideOffSystemNotification();
    return;
  }
  const ok = await ensureNotificationEnabled();
  if (ok) {
    persistSettings();
    return;
  }
  settings.value.pushNotify = false;
  persistSettings();
  uni.showToast({ title: '需在系统设置中允许通知后再开启', icon: 'none' });
}

/* ------------------------------------------------------------------ */
/*  后台保活（App 端分区；工具层内部已做平台隔离，H5 为空实现）            */
/* ------------------------------------------------------------------ */

/** 后台保活分区仅 Android 显示（本期只发布 Android；iOS 无前台服务概念，也未打包） */
const keepAliveAvailable = isKeepAliveAvailable();

/** 电池优化白名单状态：进入页面/onShow 重查（用户可能刚在系统弹窗里点了允许） */
const batteryWhitelisted = ref(true);

/**
 * 前台服务实时状态：onShow 重查。
 * 此前 isKeepAliveRunning() 是无人调用的死抽象（评审 P2 提过 running 是纯内存态，
 * 进程重建后失真）。这里如实展示，并把失真风险写进界面文案——监护场景下
 * 「以为在跑、实际没跑」比「明确显示异常」危险得多。
 */
const keepAliveRunning = ref(false);

/**
 * 后台保活开关：启动/停止前台服务并持久化偏好。
 * 关闭立即停服务（通知栏常驻消失）；开启时若系统通知未授权，前台服务照启——
 * 它只保活不弹通知，与「推送通知」开关互不干扰。
 */
function onKeepAliveChange() {
  persistSettings();
  if (settings.value.keepAlive) {
    startKeepAlive();
    uni.showToast({ title: '后台保活已开启', icon: 'none' });
  }
  else {
    stopKeepAlive();
    uni.showToast({ title: '后台保活已关闭', icon: 'none' });
  }
}

/** 电池优化白名单行：发起系统确认框（已豁免时系统无弹窗），onShow 回来后重查 */
function onBatteryWhitelistTap() {
  if (batteryWhitelisted.value) {
    uni.showToast({ title: '已豁免电池优化，无需设置', icon: 'none' });
    return;
  }
  const fired = requestIgnoreBatteryOptimizations();
  if (!fired)
    uni.showToast({ title: '请在系统设置的电池页面手动允许', icon: 'none' });
}

/** 自启动引导：确认后按机型跳转（ROM 版本差异大，失败自动降级应用详情页） */
function onAutoStartTap() {
  uni.showModal({
    title: '允许自启动',
    content: '将跳转到系统自启动管理页，允许本应用自启动并关闭省电限制，可大幅降低锁屏后被杀概率',
    confirmText: '去设置',
    cancelText: '暂不',
    success: ({ confirm }) => {
      if (confirm)
        openAutoStartSettings();
    },
  });
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

/* ------------------------------------------------------------------ */
/*  家庭共享（设计板 19 / CR-01 成员制）：管理页 pages/family-share       */
/* ------------------------------------------------------------------ */

/** 行右值（板05）：owner 显示 N/6，member 显示「已加入」；未认领/拉取失败留空 */
const familyQuotaText = ref('');

function refreshFamilyQuota() {
  if (!hasPairedDevice.value || getFamilyRole() === 'none') {
    familyQuotaText.value = '';
    return;
  }
  fetchFamilyOverview().then((data) => {
    familyQuotaText.value = data.role === 'owner' ? `${data.quota.used}/${data.quota.max}` : '已加入';
  }).catch(() => {
    familyQuotaText.value = '';
  });
}

/** 分享给家人 → 成员管理页（owner 管理成员/出码/邀请；member 只读 + 退出） */
function onShareTap() {
  uni.navigateTo({ url: '/pages/family-share/index' });
}

function goBLETest() {
  uni.navigateTo({ url: '/pages/ble-test/index' });
}

function goCollect() {
  uni.navigateTo({ url: '/pages/collect/index' });
}

/** 设备卡 → 设备详情页（规范 5.5）：重命名/监测设置/解除配对都在详情页 */
function onDeviceTap() {
  uni.navigateTo({ url: '/pages/device-detail/index' });
}

/** 未配对时设备行即配对入口（与首页空态口径一致） */
function onDeviceRowTap() {
  if (!hasPairedDevice.value) {
    goPairing();
    return;
  }
  onDeviceTap();
}

function onAccountTap() {
  uni.showToast({ title: '账号功能开发中', icon: 'none' });
}

function onLogout() {
  uni.showModal({
    title: '退出登录',
    content: '确定要退出当前账号吗？',
    confirmColor: colors.danger,
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
  // 从配对页返回时刷新配对状态与设备状态
  hasPairedDevice.value = hasLocalPairing();
  loadDevice();
  // 从系统设置页返回时刷新通知授权（用户可能刚在系统里开了/关了通知）
  systemNotifyAuth.value = isNotificationAuthorized();
  // 从分享管理页返回时刷新成员配额（板05 右值 N/6 / 已加入）
  refreshFamilyQuota();
  // 从系统弹窗/设置页返回时重查电池优化白名单状态
  batteryWhitelisted.value = isIgnoringBatteryOptimizations();
  // 前台服务运行状态同样重查（用户可能刚在系统里强停过本应用）
  keepAliveRunning.value = isKeepAliveRunning();
});
</script>

<template>
  <view class="page h-full">
    <view class="main gap-4">
      <!-- 页面标题（吸顶；胶囊避让必须留在本元素上，吸顶后才不钻到胶囊底下） -->
      <view class="page-header sticky-top" :style="capsuleTopGap ? { paddingTop: `${capsuleTopGap}px` } : undefined">
        <text class="page-title text-main font-bold">设置</text>
      </view>

      <!-- ========= 设备管理 ========= -->
      <view class="section">
        <text class="section__title block mb-2">设备管理</text>
        <view class="group bg-card rounded-lg">
          <view class="row" @tap="onDeviceRowTap">
            <image class="row-icon" :src="getIcon('signal-bars', hasPairedDevice ? 'primary' : 'muted')" mode="aspectFit" />
            <view class="row-body flex-1">
              <text class="row-title text-main">{{ hasPairedDevice ? device.name : '未配对设备' }}</text>
              <text class="row-desc text-secondary block">{{ hasPairedDevice ? `充电宝供电 · ${device.connectionText}` : '配对后可在这里查看设备状态' }}</text>
            </view>
            <view v-if="hasPairedDevice" class="online-badge rounded-pill" :class="device.isOnline ? 'online-badge--on' : 'online-badge--off'">
              {{ device.isOnline ? '在线' : '离线' }}
            </view>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
          </view>
          <view class="row" @tap="goPairing">
            <view class="plus-chip rounded-full flex items-center justify-center shrink-0">
              <image class="plus-chip__icon" :src="getIcon('plus', 'secondary')" mode="aspectFit" />
            </view>
            <view class="row-body flex-1 ml-3">
              <text class="row-title text-main">添加新设备</text>
              <text class="row-desc text-secondary block">通过蓝牙连接新设备</text>
            </view>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
          </view>
          <!-- 分享给家人（设计板 05/19：设备管理组第三行，右值 N/6；CR-01 成员制） -->
          <view class="row" @tap="onShareTap">
            <view class="plus-chip rounded-full flex items-center justify-center shrink-0">
              <image class="plus-chip__icon" :src="getIcon('users', 'primary')" mode="aspectFit" />
            </view>
            <view class="row-body flex-1 ml-3">
              <text class="row-title text-main">分享给家人</text>
              <text class="row-desc text-secondary block">家人加入后可同步查看宝宝状态，仅可只读查看</text>
            </view>
            <text v-if="familyQuotaText" class="row-value text-secondary">{{ familyQuotaText }}</text>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
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
            <AppSwitch v-model="settings.cryAlert" @change="persistSettings" />
          </view>
          <view class="row" @tap="pickSensitivity">
            <text class="row-title text-main">灵敏度阈值</text>
            <view class="flex-1" />
            <text class="row-value text-secondary">{{ settings.sensitivity }}</text>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
          </view>
          <view class="row" @tap="pickAlertVolume">
            <text class="row-title text-main">提醒音量</text>
            <view class="flex-1" />
            <text class="row-value text-secondary">{{ settings.alertVolume }}</text>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
          </view>
          <view class="row">
            <text class="row-title text-main">推送通知</text>
            <view class="flex-1" />
            <AppSwitch v-model="pushNotifySwitch" @change="onPushNotifyChange" />
          </view>
          <!-- 离线警告推送（设计定义补全 D-02/Q-01，规范 5 节 05 屏新增行）：
               成员级各自生效，默认开；关闭后不接收设备离线推送，
               不影响哭闹推送与 App 内离线提示条。推送通道落地后的接线点 -->
          <view class="row">
            <view class="row-body flex-1">
              <text class="row-title text-main block">离线警告推送</text>
              <text class="row-desc text-secondary block">关闭后不再接收设备离线提醒</text>
            </view>
            <AppSwitch v-model="settings.offlinePushEnabled" @change="persistSettings" />
          </view>
        </view>
      </view>

      <!-- ========= 后台保活（App 端）========= -->
      <view v-if="keepAliveAvailable" class="section">
        <text class="section__title block mb-2">后台保活</text>
        <view class="group bg-card rounded-lg">
          <view class="row">
            <view class="row-body flex-1">
              <text class="row-title text-main block">后台保活</text>
              <text class="row-desc text-secondary block">常驻通知运行监护，锁屏后仍能收到哭声提醒</text>
            </view>
            <AppSwitch v-model="settings.keepAlive" @change="onKeepAliveChange" />
          </view>
          <view class="row" @tap="onBatteryWhitelistTap">
            <text class="row-title text-main">电池优化白名单</text>
            <view class="flex-1" />
            <text class="row-value" :class="batteryWhitelisted ? 'text-secondary' : 'text-danger'">
              {{ batteryWhitelisted ? '已豁免' : '未豁免，点击设置' }}
            </text>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
          </view>
          <view class="row">
            <view class="row-body flex-1">
              <text class="row-title text-main block">常驻服务状态</text>
              <text class="row-desc text-secondary block">被系统清理后显示「未运行」，点开应用会自动恢复</text>
            </view>
            <text class="row-value" :class="keepAliveRunning ? 'text-secondary' : 'text-danger'">
              {{ keepAliveRunning ? '运行中' : '未运行' }}
            </text>
          </view>
          <view class="row" @tap="onAutoStartTap">
            <view class="row-body flex-1">
              <text class="row-title text-main block">允许自启动</text>
              <text class="row-desc text-secondary block">跳转系统自启动管理，降低清理后被杀概率</text>
            </view>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
          </view>
        </view>
        <text class="footnote text-secondary block">被一键清理/划掉卡片后，哭声提醒由 ntfy 兜底推送送达（需订阅配置）</text>
        <text class="footnote text-secondary block">手机重启后常驻服务会自动恢复，但监护连接需点开应用才重建；常驻通知显示「监护已中断」即表示当前没在监护</text>
      </view>

      <!-- ========= 通用 ========= -->
      <view class="section">
        <text class="section__title block mb-2">通用</text>
        <view class="group bg-card rounded-lg">
          <view class="row" @tap="onAccountTap">
            <text class="row-title text-main">账号管理</text>
            <view class="flex-1" />
            <text class="row-value text-secondary">Sheldon</text>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
          </view>
          <view class="row" @tap="onAboutTap">
            <text class="row-title text-main">关于与帮助</text>
            <view class="flex-1" />
            <text class="row-value text-secondary">v1.2.0</text>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
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
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
          </view>
          <view class="row" @tap="goCollect">
            <text class="row-title text-main">哭声数据采集</text>
            <view class="flex-1" />
            <text class="row-value text-secondary">Edge Impulse 训练数据</text>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
          </view>
        </view>
      </view>
    </view>

    <!-- 家庭共享弹框已移除（CR-01）：「分享给家人」行改跳 pages/family-share 成员管理页 -->

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
  padding-top: 0; // 状态栏避让移入吸顶 .page-header 自身（滚动吸顶后由它的不透明背景盖住状态栏区域）
}

.main {
  @include main-layout;
  padding-top: 12rpx;
  padding-bottom: 160rpx;
}

.page-header {
  // 吸顶（.sticky-top 原子类）：页面在 .page 内滚动，大标题固定不随内容滚走。
  // 状态栏避让放进自身 padding（原 .page 的避让 + .main 的 12rpx 间距，数值不变只挪位置），
  // 吸顶后不透明背景盖住状态栏区域
  padding-top: var(--status-bar-height);
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
  box-shadow: $shadow-card;
}

.row {
  // 分组列表行统一自 list-item.scss 的 list-row（含行间分割线，分割线色为 $color-divider）
  @include list-row;

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
    background-color: $color-card-soft;
  }
}

.plus-chip {
  width: 64rpx;
  height: 64rpx;
  background-color: $color-card-soft;

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
