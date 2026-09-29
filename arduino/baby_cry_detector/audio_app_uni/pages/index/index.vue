<template>
  <view class="page">
    <view class="title">🎤 宝宝哭声数据采集</view>
    <view class="sub">选分类 → 开始录音 → 停止并保存（时长不限，手动停止）</view>

    <view class="card">
      <view class="row">
        <input class="url" v-model="baseUrl" placeholder="http://192.168.4.1 或 http://babycry.local" />
        <button class="mini" :class="connected ? 'ok' : ''" @click="connect">
          {{ connected ? '已连接' : '连接' }}
        </button>
      </view>
      <view class="status" :class="statusCls">{{ statusText }}</view>
    </view>

    <view class="card">
      <view class="barwrap"><view class="bar" :style="{ width: barWidth + '%' }"></view></view>
      <view class="rms">实时电平 RMS: {{ rmsText }}</view>
    </view>

    <view class="cats">
      <view v-for="c in CATS" :key="c.key"
            class="cat" :class="[c.key, selectedCat === c.key ? 'active' : '']"
            @click="selectedCat = c.key">
        {{ c.label }}
      </view>
    </view>

    <view class="recbtns">
      <button class="rec start" :disabled="recording || !connected" @click="startRec">● 开始录音</button>
      <button class="rec stop" :disabled="!recording" @click="stopRec">■ 停止并保存</button>
    </view>
    <view v-if="recording" class="hint">录音中… {{ recSecs }}s（按「停止并保存」结束）</view>

    <view class="hint">
      保存位置：<text class="em">{{ saveHint }}</text><br />
      文件名：{{ selectedCat }}_NNN.wav
    </view>

    <button class="copylog" @click="copyLog">📋 复制日志</button>
    <scroll-view scroll-y class="log"><text>{{ logText }}</text></scroll-view>
  </view>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { onLoad, onShow, onHide } from '@dcloudio/uni-app';
import { SR, calcRms, agcNormalize, buildWav } from '../../common/audio.js';

const CATS = [
  { key: 'cry', label: '😭 哭声' },
  { key: 'babble', label: '👶 哼唧/咿呀' },
  { key: 'speech', label: '🗣 说话/电视' },
  { key: 'background', label: '🌫 背景噪声' },
];

const baseUrl = ref('http://babycry.local');
const connected = ref(false);
const statusText = ref('未连接');
const statusCls = ref('');
const selectedCat = ref('cry');
const recording = ref(false);
const recSecs = ref(0);
const barWidth = ref(0);
const rmsText = ref('—');
const counters = reactive({});
const logText = ref('');
const saveHint = ref('保存中...');

let wsTask = null;
let recChunks = [];          // 累积的 Int16Array
let recTotal = 0;
let meterTimer = null;
let recTimer = null;

try {
  const saved = uni.getStorageSync('bcCounters');
  if (saved) Object.assign(counters, saved);
} catch (e) {}

// #ifdef APP-PLUS
saveHint.value = uni.getSystemInfoSync().platform === 'android'
  ? 'Android: 下载目录/BabyCry/'
  : 'iOS: App 沙盒 _doc/audio/（可用 H5 版直接下载到文件App）';
// #endif
// #ifndef APP-PLUS
saveHint.value = '浏览器下载目录（H5 版）';
// #endif

// ---- 日志: 屏幕显示 + 写入 下载/BabyCry/app.log (Android) / 文档/audio/app.log (iOS) ----
let logQueue = [];
let logWriting = false;

function flushLogQueue() {
  if (logWriting || logQueue.length === 0) return;
  logWriting = true;
  const msg = logQueue.shift();
  // #ifdef APP-PLUS
  try {
    const isAndroid = uni.getSystemInfoSync().platform === 'android';
    plus.io.requestFileSystem(
      isAndroid ? plus.io.PUBLIC_DOWNLOADS : plus.io.PUBLIC_DOCUMENTS,
      (fs) => {
        const dirName = isAndroid ? 'BabyCry' : 'audio';
        fs.root.getDirectory(dirName, { create: true }, (dir) => {
          dir.getFile('app.log', { create: true }, (fe) => {
            fe.createWriter((writer) => {
              writer.seek(writer.length);               // 追加模式
              writer.onwrite = () => { logWriting = false; flushLogQueue(); };
              writer.onerror = () => { logWriting = false; flushLogQueue(); };
              writer.write(msg + '\n');
            }, () => { logWriting = false; flushLogQueue(); });
          }, () => { logWriting = false; flushLogQueue(); });
        }, () => { logWriting = false; flushLogQueue(); });
      },
      () => { logWriting = false; flushLogQueue(); }
    );
  } catch (e) { logWriting = false; flushLogQueue(); }
  // #endif
  // #ifndef APP-PLUS
  logWriting = false;
  flushLogQueue();
  // #endif
}

