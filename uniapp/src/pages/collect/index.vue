<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { CACHE_KEY } from '@/constants/cache';
import {
  agcWindowize,
  buildWav,
  calcRms,
  SAMPLE_RATE,
} from '@/utils/audioData';
import { getIcon } from '@/utils/icons';
import { saveWavFile } from '@/utils/saveWav';
import { storage } from '@/utils/storage';

/**
 * 哭声数据采集页 (开发者工具)
 *
 * 直连开发板 WebSocket (ws://babycry.local/ws 或 IP), 板端推高通滤波后的
 * PCM (16kHz/16bit/单声道), 手机端分窗 AGC + 封 WAV 存本地, 用于
 * Edge Impulse 重训。协议与 audio_app/README.md 一致:
 *   App→板 {"cmd":"start"/"stop"}; 板→App 二进制 PCM + {"cmd":"done",...}
 *
 * 坑位 (参考 audio_app_uni/pages/index/index.vue):
 *   - uni.connectSocket 必须传 complete 回调才返回 SocketTask
 *   - 二进制帧可能被平台当文本送达 JSON 回执, 用首字节 0x7B 探测
 *   - 分类 key 需与 Edge Impulse 工程标签名一致, 否则上传会新建类
 *   - 平台差异代码放 utils/saveWav.ts —— 本文件内不能出现平台条件编译
 *     指令, 否则 uni-pages 会把本页包进平台条件块, App 端不再注册本页
 */

interface CollectCategory {
  key: string;
}

const DEFAULT_CATEGORIES: CollectCategory[] = [
  { key: 'cry' },
  { key: 'babble' },
  { key: 'speech' },
  { key: 'background' },
];

const log = ref<string[]>([]);
const baseUrl = ref<string>(storage.get<string>(CACHE_KEY.COLLECT_BASE_URL) || 'http://babycry.local');
const connected = ref(false);
const statusText = ref('未连接');
const statusOk = ref(false);
const categories = ref<CollectCategory[]>(
  storage.get<CollectCategory[]>(CACHE_KEY.COLLECT_CATEGORIES) || DEFAULT_CATEGORIES,
);
const selectedCat = ref('cry');
const newCat = ref('');
const recording = ref(false);
const recSecs = ref(0);
const barWidth = ref(0);
const rmsText = ref('—');
const counters = ref<Record<string, number>>(
  storage.get<Record<string, number>>(CACHE_KEY.COLLECT_COUNTERS) || {},
);

let socketTask: UniApp.SocketTask | null = null;
let recChunks: Int16Array[] = [];
let recTotal = 0;
let recTimer: ReturnType<typeof setInterval> | null = null;
let meterTimer: ReturnType<typeof setInterval> | null = null;

function addLog(msg: string) {
  log.value.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  if (log.value.length > 100)
    log.value.shift();
}

function persistCounters() {
  storage.set(CACHE_KEY.COLLECT_COUNTERS, counters.value);
}

/* ==================== 连接 ==================== */

function wsUrl(): string {
  let u = baseUrl.value.trim().replace(/\/+$/, '');
  if (!/^https?:/i.test(u))
    u = `http://${u}`;
  return `${u.replace(/^http/i, 'ws')}/ws`;
}

function setupSocket(task: UniApp.SocketTask) {
  socketTask = task;
  task.onOpen(() => {
    connected.value = true;
    statusText.value = '已连接开发板';
    statusOk.value = true;
    addLog(`已连接 ${wsUrl()}`);
    startMeter();
  });
  task.onMessage((res) => {
    const data = res.data as string | ArrayBuffer;
    if (typeof data === 'string') {
      handleCmdText(data);
      return;
    }
    // ArrayBuffer: 可能是音频, 也可能是被当二进制送达的文本命令
    const bytes = new Uint8Array(data);
    if (bytes.length > 1 && bytes[0] === 0x7b) {
      // '{' — 文本命令被平台塞进二进制帧
      let txt = '';
      for (let i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]);
      handleCmdText(txt);
      return;
    }
    if (recording.value) {
      recChunks.push(new Int16Array(data));
      recTotal += data.byteLength / 2;
    }
  });
  task.onClose(() => {
    connected.value = false;
    stopRecordingLocal();
    statusText.value = '连接已断开';
    statusOk.value = false;
    stopMeter();
    addLog('连接断开');
  });
  task.onError((e) => {
    connected.value = false;
    statusText.value = `连接错误: ${e.errMsg || 'unknown'}`;
    statusOk.value = false;
  });
}

