<script setup lang="ts">
import type { BLEDevice } from '@/hooks/useBLE';
import { onShow } from '@dcloudio/uni-app';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useBLE } from '@/hooks/useBLE';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';
import { getIcon } from '@/utils/icons';

const {
  scanning,
  devices,
  connectedDevice,
  statusText,
  startScan,
  stopScan,
  connectDevice,
  pair,
} = useBLE();

const bleNotSupported = ref(false);
// #ifdef H5
// H5 恒走适配器：支持 Web Bluetooth 的浏览器挂真实蓝牙，其余挂模拟器（见 mock/ble-adapter.ts）
bleNotSupported.value = false;
// #endif

const { capsuleTopGap } = useCapsuleGap();

/* ------------------------------------------------------------------ */
/*  视觉验收开关：设为 'idle' / 'scanning' / 'timeout' 可在 H5 预览对应态  */
/*  （验收完成后置回 ''，不影响真实流程）                                 */
/* ------------------------------------------------------------------ */
const MOCK_STATE: '' | 'idle' | 'scanning' | 'timeout' = '';

const currentStep = ref<'scan' | 'wifi' | 'pairing' | 'done'>('scan');
const wifiSSID = ref('');
const wifiPass = ref('');
const showPassword = ref(false);
const serverUrl = ref('ws://192.168.3.5:3001/ws?esp32');
const scanAttempted = ref(false);

/* ---------- 视觉验收用假设备（MOCK_STATE 非空时生效） ---------- */
const MOCK_DEVICES: BLEDevice[] = [
  { deviceId: 'mock-1', name: 'Baby Monitor-A3F2', RSSI: -52 },
  { deviceId: 'mock-2', name: 'BabyCam-02', RSSI: -71 },
];

const shownDevices = computed<BLEDevice[]>(() =>
  MOCK_STATE ? MOCK_DEVICES : devices.value,
);

/* ------------------------------------------------------------------ */
/*  页面状态机：unsupported / idle / scanning / timeout / wifi / pairing / done */
/* ------------------------------------------------------------------ */

type PairingPhase = 'unsupported' | 'idle' | 'scanning' | 'timeout' | 'wifi' | 'pairing' | 'done';

const phase = computed<PairingPhase>(() => {
  if (MOCK_STATE)
    return MOCK_STATE;
  if (bleNotSupported.value)
    return 'unsupported';
  if (currentStep.value === 'pairing')
    return 'pairing';
  if (currentStep.value === 'done')
    return 'done';
  if (connectedDevice.value)
    return 'wifi';
  if (scanning.value)
    return 'scanning';
  if (scanAttempted.value && !scanning.value && devices.value.length === 0)
    return 'timeout';
  return 'idle';
});

/* ---------- 步骤条（1 开机检查 / 2 扫描设备 / 3 WiFi 配网） ---------- */
type StepState = 'done' | 'active' | 'pending';
const STEP_LABELS = ['开机检查', '扫描设备', 'WiFi 配网'];

const stepStates = computed<StepState[]>(() => {
  if (phase.value === 'unsupported')
    return ['active', 'pending', 'pending'];
  if (phase.value === 'idle' || phase.value === 'timeout')
    return phase.value === 'timeout' ? ['done', 'done', 'pending'] : ['active', 'pending', 'pending'];
  if (phase.value === 'scanning')
    return ['done', 'active', 'pending'];
  return ['done', 'done', 'active']; // wifi / pairing / done
});

/* ---------- 信号条（规范 13.2：RSSI → 0-4 格） ---------- */
function signalLevel(rssi: number): number {
  if (rssi >= -60)
    return 4;
  if (rssi >= -70)
    return 3;
  if (rssi >= -80)
    return 2;
  return 1;
}

/* ---------- 雷达三帧（H5/App：CSS 关键帧；小程序：src 轮换） ---------- */
// #ifdef MP-WEIXIN
const RADAR_FRAMES = [
  '/static/icons/ic-radar-f1.svg',
  '/static/icons/ic-radar.svg',
  '/static/icons/ic-radar-f3.svg',
];
const RADAR_DURATIONS = [120, 160, 200];
const radarFrameIndex = ref(0);
let radarTimer: ReturnType<typeof setTimeout> | null = null;
function radarLoop() {
  radarTimer = setTimeout(() => {
    radarFrameIndex.value = (radarFrameIndex.value + 1) % RADAR_FRAMES.length;
    radarLoop();
  }, RADAR_DURATIONS[radarFrameIndex.value]);
}
// #endif