function log(msg) {
  const line = new Date().toLocaleTimeString() + ' ' + msg;
  logText.value = (line + '\n' + logText.value).slice(0, 2000);
  logQueue.push(line);
  flushLogQueue();
}
// -----------------------------------------------------------------

function wsUrl() {
  let u = baseUrl.value.trim().replace(/\/+$/, '');
  if (!/^https?:/i.test(u)) u = 'http://' + u;   // 补协议
  u = u.replace(/^http/i, 'ws');                 // http → ws
  return u + '/ws';
}

function setupSocket(task) {
  wsTask = task;
  task.onOpen(() => {
    connected.value = true;
    statusText.value = '✅ 已连接开发板';
    statusCls.value = 'ok';
    log('已连接 ' + wsUrl());
  });
  task.onMessage((res) => {
    const data = res.data;
    if (typeof data === 'string') {
      // 文本命令回执 (done)
      try {
        const j = JSON.parse(data);
        if (j.cmd === 'done') {
          recording.value = false;
          if (recTimer) { clearInterval(recTimer); recTimer = null; }
          if (j.lost) log('⚠ 有数据丢失，建议重录');
          log('收到 done: ' + data);
          finalizeRec(j.samples || recTotal);
        }
      } catch (e) { log('⚠ 无法解析文本: ' + data.slice(0, 40)); }
      return;
    }
    if (data && data.byteLength !== undefined) {
      // ArrayBuffer: 可能是音频, 也可能是被当二进制送达的文本命令
      const bytes = new Uint8Array(data);
      if (bytes.length > 1 && bytes[0] === 0x7B) {   // '{'
        try {
          const txt = String.fromCharCode.apply(null, bytes);
          const j = JSON.parse(txt);
          if (j.cmd === 'done') {
            recording.value = false;
            if (recTimer) { clearInterval(recTimer); recTimer = null; }
            if (j.lost) log('⚠ 有数据丢失，建议重录');
            log('收到 done(二进制帧): ' + txt);
            finalizeRec(j.samples || recTotal);
          }
          return;
        } catch (e) { log('⚠ 二进制JSON解析失败'); return; }
      }
      // 音频 PCM
      if (recording.value) {
        recChunks.push(new Int16Array(data));
        recTotal += data.byteLength / 2;
      }
      return;
    }
    log('⚠ 未知消息类型: ' + typeof data);
  });
  task.onClose(() => {
    connected.value = false;
    recording.value = false;
    statusText.value = '连接已断开';
    log('连接断开');
  });
  task.onError((e) => {
    connected.value = false;
    statusText.value = '连接错误: ' + (e.errMsg || e);
  });
}

function connect() {
  if (wsTask) { try { wsTask.close({}); } catch (e) {} wsTask = null; }
  statusText.value = '连接中...';
  statusCls.value = '';
  const url = wsUrl();

  let task;
  try {
    // 官方示例用法: 必须传 complete 回调, 返回值才是 SocketTask
    // (不传回调时 Vue3 返回 Promise; success 回调里的 res 不是 SocketTask)
    task = uni.connectSocket({ url: url, complete: () => {} });
  } catch (e) {
    statusText.value = '连接失败: ' + e;
    statusCls.value = 'err';
    return;
  }

  if (task && typeof task.onOpen === 'function') {
    setupSocket(task);
    return;
  }

  // 兼容: 部分版本不传回调返回 Promise, 解析后也是 SocketTask
  if (task && typeof task.then === 'function') {
    task.then((t2) => {
      if (t2 && typeof t2.onOpen === 'function') {
        setupSocket(t2);
      } else {
        statusText.value = '连接失败: SocketTask 解析失败 (' + typeof t2 + ')';
        statusCls.value = 'err';
      }
    }).catch((e) => {
      statusText.value = '连接失败: ' + (e.errMsg || JSON.stringify(e));
      statusCls.value = 'err';
    });
    return;
  }

  statusText.value = '连接失败: 未获取到 SocketTask (' + typeof task + ')';
  statusCls.value = 'err';
}

