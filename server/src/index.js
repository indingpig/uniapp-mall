import 'dotenv/config';
import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Detector } from './services/detector.js';
import { dataStore } from './services/dataStore.js';
import { startSimulator } from './services/simulator.js';
import { createWSServer, getOnlineCount } from './ws/handler.js';
import { createBabyRoutes } from './routes/baby.js';
import { createHistoryRoutes } from './routes/history.js';
import { createStatsRoutes } from './routes/stats.js';

const PORT = process.env.PORT || 8080;

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

const detector = new Detector();

detector.on('statusChange', ({ from, to }) => {
  console.log(`[Detector] ${from} → ${to}`);
});

app.use('/api/baby', createBabyRoutes(detector, dataStore));
app.use('/api/history', createHistoryRoutes(dataStore));
app.use('/api/stats', createStatsRoutes());
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, onlineClients: getOnlineCount() });
});

const server = createServer(app);

// WebSocket
const wss = createWSServer(server, detector, dataStore);

// 模拟器
const useSimulator = process.env.NO_SIMULATOR !== 'true';
if (useSimulator) {
  startSimulator(detector, dataStore);
  console.log('[Simulator] Started (set NO_SIMULATOR=true to disable)');
}

server.listen(PORT, () => {
  console.log(`[Server] Baby Cry Monitor API listening on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket: ws://localhost:${PORT}/ws`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Server] ❌ 端口 ${PORT} 已被占用，请先关闭占用进程或修改 .env 中的 PORT`);
  } else {
    console.error(`[Server] ❌ 启动失败:`, err.message);
  }
  process.exit(1);
});

// 进程退出时清理
function shutdown() {
  console.log('\n[Server] Shutting down...');
  wss.close();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