/* ------------------------------------------------------------------ */
/*  动作                                                                */
/* ------------------------------------------------------------------ */

function goBack() {
  // 页面栈只有当前页（直接打开 URL / 刷新）时退无可退，回首页
  if (getCurrentPages().length > 1)
    uni.navigateBack();
  else
    uni.switchTab({ url: '/pages/home/index' });
}

async function startScanFlow() {
  scanAttempted.value = true;
  // #ifdef MP-WEIXIN
  radarLoop();
  // #endif
  await startScan();
}

function stopScanFlow() {
  scanAttempted.value = true;
  // #ifdef MP-WEIXIN
  if (radarTimer) {
    clearTimeout(radarTimer);
    radarTimer = null;
  }
  // #endif
  stopScan();
}

async function onSelectDevice(device: BLEDevice) {
  try {
    await connectDevice(device);
    currentStep.value = 'wifi';
  }
  catch {
    // connectDevice 已设置 statusText
  }
}

async function onStartPair() {
  if (!wifiSSID.value) {
    uni.showToast({ title: '请输入 WiFi 名称', icon: 'none' });
    return;
  }
  currentStep.value = 'pairing';
  const result = await pair(wifiSSID.value, wifiPass.value, serverUrl.value);
  if (result.success) {
    currentStep.value = 'done';
  }
  else {
    currentStep.value = 'wifi';
  }
}

function onHelp() {
  uni.showToast({ title: '帮助中心开发中', icon: 'none' });
}

function onWeChatGuide() {
  uni.showToast({ title: '小程序码待设计提供', icon: 'none' });
}

function onAppGuide() {
  uni.showToast({ title: '应用商店搜索「宝宝守护」', icon: 'none' });
}

/* ------------------------------------------------------------------ */
/*  生命周期                                                            */
/* ------------------------------------------------------------------ */

onShow(() => {
  // #ifdef MP-WEIXIN
  if (scanning.value && !radarTimer)
    radarLoop();
  // #endif
});

onBeforeUnmount(() => {
  // #ifdef MP-WEIXIN
  if (radarTimer) {
    clearTimeout(radarTimer);
    radarTimer = null;
  }
  // #endif
});
</script>