function startRec() {
  if (!connected.value || recording.value) return;
  recChunks = [];
  recTotal = 0;
  recSecs.value = 0;
  recording.value = true;
  try { wsTask.send({ data: JSON.stringify({ cmd: 'start' }) }); } catch (e) {}
  statusText.value = '录音中...';
  log('开始录音 [' + selectedCat.value + ']');
  recTimer = setInterval(() => { recSecs.value = Math.round(recTotal / SR); }, 200);
}

function stopRec() {
  if (!recording.value) return;
  statusText.value = '正在结束录音...';
  try { wsTask.send({ data: JSON.stringify({ cmd: 'stop' }) }); } catch (e) {}
  // done 消息回来后 finalizeRec 处理
}

function finalizeRec(samples) {
  log('finalizeRec: 本地缓冲=' + recTotal + ' 样本, 固件=' + (samples || '?') + ' 样本');
  if (recTotal < SR * 0.5) {
    statusText.value = '录音太短 (只收到 ' + (recTotal / SR).toFixed(1) + 's)';
    statusCls.value = 'err';
    log('⚠ 录音太短, 只收到 ' + recTotal + ' 样本');
    return;
  }
  try {
    // 合并累积的 PCM
    const all = new Int16Array(recTotal);
    let off = 0;
    for (const c of recChunks) { all.set(c, off); off += c.length; }
    const rms = calcRms(all);
    const norm = agcNormalize(all);
    const wav = buildWav(norm);
    const name = selectedCat.value + '_' + String((counters[selectedCat.value] || 0) + 1).padStart(3, '0') + '.wav';
    counters[selectedCat.value] = (counters[selectedCat.value] || 0) + 1;
    try { uni.setStorageSync('bcCounters', counters); } catch (e) {}
    log('开始保存 ' + name + ' (RMS=' + Math.round(rms) + ', ' + (recTotal / SR).toFixed(1) + 's)');
    saveFile(wav, name, rms);
  } catch (e) {
    statusText.value = '保存异常: ' + e.message;
    statusCls.value = 'err';
    log('⚠ finalizeRec 异常: ' + (e.message || JSON.stringify(e)));
  }
}

