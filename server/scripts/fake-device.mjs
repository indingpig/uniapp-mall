/**
 * 假设备联调脚本 — 模拟整合固件的设备侧行为, 无硬件验证全链路
 *
 * 用法:
 *   1. NO_SIMULATOR=true pnpm run dev        # 关内置模拟器起服务
 *   2. node scripts/fake-device.mjs [wsUrl]  # 默认 ws://localhost:3001/ws?device=esp32
 *   3. 另开终端跑 fake-app.mjs 发指令 / 或用 H5 首页点监听
 *
 * 行为:
 *   - 每 500ms 发 {"type":"audio","rms","peak"} (对齐固件监听中节奏)
 *   - 每 1s 发 {"type":"inference","label","score","rms"}, label 按
 *     noise → speach → babycry 轮换 (babycry 阶段应触发 statusChange → crying)
 *   - 收到 {"type":"cmd"} 打印 (fake-app 发 listen_on/off 时)
 */
import WebSocket from 'ws';

const url = process.argv[2] || 'ws://localhost:3001/ws?device=esp32';
const CYCLE = ['noise', 'speach', 'noise', 'babycry', 'babycry', 'babycry'];

const ws = new WebSocket(url);
let ticks = 0;

ws.on('open', () => {
  console.log(`[fake-device] connected: ${url}`);

  setInterval(() => {
    ticks++;
    // RMS 曲线: 基线 60, babycry 阶段抬到 300+ (模拟哭闹)
    const label = CYCLE[Math.floor(ticks / 8) % CYCLE.length];
    const rms = label === 'babycry' ? 280 + Math.round(60 * Math.random()) : 50 + Math.round(30 * Math.random());
    ws.send(JSON.stringify({ type: 'audio', rms, peak: rms * 2 }));
  }, 500);

  setInterval(() => {
    const label = CYCLE[Math.floor(ticks / 8) % CYCLE.length];
    const payload = { type: 'inference', label, score: 0.9, rms: label === 'babycry' ? 2400 : 500 };
    ws.send(JSON.stringify(payload));
    console.log(`[fake-device] inference -> ${label}`);
  }, 1000);
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'cmd') {
    console.log(`[fake-device] << cmd: ${msg.cmd}`);
    if (msg.cmd === 'listen_on' || msg.cmd === 'listen_off') {
      // 真固件会回 listenState
      ws.send(JSON.stringify({ type: 'listenState', listening: msg.cmd === 'listen_on' }));
      console.log(`[fake-device] >> listenState: ${msg.cmd === 'listen_on'}`);
    }
  }
});

ws.on('close', () => {
  console.log('[fake-device] closed');
  process.exit(0);
});

ws.on('error', (e) => {
  console.error('[fake-device] error:', e.message);
  process.exit(1);
});
