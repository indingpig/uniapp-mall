<script setup lang="ts">
import type { BLEDevice, WifiAp } from '@/hooks/useBLE';
import { onShow } from '@dcloudio/uni-app';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { CACHE_KEY } from '@/constants/cache';
import { useBLE } from '@/hooks/useBLE';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';
import { getIcon } from '@/utils/icons';
import { getConnectedSsid, scanWifiQr } from '@/utils/wifi';

const {
  scanning,
  devices,
  connectedDevice,
  wifiList,
  wifiScanning,
  startScan,
  stopScan,
  connectDevice,
  startWifiScan,
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
// 服务器地址优先级：上次配对成功写入的值 > 构建期环境变量 > 空（手填）
// 规范 5.4：换网络忘改会把设备指到不可达地址；不在代码里写死 IP，改 .env.* 即可
const serverUrl = ref(
  uni.getStorageSync(CACHE_KEY.PAIRED_SERVER_URL) || import.meta.env.VITE_WS_URL || '',
);
const scanAttempted = ref(false);

/* ---------- 规范 5.4：WiFi 配网页状态 ---------- */

const showAdvanced = ref(false); // 高级设置（服务器地址）默认收起
const showAllNetworks = ref(false); // 「其他网络」弹框开关
const passwordError = ref(false); // 密码行内错误（就地提示，不用 toast）
const modalDismissed = ref(false); // 成功弹框「稍后再说」
const pairedAtText = ref('');
const pageToast = ref(''); // 深色 toast（瞬时反馈，CTA 上方居中）
let pageToastTimer: ReturnType<typeof setTimeout> | null = null;

watch(wifiPass, () => {
  if (passwordError.value)
    passwordError.value = false; // 用户改密码即清除行内错误
});

/** 深色 toast：显示 2.5s 自动消失（规范 5.4 失败分级 ②） */
function showToast(msg: string) {
  pageToast.value = msg;
  if (pageToastTimer)
    clearTimeout(pageToastTimer);
  pageToastTimer = setTimeout(() => {
    pageToast.value = '';
  }, 2500);
}

/** 服务器地址展示（弹框/高级设置行）：剥掉 ws:// 前缀，与设计稿一致 */
const serverHost = computed(() => serverUrl.value.replace(/^wss?:\/\//, ''));

/** 列表默认露 3 条，完整列表进「其他网络」弹框（规范 5.4 板 1 不在卡内放长列表） */
const visibleAps = computed(() => wifiList.value.slice(0, 3));

/* ---------- 周边 WiFi 列表（设备扫描，免手输 SSID） ---------- */

const selectedApSsid = ref('');

async function onFetchWifiList() {
  selectedApSsid.value = '';
  showAllNetworks.value = false;
  try {
    await startWifiScan();
  }
  catch (e) {
    showToast((e as Error).message);
  }
}

function onPickAp(ap: WifiAp) {
  if (ap.auth === 0) {
    showToast('该 WiFi 未加密，暂不支持开放网络');
    return;
  }
  wifiSSID.value = ap.ssid;
  selectedApSsid.value = ap.ssid;
}

/** 弹框内点选：无论成败都收起弹框（开放网络被拒时 toast 留在页面层可见） */
function onPickApInModal(ap: WifiAp) {
  onPickAp(ap);
  showAllNetworks.value = false;
}

/** 预选手机当前连接的 WiFi：用户只需输密码，取不到就保持手输 */
async function preselectCurrentWifi() {
  const ssid = await getConnectedSsid();
  if (!ssid || wifiSSID.value)
    return;
  wifiSSID.value = ssid;
  selectedApSsid.value = ssid;
}

/** 扫码填入：先让用户在系统里「分享 WiFi」生成二维码，再扫进来 */
async function onScanWifiQr() {
  const res = await scanWifiQr();
  if (res.status === 'cancel')
    return;
  if (res.status === 'invalid') {
    showToast('未识别到 WiFi 二维码');
    return;
  }
  if (!res.data.password) {
    // 扫到的是开放网络的分享码：产品上不支持无密码 WiFi，直接拒绝
    showToast('该 WiFi 未设置密码，暂不支持开放网络');
    return;
  }
  wifiSSID.value = res.data.ssid;
  selectedApSsid.value = res.data.ssid;
  if (res.data.password)
    wifiPass.value = res.data.password;
  showToast('已填入 WiFi 信息');
}

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
  // wifi/pairing/done 由 currentStep 决定且不回退：配网中设备掉线时
  // connectedDevice 会被 useBLE 清空，若回退到扫描态会与「已连接」提示互斥（规范 5.4 问题②）
  if (currentStep.value === 'pairing')
    return 'pairing';
  if (currentStep.value === 'done')
    return 'done';
  if (currentStep.value === 'wifi')
    return 'wifi';
  if (scanning.value)
    return 'scanning';
  if (scanAttempted.value && !scanning.value && devices.value.length === 0)
    return 'timeout';
  return 'idle';
});

/** 配网流程中设备是否掉线（设备状态条切灰态，规范 5.4 失败分级 ③） */
const deviceLost = computed(() => phase.value !== 'unsupported' && !connectedDevice.value && currentStep.value !== 'scan');

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
  if (phase.value === 'done')
    return ['done', 'done', 'done']; // 配对闭环：三步全亮
  return ['done', 'done', 'pending']; // wifi/pairing：进行中——圆点/文字保持中性，横杠由 stepLines 点亮
});