function saveFile(wav, name, rms) {
  // #ifdef APP-PLUS
  const isAndroid = uni.getSystemInfoSync().platform === 'android';
  plus.io.requestFileSystem(
    isAndroid ? plus.io.PUBLIC_DOWNLOADS : plus.io.PUBLIC_DOCUMENTS,
    (fs) => {
      const dirName = isAndroid ? 'BabyCry' : 'audio';
      fs.root.getDirectory(dirName, { create: true }, (dir) => {
        dir.getFile(name, { create: true }, (fe) => {
          fe.createWriter((writer) => {
            writer.onwrite = () => afterSave(name, rms, isAndroid ? '下载目录/BabyCry/' : 'App 文档目录');
            writer.onerror = () => afterSave(name, rms, 'App 文档目录');
            writer.write(new Blob([wav], { type: 'audio/wav' }));
          }, () => log('⚠ 创建写入器失败'));
        }, () => log('⚠ 创建文件失败'));
      }, () => log('⚠ 创建目录失败'));
    },
    (e) => { statusText.value = '保存失败: ' + JSON.stringify(e); statusCls.value = 'err'; log('⚠ 保存失败(目录不可写): ' + JSON.stringify(e)); }
  );
  // #endif
  // #ifndef APP-PLUS
  const blob = new Blob([wav], { type: 'audio/wav' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  afterSave(name, rms, '浏览器下载目录');
  // #endif
}

function afterSave(name, rms, where) {
  statusText.value = '✔ 已保存 ' + name + '（RMS ' + Math.round(rms) + '，时长 ' + (recTotal / SR).toFixed(1) + 's）';
  statusCls.value = 'ok';
  log('✔ ' + name + ' → ' + where);
}

function updateMeter() {
  if (!connected.value) return;
  uni.request({
    url: baseUrl.value.replace(/\/$/, '') + '/rms',
    timeout: 3000,
    success: (res) => {
      let rms = 0;
      try { rms = JSON.parse(res.data).rms || 0; } catch (e) {}
      barWidth.value = Math.min(100, rms / 160 * 100);
      rmsText.value = Math.round(rms);
    },
  });
}

function copyLog() {
  uni.setClipboardData({
    data: logText.value,
    success: () => { statusText.value = '✔ 日志已复制，粘贴发给我'; statusCls.value = 'ok'; },
  });
}

onLoad(() => {
  // #ifdef APP-PLUS
  const p = uni.getSystemInfoSync().platform;
  const fsType = p === 'android' ? '下载目录/BabyCry/app.log' : '文档目录/audio/app.log';
  log('App 启动 (' + p + ')，日志文件: ' + fsType);
  // #endif
});

onShow(() => { if (!meterTimer) meterTimer = setInterval(updateMeter, 500); });
onHide(() => { if (meterTimer) { clearInterval(meterTimer); meterTimer = null; } });
onMounted(() => { if (!meterTimer) meterTimer = setInterval(updateMeter, 500); });
onUnmounted(() => {
  if (meterTimer) { clearInterval(meterTimer); meterTimer = null; }
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
  if (wsTask) { try { wsTask.close({}); } catch (e) {} }
});
</script>

<style>
.page { padding: 24rpx; max-width: 700rpx; margin: 0 auto; }
.title { font-size: 40rpx; font-weight: 600; margin: 10rpx 0 4rpx; }
.sub { font-size: 24rpx; color: #8a94a8; margin-bottom: 20rpx; }
.em { color: #fff; font-style: normal; }
.card { background: #1a2133; border-radius: 16rpx; padding: 20rpx; margin-bottom: 20rpx; }
.row { display: flex; align-items: center; }
.url { flex: 1; background: #0b101c; color: #e8ecf4; border-radius: 10rpx; padding: 14rpx 16rpx; font-size: 26rpx; }
.mini { margin-left: 16rpx; background: #5b9fe0; color: #fff; font-size: 26rpx; padding: 0 24rpx; border-radius: 10rpx; }
.mini.ok { background: #4caf50; }
.status { font-size: 26rpx; margin-top: 14rpx; }
.status.ok { color: #4caf50; }
.status.err { color: #f44336; }
.barwrap { height: 16rpx; background: #0b101c; border-radius: 8rpx; overflow: hidden; }
.bar { height: 100%; width: 0; background: linear-gradient(90deg, #4caf50, #ff9800, #f44336); }
.rms { font-size: 22rpx; color: #8a94a8; margin-top: 8rpx; }
.cats { display: flex; flex-wrap: wrap; justify-content: space-between; margin-bottom: 20rpx; }
.cat { width: 48%; box-sizing: border-box; border-radius: 16rpx; padding: 26rpx 0; margin-bottom: 16rpx; text-align: center; color: #fff; font-size: 30rpx; opacity: 0.45; }
.cat.active { opacity: 1; outline: 4rpx solid #fff; }
.c { background: #e05b5b; } .b { background: #5b9fe0; }
.s { background: #5bd08a; } .n { background: #8a8fa3; }
.recbtns { display: flex; justify-content: space-between; margin-bottom: 20rpx; }
.rec { width: 48%; color: #fff; border-radius: 16rpx; padding: 24rpx 0; font-size: 30rpx; }
.rec.start { background: #e05b5b; }
.rec.stop { background: #4caf50; }
.rec[disabled] { opacity: 0.4; }
.hint { font-size: 24rpx; color: #8a94a8; line-height: 1.7; margin-bottom: 20rpx; }
.copylog { background: #3a4c6b; color: #fff; border-radius: 12rpx; padding: 14rpx; margin-bottom: 12rpx; font-size: 26rpx; }
.log { height: 200rpx; background: #1a2133; border-radius: 12rpx; padding: 16rpx; font-size: 22rpx; color: #8a94a8; }
</style>