function handleCmdText(text: string) {
  try {
    const j = JSON.parse(text) as { cmd?: string; samples?: number; lost?: boolean };
    if (j.cmd === 'done') {
      stopRecordingLocal();
      if (j.lost)
        addLog('有数据丢失，建议重录');
      finalizeRec(j.samples || recTotal);
    }
  }
  catch {
    addLog(`无法解析文本: ${text.slice(0, 40)}`);
  }
}

function doConnect() {
  if (connected.value) {
    socketTask?.close({});
    return;
  }
  statusText.value = '连接中...';
  statusOk.value = false;
  const url = wsUrl();

  let task: UniApp.SocketTask | null = null;
  try {
    // 官方用法: 必须传 complete 回调, 返回值才是 SocketTask
    // (不传回调时 Vue3 返回 Promise; success 回调里的 res 不是 SocketTask)
    task = uni.connectSocket({ url, complete: () => {} });
  }
  catch (e) {
    statusText.value = `连接失败: ${e}`;
    return;
  }

  if (task && typeof task.onOpen === 'function') {
    setupSocket(task);
    return;
  }

  // 兼容: 部分版本不传回调返回 Promise
  if (task && typeof (task as unknown as Promise<UniApp.SocketTask>).then === 'function') {
    (task as unknown as Promise<UniApp.SocketTask>).then((t2) => {
      if (t2 && typeof t2.onOpen === 'function')
        setupSocket(t2);
      else
        statusText.value = '连接失败: SocketTask 解析失败';
    });
    return;
  }

  statusText.value = '连接失败: 未获取到 SocketTask';
}

function persistBaseUrl() {
  storage.set(CACHE_KEY.COLLECT_BASE_URL, baseUrl.value.trim());
}

/* ==================== 实时电平 (/rms 轮询) ==================== */

function startMeter() {
  if (meterTimer)
    return;
  meterTimer = setInterval(() => {
    if (!connected.value)
      return;
    const base = baseUrl.value.trim().replace(/\/+$/, '');
    uni.request({
      url: `${base}/rms`,
      timeout: 3000,
      success: (res) => {
        try {
          const rms = (JSON.parse(res.data as string) as { rms?: number }).rms || 0;
          barWidth.value = Math.min(100, (rms / 160) * 100);
          rmsText.value = String(Math.round(rms));
        }
        catch { /* 忽略解析失败 */ }
      },
    });
  }, 500);
}

function stopMeter() {
  if (meterTimer) {
    clearInterval(meterTimer);
    meterTimer = null;
  }
  barWidth.value = 0;
  rmsText.value = '—';
}

/* ==================== 录音 ==================== */

function startRec() {
  if (!connected.value || recording.value)
    return;
  recChunks = [];
  recTotal = 0;
  recSecs.value = 0;
  recording.value = true;
  socketTask?.send({ data: JSON.stringify({ cmd: 'start' }), fail: () => addLog('发送 start 失败') });
  statusText.value = '录音中...';
  statusOk.value = false;
  addLog(`开始录音 [${selectedCat.value}]`);
  recTimer = setInterval(() => {
    recSecs.value = Math.round(recTotal / SAMPLE_RATE);
  }, 200);
}

function stopRec() {
  if (!recording.value)
    return;
  statusText.value = '正在结束录音...';
  socketTask?.send({ data: JSON.stringify({ cmd: 'stop' }), fail: () => addLog('发送 stop 失败') });
  // done 回来后 finalizeRec 处理
}

function stopRecordingLocal() {
  recording.value = false;
  if (recTimer) {
    clearInterval(recTimer);
    recTimer = null;
  }
}

function finalizeRec(samples: number) {
  addLog(`完成: 本地缓冲=${recTotal} 样本, 固件=${samples} 样本`);
  if (recTotal < SAMPLE_RATE * 0.5) {
    statusText.value = `录音太短 (只收到 ${(recTotal / SAMPLE_RATE).toFixed(1)}s)`;
    addLog('录音太短，已丢弃');
    return;
  }
  try {
    // 合并累积 PCM
    const all = new Int16Array(recTotal);
    let off = 0;
    for (const c of recChunks) {
      all.set(c, off);
      off += c.length;
    }
    const rawRms = calcRms(all);
    // 关键: 按 1s 窗口逐窗 AGC (与固件推理同粒度), 不要整条全局归一化
    const normed = agcWindowize(all);
    const wav = buildWav(normed);
    const count = counters.value[selectedCat.value] || 0;
    const name = `${selectedCat.value}_${String(count + 1).padStart(3, '0')}.wav`;
    counters.value[selectedCat.value] = count + 1;
    persistCounters();
    addLog(`保存 ${name} (原始RMS=${Math.round(rawRms)}, ${(recTotal / SAMPLE_RATE).toFixed(1)}s)`);
    saveFile(wav, name, rawRms);
  }
  catch (e) {
    statusText.value = `保存异常: ${(e as Error).message}`;
    addLog(`保存异常: ${(e as Error).message}`);
  }
}

