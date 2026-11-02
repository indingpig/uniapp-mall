import { WebSocketServer } from 'ws';
import { STATUS } from '../services/detector.js';

const clients = new Set();
let esp32Client = null;           // 设备连接 (单设备)
let lastInference = null;         // { label, ts } 设备最新识别结果, 附到 audio 上喂 detector

// 模型 label 的有效期: 推理 1s 一窗, 取 1.5s 覆盖两次 audio 间隔
const LABEL_FRESH_MS = 1500;

export function createWSServer(server, detector, dataStore) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('[WS] Server error:', err.message);
    }
  });

  detector.on('statusChange', ({ from, to, timestamp }) => {
    broadcast({ type: 'statusChange', from, to, timestamp });
  });

  wss.on('connection', (ws, req) => {
    const clientType = req.url?.includes('esp32') ? 'esp32' : 'app';
    clients.add(ws);
    if (clientType === 'esp32') {
      esp32Client = ws;
    }
    console.log(`[WS] ${clientType} connected (total: ${clients.size})`);

    // 新客户端连接后发送当前状态
    ws.send(JSON.stringify({
      type: 'init',
      status: detector.status,
      durationSec: detector.getDurationSec(),
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
          broadcastToApps({ type: 'listenState', listening: !!msg.listening });
          return;
        }

        if (msg.type === 'cmd' && clientType === 'app') {
          // App 指令中继给设备: { type:'cmd', cmd }
          sendToEsp32({ type: 'cmd', cmd: msg.cmd });
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
        lastInference = null;
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
