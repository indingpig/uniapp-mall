import 'dotenv/config';
import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Detector } from './services/detector.js';
import { dataStore } from './services/dataStore.js';
import { startSimulator } from './services/simulator.js';
import { familyStore } from './services/familyStore.js';
import { createWSServer, getOnlineCount, notifyFamilyChanged } from './ws/handler.js';
import { logNotifyConfig } from './services/notify.js';
import { createBabyRoutes } from './routes/baby.js';
import { createHistoryRoutes } from './routes/history.js';
import { createStatsRoutes } from './routes/stats.js';
import { createFamilyRoutes } from './routes/family.js';
import { requireFamilyToken, logAuthConfig } from './services/auth.js';

const PORT = process.env.PORT || 8080;
// 监听地址：默认 0.0.0.0 保持本机开发体验（手机真机调试要连局域网 IP）。
// 生产环境（服务器 .env）必须设 HOST=127.0.0.1，让 Node 只绑回环，
// 外部只能经 Caddy 反代进来 —— 即便安全组误开 3001，公网也物理不可达。
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

const detector = new Detector();

detector.on('statusChange', ({ from, to }) => {
  console.log(`[Detector] ${from} → ${to}`);
});

// ===== 鉴权分层（2026-11-26 上公网加固）=====
// /api/health 刻意豁免：负载均衡/监控探活不该需要凭据，且它不暴露任何隐私数据。
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, onlineClients: getOnlineCount() });
});

// 业务端点一律要求有效家人 token（owner 或 member 均可读）；
// 板子拉取配置类接口额外允许设备令牌通过。
const familyGuard = requireFamilyToken(familyStore);

app.use('/api/baby', familyGuard, createBabyRoutes(detector, dataStore));
app.use('/api/history', familyGuard, createHistoryRoutes(dataStore));
app.use('/api/stats', familyGuard, createStatsRoutes());
// family 路由内部自带更细的角色校验（owner/member 分支），此处只挡匿名
app.use('/api/family', createFamilyRoutes(familyStore, notifyFamilyChanged));

const server = createServer(app);

// WebSocket
const wss = createWSServer(server, detector, dataStore, familyStore);

// 模拟器
const useSimulator = process.env.NO_SIMULATOR !== 'true';
if (useSimulator) {
  startSimulator(detector, dataStore);
  console.log('[Simulator] Started (set NO_SIMULATOR=true to disable)');
}

// ntfy 兜底推送配置状态（未启用时不打印）
logNotifyConfig();
// 鉴权配置状态（不打印密钥本体）
logAuthConfig();

server.listen(PORT, HOST, () => {
  console.log(`[Server] Baby Cry Monitor API listening on http://${HOST}:${PORT}`);
  console.log(`[Server] WebSocket: ws://${HOST}:${PORT}/ws`);
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