function afterSave(name: string, rms: number, where: string) {
  statusText.value = `已保存 ${name} (RMS ${Math.round(rms)}, ${(recTotal / SAMPLE_RATE).toFixed(1)}s)`;
  statusOk.value = true;
  addLog(`${name} → ${where}`);
}

function saveFile(wav: ArrayBuffer, name: string, rms: number) {
  saveWavFile(wav, name, {
    onSaved: where => afterSave(name, rms, where),
    onError: (msg) => {
      statusText.value = msg;
      addLog(msg);
    },
  });
}

/* ==================== 分类管理 ==================== */

function selectCat(key: string) {
  selectedCat.value = key;
}

function addCategory() {
  const key = newCat.value.trim().replace(/\s+/g, '-').toLowerCase();
  if (!key)
    return;
  if (categories.value.some(c => c.key === key)) {
    selectedCat.value = key;
    newCat.value = '';
    return;
  }
  categories.value.push({ key });
  selectedCat.value = key;
  newCat.value = '';
  storage.set(CACHE_KEY.COLLECT_CATEGORIES, categories.value);
  addLog(`新增分类: ${key}`);
}

function removeCategory(key: string) {
  if (categories.value.length <= 1)
    return;
  uni.showModal({
    title: '删除分类',
    content: `删除 "${key}"？（已保存的 WAV 文件不受影响）`,
    success: ({ confirm }) => {
      if (!confirm)
        return;
      categories.value = categories.value.filter(c => c.key !== key);
      if (selectedCat.value === key)
        selectedCat.value = categories.value[0].key;
      storage.set(CACHE_KEY.COLLECT_CATEGORIES, categories.value);
    },
  });
}

/* ==================== 其他 ==================== */

function copyLog() {
  uni.setClipboardData({
    data: log.value.join('\n'),
    success: () => addLog('日志已复制'),
  });
}

function goBack() {
  // 深链直接进入时无页面历史,回首页兜底
  if (getCurrentPages().length > 1)
    uni.navigateBack();
  else
    uni.reLaunch({ url: '/pages/home/index' });
}

onBeforeUnmount(() => {
  stopRecordingLocal();
  stopMeter();
  socketTask?.close({});
  socketTask = null;
});
</script>

<template>
  <view class="page min-h-full bg-page p-3 px-4 flex flex-col gap-3">
    <!-- 顶部导航行:全局 navigationStyle=custom,自绘返回按钮 -->
    <view class="nav-row flex items-center">
      <view class="nav-row__back rounded-full flex items-center justify-center" @tap="goBack">
        <image class="nav-row__icon" :src="getIcon('chevron-left', 'ink')" mode="aspectFit" />
      </view>
      <text class="nav-row__title font-bold text-main">哭声数据采集</text>
    </view>

    <!-- 连接控制 -->
    <view class="card bg-card rounded-md p-3">
      <view class="input-row flex items-center">
        <input
          v-model="baseUrl"
          class="input flex-1 rounded-md bg-page text-main"
          placeholder="http://babycry.local 或 IP"
          @blur="persistBaseUrl"
        >
        <button
          class="btn font-semibold border-none flex items-center justify-center shrink-0"
          :class="connected ? 'btn--secondary' : 'btn--primary'"
          @tap="doConnect"
        >
          {{ connected ? '断开' : '连接' }}
        </button>
      </view>
      <view class="flex items-center justify-between mt-2">
        <text class="status-text" :class="statusOk ? 'text-primary' : 'text-secondary'">
          {{ statusText }}
        </text>
      </view>
    </view>

    <!-- 实时电平 -->
    <view class="card bg-card rounded-md p-3">
      <view class="bar-track rounded-pill overflow-hidden">
        <view class="bar-fill rounded-pill" :style="{ width: `${barWidth}%` }" />
      </view>
      <text class="rms-text block mt-2 text-secondary">实时电平 RMS: {{ rmsText }}</text>
    </view>

    <!-- 分类选择 (key 需与 Edge Impulse 标签名一致) -->
    <view class="card bg-card rounded-md p-3">
      <text class="label block text-secondary">分类（需与 EI 工程标签名一致，长按删除）</text>
      <view class="cats flex flex-wrap gap-2 mt-2">
        <view
          v-for="c in categories"
          :key="c.key"
          class="cat rounded-md flex items-center justify-center gap-1"
          :class="{ 'cat--active': selectedCat === c.key }"
          @tap="selectCat(c.key)"
          @longpress="removeCategory(c.key)"
        >
          <text class="cat__text">{{ c.key }}</text>
        </view>
      </view>
      <view class="input-row flex items-center mt-2">
        <input
          v-model="newCat"
          class="input flex-1 rounded-md bg-page text-main"
          placeholder="新增分类 key（如 babycry）"
          confirm-type="done"
          @confirm="addCategory"
        >
        <button class="btn btn--secondary btn--sm font-semibold border-none flex items-center justify-center shrink-0" @tap="addCategory">
          添加
        </button>
      </view>
    </view>

    <!-- 录音控制 -->
    <view class="card bg-card rounded-md p-3">
      <view class="flex items-center gap-3">
        <button
          class="btn btn--rec-start font-semibold border-none flex-1 flex items-center justify-center"
          :disabled="recording || !connected"
          @tap="startRec"
        >
          ● 开始录音
        </button>
        <button
          class="btn btn--rec-stop font-semibold border-none flex-1 flex items-center justify-center"
          :disabled="!recording"
          @tap="stopRec"
        >
          ■ 停止并保存
        </button>
      </view>
      <text v-if="recording" class="hint block mt-2 text-secondary">
        录音中… {{ recSecs }}s（按「停止并保存」结束）
      </text>
      <text v-else class="hint block mt-2 text-muted">
        文件名: {{ selectedCat }}_NNN.wav；保存位置: Android 下载目录/BabyCry/，iOS App 沙盒 audio/
      </text>
    </view>

    <!-- 日志 -->
    <view class="card card--log bg-card rounded-md p-3 flex-1 flex flex-col">
      <view class="flex items-center justify-between mb-2">
        <text class="label text-secondary">日志</text>
        <view class="copy-btn flex items-center gap-1" @tap="copyLog">
          <text class="copy-btn__text text-secondary">复制</text>
          <image class="copy-btn__icon" :src="getIcon('chevron-right', 'secondary')" mode="aspectFit" />
        </view>
      </view>
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
// box-sizing 必须 border-box:uni-h5 的 view 默认 content-box
.page {
  height: 100%;
  box-sizing: border-box;
}