<template>
  <view class="page">
    <!-- ========= 导航栏 ========= -->
    <view class="navbar flex items-center">
      <view class="navbar__back flex items-center justify-center" @tap="goBack">
        <image class="navbar__back-icon" :src="getIcon('chevron-left', '#3B362E')" mode="aspectFit" />
      </view>
      <text class="navbar__title text-main font-semibold">设备配对</text>
    </view>

    <!-- ========= 三步条（引导态隐藏） ========= -->
    <view v-if="phase !== 'unsupported'" class="steps flex items-center">
      <template v-for="(label, i) in STEP_LABELS" :key="label">
        <view v-if="i > 0" class="steps__line" :class="{ 'steps__line--done': stepStates[i] === 'done' }" />
        <view class="steps__dot rounded-full flex items-center justify-center" :class="`steps__dot--${stepStates[i]}`">
          <text class="steps__num">{{ i + 1 }}</text>
        </view>
        <text class="steps__label" :class="`steps__label--${stepStates[i]}`">{{ label }}</text>
      </template>
    </view>

    <view class="main" :style="{ paddingTop: `${capsuleTopGap}px` }">
      <!-- ========= 不支持蓝牙引导态 ========= -->
      <template v-if="phase === 'unsupported'">
        <view class="guide-hero flex flex-col items-center">
          <view class="guide-hero__circle rounded-full bg-amber-soft flex items-center justify-center">
            <image class="guide-hero__icon" :src="getIcon('bluetooth-off', '#D99A3D')" mode="aspectFit" />
          </view>
          <text class="guide-hero__title text-main font-bold">当前设备不支持蓝牙</text>
          <text class="guide-hero__desc text-secondary">请在手机 App 或微信小程序中完成配对</text>
        </view>

        <view class="group bg-card rounded-card mt-4">
          <view class="row" @tap="onWeChatGuide">
            <view class="row-chip rounded-full bg-primary-soft flex items-center justify-center shrink-0">
              <image class="row-chip__icon" :src="getIcon('bluetooth', '#7BA05B')" mode="aspectFit" />
            </view>
            <view class="row-body flex-1">
              <text class="row-title text-main block">使用微信小程序配对</text>
              <text class="row-desc text-secondary block">扫码即可，无需下载</text>
            </view>
            <image class="row-arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </view>
          <view class="row" @tap="onAppGuide">
            <view class="row-chip rounded-full bg-amber-soft flex items-center justify-center shrink-0">
              <image class="row-chip__icon" :src="getIcon('download', '#B07A28')" mode="aspectFit" />
            </view>
            <view class="row-body flex-1">
              <text class="row-title text-main block">下载 Android / iOS App</text>
              <text class="row-desc text-secondary block">应用商店搜索「宝宝守护」</text>
            </view>
            <image class="row-arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </view>
        </view>

        <view class="qr-placeholder rounded-md flex items-center justify-center mt-6">
          <text class="text-tertiary">小程序码</text>
        </view>
        <text class="qr-hint text-secondary block text-center">微信扫码打开小程序</text>

        <view class="btn-ghost-h48 bg-card rounded-pill flex items-center justify-center mt-8" @tap="goBack">
          <text class="btn-ghost-text text-main">返回</text>
        </view>
      </template>

      <!-- ========= 蓝牙可用流程 ========= -->
      <template v-else>
        <!-- 扫描卡：待机 -->
        <view v-if="phase === 'idle'" class="card bg-card rounded-card">
          <view class="scan-card flex flex-col items-center">
            <view class="scan-card__icon rounded-full bg-primary-soft flex items-center justify-center">
              <image class="scan-card__icon-img" :src="getIcon('search', '#7BA05B')" mode="aspectFit" />
            </view>
            <text class="scan-card__title text-main font-semibold">扫描查找设备</text>
            <text class="scan-card__desc text-secondary">确保设备已通电并靠近手机</text>
            <view class="btn-scan rounded-pill bg-primary flex items-center justify-center" @tap="startScanFlow">
              <text class="text-white font-medium">开始扫描</text>
            </view>
          </view>
        </view>

        <!-- 扫描卡：扫描中（雷达三帧动画） -->
        <view v-if="phase === 'scanning'" class="card bg-card rounded-card">
          <view class="scan-card flex flex-col items-center">
            <view class="scan-card__icon rounded-full bg-amber-soft flex items-center justify-center relative">
              <!-- #ifdef H5 || APP-PLUS -->
              <image class="radar-frame radar-frame--f1" src="/static/icons/ic-radar-f1.svg" mode="aspectFit" />
              <image class="radar-frame radar-frame--f2" src="/static/icons/ic-radar.svg" mode="aspectFit" />
              <image class="radar-frame radar-frame--f3" src="/static/icons/ic-radar-f3.svg" mode="aspectFit" />
              <!-- #endif -->
              <!-- #ifdef MP-WEIXIN -->
              <image class="radar-frame" :src="RADAR_FRAMES[radarFrameIndex]" mode="aspectFit" />
              <!-- #endif -->
            </view>
            <text class="scan-card__title text-main font-semibold">正在扫描附近设备…</text>
            <text class="scan-card__desc text-secondary">请保持设备通电并靠近手机</text>
            <view class="btn-scan btn-scan--ghost rounded-pill bg-card flex items-center justify-center" @tap="stopScanFlow">
              <text class="text-main font-medium">停止扫描</text>
            </view>
          </view>
        </view>

        <!-- 扫描卡：超时未找到 -->
        <view v-if="phase === 'timeout'" class="card bg-card rounded-card">
          <view class="scan-card flex flex-col items-center">
            <view class="scan-card__icon scan-card__icon--lg rounded-full bg-amber-soft flex items-center justify-center relative">
              <image class="scan-card__icon-img" :src="getIcon('radar', '#D99A3D')" mode="aspectFit" />
              <view class="timeout-slash" />
            </view>
            <text class="scan-card__title text-main font-bold">未找到附近设备</text>
            <text class="scan-card__desc scan-card__desc--wide text-secondary">已扫描 30 秒 · 请确认设备已通电、未被其他手机连接，并靠近手机 1 米内</text>
          </view>
        </view>

        <!-- 超时态操作区 -->
        <template v-if="phase === 'timeout'">
          <view class="btn-cta rounded-pill bg-primary flex items-center justify-center gap-2" @tap="startScanFlow">
            <image class="btn-cta__icon" :src="getIcon('spinner', '#ffffff')" mode="aspectFit" />
            <text class="btn-cta__text text-white">重新扫描</text>
          </view>
          <view class="btn-ghost-h48 bg-card rounded-pill flex items-center justify-center mt-3" @tap="onHelp">
            <text class="btn-ghost-text text-main font-medium">配对失败？查看帮助</text>
          </view>
          <text class="footnote text-muted block text-center">提示：设备首次使用需长按电源键 3 秒进入配对模式</text>
        </template>

        <!-- 已发现的设备 -->
        <view v-if="phase === 'idle' || phase === 'scanning'" class="section">
          <view class="flex items-center gap-2 mb-2">
            <text class="section__title block">已发现的设备</text>
            <text v-if="phase === 'scanning'" class="section__count text-secondary">· {{ shownDevices.length }}</text>
          </view>
          <view v-if="shownDevices.length > 0" class="group bg-card rounded-card">
            <view v-for="dev in shownDevices" :key="dev.deviceId" class="dev-row" @tap="onSelectDevice(dev)">
              <image class="dev-row__logo" :src="getIcon('bluetooth', '#3B362E')" mode="aspectFit" />
              <text class="dev-row__name text-main flex-1">{{ dev.name }}</text>
              <view class="signal-bars flex items-end gap-0.5">
                <view
                  v-for="b in 4"
                  :key="b"
                  class="signal-bars__bar rounded-sm"
                  :class="{ 'signal-bars__bar--lit': b <= signalLevel(dev.RSSI) }"
                  :style="{ height: `${4 + b * 3}px` }"
                />
              </view>
              <view class="pill-connect rounded-pill flex items-center justify-center" @tap.stop="onSelectDevice(dev)">
                <text class="pill-connect__text">连接</text>
              </view>
            </view>
            <view v-if="phase === 'scanning'" class="searching-row">
              <uni-load-more
                status="loading"
                :icon-size="18"
                color="#8C8578"
                :content-text="{ contentdown: '', contentrefresh: '正在搜索更多设备…', contentnomore: '' }"
              />
            </view>
          </view>
        </view>

        <!-- WiFi 配网（连接设备后显示） -->
        <template v-if="phase === 'wifi' || phase === 'pairing' || phase === 'done'">
          <view v-if="connectedDevice" class="connected-tip bg-card rounded-card flex items-center gap-2 px-4 py-3">
            <view class="connected-tip__dot rounded-full bg-primary" />
            <text class="text-main flex-1">已连接 {{ connectedDevice.name }}</text>
            <text class="text-secondary">{{ statusText }}</text>
          </view>

          <view class="section">
            <text class="section__title block">WiFi 配网</text>
            <text class="form-hint text-secondary block">填写手机当前连接的 WiFi，用于给设备联网</text>
          </view>

          <view class="form flex flex-col gap-3">
            <view class="input-box rounded-input">
              <text class="input-box__label text-secondary">WiFi 名称 (SSID)</text>
              <input v-model="wifiSSID" class="input-box__input" placeholder="请输入 WiFi 名称" placeholder-class="input-placeholder">
            </view>
            <view class="input-box rounded-input">
              <text class="input-box__label text-secondary">WiFi 密码</text>
              <view class="flex items-center">
                <input
                  v-model="wifiPass"
                  class="input-box__input flex-1"
                  :password="!showPassword"
                  placeholder="请输入 WiFi 密码"
                  placeholder-class="input-placeholder"
                >
                <image
                  class="input-box__eye"
                  :src="getIcon('eye', showPassword ? '#7BA05B' : '#B3AB9D')"
                  mode="aspectFit"
                  @tap="showPassword = !showPassword"
                />
              </view>
            </view>
          </view>

          <view
            v-if="phase !== 'done'"
            class="btn-cta rounded-pill bg-primary flex items-center justify-center mt-6"
            :class="{ 'btn-cta--disabled': phase === 'pairing' }"
            @tap="phase === 'wifi' && onStartPair()"
          >
            <text class="btn-cta__text text-white">{{ phase === 'pairing' ? '正在配网…' : '下一步：配网' }}</text>
          </view>
        </template>

        <!-- 配网中 / 完成 提示 -->
        <view v-if="phase === 'pairing' || phase === 'done'" class="status-card bg-card rounded-card">
          <view class="flex flex-col items-center py-6 gap-2">
            <text class="status-card__title font-semibold" :class="phase === 'done' ? 'text-primary-deep' : 'text-main'">
              {{ phase === 'done' ? '配对成功' : statusText }}
            </text>
            <text class="status-card__desc text-secondary">{{ phase === 'done' ? '设备已联网，开始使用吧' : '设备正在连接 WiFi 和服务器' }}</text>
            <uni-load-more v-if="phase === 'pairing'" status="loading" :icon-size="20" :content-text="{ contentdown: '', contentrefresh: '', contentnomore: '' }" />
          </view>
        </view>
      </template>
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
  padding-top: var(--status-bar-height); // 刘海/灵动岛/状态栏避让（App 端为真实高度）
  min-height: 100vh;
  background-color: $color-bg;
}

