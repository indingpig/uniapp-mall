/* ================================================================== */
/*  接口契约测试（方案-接口状态码与业务码设计.md §2 第 6 项）             */
/*                                                                     */
/*  覆盖：状态码类别、`2xx ⟺ code === 0` 不变量、错误体恒为 JSON、        */
/*        业务码映射、WS 握手期鉴权（401 在升级前返回，不再 101 后关闭）。 */
/*  运行：cd server && pnpm test（node --test，无需额外依赖）            */
/*  隔离：服务以随机端口 + 独立 FAMILY_DATA_FILE 启动，不碰真实 data/     */
/* ================================================================== */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 30_000 + Math.floor(Math.random() * 10_000) * 2;   // 避开常用段，取偶数段
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER_TOKEN = 'test-owner-token-0123456789abcdef';
const DEVICE_TOKEN = 'test-device-token-0123456789abcdef0123456789abcdef';

let child;
let dataDir;

async function waitHealthy(timeoutMs = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not become healthy in time');
}

/** 发请求并收 {status, contentType, body}（body 已 JSON.parse，失败时为原文） */
async function j(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const ct = res.headers.get('content-type') || '';
  let body;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = await res.text();
  }
  return { status: res.status, contentType: ct, body };
}

const authed = (token) => ({ headers: { 'X-Family-Token': token } });

