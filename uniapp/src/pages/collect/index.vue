<script setup lang="ts">
import type { BLEDevice } from '@/hooks/useBLE';
import type { WavRecResult } from '@/utils/nativeWavRec';
import type { WavStreamSession } from '@/utils/wavStream';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { CACHE_KEY } from '@/constants/cache';
import { useBLE } from '@/hooks/useBLE';
import {
  agcWindowize,
  buildWav,
  calcRms,
  SAMPLE_RATE,
} from '@/utils/audioData';
import { AUTO_BLE_ON_MOUNT } from '@/utils/bleEnv';
import { getIcon } from '@/utils/icons';
import {
  nativeClose,
  nativeConnectWS,
  nativeGetResult,
  nativeGetState,
  nativeIsConnected,
  nativeProgress,
  nativeStart,
  nativeStop,
  nativeWavRecAvailable,
} from '@/utils/nativeWavRec';
import { saveWavFile } from '@/utils/saveWav';
import { storage } from '@/utils/storage';
import { startWavStream } from '@/utils/wavStream';

/**
 * 哭声数据采集页 (开发者工具)
 *
 * 直连开发板 WebSocket (ws://babycry.local/ws 或 IP), 板端推高通滤波后的
 * PCM (16kHz/16bit/单声道), 手机端分窗 AGC + 封 WAV 存本地, 用于
 * Edge Impulse 重训。协议与 audio_app/README.md 一致:
 *   App→板 {"cmd":"start"/"stop"}; 板→App 二进制 PCM + {"cmd":"done",...}
 *
 * 寻址: 进页面先用已存地址直连, 连不上自动转 BLE 读板子 DeviceInfo 里的
 * IP 并直连 (广播仅窗口期可见, 扫不到时按住板子 BOOT 3 秒使其可被发现——
 * 注意这不是重新配对, 读取 IP 全程无配对/无写入); Android 原生 socket
 * 解析不了 babycry.local, IP 是唯一可靠的直连地址。
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
/* 流式写盘 (App 端): 开流成功时非 null, 磁盘上逐窗落盘, JS 不攒全量 PCM;
 * H5 / 开流失败为 null, 回退 recChunks 内存累积 */
let streamSession: WavStreamSession | null = null;
let streamName = '';
let startingRec = false;
/* 原生直录模式 (uts-wavrec): true 时 WS 收流在 Kotlin 层, 音频字节不过 JS 桥;
 * JS 流式/内存路径是其回退 (原生开连失败 / H5) */
let usingNative = false;
/* done 回执兜底 (2026-11-24): stop 后 done 不来 (WS 半死/断连) 会永久卡在
 * 「正在结束录音」且数据静默丢失 —— 真机实测现场。超时按本地缓冲收尾 */
const DONE_GUARD_MS = 8000;
const stopPending = ref(false);
let stopGuardTimer: ReturnType<typeof setTimeout> | null = null;

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

function setupSocket(task: UniApp.SocketTask, onSettled?: (ok: boolean) => void) {
  socketTask = task;
  task.onOpen(() => {
    connected.value = true;
    statusText.value = '已连接开发板';
    statusOk.value = true;
    addLog(`已连接 ${wsUrl()}`);
    startMeter();
    onSettled?.(true);
  });
  task.onMessage((res) => {
    const data = res.data as string | ArrayBuffer;
    if (typeof data === 'string') {
      handleCmdText(data);
      return;
    }
    // 平台会把文本命令塞进二进制帧送达, 必须区分。按帧长判别:
    // 音频恒为 2048B 整块 (AUDIO_CHUNK_SAMPLES=1024), 文本命令几十 B。
    // 旧版按首字节 0x7b 嗅探 —— PCM 首样本低字节恰为 0x7b 的概率 1/256,
    // 每条长录音被静默吃掉 ~0.4% 块 (2026-11-24 实测 715 块丢 3 块, 由此定位)
    if (data.byteLength >= 1024) {
      if (recording.value) {
        const view = new Int16Array(data);
        recTotal += view.length;
        if (streamSession)
          streamSession.append(view); // 流式: 逐窗落盘, JS 内存恒定
        else
          recChunks.push(view); // 回退: 内存累积 (H5 / 开流失败)
      }
      return;
    }
    let txt = '';
    const bytes = new Uint8Array(data);
    for (let i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]);
    handleCmdText(txt);
  });
  task.onClose(() => {
    connected.value = false;
    if (stopPending.value)
      finalizeFromBuffer('连接断开');
    else
      stopRecordingLocal();
    statusText.value = '连接已断开';
    statusOk.value = false;
    stopMeter();
    addLog('连接断开');
  });
  task.onError((e) => {
    connected.value = false;
    if (stopPending.value)
      finalizeFromBuffer('连接错误'); // 与 onClose 双触发时由 stopPending 去重
    statusText.value = `连接错误: ${e.errMsg || 'unknown'}`;
    statusOk.value = false;
    onSettled?.(false);
  });
}

