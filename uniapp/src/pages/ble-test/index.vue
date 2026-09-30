<script setup lang="ts">
import type { Advertisement } from '@/uni_modules/bin-bluetooth';
import { onBeforeUnmount, ref } from 'vue';
// #ifndef H5
import {
  characteristicOf,
  createPeripheral,
  createScanner,
  openAdapter,
} from '@/uni_modules/bin-bluetooth';
// #endif
// 注意:getIcon 导入必须放在平台条件块之外 —— eslint 导入排序曾把它挪进上方
// 平台块内,H5 编译剥掉该块后 getIcon 未定义,返回按钮会渲染成注释节点
import { getIcon } from '@/utils/icons';
// #ifdef H5
interface H5ScannerLike { startScan: (o: never) => void; stopScan: () => void }
interface H5PeripheralLike {
  connect: () => Promise<void>;
  disconnect: () => void;
  onStateChange: (cb: (s: number) => void) => void;
  discoverServices: (cb: (s: string, c: string, p: number) => void) => Promise<void>;
  observe: (r: never, h: { onValue: (v: string) => void; onError: (e: { errMsg: string }) => void }) => void;
  write: (r: never, v: string, t: number) => Promise<void>;
}
declare function createScanner(): H5ScannerLike;
declare function createPeripheral(id: string): H5PeripheralLike;
declare function characteristicOf(s: string, c: string): never;
declare function openAdapter(): Promise<boolean>;
// #endif

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_TX_UUID = 'beb5483e-36e1-4688-b7f5-000000000001';
const CHAR_RX_UUID = 'beb5483e-36e1-4688-b7f5-000000000002';

const log = ref<string[]>([]);
const textInput = ref('');
const connected = ref(false);
const deviceName = ref('');

let peripheral: ReturnType<typeof createPeripheral> | null = null;
let svcUuid = '';
let txUuid = '';
let rxUuid = '';