/** 连接线独立于圆点点亮：进入第 3 步（含进行中）2-3 横杠即亮，timeout 只亮 1-2 */
const stepLines = computed<boolean[]>(() => {
  if (phase.value === 'wifi' || phase.value === 'pairing' || phase.value === 'done')
    return [true, true, true];
  if (phase.value === 'timeout')
    return [false, true, false];
  return [false, false, false];
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

const connectingId = ref(''); // 正在连接的设备（connect 内部含 1s 稳定等待 + 服务发现，需即时反馈防「点了没反应」）

async function onSelectDevice(device: BLEDevice) {
  if (connectingId.value)
    return; // 连接进行中，忽略重复点击
  connectingId.value = device.deviceId;
  try {
    await connectDevice(device);
    currentStep.value = 'wifi';
    preselectCurrentWifi();
  }
  catch {
    // connectDevice 已设置 statusText
  }
  finally {
    connectingId.value = '';
  }
}

async function onStartPair() {
  // 环境变量缺失时 serverUrl 可能是空串，别让固件收到空地址后静默失败
  if (!serverUrl.value) {
    showAdvanced.value = true;
    showToast('请填写服务器地址');
    return;
  }
  if (!wifiSSID.value) {
    showToast('请输入 WiFi 名称');
    return;
  }
  if (!wifiPass.value) {
    // 手输 SSID 没填密码也会走到这里：开放网络产品上不支持（热点/随身 WiFi 自带密码）
    showToast('请输入 WiFi 密码（暂不支持开放网络）');
    return;
  }
  passwordError.value = false;
  modalDismissed.value = false;
  currentStep.value = 'pairing';
  const result = await pair(wifiSSID.value, wifiPass.value, serverUrl.value);
  if (result.success) {
    const now = new Date();
    pairedAtText.value = `今天 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    currentStep.value = 'done';
  }
  else if (result.message === 'wifi_password') {
    // 规范 5.4 失败分级 ①: 就地错误 —— 密码行浅红底 + 行内提示, 不用 toast
    passwordError.value = true;
    currentStep.value = 'wifi';
  }
  else {
    currentStep.value = 'wifi';
    if (result.message === 'server_unreachable') {
      showToast('WiFi 已连通，但服务器不可达：请启动后台服务或检查服务器地址');
    }
    else if (result.message === 'wifi_failed') {
      showToast('WiFi 连接失败，请检查密码和信号');
    }
    else {
      showToast(result.message === 'timeout' ? '配对超时，请重试' : `配对失败：${result.message}`);
    }
  }
}

function enterHome() {
  uni.switchTab({ url: '/pages/home/index' });
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
  if (pageToastTimer) {
    clearTimeout(pageToastTimer);
    pageToastTimer = null;
  }
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
    <view class="navbar sticky-top flex items-center">
      <view class="navbar__back flex items-center justify-center" @tap="goBack">
        <image class="navbar__back-icon" :src="getIcon('chevron-left', 'ink')" mode="aspectFit" />
      </view>
      <text class="navbar__title text-main font-semibold">设备配对</text>
    </view>

    <!-- ========= 三步条（引导态隐藏） ========= -->
    <view v-if="phase !== 'unsupported'" class="steps flex items-center">
      <template v-for="(label, i) in STEP_LABELS" :key="label">
        <view v-if="i > 0" class="steps__line" :class="{ 'steps__line--done': stepLines[i] }" />
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
            <image class="guide-hero__icon" :src="getIcon('bluetooth-off', 'amber')" mode="aspectFit" />
          </view>
          <text class="guide-hero__title text-main font-bold">当前设备不支持蓝牙</text>
          <text class="guide-hero__desc text-secondary">请在手机 App 或微信小程序中完成配对</text>
        </view>

        <view class="group bg-card rounded-card mt-4">
          <view class="row" @tap="onWeChatGuide">
            <view class="row-chip rounded-full bg-primary-soft flex items-center justify-center shrink-0">
              <image class="row-chip__icon" :src="getIcon('bluetooth', 'primary')" mode="aspectFit" />
            </view>
            <view class="row-body flex-1">
              <text class="row-title text-main block">使用微信小程序配对</text>
              <text class="row-desc text-secondary block">扫码即可，无需下载</text>
            </view>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
          </view>
          <view class="row" @tap="onAppGuide">
            <view class="row-chip rounded-full bg-amber-soft flex items-center justify-center shrink-0">
              <image class="row-chip__icon" :src="getIcon('download', 'amberInk')" mode="aspectFit" />
            </view>
            <view class="row-body flex-1">
              <text class="row-title text-main block">下载 Android / iOS App</text>
              <text class="row-desc text-secondary block">应用商店搜索「宝宝守护」</text>
            </view>
            <image class="row-arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
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
              <image class="scan-card__icon-img" :src="getIcon('search', 'primary')" mode="aspectFit" />
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
              <image class="scan-card__icon-img" :src="getIcon('radar', 'amber')" mode="aspectFit" />
              <view class="timeout-slash" />
            </view>
            <text class="scan-card__title text-main font-bold">未找到附近设备</text>
            <text class="scan-card__desc scan-card__desc--wide text-secondary">已扫描 30 秒 · 请确认设备已通电、未被其他手机连接，并靠近手机 1 米内</text>
          </view>
        </view>

        <!-- 超时态操作区 -->
        <template v-if="phase === 'timeout'">
          <AppButton size="cta" @tap="startScanFlow">
            <image class="btn-cta__icon" :src="getIcon('spinner', 'white')" mode="aspectFit" />
            重新扫描
          </AppButton>
          <AppButton size="quick" variant="secondary" class="mt-3" @tap="onHelp">
            配对失败？查看帮助
          </AppButton>
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
              <image class="dev-row__logo" :src="getIcon('bluetooth', 'ink')" mode="aspectFit" />
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
              <view
                class="pill-connect rounded-pill flex items-center justify-center"
                :class="{ 'pill-connect--busy': connectingId === dev.deviceId }"
                @tap.stop="onSelectDevice(dev)"
              >
                <text class="pill-connect__text">{{ connectingId === dev.deviceId ? '连接中…' : '连接' }}</text>
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

        <!-- WiFi 配网（连接设备后显示，规范 5.4 板 1 紧凑重设计） -->
        <template v-if="phase === 'wifi' || phase === 'pairing' || phase === 'done'">
          <!-- 设备状态紧凑条：绿=已连接，灰=配网中掉线（失败分级 ③；状态互斥修复，问题②） -->
          <view class="dev-bar bg-card rounded-card" :class="{ 'dev-bar--lost': deviceLost }">
            <view class="dev-bar__dot rounded-full" :class="deviceLost ? 'dev-bar__dot--gray' : 'bg-primary'" />
            <text class="dev-bar__name text-main flex-1">{{ connectedDevice?.name ?? '设备已断开' }}</text>
            <view class="dev-bar__badge rounded-pill" :class="{ 'dev-bar__badge--gray': deviceLost }">
              <text class="dev-bar__badge-text" :class="{ 'dev-bar__badge-text--gray': deviceLost }">{{ deviceLost ? '已断开' : '已连接' }}</text>
            </view>
          </view>

          <!-- WiFi 选择单卡 -->
          <view class="wifi-card bg-card rounded-card">
            <!-- SSID 行 + 行尾扫码入口 -->
            <view class="wifi-ssid flex items-center">
              <view class="wifi-ssid__body flex-1">
                <text class="wifi-ssid__label text-secondary block">WiFi 名称 (SSID)</text>
                <input
                  v-model="wifiSSID"
                  class="wifi-ssid__input"
                  placeholder="选择或输入 WiFi 名称"
                  placeholder-class="input-placeholder"
                >
              </view>
              <view class="wifi-scan-btn rounded-md" @tap="onScanWifiQr">
                <image class="wifi-scan-btn__icon" :src="getIcon('scan', 'primary')" mode="aspectFit" />
              </view>
            </view>

            <view class="wifi-card__divider" />

            <!-- 周边列表头 -->
            <view class="wifi-head flex items-center justify-between">
              <text class="wifi-head__label text-secondary">周边 WiFi</text>
              <text
                class="wifi-head__refresh"
                :class="{ 'wifi-head__refresh--disabled': wifiScanning }"
                @tap="!wifiScanning && onFetchWifiList()"
              >
                {{ wifiScanning ? '刷新中…' : '刷新列表' }}
              </text>
            </view>

            <!-- 列表：默认露 3 条，其余收进「其他网络」展开行；选中 = 绿字加粗（v1.1.23 不打勾） -->
            <template v-if="wifiList.length">
              <view
                v-for="ap in visibleAps"
                :key="ap.ssid"
                class="wifi-row flex items-center justify-between"
                @tap="onPickAp(ap)"
              >
                <text class="wifi-row__ssid" :class="{ 'wifi-row__ssid--selected': selectedApSsid === ap.ssid }">{{ ap.ssid }}</text>
                <view class="flex items-center gap-2">
                  <text v-if="ap.auth > 0" class="wifi-row__tag rounded-pill text-secondary">加密</text>
                  <text class="wifi-row__rssi text-secondary">{{ ap.rssi }} dBm</text>
                </view>
              </view>
              <view v-if="!showAllNetworks && wifiList.length > 3" class="wifi-more flex items-center justify-center gap-1" @tap="showAllNetworks = true">
                <text class="wifi-more__text text-secondary">
                  其他网络（{{ wifiList[3].ssid }} 等 {{ wifiList.length - 3 }} 个）
                </text>
                <image class="wifi-more__arrow" :src="getIcon('chevron-down', 'muted')" mode="aspectFit" />
              </view>
            </template>
            <text v-else-if="!wifiScanning" class="wifi-empty text-secondary block">点「刷新列表」，首次会弹系统配对框，确认后开始扫描</text>

            <view class="wifi-card__divider" />

            <!-- 密码行：错误态浅红底 + 红字 + 行内提示（失败分级 ①，不用 toast） -->
            <view class="wifi-pass" :class="{ 'wifi-pass--error': passwordError }">
              <text class="wifi-pass__label text-secondary block">WiFi 密码</text>
              <view class="flex items-center">
                <input
                  v-model="wifiPass"
                  class="wifi-pass__input flex-1"
                  :class="{ 'wifi-pass__input--error': passwordError }"
                  :password="!showPassword"
                  placeholder="请输入 WiFi 密码"
                  placeholder-class="input-placeholder"
                >
                <image
                  class="wifi-pass__eye"
                  :src="getIcon('eye', showPassword ? 'primary' : 'muted')"
                  mode="aspectFit"
                  @tap="showPassword = !showPassword"
                />
              </view>
              <view v-if="passwordError" class="wifi-pass__error flex items-center gap-1">
                <image class="wifi-pass__error-icon" :src="getIcon('error', 'danger')" mode="aspectFit" />
                <text class="wifi-pass__error-text">WiFi 密码错误，请重新输入</text>
              </view>
            </view>

            <view class="wifi-card__divider" />

            <!-- 高级设置折叠行（服务器地址，默认收起） -->
            <view class="wifi-adv flex items-center justify-between" @tap="showAdvanced = !showAdvanced">
              <text class="wifi-adv__label text-main">高级设置 · 服务器地址</text>
              <view class="flex items-center gap-1">
                <text class="wifi-adv__value text-secondary">{{ serverHost || '默认' }}</text>
                <image class="wifi-adv__arrow" :class="{ 'wifi-adv__arrow--open': showAdvanced }" :src="getIcon('chevron-down', 'muted')" mode="aspectFit" />
              </view>
            </view>
            <view v-if="showAdvanced" class="wifi-adv__body">
              <input
                v-model="serverUrl"
                class="wifi-adv__input"
                placeholder="ws://IP:3001/ws"
                placeholder-class="input-placeholder"
              >
            </view>
          </view>

          <!-- 给吸底 CTA 让位 -->
          <view class="cta-spacer" />
        </template>

        <!-- 深色 toast：瞬时反馈（刷新列表失败/扫码失败等），CTA 上方居中（失败分级 ②） -->
        <view v-if="pageToast && phase !== 'idle' && phase !== 'scanning' && phase !== 'timeout'" class="page-toast rounded-pill">
          <text class="page-toast__text">{{ pageToast }}</text>
        </view>

        <!-- 吸底主 CTA（配网中 = 规范禁用灰态，防重复提交） -->
        <view v-if="phase === 'wifi' || phase === 'pairing'" class="cta-bar">
          <AppButton size="cta" :disabled="phase === 'pairing'" @tap="phase === 'wifi' && onStartPair()">
            {{ phase === 'pairing' ? '正在配网…' : '连接设备，完成配对' }}
          </AppButton>
        </view>

        <!-- 配对成功弹框（规范 5.4 板 2：遮罩 + 居中白卡，不做独立成功页） -->
        <view v-if="phase === 'done' && !modalDismissed" class="success-mask" @tap="modalDismissed = true">
          <view class="success-modal" @tap.stop>
            <view class="success-modal__check rounded-full flex items-center justify-center">
              <image class="success-modal__check-icon" :src="getIcon('check', 'primary')" mode="aspectFit" />
            </view>
            <text class="success-modal__title">配对成功</text>
            <text class="success-modal__desc text-secondary">设备已联网，开始使用吧</text>
            <view class="success-modal__info rounded-md">
              <view class="success-modal__row">
                <text class="success-modal__row-label">网络</text>
                <text class="success-modal__row-value">{{ wifiSSID }}</text>
              </view>
              <view class="success-modal__row">
                <text class="success-modal__row-label">服务器</text>
                <text class="success-modal__row-value">{{ serverHost }}</text>
              </view>
              <view class="success-modal__row">
                <text class="success-modal__row-label">配对时间</text>
                <text class="success-modal__row-value">{{ pairedAtText }}</text>
              </view>
            </view>
            <AppButton size="cta" class="success-modal__cta" @tap="enterHome">
              进入首页
            </AppButton>
            <text class="success-modal__later" @tap="modalDismissed = true">稍后再说，留在当前页</text>
          </view>
        </view>

        <!-- 「其他网络」弹框：完整 WiFi 列表选择器（卡内只露 3 条，规范 5.4 板 1） -->
        <view v-if="showAllNetworks" class="net-mask" @tap="showAllNetworks = false">
          <view class="net-modal" @tap.stop>
            <text class="net-modal__title text-main font-semibold">其他网络</text>
            <text class="net-modal__sub text-secondary block">共 {{ wifiList.length }} 个网络 · 点选自动填入</text>
            <scroll-view class="net-modal__list" scroll-y>
              <view
                v-for="ap in wifiList"
                :key="ap.ssid"
                class="net-modal__row flex items-center justify-between"
                @tap="onPickApInModal(ap)"
              >
                <text class="net-modal__ssid" :class="{ 'net-modal__ssid--selected': selectedApSsid === ap.ssid }">{{ ap.ssid }}</text>
                <view class="flex items-center gap-2">
                  <text v-if="ap.auth > 0" class="net-modal__tag rounded-pill text-secondary">加密</text>
                  <text class="net-modal__rssi text-secondary">{{ ap.rssi }} dBm</text>
                </view>
              </view>
            </scroll-view>
            <text class="net-modal__close text-secondary" @tap="showAllNetworks = false">收起</text>
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
  padding-top: 0; // 状态栏避让移入吸顶 navbar 自身（滚动吸顶后由它的不透明背景盖住状态栏区域）
  min-height: 100vh;
  background-color: $color-bg;
}

/* ------------------------------------------------------------------ */
/*  导航栏                                                              */
/* ------------------------------------------------------------------ */
.navbar {
  gap: 20rpx;
  // 吸顶（.sticky-top 原子类：sticky/top/z/不透明背景），返回键行固定不随内容滚走。
  // 状态栏避让放进自身 padding —— sticky top:0 吸到的是屏幕最上沿，吸顶后背景盖住
  // 状态栏区域，标题始终在系统状态栏下方
  // 顶部 32rpx = H5 端顶栏呼吸间距（避让变量为 0 时仍离屏幕顶一指宽）；App 端叠加在状态栏避让之上。
  // 用 padding 而非 margin：margin 在盒外会把 min-height 100vh 的页面顶出滚动条
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

/* ---------- CTA 图标（按钮本体为共享组件 AppButton，样式由组件提供） ---------- */
.btn-cta__icon {
  width: 32rpx;
  height: 32rpx;
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
  // 分组列表行统一自 list-item.scss 的 list-row（单行 cell 高度与设置页一致）
  @include list-row($gap: 16rpx);
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
  // 不能写死 width: 「连接中…」比「连接」宽，固定宽度会挤到换行、被 54rpx 高度裁掉
  min-width: 100rpx; // 52px
  height: 54rpx;     // 28px
  padding: 0 16rpx;
  background-color: $color-primary-soft;

  &--busy {
    opacity: 0.6;   // 连接中整体减淡，兼作禁用态反馈
  }

  &__text {
    font-size: 25rpx;
    font-weight: 500;
    color: $color-primary-deep;
    white-space: nowrap;
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

/* ---------- 设备状态紧凑条（规范 5.4） ---------- */
.dev-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  border: 1px solid $color-border;

  &__dot {
    width: 12rpx;
    height: 12rpx;

    &--gray {
      background-color: $color-text-muted;
    }
  }

  &__name {
    font-size: 27rpx; // body 14px
    font-weight: 500;
  }

  &__badge {
    padding: 4rpx 20rpx;
    background-color: $color-primary-soft;

    &--gray {
      background-color: $color-card-soft;
    }
  }

  &__badge-text {
    font-size: 22rpx;
    font-weight: 500;
    color: $color-primary-deep;

    &--gray {
      color: $color-text-secondary;
    }
  }
}

/* ---------- WiFi 选择单卡（规范 5.4 板 1） ---------- */
.wifi-card {
  &__divider {
    height: 1px;
    margin: 0 24rpx;
    background-color: $color-divider;
  }
}

.wifi-ssid {
  gap: 16rpx;
  padding: 24rpx;

  &__label {
    font-size: 21rpx; // 浮动标签 11px
  }

  &__input {
    margin-top: 6rpx;
    height: 48rpx;
    font-size: 29rpx; // value 15px
    color: $color-text-primary;
  }
}

.wifi-scan-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 70rpx; // 36px
  height: 70rpx;
  background-color: $color-primary-soft;
  flex-shrink: 0;

  &__icon {
    width: 36rpx;
    height: 36rpx;
  }
}

.wifi-head {
  padding: 20rpx 24rpx 8rpx;

  &__label {
    font-size: 25rpx;
  }

  &__refresh {
    font-size: 25rpx;
    color: $color-primary;

    &--disabled {
      opacity: 0.6;
    }
  }
}

.wifi-row {
  padding: 0 24rpx;
  height: 72rpx;

  &__ssid {
    font-size: 28rpx;
    color: $color-text-primary;

    &--selected {
      color: $color-primary-deep; // 规范 v1.1.23: 选中绿字加粗, 不打勾
      font-weight: 600;
    }
  }

  &__tag {
    font-size: 22rpx;
    padding: 2rpx 10rpx;
    border: 1px solid $color-border;
  }

  &__rssi {
    font-size: 22rpx;
    min-width: 90rpx;
    text-align: right;
  }
}

.wifi-more {
  padding: 16rpx 0;

  &__text {
    font-size: 25rpx;
  }

  &__arrow {
    width: 28rpx;
    height: 28rpx;
  }
}

.wifi-empty {
  padding: 12rpx 24rpx 20rpx;
  font-size: 24rpx;
}

.wifi-pass {
  padding: 24rpx;

  &--error {
    background-color: #fdf3f1; // 规范: 错误行浅红底
  }

  &__label {
    font-size: 21rpx;
  }

  &__input {
    margin-top: 6rpx;
    height: 48rpx;
    font-size: 29rpx;
    color: $color-text-primary;

    &--error {
      color: $color-danger; // 密码值红字
    }
  }

  &__eye {
    width: 36rpx;
    height: 36rpx;
  }

  &__error {
    margin-top: 8rpx;

    &-icon {
      width: 30rpx;
      height: 30rpx;
    }

    &-text {
      font-size: 24rpx;
      color: $color-danger;
    }
  }
}

.wifi-adv {
  padding: 24rpx;

  &__label {
    font-size: 27rpx;
    font-weight: 500;
  }

  &__value {
    display: block;
    max-width: 320rpx;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 24rpx;
  }

  &__arrow {
    width: 28rpx;
    height: 28rpx;
    transition: transform 150ms;

    &--open {
      transform: rotate(180deg);
    }
  }

  &__body {
    padding: 0 24rpx 24rpx;
  }

  &__input {
    box-sizing: border-box;
    width: 100%;
    height: 72rpx;
    padding: 0 20rpx;
    font-size: 25rpx;
    color: $color-text-primary;
    border: 1px solid $color-border;
    border-radius: 12rpx; // r12
  }
}

:deep(.input-placeholder) {
  color: $color-text-muted;
}

/* ---------- 深色 toast（失败分级 ②，CTA 上方居中） ---------- */
.page-toast {
  position: fixed;
  left: 50%;
  bottom: 220rpx;
  transform: translateX(-50%);
  z-index: 30;
  padding: 16rpx 36rpx;
  background-color: rgba(59, 54, 46, 0.92); // #3B362E 92%

  &__text {
    font-size: 25rpx;
    color: #ffffff;
  }
}

/* ---------- 吸底主 CTA ---------- */
.cta-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  box-sizing: border-box;
  padding: 20rpx 40rpx calc(20rpx + env(safe-area-inset-bottom)); // 容器 padding 20/21
  background-color: $color-bg;
}

.cta-spacer {
  height: 180rpx; // 吸底 CTA 高度 + 间距
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

/* ---------- 配对成功弹框（规范 5.4 板 2） ---------- */
.success-mask {
  position: fixed;
  inset: 0;
  z-index: 200; // 高于吸顶顶栏(.sticky-top z-100)：遮罩必须连顶栏一起压暗，否则顶栏「浮」在弹框上
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.35); // #00000059
}

.success-modal {
  box-sizing: border-box;
  width: 590rpx;
  padding: 48rpx 40rpx 32rpx;
  border-radius: 32rpx;
  background-color: $color-card;
  display: flex;
  flex-direction: column;
  align-items: center;

  &__check {
    width: 124rpx; // 64px
    height: 124rpx;
    background-color: $color-primary-soft;
  }

  &__check-icon {
    width: 60rpx;
    height: 60rpx;
  }

  &__title {
    margin-top: 24rpx;
    font-size: 46rpx; // 24px
    font-weight: 700;
    color: $color-primary-deep;
  }

  &__desc {
    margin-top: 8rpx;
    font-size: 25rpx;
  }

  &__info {
    width: 100%;
    margin-top: 32rpx;
    padding: 8rpx 24rpx;
    background-color: $color-bg;
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 72rpx;

    & + & {
      border-top: 1px solid $color-divider;
    }
  }

  &__row-label {
    font-size: 25rpx;
    color: $color-text-secondary;
  }

  &__row-value {
    display: block;
    max-width: 380rpx;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 25rpx;
    font-weight: 500;
    color: $color-text-primary;
  }

  &__cta {
    margin-top: 40rpx; // 按钮本体为 AppButton（宽度/胶囊/主色/禁用态由组件提供）
  }

  &__later {
    margin-top: 20rpx;
    font-size: 24rpx;
    color: $color-text-muted;
  }
}

/* ---------- 「其他网络」弹框（完整列表选择器，遮罩/白卡与成功弹框同款） ---------- */
.net-mask {
  position: fixed;
  inset: 0;
  z-index: 200; // 与成功弹框一致，高于吸顶顶栏
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.35); // #00000059
}

.net-modal {
  box-sizing: border-box;
  width: 590rpx; // 与成功弹框同宽
  padding: 40rpx 32rpx 20rpx;
  border-radius: 32rpx;
  background-color: $color-card;
  display: flex;
  flex-direction: column;

  &__title {
    font-size: 33rpx; // nav-title 级
  }

  &__sub {
    margin-top: 6rpx;
    font-size: 22rpx;
  }

  // scroll-view 需要受限高度才能滚：max-height 在 H5/App 正常，小程序端启用时再适配
  &__list {
    max-height: 56vh;
    margin-top: 20rpx;
  }

  &__row {
    height: 80rpx;
    padding: 0 8rpx;

    & + & {
      border-top: 1px solid $color-divider;
    }
  }

  &__ssid {
    display: block;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 28rpx;
    color: $color-text-primary;

    &--selected {
      color: $color-primary-deep;
      font-weight: 600;
    }
  }

  &__tag {
    font-size: 22rpx;
    padding: 2rpx 10rpx;
    border: 1px solid $color-border;
  }

  &__rssi {
    font-size: 22rpx;
    min-width: 90rpx;
    text-align: right;
  }

  &__close {
    margin-top: 16rpx;
    padding: 16rpx 0 8rpx;
    text-align: center;
    font-size: 24rpx;
  }
}
</style>
