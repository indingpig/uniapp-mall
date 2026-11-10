import type { BabyStatusData, DeviceData, VolumeData } from '@/api/baby';
import { onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue';
import { fetchBabyStatus, fetchDevice, fetchVolume } from '@/api/baby';
import { STATUS_META, toCardState } from '@/constants/babyStatus';
import { maybeNotifyCry } from '@/utils/notify';
import { resolveServerUrl } from '@/utils/server';

const POLL_INTERVAL = 5000;
const RECONNECT_DELAY = 3000;

interface WsMessage {
  type: 'init' | 'statusChange' | 'volume' | 'inference' | 'listenState';
  status?: string;
  durationSec?: number;
  rms?: number;
  peak?: number;
  from?: string;
  to?: string;
  timestamp?: number;
  // inference 消息 (设备端模型识别结果)
  label?: string;
  score?: number;
  // listenState 消息 (设备监听状态回执)
  listening?: boolean;
}

export function useBabyMonitor() {
  const status = ref<BabyStatusData>({
    status: 'offline',
    statusText: '连接中...',
    iconKey: 'face-cry',
    iconColor: '#b3b3b3',
    durationSec: 0,
    isOnline: false,
  });

  const volume = ref<VolumeData>({ rms: 0, peak: 0, db: 0, timestamp: Date.now() });
  const device = ref<DeviceData>({
    name: '连接中...',
    connectionText: '等待连接',
    signalStrength: 0,
    isOnline: false,
  });

  const durationSec = ref(0);
  /** 设备是否在跑推理监听（由 App 指令触发，设备回执驱动） */
  const listening = ref(false);

  let socket: ReturnType<typeof uni.connectSocket> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let localTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let wsActive = false;

  function applyStatus(s: string) {
    // 文案/取色统一走 STATUS_META（设计规范 v1.1 第 6 节），避免第二份映射漂移
    const meta = STATUS_META[toCardState(s)];
    status.value = {
      status: s as BabyStatusData['status'],
      statusText: meta.text,
      iconKey: 'face-cry',
      iconColor: meta.color,
      durationSec: durationSec.value,
      isOnline: s !== 'offline',
    };
    device.value = { ...device.value, isOnline: s !== 'offline' };
  }

  function applyVolume(rms: number, peak: number, newStatus?: string) {
    volume.value = {
      rms,
      peak,
      db: Math.round(20 * Math.log10(Math.max(rms, 1))),
      timestamp: Date.now(),
    };
    if (newStatus && newStatus !== status.value.status) {
      durationSec.value = 0;
      applyStatus(newStatus);
    }
  }

  /** 状态将要转换进 crying 的瞬间发后台通知（必须在 applyStatus 之前判 prev） */
  function notifyOnCryTransition(next?: string) {
    if (next === 'crying' && status.value.status !== 'crying')
      maybeNotifyCry();
  }

  /* -------------------- WebSocket -------------------- */

  function connectWs() {
    // 每次连接现读地址：家人加入/重新配对后无需重启 App 即生效
    const wsUrl = resolveServerUrl();
    if (!wsUrl) {
      console.warn('[WS] 未配置服务器地址（配对或加入家庭监护后可用）');
      return;
    }
    console.warn('[WS] connect', wsUrl);
    // 必须传 complete 回调才返回 SocketTask（不传回调时返回 Promise，
    // success 回调里的 res 不是 SocketTask）
    socket = uni.connectSocket({ url: wsUrl, complete: () => {} });

    socket.onOpen(() => {
      console.warn('[WS] Connected');
      wsActive = true;
      stopPolling();
    });

    socket.onMessage((res: { data: string | ArrayBuffer }) => {
      try {
        const msg: WsMessage = JSON.parse(res.data as string);
        switch (msg.type) {
          case 'init':
            if (msg.status) {
              applyStatus(msg.status);
              durationSec.value = msg.durationSec || 0;
            }
            break;
          case 'statusChange':
            if (msg.to) {
              notifyOnCryTransition(msg.to);
              durationSec.value = 0;
              applyStatus(msg.to);
            }
            break;
          case 'volume':
            notifyOnCryTransition(msg.status);
            applyVolume(msg.rms || 0, msg.peak || 0, msg.status);
            break;
          case 'listenState':
            listening.value = !!msg.listening;
            break;
        }
      }
      catch { /* ignore malformed */ }
    });

    socket.onClose(() => {
      console.warn('[WS] Disconnected, falling back to polling');
      wsActive = false;
      startPolling();
      scheduleReconnect();
    });

    socket.onError((err: { errMsg?: string }) => {
      console.error('[WS] Error', err);
      socket?.close();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer)
      clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (!wsActive)
        connectWs();
    }, RECONNECT_DELAY);
  }

  function closeWs() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      try {
        socket.close();
      }
      catch { /* ignore */ }
      socket = null;
    }
    wsActive = false;
  }

  /** 立即按最新 server 地址重连（加入/换绑后调用，不等 3s 自动重连） */
  function reconnect() {
    closeWs();
    stopPolling();
    connectWs();
  }

  /* -------------------- 指令下发（App → server 中继 → 设备） -------------------- */

  /**
   * 发送监听指令。发送成功后本地先置位（乐观更新给出即时反馈），
   * 设备回执的 listenState 会覆盖为真实状态。
   */
  function sendCmd(cmd: 'listen_on' | 'listen_off') {
    if (!socket || !wsActive) {
      console.warn('[WS] sendCmd skipped: not connected');
      return false;
    }
    socket.send({ data: JSON.stringify({ type: 'cmd', cmd }) });
    listening.value = cmd === 'listen_on';
    return true;
  }

  /* -------------------- 轮询（WS 断开时兜底） -------------------- */

  async function refresh() {
    try {
      const [s, v, d] = await Promise.all([
        fetchBabyStatus().catch(() => null),
        fetchVolume().catch(() => null),
        fetchDevice().catch(() => null),
      ]);
      if (s) {
        const prev = status.value.status;
        status.value = s;
        if (prev !== s.status)
          durationSec.value = s.durationSec;
      }
      if (v)
        volume.value = v;
      if (d)
        device.value = d;
    }
    catch { /* offline */ }
  }

  function startPolling() {
    if (pollTimer)
      return;
    refresh();
    pollTimer = setInterval(refresh, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /* -------------------- 本地计时器 -------------------- */

  function startLocalTimer() {
    localTimer = setInterval(() => {
      durationSec.value++;
    }, 1000);
  }

  function stopLocalTimer() {
    if (localTimer) {
      clearInterval(localTimer);
      localTimer = null;
    }
  }

  /* -------------------- 生命周期 -------------------- */

  // 设备离线 → 立即退出监听态（规范 12.3 逻辑，由 server 状态变化驱动）
  watch(() => status.value.status, (s) => {
    if (s === 'offline')
      listening.value = false;
  });

  onMounted(() => {
    connectWs();
    startLocalTimer();
  });

  onBeforeUnmount(() => {
    closeWs();
    stopPolling();
    stopLocalTimer();
  });

  return {
    status: readonly(status),
    volume: readonly(volume),
    device: readonly(device),
    durationSec: readonly(durationSec),
    listening: readonly(listening),
    sendCmd,
    refresh,
    reconnect,
  };
}
