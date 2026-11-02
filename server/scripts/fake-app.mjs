/**
 * 假 App 联调脚本 — 模拟 App 客户端, 配合 fake-device.mjs 验证指令链路
 *
 * 用法: node scripts/fake-app.mjs [wsUrl] [cmd]
 *   默认 ws://localhost:3001/ws, 发送 listen_on, 5s 后发 listen_off 后退出。
 *   同时打印收到的 init / statusChange / inference / listenState 广播。
 */
import WebSocket from 'ws';

const url = process.argv[2] || 'ws://localhost:3001/ws';
const cmd = process.argv[3] || 'listen_on';

const ws = new WebSocket(url);

ws.on('open', () => {
  console.log(`[fake-app] connected: ${url}`);
  setTimeout(() => {
    console.log(`[fake-app] >> cmd: ${cmd}`);
    ws.send(JSON.stringify({ type: 'cmd', cmd }));
    setTimeout(() => {
      const off = cmd === 'listen_on' ? 'listen_off' : 'listen_on';
      console.log(`[fake-app] >> cmd: ${off}`);
      ws.send(JSON.stringify({ type: 'cmd', cmd: off }));
      setTimeout(() => process.exit(0), 1500);
    }, 5000);
  }, 1000);
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'volume') return;   // 太刷屏, 不打
  console.log(`[fake-app] << ${JSON.stringify(msg)}`);
});

ws.on('close', () => console.log('[fake-app] closed'));
ws.on('error', (e) => {
  console.error('[fake-app] error:', e.message);
  process.exit(1);
});
