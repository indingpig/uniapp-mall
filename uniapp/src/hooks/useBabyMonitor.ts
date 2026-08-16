import type { BabyStatusData, DeviceData, VolumeData } from '@/api/baby';
import { onBeforeUnmount, onMounted, readonly, ref } from 'vue';
import { fetchBabyStatus, fetchDevice, fetchVolume } from '@/api/baby';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws';
const POLL_INTERVAL = 5000;
const RECONNECT_DELAY = 3000;

interface WsMessage {
  type: 'init' | 'statusChange' | 'volume';
  status?: string;
  durationSec?: number;
  rms?: number;
  peak?: number;
  from?: string;
  to?: string;
  timestamp?: number;
}

const STATUS_TEXT: Record<string, string> = {
  sleeping: '正在安睡',
  awake: '清醒中',
  crying: '正在哭泣',
  playing: '在玩耍',
  offline: '设备离线',
};

const STATUS_COLOR: Record<string, string> = {
  sleeping: '#7ea279',
  awake: '#7ea279',
  crying: '#d8896a',
  playing: '#7ea279',
  offline: '#b3b3b3',
};

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
    batteryPercent: 0,
    signalStrength: 0,
    isOnline: false,
  });

  const durationSec = ref(0);

  let socket: ReturnType<typeof uni.connectSocket> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let localTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let wsActive = false;

  function applyStatus(s: string) {
    status.value = {
      status: s as BabyStatusData['status'],
      statusText: STATUS_TEXT[s] || s,
      iconKey: 'face-cry',
      iconColor: STATUS_COLOR[s] || '#b3b3b3',
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

  /* -------------------- WebSocket -------------------- */

  function connectWs() {
    socket = uni.connectSocket({ url: WS_URL });

    socket.onOpen(() => {
      console.log('[WS] Connected');
      wsActive = true;
      stopPolling();
    });

    socket.onMessage((res) => {
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
              durationSec.value = 0;
              applyStatus(msg.to);
            }
            break;
          case 'volume':
            applyVolume(msg.rms || 0, msg.peak || 0, msg.status);
            break;
        }
      }
      catch { /* ignore malformed */ }
    });

    socket.onClose(() => {
      console.log('[WS] Disconnected, falling back to polling');
      wsActive = false;
      startPolling();
      scheduleReconnect();
    });

    socket.onError((err) => {
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
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* -------------------- 本地计时器 -------------------- */

  function startLocalTimer() {
    localTimer = setInterval(() => { durationSec.value++; }, 1000);
  }

  function stopLocalTimer() {
    if (localTimer) { clearInterval(localTimer); localTimer = null; }
  }

  /* -------------------- 生命周期 -------------------- */

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
    refresh,
  };
}