/* ------------------------------------------------------------------ */
/*  导航栏                                                              */
/* ------------------------------------------------------------------ */
.navbar {
  gap: 20rpx;
  // 顶部 32rpx = H5 端顶栏呼吸间距（避让变量为 0 时仍离屏幕顶一指宽）；App 端叠加在状态栏避让之上。
  // 用 padding 而非 margin：margin 在盒外会把 min-height 100vh 的页面顶出滚动条
  padding: 32rpx 0 20rpx;

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
}

/* ------------------------------------------------------------------ */
/*  步骤条                                                              */
/* ------------------------------------------------------------------ */
.steps {
  gap: 12rpx;
  padding-top: 8rpx;
  padding-bottom: 28rpx;
}

.steps__dot {
  width: 38rpx;
  height: 38rpx;

  &--done {
    background-color: $color-primary;
  }

  &--active {
    background-color: $color-primary;
  }

  &--pending {
    background-color: $color-card-soft;
  }
}

.steps__num {
  font-size: 21rpx; // micro 11px
  font-weight: 600;
  color: #ffffff;
}

.steps__dot--pending .steps__num {
  color: $color-text-secondary;
}

.steps__label {
  white-space: nowrap;
  font-size: 27rpx; // body 14px
  color: $color-text-muted;

  &--active {
    color: $color-text-primary;
    font-weight: 500;
  }

  &--done {
    color: $color-text-primary;
  }
}

