<route lang="json">
{ "layout": "tabbar" }
</route>

<script setup lang="ts">
import type { DeviceData } from '@/api/baby';
import { onShow } from '@dcloudio/uni-app';
import UQRCode from 'uqrcodejs';
import { computed, getCurrentInstance, nextTick, onMounted, ref } from 'vue';
import { fetchDevice } from '@/api/baby';
import { CACHE_KEY } from '@/constants/cache';
import { colors } from '@/constants/colors';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';
import { getIcon } from '@/utils/icons';
import { ensureNotificationEnabled, guideOffSystemNotification, isNotificationAuthorized } from '@/utils/notify';
import { resolveServerUrl } from '@/utils/server';
import { hasLocalPairing } from '@/utils/storage';

const { capsuleTopGap } = useCapsuleGap();

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
/*  家庭共享（2026-11-10 决策）：家人手机无需配对，扫码/填地址即成为观众  */
/* ------------------------------------------------------------------ */

const QR_SIZE = 180; // px，须与 canvas 宽高一致
const shareVisible = ref(false);
const shareUrl = ref('');

function onShareTap() {
  const url = resolveServerUrl();
  if (!url) {
    uni.showToast({ title: '尚未配置服务器地址', icon: 'none' });
    return;
  }
  shareUrl.value = url;
  shareVisible.value = true;
  // 等 v-if 弹框与 canvas 完成首帧布局后再绘制
  nextTick(() => {
    setTimeout(drawShareQr, 60);
  });
}

function drawShareQr() {
  try {
    const qr = new UQRCode();
    qr.data = shareUrl.value;
    qr.size = QR_SIZE;
    qr.make();
    const instance = getCurrentInstance()?.proxy;
    qr.canvasContext = uni.createCanvasContext('shareQrCanvas', instance);
    qr.drawCanvas();
  }
  catch (e) {
    console.warn('[ShareQR] draw failed', e);
  }
}

function onShareCopy() {
  uni.setClipboardData({ data: shareUrl.value });
}

function onShareClose() {
  shareVisible.value = false;
}

function goBLETest() {
  uni.navigateTo({ url: '/pages/ble-test/index' });
}

function goCollect() {
  uni.navigateTo({ url: '/pages/collect/index' });
}

function onDeviceTap() {
  uni.showToast({ title: '设备详情开发中', icon: 'none' });
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
        </view>
      </view>

      <!-- ========= 家庭共享（2026-11-10 决策：单设备多观众） ========= -->
      <!-- 未配对时整节隐藏：没有设备就没有可分享的对象，与设备卡占位态口径一致 -->
      <view v-if="hasPairedDevice" class="section">
        <text class="section__title block mb-2">家庭共享</text>
        <view class="group bg-card rounded-lg">
          <view class="row" @tap="onShareTap">
            <view class="row-body flex-1">
              <text class="row-title text-main">分享给家人</text>
              <text class="row-desc text-secondary block">家人加入后可同步查看宝宝状态与告警，无需重复配对</text>
            </view>
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

    <!-- 家庭共享弹框（遮罩/白卡与配对页成功弹框同款：z-200 压暗吸顶顶栏） -->
    <view v-if="shareVisible" class="share-mask" @tap="onShareClose">
      <view class="share-modal" @tap.stop>
        <text class="share-modal__title">分享给家人</text>
        <text class="share-modal__desc text-secondary">家人在 App 首页点「加入家庭监护」扫码即可</text>
        <view class="share-modal__qr rounded-md">
          <canvas id="shareQrCanvas" canvas-id="shareQrCanvas" class="share-modal__canvas" :style="{ width: `${QR_SIZE}px`, height: `${QR_SIZE}px` }" />
        </view>
        <text class="share-modal__url text-secondary">{{ shareUrl }}</text>
        <AppButton size="cta" class="share-modal__cta" @tap="onShareCopy">
          复制地址
        </AppButton>
        <text class="share-modal__later" @tap="onShareClose">关闭</text>
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

/* ---------- 家庭共享弹框（遮罩/白卡与配对页成功弹框同款） ---------- */

.share-mask {
  position: fixed;
  inset: 0;
  z-index: 200; // 高于吸顶顶栏(.sticky-top z-100)：遮罩必须连顶栏一起压暗
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: $color-mask;
}

.share-modal {
  box-sizing: border-box;
  width: 590rpx;
  padding: 48rpx 40rpx 32rpx;
  border-radius: 32rpx;
  background-color: $color-card;
  display: flex;
  flex-direction: column;
  align-items: center;

  &__title {
    font-size: 40rpx; // 21px
    font-weight: 700;
    color: $color-primary-deep;
  }

  &__desc {
    margin-top: 8rpx;
    font-size: 25rpx;
    text-align: center;
  }

  &__qr {
    margin-top: 32rpx;
    padding: 24rpx;
    background-color: $color-white; // 二维码底必须纯白，深色主题下也不可透出卡片色
  }

  &__canvas {
    display: block;
  }

  &__url {
    width: 100%;
    margin-top: 24rpx;
    font-size: 22rpx;
    text-align: center;
    word-break: break-all;
  }

  &__cta {
    width: 100%;
    margin-top: 32rpx;
  }

  &__later {
    margin-top: 24rpx;
    padding: 8rpx;
    font-size: 25rpx;
    color: $color-text-muted;
  }
}
</style>