function handleCmdText(text: string) {
  try {
    const j = JSON.parse(text) as { cmd?: string; message?: string; samples?: number; lost?: boolean };
    if (j.cmd === 'done') {
      if (stopGuardTimer) {
        clearTimeout(stopGuardTimer);
        stopGuardTimer = null;
      }
      const late = !stopPending.value;
      stopPending.value = false;
      stopRecordingLocal();
      if (j.lost)
        addLog('有数据丢失，建议重录');
      if (late)
        addLog('done 迟到（已按本地缓冲收过尾），忽略固件回执');
      else
        finalizeRec(j.samples || recTotal);
    }
    else if (j.cmd === 'error') {
      // 板子拒绝会话 (ring_alloc_failed: wsRing 48KB 分配失败=内部堆不足)。
      // 计时器按实收字节走, 会话被拒时恒 0s —— 必须明确报错, 别让用户干等
      stopRecordingLocal();
      statusText.value = '设备内存不足，采集被拒绝';
      statusOk.value = false;
      uni.showToast({ title: '设备拒绝采集（内存不足），请稍后重试', icon: 'none' });
      addLog(`固件错误: ${j.message || 'unknown'}`);
    }
  }
  catch {
    addLog(`无法解析文本: ${text.slice(0, 40)}`);
  }
}

function doConnect(onSettled?: (ok: boolean) => void) {
  if (connected.value) {
    if (usingNative) {
      nativeClose();
      connected.value = false;
      statusText.value = '连接已断开';
      statusOk.value = false;
    }
    else {
      socketTask?.close({});
    }
    usingNative = false;
    return;
  }
  statusText.value = '连接中...';
  statusOk.value = false;
  const url = wsUrl();

  // 原生直录优先 (APP): 音频字节不进 JS 桥; 开连失败回退 JS socket 路径。
  // 插件零回调参数, 连接态轮询 getState (0 未连/1 连接中/2 已连)
  if (nativeWavRecAvailable) {
    nativeConnectWS(url);
    const startAt = Date.now();
    const statePoll = setInterval(() => {
      const st = nativeGetState();
      if (st === 2) {
        clearInterval(statePoll);
        usingNative = true;
        connected.value = true;
        statusText.value = '已连接开发板（原生直录）';
        statusOk.value = true;
        addLog(`已连接 ${url}（uts 原生 socket）`);
        startMeter();
        onSettled?.(true);
      }
      else if (st === 0 || Date.now() - startAt > 8000) {
        clearInterval(statePoll);
        usingNative = false;
        addLog('原生连接失败，回退 JS socket');
        connectViaJsSocket(url, onSettled);
      }
    }, 250);
    return;
  }
  connectViaJsSocket(url, onSettled);
}

function connectViaJsSocket(url: string, onSettled?: (ok: boolean) => void) {
  let task: UniApp.SocketTask | null = null;
  try {
    // 官方用法: 必须传 complete 回调, 返回值才是 SocketTask
    // (不传回调时 Vue3 返回 Promise; success 回调里的 res 不是 SocketTask)
    task = uni.connectSocket({ url, complete: () => {} });
  }
  catch (e) {
    statusText.value = `连接失败: ${e}`;
    onSettled?.(false);
    return;
  }

  if (task && typeof task.onOpen === 'function') {
    setupSocket(task, onSettled);
    return;
  }

  // 兼容: 部分版本不传回调返回 Promise
  if (task && typeof (task as unknown as Promise<UniApp.SocketTask>).then === 'function') {
    (task as unknown as Promise<UniApp.SocketTask>).then((t2) => {
      if (t2 && typeof t2.onOpen === 'function') {
        setupSocket(t2, onSettled);
      }
      else {
        statusText.value = '连接失败: SocketTask 解析失败';
        onSettled?.(false);
      }
    });
    return;
  }

  statusText.value = '连接失败: 未获取到 SocketTask';
  onSettled?.(false);
}