.steps__line {
  width: 27rpx; // 14px
  height: 4rpx;
  border-radius: 2rpx;
  background-color: $color-card-soft;

  &--done {
    background-color: $color-primary;
  }
}

/* ------------------------------------------------------------------ */
/*  主体                                                                */
/* ------------------------------------------------------------------ */
.main {
  display: flex;
  flex-direction: column;
  gap: 27rpx; // 区块间距 14px
  padding-bottom: 48rpx;
}

.card {
  padding: 32rpx;
}

/* ---------- 扫描卡 ---------- */
.scan-card {
  gap: 16rpx;

  &__icon {
    width: 108rpx; // 56px
    height: 108rpx;

    &--lg {
      width: 185rpx; // 96px
      height: 185rpx;
    }
  }

  &__icon-img {
    width: 56rpx;
    height: 56rpx;
  }

  &__title {
    margin-top: 8rpx;
    font-size: 33rpx; // nav-title 级
  }

  &__desc {
    font-size: 25rpx; // caption 13px
    line-height: 1.6;

    &--wide {
      padding: 0 16rpx;
    }
  }
}

.btn-scan {
  width: 200rpx; // 104px
  height: 65rpx; // 34px
  margin-top: 12rpx;

  &--ghost {
    border: 1px solid $color-border-btn;
  }
}

.timeout-slash {
  position: absolute;
  width: 3px;
  height: 60%;
  background-color: $color-danger;
  border-radius: 2px;
  transform: rotate(45deg);
}

/* ---------- CTA / 次按钮 ---------- */
.btn-cta {
  height: 96rpx; // h50

  &__icon {
    width: 32rpx;
    height: 32rpx;
  }

  &__text {
    font-size: 29rpx; // value 15px
    font-weight: 500;
  }

  &--disabled {
    opacity: 0.6;
  }
}

.btn-ghost-h48 {
  height: 92rpx; // h48
}

.btn-ghost-text {
  font-size: 29rpx;
  font-weight: 500;
}

.footnote {
  margin-top: 20rpx;
  font-size: 21rpx; // micro 11px
}

/* ---------- 设备列表 ---------- */
.section__title {
  @include section-title;
  color: $color-ink-group;
  padding-left: 4rpx;
}

.section__count {
  font-size: 25rpx;
}

.group {
  border: 1px solid $color-border;
}