/** WS 握手结果：成功返回 'open'；被 HTTP 拒绝返回状态码数字 */
function wsHandshake(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}`, { headers });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('handshake timeout')); }, 5000);
    ws.on('open', () => { clearTimeout(timer); ws.close(); resolve('open'); });
    ws.on('error', (err) => {
      clearTimeout(timer);
      const m = /Unexpected server response: (\d+)/.exec(err.message);
      resolve(m ? Number(m[1]) : err.message);
    });
  });
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'babycry-contract-'));
  child = spawn(process.execPath, [join(ROOT, 'src/index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NO_SIMULATOR: 'true',
      AUTH_MODE: 'enforce',
      DEVICE_TOKEN,
      TZ: 'UTC',
      FAMILY_DATA_FILE: join(dataDir, 'family.json'),
    },
    stdio: 'ignore',
  });
  child.on('error', (e) => { throw new Error(`server spawn failed: ${e.message}`); });
  await waitHealthy();
});

after(() => {
  child?.kill();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* ------------------------------------------------------------------ */
/*  REST 契约                                                          */
/* ------------------------------------------------------------------ */

describe('REST 契约', () => {
  it('health 探活：信封豁免的唯一接口', async () => {
    const r = await j('/api/health');
    assert.equal(r.status, 200);
    assert.match(r.contentType, /application\/json/);
    assert.deepEqual(r.body, { ok: true, onlineClients: r.body.onlineClients });
  });

  it('未携带家人 token 的业务接口 → 401 UNAUTHORIZED + JSON + 中文文案', async () => {
    const r = await j('/api/baby/status');
    assert.equal(r.status, 401);
    assert.match(r.contentType, /application\/json/);
    assert.equal(r.body.code, 'UNAUTHORIZED');
    assert.ok(r.body.message, 'message 必须非空');
  });

  it('owner 认领 → 200 code:0', async () => {
    const r = await j('/api/family/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: OWNER_TOKEN, name: '测试员' }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.code, 0);
    assert.equal(r.body.data.role, 'owner');
  });

  it('重复认领（他人）→ 409 CONFLICT', async () => {
    const r = await j('/api/family/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'another-token', name: '别人' }),
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'CONFLICT');
    assert.ok(r.body.message);
  });

  it('带有效 token 的业务接口 → 200 code:0', async () => {
    const r = await j('/api/baby/status', authed(OWNER_TOKEN));
    assert.equal(r.status, 200);
    assert.equal(r.body.code, 0);
    assert.ok(typeof r.body.data.isOnline === 'boolean');
  });

  it('无效加入码 → 400 JOIN_CODE_EXPIRED（状态码保持历史口径，码区分原因）', async () => {
    const r = await j('/api/family/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ZZZZZZ', name: '家人' }),
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'JOIN_CODE_EXPIRED');
    assert.ok(r.body.message);
  });

  it('member 加入 → 只读权限成立（写操作 403 FORBIDDEN）', async () => {
    const jc = await j('/api/family/join-code', { method: 'POST', ...authed(OWNER_TOKEN) });
    assert.equal(jc.status, 200);
    assert.equal(jc.body.code, 0);

    const join = await j('/api/family/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: jc.body.data.code, name: '奶奶' }),
    });
    assert.equal(join.status, 200);
    assert.equal(join.body.code, 0);
    const memberToken = join.body.data.token;

    const read = await j('/api/baby/status', authed(memberToken));
    assert.equal(read.status, 200);
    assert.equal(read.body.code, 0);

    const write = await j('/api/family/join-code', { method: 'POST', ...authed(memberToken) });
    assert.equal(write.status, 403);
    assert.equal(write.body.code, 'FORBIDDEN');
    assert.ok(write.body.message);
  });

  it('未知 /api/* 路由 → 404 JSON（不再是 HTML 的 Cannot GET）', async () => {
    const r = await j('/api/does-not-exist');
    assert.equal(r.status, 404);
    assert.match(r.contentType, /application\/json/);
    assert.equal(r.body.code, 'NOT_FOUND');
    assert.ok(r.body.message);
  });

  it('不变量抽查：2xx ⟺ code === 0，错误体必带非空 message', async () => {
    // 注意 /api/health 是信封豁免接口（{ok,...}），不在本抽查内，其形态在专属用例断言
    const cases = [
      await j('/api/baby/status', authed(OWNER_TOKEN)),
      await j('/api/baby/volume', authed(OWNER_TOKEN)),
      await j('/api/baby/device', authed(OWNER_TOKEN)),
      await j('/api/history', authed(OWNER_TOKEN)),
      await j('/api/stats/summary', authed(OWNER_TOKEN)),
      await j('/api/baby/status'),
      await j('/api/family/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    ];
    for (const r of cases) {
      const is2xx = r.status >= 200 && r.status < 300;
      assert.match(r.contentType, /application\/json/, `非 JSON 响应: ${r.status}`);
      if (is2xx) {
        assert.equal(r.body.code, 0, `2xx 必须 code:0，实际 ${JSON.stringify(r.body)}`);
        assert.ok('data' in r.body, '2xx 必须带 data');
      } else {
        assert.notEqual(r.body.code, 0, `非 2xx 不得 code:0`);
        assert.ok(r.body.message, '错误体必须带非空 message');
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/*  WS 握手契约                                                        */
/* ------------------------------------------------------------------ */

describe('WS 握手契约', () => {
  it('app 无 ftoken → 握手期 401（不再 101 后关闭）', async () => {
    assert.equal(await wsHandshake('/ws'), 401);
  });

  it('esp32 无设备令牌 → 握手期 401', async () => {
    assert.equal(await wsHandshake('/ws?device=esp32'), 401);
  });

  it('esp32 令牌错误 → 握手期 401', async () => {
    assert.equal(await wsHandshake('/ws?device=esp32', { Authorization: 'Bearer wrong-token' }), 401);
  });

  it('esp32 令牌正确 → 101 建立连接', async () => {
    assert.equal(await wsHandshake('/ws?device=esp32', { Authorization: `Bearer ${DEVICE_TOKEN}` }), 'open');
  });

  it('app 有效 ftoken → 101 建立连接', async () => {
    assert.equal(await wsHandshake(`/ws?ftoken=${OWNER_TOKEN}`), 'open');
  });

  it('非 /ws 的升级请求 → 握手期 404', async () => {
    assert.equal(await wsHandshake('/other', { Upgrade: 'websocket', Connection: 'Upgrade' }), 404);
  });
});
