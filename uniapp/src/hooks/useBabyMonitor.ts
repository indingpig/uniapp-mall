import type { BabyStatusData, DeviceData, VolumeData } from '@/api/baby';
import { onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue';
import { fetchBabyStatus, fetchDevice, fetchVolume } from '@/api/baby';
import { STATUS_META, toCardState } from '@/constants/babyStatus';
import { colors } from '@/constants/colors';
import { clearFamilyIdentity, getFamilyMember, getFamilyOwner } from '@/utils/family';
import { pingKeepAlive } from '@/utils/keepalive';
import { maybeNotifyCry } from '@/utils/notify';
import { resolveServerUrl } from '@/utils/server';
import { clearPairingRecords } from '@/utils/storage';

const POLL_INTERVAL = 5000;
const RECONNECT_DELAY = 3000;
/** WS 应用层心跳间隔：锁屏/doze 下 NAT 网关会掐掉静默连接，25s 一帧 ping 保持活性 */
const WS_PING_INTERVAL = 25_000;

interface WsMessage {
  type: 'init' | 'statusChange' | 'volume' | 'inference' | 'listenState' | 'familyChanged' | 'error';
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
  // familyChanged 消息 (成员加入/移除/解散广播)
  action?: 'added' | 'removed' | 'dissolved';
  memberId?: string;
  // error 消息 (成员发设备指令被拒等)
  message?: string;
}

export function useBabyMonitor() {
  const status = ref<BabyStatusData>({
    status: 'offline',
    statusText: '连接中...',
    iconKey: 'face-cry',
    iconColor: colors.muted,
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
  /** 设备是否在跑推理监听（设备端持久偏好, listenState 回执/init 驱动） */
  const listening = ref(false);

  let socket: ReturnType<typeof uni.connectSocket> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let localTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
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

  /**
   * E-13/E-14：本机成员被移除或共享解散 → 立即收敛为未配对空态。
   * 清身份与配对记录后主动断线（防 3s 重连循环），toast 后回首页空态；
   * owner 收到自己触发的 dissolved 广播时本机无成员身份，自然跳过
   */
  function handleFamilyChanged(msg: WsMessage) {
    if (msg.action !== 'removed' && msg.action !== 'dissolved')
      return;
    const me = getFamilyMember();
    if (!me)
      return;
    if (msg.action === 'removed' && msg.memberId && msg.memberId !== me.id)
      return;
    clearFamilyIdentity();
    clearPairingRecords();
    closeWs();
    stopPolling();
    uni.showToast({ title: '已退出该设备的共享', icon: 'none' });
    setTimeout(() => uni.reLaunch({ url: '/pages/home/index' }), 600);
  }

  /* -------------------- WebSocket -------------------- */

  function connectWs() {
    // 每次连接现读地址：家人加入/重新配对后无需重启 App 即生效
    const wsUrl = resolveServerUrl();
    if (!wsUrl) {
      console.warn('[WS] 未配置服务器地址（配对或加入家庭监护后可用）');
      return;
    }
    // 家庭 token 上行（S-07）：server 据此判角色，成员端设备指令会被拒
    const familyToken = getFamilyMember()?.token || getFamilyOwner()?.token;
    const url = familyToken ? `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}ftoken=${familyToken}` : wsUrl;
    console.warn('[WS] connect', url);
    // 必须传 complete 回调才返回 SocketTask（不传回调时返回 Promise，
    // success 回调里的 res 不是 SocketTask）
    socket = uni.connectSocket({ url, complete: () => {} });

    socket.onOpen(() => {
      console.warn('[WS] Connected');
      wsActive = true;
      stopPolling();
      startPing();
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
            // 连接瞬间同步设备真实监听状态（多 App 引用计数下，晚入的 App
            // 可能是别人开着监听，初始 false 会显示错）
            if (msg.listening !== undefined)
              listening.value = msg.listening;
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
          case 'familyChanged':
            handleFamilyChanged(msg);
            break;
          case 'error':
            console.warn('[WS] server error:', msg.message);
            // server 拒绝（成员无权限）或设备离线丢指令时明确告知，别静默无效
            uni.showToast({ title: msg.message || '指令执行失败', icon: 'none' });
            break;
        }
      }
      catch { /* ignore malformed */ }
    });

    socket.onClose(() => {
      console.warn('[WS] Disconnected, falling back to polling');
      wsActive = false;
      stopPing();
      startPolling();
      scheduleReconnect();
    });

    socket.onError((err: { errMsg?: string }) => {
      console.error('[WS] Error', err);
      socket?.close();
    });
  }

  /**
   * 应用层心跳（server handler 已有 ping→pong 回执）：静默连接会被 NAT/doze
   * 掐断且不发 FIN，App 收不到 onClose——定时发 ping 触发底层错误让断线尽快
   * 显形，走既有重连逻辑。与 server 端 30s isAlive 清扫互为补充。
   *
   * 同一定时器顺带上报保活活性（pingKeepAlive）：前台服务据此判断 JS 是否真的
   * 还在跑，断线时停止上报 → 90s 后常驻通知改写为「监护已中断」，杜绝幽灵态。
   */
  function startPing() {
    stopPing();
    pingKeepAlive();
    pingTimer = setInterval(() => {
      if (!wsActive)
        return;
      try {
        socket?.send({ data: JSON.stringify({ type: 'ping' }) });
      }
      catch { /* 发送失败由 onClose/onError 驱动重连 */ }
      pingKeepAlive();
    }, WS_PING_INTERVAL);
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
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
    stopPing();
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
   * 发送监听开关指令。2026-11-19 语义：监听是设备端 NVS 持久偏好，开关写
   * 设备闪存，重启仍生效，不随 App 在线启停（server 原样透传给设备）。
   * 乐观置位给即时反馈，最终以设备 listenState 回执 / init 为准。
   */
  function sendCmd(cmd: 'listen_on' | 'listen_off') {
    if (!socket || !wsActive) {
      uni.showToast({ title: '连接未建立，请稍后再试', icon: 'none' });
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