function addLog(msg: string) {
  log.value.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function strToHex(str: string): string {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToStr(hex: string): string {
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(Number.parseInt(hex.substring(i, i + 2), 16));
  }
  return str.replace(/\0/g, '');
}

/* ==================== 扫描连接 ==================== */

async function doScanAndConnect() {
  log.value = [];
  addLog('初始化蓝牙...');
  const ok = await openAdapter();
  if (!ok) {
    addLog('蓝牙不可用');
    return;
  }

  addLog('开始扫描...');
  const scanner = createScanner();

  scanner.startScan({
    services: [],
    namePrefix: 'BabyMonitor-ECHO',
    onAdvertisement: async (adv: Advertisement) => {
      addLog(`发现: ${adv.name} (${adv.deviceId})`);
      scanner.stopScan();

      try {
        addLog('连接中...');
        peripheral = createPeripheral(adv.deviceId);
        await peripheral.connect();
        deviceName.value = adv.name || '';
        connected.value = true;
        addLog('已连接! 发现服务...');

        // 获取所有特征的 service/characteristic UUID
        const chars: { serviceUuid: string; uuid: string }[] = [];
        await peripheral.discoverServices((s, c) => {
          chars.push({ serviceUuid: s, uuid: c });
        });

        // 打印所有发现的 UUID (方便调试)
        addLog(`发现 ${chars.length} 个特征值:`);
        for (const c of chars) addLog(`  ${c.uuid}`);

        // UUID 匹配: 先精确匹配完整 UUID, 再尝试尾部匹配
        function match(items: string[], target: string): string {
          const t = target.toLowerCase();
          const exact = items.find(i => i.toLowerCase() === t);
          if (exact)
            return exact;
          // 取 target 最后 12 位匹配 (Android 短 UUID 展开后的格式)
          const tail12 = target.slice(-12);
          return items.find(i => i.toLowerCase().includes(tail12)) || '';
        }

        const svcs = [...new Set(chars.map(c => c.serviceUuid))];
        svcUuid = match(svcs, SERVICE_UUID);
        const allUUIDs = chars.map(c => c.uuid);
        txUuid = match(allUUIDs, CHAR_TX_UUID);
        rxUuid = match(allUUIDs, CHAR_RX_UUID);

        addLog(`Service: ${svcUuid ? 'OK' : 'NOT FOUND'}`);
        addLog(`TX: ${txUuid ? 'OK' : 'NOT FOUND'}`);
        addLog(`RX: ${rxUuid ? 'OK' : 'NOT FOUND'}`);

        // 监听回显
        if (peripheral && rxUuid) {
          const ref = characteristicOf(svcUuid, rxUuid);
          peripheral.observe(ref, {
            onValue: (hex: string) => {
              addLog(`回显: ${hexToStr(hex)}`);
            },
          });
        }

        addLog('就绪 - 输入文本点击发送');
      }
      catch (e) {
        addLog(`连接失败: ${(e as Error).message}`);
      }
    },
    onError: (err) => {
      addLog(`扫描错误: ${err.errMsg}`);
    },
    timeout: 15000,
    onEnd: () => {
      if (!connected.value)
        addLog('扫描结束, 未找到设备');
    },
  });
}

/* ==================== 发送 ==================== */

async function doSend() {
  const text = textInput.value.trim();
  if (!text || !peripheral || !svcUuid || !txUuid)
    return;

  try {
    const ref = characteristicOf(svcUuid, txUuid);
    await peripheral.write(ref, strToHex(text), 0);
    addLog(`发送: ${text}`);
    textInput.value = '';
  }
  catch (e) {
    addLog(`发送失败: ${(e as Error).message}`);
  }
}

/* ==================== 断开 ==================== */

function doDisconnect() {
  if (peripheral) {
    peripheral.disconnect();
    peripheral = null;
  }
  connected.value = false;
  deviceName.value = '';
  addLog('已断开');
}

/* ==================== 返回 ==================== */

function goBack() {
  // 深链直接进入时无页面历史,回首页兜底
  if (getCurrentPages().length > 1)
    uni.navigateBack();
  else
    uni.reLaunch({ url: '/pages/home/index' });
}

onBeforeUnmount(doDisconnect);
</script>

<template>
  <view class="page min-h-full bg-page p-3 px-4 flex flex-col gap-3">
    <!-- 顶部导航行:全局 navigationStyle=custom,自绘返回按钮 -->
    <view class="nav-row flex items-center">
      <view class="nav-row__back rounded-full flex items-center justify-center" @tap="goBack">
        <image class="nav-row__icon" :src="getIcon('chevron-left', '#3B362E')" mode="aspectFit" />
      </view>
      <text class="nav-row__title font-bold text-main">BLE 串口测试</text>
    </view>

    <!-- 连接控制 -->
    <view class="card bg-card rounded-md p-3">
      <view v-if="!connected" class="flex items-center justify-between">
        <text class="status-text text-secondary">未连接</text>
        <button class="btn btn--primary font-semibold border-none flex items-center justify-center shrink-0" @tap="doScanAndConnect">
          扫描并连接
        </button>
      </view>
      <view v-else class="flex items-center justify-between">
        <text class="status-text text-primary font-medium">已连接: {{ deviceName }}</text>
        <button class="btn btn--secondary font-semibold border-none flex items-center justify-center shrink-0" @tap="doDisconnect">
          断开
        </button>
      </view>
    </view>

    <!-- 文本输入 -->
    <view v-if="connected" class="card bg-card rounded-md p-3">
      <text class="label block text-secondary">发送文本 (UTF-8)</text>
      <view class="input-row flex items-center">
        <input
          v-model="textInput"
          class="input flex-1 rounded-md bg-page text-main"
          placeholder="输入要发送的文本..."
          confirm-type="send"
          @confirm="doSend"
        >
        <button class="btn btn--primary btn--sm font-semibold border-none flex items-center justify-center shrink-0" @tap="doSend">
          发送
        </button>
      </view>
    </view>

    <!-- 日志 -->
    <view class="card card--log bg-card rounded-md p-3 flex-1 flex flex-col">
      <text class="label block text-secondary">串口日志</text>
      <scroll-view class="log-box flex-1 rounded-sm" scroll-y>
        <text
          v-for="(item, i) in log"
          :key="i"
          class="log-line block"
        >
          {{ item }}
        </text>
      </scroll-view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
// 确定高度(而非仅 min-height):flex 容器高度不定时,Chrome 会把列内容
// 布局得比视口高出一个 gap,日志卡底部被推出屏幕外。
// box-sizing 必须 border-box:uni-h5 的 view 默认 content-box,
// height:100% + 页面 padding 会恰好高出两个内边距、底部贴边
.page {
  height: 100%;
  box-sizing: border-box;
}

.nav-row {
  gap: 16rpx;
  // 全局 navigationStyle=custom,顶部让出状态栏
  padding-top: calc(env(safe-area-inset-top) + 8rpx);

  &__back {
    width: 64rpx;
    height: 64rpx;
    background-color: $color-card-soft;
  }

  &__icon {
    width: 40rpx;
    height: 40rpx;
  }

  &__title {
    font-size: 34rpx;
  }
}

.card--log {
  min-height: 0;
  min-width: 0; // 页面级 flex 项:允许收缩,防长日志行把卡片撑破
}

.label {
  font-size: 24rpx;
  margin-bottom: 12rpx;
}

.status-text {
  font-size: 28rpx;
}

.input-row {
  gap: 12rpx;
}

.input {
  height: 72rpx;
  padding: 0 20rpx;
  font-size: 28rpx;
}

.btn {
  margin: 0; // uni-h5 button 默认水平 auto 居中,会顶乱 flex 行布局
  height: 72rpx;
  padding: 0 28rpx;
  border-radius: 36rpx;
  font-size: 26rpx;

  &--primary { background-color: $color-primary; color: #fff; }
  &--secondary { background-color: $color-bg; color: $color-text-primary; }
  &--sm { height: 60rpx; padding: 0 24rpx; font-size: 24rpx; }
}

.log-box {
  min-height: 400rpx;
  min-width: 0; // uni-h5 scroll-view 外层不受 flex 拉伸约束(min-width:auto),会按内容+padding 撑出容器
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  background-color: #1e1e1e;
  padding: 20rpx;
  font-family: 'Courier New', monospace;
}

.log-line {
  font-size: 22rpx;
  color: #7ec87e;
  line-height: 1.8;
  white-space: pre-wrap; // 长十六进制串换行,不横向撑破日志框
  word-break: break-all;
}
</style>