.nav-row {
  gap: 16rpx;
  // 全局 navigationStyle=custom,顶部让出状态栏
  // 状态栏避让：Android webview 的 env(safe-area-inset-top) 恒为 0（iOS 刘海才有值），
  // 必须用 uni-app 内置变量 --status-bar-height（App=真实高度，H5=0，微信小程序=25px）
  padding-top: calc(var(--status-bar-height) + 8rpx);

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
  min-height: 360rpx;
  min-width: 0; // 页面级 flex 项:允许收缩,防长日志行把卡片撑破
}

.label {
  font-size: 24rpx;
}

.status-text {
  font-size: 26rpx;
}

.input-row {
  gap: 12rpx;
}

.input {
  height: 72rpx;
  padding: 0 20rpx;
  font-size: 26rpx;
}

.btn {
  margin: 0; // uni-h5 button 默认水平 auto 居中,会顶乱 flex 行布局
  height: 72rpx;
  padding: 0 28rpx;
  border-radius: 36rpx;
  font-size: 26rpx;

  &--primary { background-color: $color-primary; color: $color-white; }
  &--secondary { background-color: $color-bg; color: $color-text-primary; }
  &--sm { height: 60rpx; padding: 0 24rpx; font-size: 24rpx; }
  &--rec-start { background-color: $color-coral; color: $color-white; }
  &--rec-stop { background-color: $color-primary; color: $color-white; }
  &[disabled] { opacity: 0.4; }
}

.bar-track {
  height: 16rpx;
  background-color: $color-card-soft;
}

.bar-fill {
  height: 100%;
  width: 0;
  background: linear-gradient(90deg, $color-primary, $color-amber, $color-danger);
}

.rms-text {
  font-size: 22rpx;
}

.cats {
  // flex 容器子元素不用垂直 margin,间距一律 gap
}

.cat {
  padding: 16rpx 28rpx;
  background-color: $color-card-soft;

  &__text {
    font-size: 26rpx;
    color: $color-text-secondary;
  }

  &--active {
    background-color: $color-primary;

    .cat__text {
      color: $color-white;
      font-weight: 600;
    }
  }
}

.hint {
  font-size: 22rpx;
  line-height: 1.7;
}

.copy-btn {
  gap: 4rpx;

  &__text {
    font-size: 24rpx;
  }

  &__icon {
    width: 28rpx;
    height: 28rpx;
  }
}

.log-box {
  min-height: 280rpx;
  min-width: 0; // uni-h5 scroll-view 外层不受 flex 拉伸约束,会按内容撑出容器
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  background-color: $color-dev-terminal-bg;
  padding: 20rpx;
  font-family: 'Courier New', monospace;
}

.log-line {
  font-size: 22rpx;
  color: $color-dev-terminal-ink;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
