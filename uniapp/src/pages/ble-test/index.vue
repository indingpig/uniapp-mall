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
// #ifdef H5
type Advertisement = Record<string, never>;
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
  if (!ok) { addLog('蓝牙不可用'); return; }

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

onBeforeUnmount(doDisconnect);
</script>

<template>
  <view class="page">
    <text class="title">BLE 串口测试</text>

    <!-- 连接控制 -->
    <view class="card">
      <view v-if="!connected" class="row">
        <text class="status-text">未连接</text>
        <button class="btn btn--primary" @tap="doScanAndConnect">
          扫描并连接
        </button>
      </view>
      <view v-else class="row">
        <text class="status-text status-text--ok">已连接: {{ deviceName }}</text>
        <button class="btn btn--secondary" @tap="doDisconnect">
          断开
        </button>
      </view>
    </view>

    <!-- 文本输入 -->
    <view v-if="connected" class="card">
      <text class="label">发送文本 (UTF-8)</text>
      <view class="input-row">
        <input
          v-model="textInput"
          class="input"
          placeholder="输入要发送的文本..."
          confirm-type="send"
          @confirm="doSend"
        >
        <button class="btn btn--primary btn--sm" @tap="doSend">
          发送
        </button>
      </view>
    </view>

    <!-- 日志 -->
    <view class="card card--log">
      <text class="label">串口日志</text>
      <scroll-view class="log-box" scroll-y>
        <text
          v-for="(item, i) in log"
          :key="i"
          class="log-line"
        >
          {{ item }}
        </text>
      </scroll-view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background-color: $color-bg;
  padding-top: var(--status-bar-height);
  padding: 24rpx 32rpx;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.title {
  font-size: 36rpx;
  font-weight: 700;
  color: $color-text-primary;
}

.card {
  background-color: $color-card;
  border-radius: $radius-md;
  padding: 24rpx;

  &--log {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
}

.label {
  font-size: 24rpx;
  color: $color-text-secondary;
  margin-bottom: 12rpx;
  display: block;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-text {
  font-size: 28rpx;
  color: $color-text-secondary;

  &--ok {
    color: $color-primary;
    font-weight: 500;
  }
}

.input-row {
  display: flex;
  gap: 12rpx;
  align-items: center;
}

.input {
  flex: 1;
  height: 72rpx;
  background-color: $color-bg;
  border-radius: $radius-md;
  padding: 0 20rpx;
  font-size: 28rpx;
  color: $color-text-primary;
}

.btn {
  height: 72rpx;
  padding: 0 28rpx;
  border-radius: 36rpx;
  font-size: 26rpx;
  font-weight: 600;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &--primary { background-color: $color-primary; color: #fff; }
  &--secondary { background-color: $color-bg; color: $color-text-primary; }
  &--sm { height: 60rpx; padding: 0 24rpx; font-size: 24rpx; }
}

.log-box {
  flex: 1;
  min-height: 400rpx;
  background-color: #1e1e1e;
  border-radius: 12rpx;
  padding: 20rpx;
  font-family: 'Courier New', monospace;
}

.log-line {
  display: block;
  font-size: 22rpx;
  color: #7ec87e;
  line-height: 1.8;
}
</style>
