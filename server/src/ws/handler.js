import { WebSocketServer } from 'ws';
import { STATUS } from '../services/detector.js';

const clients = new Set();
let esp32Client = null;           // 设备连接 (单设备)
let deviceListening = false;      // 设备真实监听状态 (listenState 回执驱动)
const listenWanters = new Set();  // 想监听的 app 连接集合 (引用计数: 0→1 开, 归 0 关)
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
  });

  // 事件层「有动静」(规范 6/T-07): 睡眠中的短暂声响, 不改主状态——
  // 落库存为独立事件, /api/history 随 records 一并返回, 时间线单条呈现
  detector.on('noise', ({ timestamp }) => {
    dataStore.addEvent('noise', timestamp);
  });

  wss.on('connection', (ws, req) => {
    const clientType = req.url?.includes('esp32') ? 'esp32' : 'app';
    // 家庭角色（?ftoken=，S-07）：member 拒绝设备指令；owner/未加入(无 token 的旧客户端)保持原行为
    let familyRole = 'guest';
    if (clientType === 'app') {
      try {
        familyRole = familyStore.auth(new URL(req.url, 'http://localhost').searchParams.get('ftoken')).role;
      } catch {
        familyRole = 'guest';
      }
    }
    clients.add(ws);
    if (clientType === 'esp32') {
      esp32Client = ws;
      // 设备 (重)连后按当前意愿恢复监听: 设备重启后 s_listening 归零, 而网络
      // 抖动重连时设备仍保持监听并自行补发 listenState (server_link.cpp) ——
      // 两侧最终都以设备回执为准, 这里只负责「有意愿就发一次 listen_on」
      if (listenWanters.size > 0) {
        sendToEsp32({ type: 'cmd', cmd: 'listen_on' });
      }
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
          // 监听指令走引用计数: 谁想听谁登记, 0→1 时开设备, 归 0 才关设备;
          // 单个 App 的开关不影响其他成员的监听意愿, App 断开自动退订
          if (msg.cmd === 'listen_on') {
            listenWanters.add(ws);
            if (!deviceListening) {
              sendToEsp32({ type: 'cmd', cmd: 'listen_on' });
            }
          } else if (msg.cmd === 'listen_off') {
            listenWanters.delete(ws);
            if (deviceListening && listenWanters.size === 0) {
              sendToEsp32({ type: 'cmd', cmd: 'listen_off' });
            }
          } else {
            // 其他指令原样透传给设备
            sendToEsp32({ type: 'cmd', cmd: msg.cmd });
          }
          return;
        }
      } catch (e) {
        console.error('[WS] Invalid message:', raw.toString().slice(0, 50));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      listenWanters.delete(ws);
      if (clientType === 'esp32' && esp32Client === ws) {
        esp32Client = null;
        deviceListening = false;
        lastInference = null;
      }
      else if (clientType === 'app' && deviceListening && listenWanters.size === 0) {
        // 最后一个想听的 App 离开 (含杀进程/断网) → 停设备监听
        sendToEsp32({ type: 'cmd', cmd: 'listen_off' });
      }
      console.log(`[WS] ${clientType} disconnected (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
    });
  });

  return wss;
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