function persistBaseUrl() {
  storage.set(CACHE_KEY.COLLECT_BASE_URL, baseUrl.value.trim());
}

/* ==================== BLE 自动寻址 (扫描板子读 IP) ==================== */

const ble = useBLE();
const scanningBoard = ref(false);

/** 用当前地址发起一次连接, 8s 内未连上视为失败 (仅自动寻址流程的探测用) */
function probeConnect(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (usingNative) {
        nativeClose();
      }
      else {
        socketTask?.close({});
      }
      resolve(false);
    }, 8000);
    doConnect((ok) => {
      clearTimeout(timer);
      resolve(ok);
    });
  });
}

function pickDevice(devices: BLEDevice[]): Promise<BLEDevice> {
  return new Promise((resolve, reject) => {
    uni.showActionSheet({
      itemList: devices.slice(0, 6).map(d => d.name),
      success: ({ tapIndex }) => resolve(devices[tapIndex]),
      fail: () => reject(new Error('已取消选择设备')),
    });
  });
}

/**
 * BLE 扫描 → 连接 → 读 DeviceInfo 拿板子 IP → 填地址并直连。
 * 前提: 板子广播可见 (出厂态常开; 已配网设备按住 BOOT 3 秒打开 5 分钟可见
 * 窗口) —— 注意这不是重新配对: 只读特征值, 无写入、全程无配对弹窗。
 * 地址取到即持久化, 下次进页走快路径。
 */
async function scanBoardIp(): Promise<boolean> {
  if (scanningBoard.value) {
    return false;
  }
  scanningBoard.value = true;
  statusText.value = '正在扫描板子...';
  statusOk.value = false;
  addLog('BLE 扫描开始 (扫不到时按住板子 BOOT 3 秒使其可被发现)');
  try {
    await ble.startScan();
    // startScan 自身 30s 超时, 这里 12s 就放弃, 把时间留给引导文案
    const deadline = Date.now() + 12_000;
    while (ble.devices.value.length === 0 && ble.scanning.value && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 400));
    }
    ble.stopScan();
    const found = ble.devices.value;
    if (found.length === 0) {
      statusText.value = '未发现板子：按住板子 BOOT 3 秒使其可被发现, 再点「扫描」重试';
      addLog(`扫描无结果 (蓝牙: ${ble.statusText.value})`);
      return false;
    }
    const target = found.length === 1 ? found[0] : await pickDevice(found);
    addLog(`发现 ${target.name}, 连接读取设备信息...`);
    // skipNotify: 不订阅 Status (collect 用不到) —— CCCD 描述符写在途会让紧随
    // 其后的 read 撞上 Android 单 GATT 操作限制而失败 (真机日志 9020007)
    await ble.connectDevice(target, { skipNotify: true });
    // GATT 偶发繁忙时单次读可能失败, 重试兜底
    let info: Record<string, unknown> | null = null;
    for (let attempt = 1; attempt <= 3 && !info; attempt++) {
      try {
        info = await ble.readDeviceInfo();
      }
      catch (e) {
        if (attempt === 3)
          throw e;
        addLog(`读取设备信息失败, 重试 (${attempt}/2)...`);
        await new Promise(r => setTimeout(r, 400));
      }
    }
    const ip = typeof info?.ip === 'string' ? info.ip : '';
    if (!ip || ip === '0.0.0.0') {
      statusText.value = '板子尚未连上 WiFi, 无法获取 IP';
      addLog(`DeviceInfo 无有效 IP: ${JSON.stringify(info)}`);
      return false;
    }
    baseUrl.value = `http://${ip}`;
    persistBaseUrl();
    addLog(`已获取板子 IP: ${ip}, 直连...`);
    doConnect();
    return true;
  }
  catch (e) {
    statusText.value = `自动寻址失败: ${(e as Error).message}`;
    addLog(`自动寻址失败: ${(e as Error).message}`);
    return false;
  }
  finally {
    ble.close(); // 兜底断 BLE (幂等), 不影响 WS 长连接
    scanningBoard.value = false;
  }
}

/* ==================== 进页自动寻址 ==================== */

