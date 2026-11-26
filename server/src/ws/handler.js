import { WebSocketServer } from 'ws';
import { STATUS } from '../services/detector.js';
import { deviceCameBack, deviceWentOffline, pushCry } from '../services/notify.js';
import {
  AUTH_MODE,
  extractDeviceTokenFromRequest,
  verifyDeviceToken,
} from '../services/auth.js';

const clients = new Set();
let esp32Client = null;           // 设备连接 (单设备)
let deviceListening = false;      // 设备真实监听状态 (listenState 回执驱动)
let lastInference = null;         // { label, ts } 设备最新识别结果, 附到 audio 上喂 detector

// 模型 label 的有效期: 推理 1s 一窗, 取 1.5s 覆盖两次 audio 间隔
const LABEL_FRESH_MS = 1500;

export function createWSServer(server, detector, dataStore, familyStore) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('[WS] Server error:', err.message);
    }
  });

  detector.on('statusChange', ({ from, to, timestamp }) => {
    broadcast({ type: 'statusChange', from, to, timestamp });
    // ntfy 兜底推送（App 被杀后仍能收到系统通知）；App 内本地通知由 App 进程
    // 自己在收到广播后触发，两条链路互不依赖
    if (to === STATUS.CRYING) pushCry();
    // 失联看门狗: 持续离线超过确认窗口才推（瞬断不打扰），恢复补发一次
    if (to === STATUS.OFFLINE) {
      deviceWentOffline(() => detector.status === STATUS.OFFLINE);
    } else if (from === STATUS.OFFLINE) {
      deviceCameBack();
    }
  });

  // 事件层「有动静」(规范 6/T-07): 睡眠中的短暂声响, 不改主状态——
  // 落库存为独立事件, /api/history 随 records 一并返回, 时间线单条呈现
  detector.on('noise', ({ timestamp }) => {
    dataStore.addEvent('noise', timestamp);
  });

  wss.on('connection', (ws, req) => {
    const clientType = req.url?.includes('esp32') ? 'esp32' : 'app';

    // ===== 鉴权（2026-11-26 上公网加固，S-07 强化）=====
    // 旧实现：app 的 ftoken 无效时 catch 落成 'guest' 放行 —— 等于无 token 也能连，
    // 任何人带 ?esp32 即可冒充设备上报假数据。现在改为握手期直接拒绝。
    let familyRole = null;

    if (AUTH_MODE === 'off') {
      // 过渡模式：仅当显式配置 AUTH_MODE=off 时放行，用于固件未升级的空窗期
      familyRole = clientType === 'esp32' ? 'device' : 'guest';
      console.warn(`[WS] AUTH_MODE=off，放行 ${clientType} 连接（不安全，仅过渡用）`);
    } else if (clientType === 'esp32') {
      if (!verifyDeviceToken(extractDeviceTokenFromRequest(req))) {
        console.warn(`[WS] 拒绝 esp32：设备令牌无效或缺失 (${rejectReason(req)})`);
        ws.close(1008, 'invalid device token');
        return;
      }
      familyRole = 'device';
    } else {
      // app：必须持有 familyStore 签发的有效 token
      let token = null;
      try {
        token = new URL(req.url, 'http://localhost').searchParams.get('ftoken');
      } catch {
        token = null;
      }
      try {
        familyRole = familyStore.auth(token).role;
      } catch {
        // 无 token / token 失效 → 拒绝。App 侧需引导用户先配对认领或扫码加入。
        console.warn('[WS] 拒绝 app：缺少或无效的 ftoken');
        ws.close(1008, 'unauthorized');
        return;
      }
    }

    clients.add(ws);
    // 心跳存活标记：ws 库协议层自动回 pong（ESP32 固件 server_link.cpp 手写了
    // ping→pong 回执），清扫循环据此识别死连接
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    if (clientType === 'esp32') {
      esp32Client = ws;
      // 监听偏好持久化 (2026-11-19 语义调整): 设备 (重)连后自行补发当前
      // listenState (server_link.cpp), 两侧都以设备回执为准
    }
    console.log(`[WS] ${clientType} connected (total: ${clients.size})`);

    // 新客户端连接后发送当前状态 (含监听状态, 避免晚入的 App 显示过期开关)
    ws.send(JSON.stringify({
      type: 'init',
      status: detector.status,
      durationSec: detector.getDurationSec(),
      listening: deviceListening,
    }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (msg.type === 'audio' && clientType === 'esp32') {
          // ESP32 发来的数据: { type: 'audio', rms: number, peak: number }
          // 附带最近一次设备端模型识别结果 (有监听才产生, 过期视为无)
          const label = lastInference && Date.now() - lastInference.ts < LABEL_FRESH_MS
            ? lastInference.label
            : null;
          detector.feed(msg.rms, msg.peak, label);
          dataStore.addRecord(msg.rms, msg.peak, detector.status);

          // 广播音量数据给所有 app 客户端
          broadcastToApps({
            type: 'volume',
            rms: msg.rms,
            peak: msg.peak,
            status: detector.status,
            durationSec: detector.getDurationSec(),
          });
          return;
        }

        if (msg.type === 'inference' && clientType === 'esp32') {
          // 设备端模型识别结果: { type:'inference', label, score, rms }
          lastInference = { label: msg.label, ts: Date.now() };
          broadcastToApps({
            type: 'inference',
            label: msg.label,
            score: msg.score,
            rms: msg.rms,
          });
          return;
        }

        if (msg.type === 'listenState' && clientType === 'esp32') {
          // 设备监听状态回执: { type:'listenState', listening }
          deviceListening = !!msg.listening;
          broadcastToApps({ type: 'listenState', listening: deviceListening });
          return;
        }

        if (msg.type === 'cmd' && clientType === 'app') {
          if (familyRole === 'member') {
            // P-02 成员只读：监听开关等指令都是设备控制，成员端只收广播
            ws.send(JSON.stringify({ type: 'error', message: '成员仅可查看，无法控制设备' }));
            return;
          }
          // listen_on/off = 监听偏好开关（设备端 NVS 持久化, 不随 App 在线启停,
          // 2026-11-19 语义调整）, 与其他指令一样原样透传, 以设备回执为准。
          // 设备离线时明确回执错误, 别让 App 开关静默无效
          if (esp32Client && esp32Client.readyState === esp32Client.OPEN) {
            sendToEsp32({ type: 'cmd', cmd: msg.cmd });
          } else {
            ws.send(JSON.stringify({ type: 'error', message: '设备离线，指令未送达' }));
          }
          return;
        }
      } catch (e) {
        console.error('[WS] Invalid message:', raw.toString().slice(0, 50));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      if (clientType === 'esp32' && esp32Client === ws) {
        esp32Client = null;
        deviceListening = false;
        lastInference = null;
      }
      // 监听是设备端持久偏好, App 离开不改变设备状态（旧逻辑在此向设备发 listen_off）
      console.log(`[WS] ${clientType} disconnected (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
    });
  });

  // 死连接清扫：30s 一轮协议层 ping，下一轮仍无 pong 即 terminate。
  // doze/NAT 造成的半开连接不发 FIN，客户端永远收不到 close 事件，
  // App 侧既有的 3s 重连逻辑无从触发——主动清扫让双方尽快感知断线。
  // App 自身另有 25s 应用层 ping（useBabyMonitor），两层互为补充。
  const HEARTBEAT_SWEEP_MS = 30_000;
  const heartbeatTimer = setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_SWEEP_MS);
  wss.on('close', () => clearInterval(heartbeatTimer));

  return wss;
}

/* 拒绝原因归类（只用于日志，不把令牌本体写进日志） */
function rejectReason(req) {
  const hasAuthz = typeof req.headers?.authorization === 'string';
  const hasApiKey = typeof req.headers?.['x-api-key'] === 'string';
  const hasQuery = typeof req.url === 'string' && req.url.includes('dtoken=');
  if (!hasAuthz && !hasApiKey && !hasQuery) return '固件未携带任何令牌，需重新配网写入';
  return '令牌与 server/.env 的 DEVICE_TOKEN 不一致';
}

function broadcast(data) {
  const json = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(json);
    }
  }
}

/* 只发给 App 客户端 (设备不需要 volume/inference 回声) */
function broadcastToApps(data) {
  const json = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN && ws !== esp32Client) {
      ws.send(json);
    }
  }
}

/* 转发给设备 (App 下发的指令) */
function sendToEsp32(data) {
  if (esp32Client && esp32Client.readyState === esp32Client.OPEN) {
    esp32Client.send(JSON.stringify(data));
  } else {
    console.log('[WS] cmd dropped: esp32 not connected');
  }
}

export function getOnlineCount() {
  return clients.size;
}

/** 家庭变更广播（成员加入/移除/解散）：在线成员端据此实时收敛本地共享态（E-13） */
export function notifyFamilyChanged(payload) {
  broadcastToApps({ type: 'familyChanged', ...payload });
}
