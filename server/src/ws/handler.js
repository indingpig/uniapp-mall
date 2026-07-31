import { WebSocketServer } from 'ws';
import { STATUS } from '../services/detector.js';

const clients = new Set();

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
          detector.feed(msg.rms, msg.peak);
          dataStore.addRecord(msg.rms, msg.peak, detector.status);

          // 广播音量数据给所有 app 客户端
          broadcast({
            type: 'volume',
            rms: msg.rms,
            peak: msg.peak,
            status: detector.status,
            durationSec: detector.getDurationSec(),
          });
        }
      } catch (e) {
        console.error('[WS] Invalid message:', raw.toString().slice(0, 50));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
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

export function getOnlineCount() {
  return clients.size;
}