onMounted(async () => {
  // 1) 已存地址先直连 (快路径, 不跑 BLE); 2) 连不上/没存过 → BLE 自动寻址;
  // 3) H5 真实蓝牙的扫描必须由用户手势触发, 只提示手动点「扫描」
  const stored = storage.get<string>(CACHE_KEY.COLLECT_BASE_URL);
  if (stored) {
    addLog(`尝试已存地址: ${stored}`);
    if (await probeConnect())
      return;
    addLog('已存地址连不上, 转 BLE 自动寻址');
  }
  if (AUTO_BLE_ON_MOUNT) {
    await scanBoardIp();
    return;
  }
  statusText.value = stored ? '已存地址连不上, 点「扫描」重试' : '点「扫描」自动获取板子地址';
});

/* ==================== 实时电平 (/rms 轮询) ==================== */

function startMeter() {
  if (meterTimer)
    return;
  meterTimer = setInterval(() => {
    // 原生模式断连感知: onClosed/onFailure 在 Kotlin 层, JS 拿不到回调,
    // 用 500ms 轮询连接态兜底 (录音中的断连经 getResult 结果送达)
    if (usingNative && !recording.value && connected.value && !nativeIsConnected()) {
      connected.value = false;
      statusText.value = '连接已断开';
      statusOk.value = false;
      addLog('连接断开');
      stopMeter();
      return;
    }
    // 录音中暂停轮询: 每秒 2 次 uni.request 全程过 JS 桥, 与推流抢桥无谓开销
    if (!connected.value || recording.value)
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

async function startRec() {
  if (!connected.value || recording.value || startingRec)
    return;
  startingRec = true; // 开流走异步桥调用, 防双击重入
  try {
    recChunks = [];
    recTotal = 0;
    recSecs.value = 0;
    // 文件名此刻定下 (磁盘先建文件), 计数器保存成功才自增;
    // 模式优先级: 原生直录 > JS 流式写盘 > 内存累积
    const count = counters.value[selectedCat.value] || 0;
    streamName = `${selectedCat.value}_${String(count + 1).padStart(3, '0')}.wav`;
    let mode = '';
    if (usingNative) {
      if (!nativeStart(streamName)) {
        statusText.value = '启动失败（原生）';
        statusOk.value = false;
        addLog('⚠ nativeStart 失败');
        return;
      }
      mode = '（原生直录）';
    }
    else {
      streamSession = await startWavStream(streamName);
      if (streamSession) {
        mode = '（流式写盘）';
      }
    }
    recording.value = true;
    if (!usingNative) {
      socketTask?.send({ data: JSON.stringify({ cmd: 'start' }), fail: () => addLog('发送 start 失败') });
    }
    statusText.value = '录音中...';
    statusOk.value = false;
    addLog(`开始录音 [${selectedCat.value}]${mode}`);
    recTimer = setInterval(() => {
      // 原生模式: 音频不进 JS, recTotal 不增长, 进度从插件轮询
      const samples = usingNative ? nativeProgress() : recTotal;
      recSecs.value = Math.round(samples / SAMPLE_RATE);
    }, 200);
  }
  finally {
    startingRec = false;
  }
}

function stopRec() {
  if (!recording.value || stopPending.value)
    return;
  statusText.value = '正在结束录音...';
  stopPending.value = true;
  if (usingNative) {
    // 原生模式: done 在 Kotlin 层消费并收尾, 结果轮询 getResult 送达;
    // 插件内 8s 兜底/断连也会生成 result, 页面轮询上限 10s 再兜底
    const ok = nativeStop();
    if (!ok) {
      // 返回 false 的唯一含义是「WS 已断，命令发不出去」（已收尾的情况插件返回 true）。
      // 旧文案「发送 stop 失败」曾把"会话已结束"也报成失败，误导排查方向（2026-11-24 修正）
      stopPending.value = false;
      addLog('停止失败：连接已断开');
      return;
    }
    const pollStart = Date.now();
    const resultPoll = setInterval(() => {
      const res = nativeGetResult();
      if (res != null) {
        clearInterval(resultPoll);
        onNativeResult(res);
      }
      else if (Date.now() - pollStart > 10000) {
        clearInterval(resultPoll);
        stopPending.value = false;
        stopRecordingLocal();
        statusText.value = '结束超时，未收到保存结果';
        statusOk.value = false;
        addLog('⚠ 结束超时：原生层未生成结果');
      }
    }, 300);
    return;
  }
  socketTask?.send({ data: JSON.stringify({ cmd: 'stop' }), fail: () => addLog('发送 stop 失败') });
  // done 回来后 finalizeRec 处理; 兜底: 超时按本地缓冲收尾
  if (stopGuardTimer)
    clearTimeout(stopGuardTimer);
  stopGuardTimer = setTimeout(finalizeFromBuffer, DONE_GUARD_MS, 'done 超时');
}

/* 原生直录的结果落 UI（文件已由 Kotlin 层写完并校验） */
function onNativeResult(res: WavRecResult) {
  stopPending.value = false;
  stopRecordingLocal();
  const name = streamName;
  streamName = '';
  if (res.lost)
    addLog('板端报有数据丢失，建议重录');
  if (!res.ok) {
    statusText.value = `保存未完成 (${res.reason})`;
    statusOk.value = false;
    addLog(`⚠ 保存未完成: ${res.reason}`);
    return;
  }
  const count = counters.value[selectedCat.value] || 0;
  counters.value[selectedCat.value] = count + 1;
  persistCounters();
  const secs = (res.samples / SAMPLE_RATE).toFixed(1);
  const reasonTag = res.reason === 'done' ? '' : `, ${res.reason}`;
  addLog(`保存 ${name} (原始RMS=${Math.round(res.rms)}, ${secs}s, ${res.bytes}B${reasonTag})`);
  statusText.value = `已保存 ${name} (RMS ${Math.round(res.rms)}, ${secs}s)`;
  statusOk.value = true;
  addLog(`${name} → ${res.path}`);
}

/* done 不来的兜底 (超时/断连/错误): 按本地已收缓冲收尾。
 * stopPending 既标记「等待 done」也做 finalize 去重 */
function finalizeFromBuffer(reason: string) {
  if (!stopPending.value)
    return;
  stopPending.value = false;
  if (stopGuardTimer) {
    clearTimeout(stopGuardTimer);
    stopGuardTimer = null;
  }
  addLog(`⚠ ${reason}，按本地缓冲收尾`);
  stopRecordingLocal();
  finalizeRec(recTotal);
}

function stopRecordingLocal() {
  recording.value = false;
  if (recTimer) {
    clearInterval(recTimer);
    recTimer = null;
  }
}

async function finalizeRec(samples: number) {
  addLog(`完成: 本地缓冲=${recTotal} 样本, 固件=${samples} 样本`);
  if (recTotal < SAMPLE_RATE * 0.5) {
    statusText.value = `录音太短 (只收到 ${(recTotal / SAMPLE_RATE).toFixed(1)}s)`;
    addLog('录音太短，已丢弃');
    streamSession?.cancel(); // 删除半成品, 文件名下轮复用
    streamSession = null;
    return;
  }
  if (streamSession) {
    await finalizeStream();
    return;
  }
  try {
    // 内存累积路径 (H5 / 开流失败回退): 合并 → 逐窗 AGC → WAV → saveWavFile
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
  finally {
    recChunks = []; // 立即释放全量 PCM (可达十几 MB)
  }
}

/* 流式路径: 数据已在磁盘, 只需回补 44B 头 + 计数 (零全量内存操作) */
async function finalizeStream() {
  const sess = streamSession;
  const name = streamName;
  streamSession = null;
  streamName = '';
  if (!sess)
    return;
  const result = await sess.finalize();
  if (!result) {
    statusText.value = '流式写盘失败，本段未保存';
    statusOk.value = false;
    addLog('⚠ 流式写盘失败 (见 console)，本段未保存');
    return;
  }
  const count = counters.value[selectedCat.value] || 0;
  counters.value[selectedCat.value] = count + 1;
  persistCounters();
  const secs = (recTotal / SAMPLE_RATE).toFixed(1);
  addLog(`保存 ${name} (原始RMS=${Math.round(result.rms)}, ${secs}s, ${result.bytes}B)`);
  statusText.value = `已保存 ${name} (RMS ${Math.round(result.rms)}, ${secs}s)`;
  statusOk.value = true;
  addLog(`${name} → ${result.path}`);
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
          class="btn btn--secondary font-semibold border-none flex items-center justify-center shrink-0"
          :disabled="scanningBoard"
          @tap="scanBoardIp()"
        >
          {{ scanningBoard ? '扫描中' : '扫描' }}
        </button>
        <button
          class="btn font-semibold border-none flex items-center justify-center shrink-0"
          :class="connected ? 'btn--secondary' : 'btn--primary'"
          @tap="doConnect()"
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
        文件名: {{ selectedCat }}_NNN.wav；保存路径以保存后状态行为准（写入后回读校验，EMUI 映射到应用目录属正常）
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