.dev-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  // 盒参数与设置页 .row 保持一致（单行 cell 高度统一）
  min-height: 1.1rem;
  padding: 20rpx 32rpx;

  & + .dev-row {
    border-top: 1px solid $color-divider;
  }
}

.dev-row__logo {
  width: 42rpx; // 22px
  height: 42rpx;
}

.dev-row__name {
  font-size: 27rpx; // body 14px
  font-weight: 500;
}

.pill-connect {
  width: 100rpx; // 52px
  height: 54rpx; // 28px
  background-color: $color-primary-soft;

  &__text {
    font-size: 25rpx;
    font-weight: 500;
    color: $color-primary-deep;
  }
}

.searching-row {
  border-top: 1px solid $color-divider;
  padding: 8rpx 0;
}

/* ---------- 信号条（规范 13.2 纯 CSS） ---------- */
.signal-bars__bar {
  width: 6rpx;
  background-color: $color-text-muted;

  &--lit {
    background-color: $color-primary;
  }
}

/* ---------- WiFi 表单 ---------- */
.section .form-hint {
  margin-top: 10rpx;
  padding-left: 4rpx;
  font-size: 25rpx;
}

.form {
  margin-top: 4rpx;
}

.input-box {
  padding: 16rpx 24rpx;
  border: 1px solid $color-border;

  &__label {
    font-size: 21rpx; // 浮动标签 11px
  }

  &__input {
    margin-top: 6rpx;
    font-size: 29rpx; // 值 15px
    color: $color-text-primary;
    height: 48rpx;
  }

  &__eye {
    width: 36rpx; // 18px
    height: 36rpx;
  }
}

:deep(.input-placeholder) {
  color: $color-text-muted;
}

/* ---------- 引导态 ---------- */
.guide-hero {
  gap: 16rpx;
  padding: 24rpx 0 8rpx;

  &__circle {
    width: 185rpx;
    height: 185rpx;
  }

  &__icon {
    width: 80rpx;
    height: 80rpx;
  }

  &__title {
    margin-top: 16rpx;
    font-size: 44rpx; // display 23px
  }

  &__desc {
    font-size: 25rpx;
  }
}

.row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  min-height: 108rpx;
  padding: 24rpx 32rpx;

  & + .row {
    border-top: 1px solid $color-divider;
  }
}

.row-chip {
  width: 64rpx;
  height: 64rpx;

  &__icon {
    width: 32rpx;
    height: 32rpx;
  }
}

.row-body {
  min-width: 0;
}

.row-title {
  font-size: 27rpx;
  font-weight: 500;
}

.row-desc {
  margin-top: 4rpx;
  font-size: 24rpx;
}

.row-arrow {
  width: 28rpx;
  height: 28rpx;
}

.qr-placeholder {
  width: 212rpx; // 110px
  height: 212rpx;
  margin: 0 auto;
  background-color: #e3e7ee;
}

.qr-hint {
  margin-top: 16rpx;
  font-size: 24rpx;
}

/* ---------- 雷达三帧动画（H5/App；小程序走 src 轮换） ---------- */
/* eslint-disable uni-app/no-unsafe-keyboard, style/media-feature-name-no-vendor-prefix -- 关键帧命名 */
/* stylelint-disable */
.radar-frame {
  width: 56rpx;
  height: 56rpx;
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.radar-frame--f1 {
  animation: radar-kf-f1 480ms linear infinite;
}

.radar-frame--f2 {
  animation: radar-kf-f2 480ms linear infinite;
}

.radar-frame--f3 {
  animation: radar-kf-f3 480ms linear infinite;
}

/* 三帧窗口：f1 0-120ms（25%）、f2 120-280ms（25%~58.3%）、f3 280-480ms（58.3%~100%） */
@keyframes radar-kf-f1 {
  0%, 24.9% { opacity: 1; }
  25%, 100% { opacity: 0; }
}

@keyframes radar-kf-f2 {
  0%, 24.9% { opacity: 0; }
  25%, 58.2% { opacity: 1; }
  58.3%, 100% { opacity: 0; }
}

@keyframes radar-kf-f3 {
  0%, 58.2% { opacity: 0; }
  58.3%, 100% { opacity: 1; }
}

/* ---------- 状态卡（配网中/完成） ---------- */
.status-card {
  &__title {
    font-size: 33rpx;
  }

  &__desc {
    font-size: 25rpx;
  }
}

.connected-tip {
  border: 1px solid $color-border;

  &__dot {
    width: 12rpx;
    height: 12rpx;
  }
}
</style>
