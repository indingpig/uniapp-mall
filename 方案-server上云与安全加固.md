# 方案：server 上云部署与安全加固

> **日期**：2026-11-25 立项（方案留档，尚未实施）
> 背景：当前 server 跑在家里 Mac 上（`pnpm run dev`），**Mac 一关机整个监控就断**。
> 目标：迁到云服务器常驻，状态与数据不再依赖家里电脑。
> ⚠️ 本文所有 IP/域名均为占位符，安全约束见 AGENTS.md。

## 0. 一句话结论

**可以上云，但有 3 个前置硬伤必须先修，其中 1 个要改固件。**

| 事项 | 结论 | 状态 |
|---|---|---|
| 数据层 | 已迁 SQLite（`node:sqlite` 内置，零依赖），重启不丢 | 🟢 代码已改（未提交） |
| **WS/REST 零鉴权** | 上公网 = 宝宝卧室麦克风挂到互联网 | 🔴 **必须在部署前修** |
| **固件不支持 wss** | `server_link.cpp` 直接拒绝 `wss://`/`https://` | 🔴 端到端加密需改固件 |
| **固件路径写死 `/ws`** | 填的路径会被 `substring` 剥掉 | 🟡 「路径隐藏」方案对板子无效 |
| 时区 | 腾讯云默认 UTC，统计会偏 8 小时 | 🟡 加 `TZ` 环境变量即可 |

## 1. 目标服务器的现实约束

用户现有条件：

- 腾讯云轻量应用服务器，**2 核 2G**
- 有公网 IP，可直接连
- 核心诉求：**不依赖家里 Mac 常开**

规划中的变化：

- 国内域名需备案 → 太麻烦 → **打算换海外服务器**
- 换海外后用 **Cloudflare 证书 + 域名**，开 HTTPS/端到端加密

→ 因此本方案分**两步**：先解决「不依赖 Mac」，再解决「加密」。

## 2. 🔴 前置硬伤（部署前必修）

### 2.1 WS 与 REST 完全没有鉴权

> ✅ **已于 2026-11-27 解决**（`8a3b860`）。本节记录的是**问题分析**，
> 不是现状。当前实现见
> 《[交接-2026-11-27-server上云与鉴权落地.md](交接-2026-11-27-server上云与鉴权落地.md)》§3。

**当时现状**（`src/ws/handler.js:41`）：

```js
const clientType = req.url?.includes('esp32') ? 'esp32' : 'app';
```

**任何人**连上 `ws://<公网IP>:3001/ws` 就能：
- 订阅宝宝实时状态、音量、事件推送
- 带 `?esp32` 还能**冒充设备**上报假数据（污染 detector 状态、触发误报 ntfy）

**REST 同样全开放**：16 个端点（`/api/baby/*`、`/api/history`、`/api/stats/*`、`/api/family/*`）
中，只有 family 组做了 `X-Family-Token` 校验，其余无任何保护。

> 公网 IP 的开放端口会被全网扫描器在数小时内发现，这是常态，不能靠「别人不知道」赌安全。

### 2.2 固件不支持 wss（端到端加密的硬阻塞）

`server_link.cpp:192`：

```cpp
if (u.startsWith("https://") || u.startsWith("wss://")) {
  Serial.println("[ServerLink] ERR: 暂不支持加密连接, 请使用 ws://");
  return false;
}
```

当前用的是 `WiFiClient`（明文 TCP），mbedtls 只引了 `mbedtls/md.h`（做 SHA1 哈希），
**没有引入 TLS 栈**。

**要做 wss 需要**：
1. 换 `WiFiClientSecure`（ESP32 内置 mbedTLS）
2. 评估内存：TLS 握手约需 40-50KB 内部堆；板子 3.x + PSRAM 后推理缓冲已外置，
   `ready free ≈ 133K`（2026-11-20 真机实测），**看起来够，但必须真机实测**
3. 证书验证策略：完整链验证 vs 只固定 SPKI 指纹（内存/安全折中）

> 这是绕不过的工作量，估 **2-3 小时**（含真机内存观测）。

### 2.3 固件路径写死，`路径隐藏` 方案对板子无效

`server_link.cpp:201`：

```cpp
int slash = u.indexOf('/');
if (slash >= 0) u = u.substring(0, slash);   // ← 配网填的路径被丢掉
...
String req = String("GET /ws?device=esp32 HTTP/1.1\r\n") + ...  // ← 永远请求 /ws
```

所以「Nginx 用特定字符串路径保护 + 板子填该路径」**不成立**——板子永远打 `/ws`。

**且这道防线本身也弱**：路径混淆只能降低被发现的概率，不能替代鉴权。
一旦路径泄漏（日志/抓包/爆破），保护归零。**必须靠密钥校验。**

## 3. 分阶段实施方案

### 阶段一（现在可做，与服务器无关）

这些改动不管部署到哪台机器都需要，且不依赖 TLS：

| 项 | 内容 | 工作量 |
|---|---|---|
| **A. 共享密钥鉴权** | WS 连接与 REST 请求校验密钥；密钥走环境变量 | ~30 行 |
| **B. 生产配置** | `NO_SIMULATOR=true`（默认开模拟器会污染数据库）、`TZ=Asia/Shanghai`、`PORT` | 配置 |
| **C. systemd 服务** | 开机自启、崩溃重启、日志落 journald | 1 个 unit 文件 |
| **D. 备份脚本** | SQLite 在线备份（`VACUUM INTO`），按天保留 | ~20 行 |

#### A 的设计要点

**WS**：在 `wss.on('connection')` 首行校验

```
ws://<host>:3001/ws?key=<KEY>          App 端
ws://<host>:3001/ws?esp32&key=<KEY>    设备端
```

不匹配直接 `ws.close(1008)`，不加入 clients 集合。
**注意**：固件侧要能带 key —— 当前固件只发 `GET /ws?device=esp32`，
**需要改一行 C 代码拼上 key**（比 TLS 改造成本低得多）。

**REST**：Express 中间件校验 header（如 `X-Api-Key`），`/api/health` 可豁免。
注意 `uni.request` 封装（`uniapp/src/utils/request/`）要统一带上。

**密钥存哪**：`server/.env` 的 `API_KEY=xxx`，**不进 Git**（`.env` 已 gitignore）。
板子和 App 侧分别写在 NVS 与本地存储里（配网时下发）。

#### 替代方案（更简单，但弱）

**安全组限制源 IP** 为家里宽带出口 IP，连密钥都省了。
- 优点：零代码改动
- 缺点：家里 IP 会漂移（重播光猫就变），且家人在外地用不了

→ **建议两者叠加**：安全组限 IP + 密钥校验，纵深防御。

### 阶段二（换海外服务器 + Cloudflare 后）

```
Internet
   ↓ wss://baby.example.com/ws   (TLS 由 Cloudflare 终止或回源)
Cloudflare (证书 + 可选 WAF/限速)
   ↓
Nginx (反代，可只信 Cloudflare 回源 IP)
   ↓ ws://127.0.0.1:3001
Node server + SQLite
```

要点：
- **Nginx 只监听 127.0.0.1:3001**（或防火墙只放行 Cloudflare 回源段），避免绕过 CF 直连
- 安全组只开 **22(SSH) + 80 + 443**；3001 不对公网开放
- 禁 ICMP（降低被批量扫描收录，但对端口扫描无效，别当安全措施）
- 固件此时需升 wss（见 §2.2）
- 家庭成员的 App 也走 `wss://域名`

> ⚠️ Cloudflare 免费版对 WebSocket 支持良好，但**回源若走 CF 代理，长连接有 100 秒空闲超时**；
> 我们的固件有 10s ping（`SERVER_PING_MS`）、App 有 25s 心跳，可覆盖。需实测确认。

## 4. 部署清单（阶段一，拿到服务器后照做）

### 4.1 服务器准备

```bash
# 1. 装 Node（node:sqlite 需要 22.5+；22.5~22.x 可能要 --experimental-sqlite，
#    23+ 起无需 flag。**建议直接装 24/26 LTS**，避免 flag 折腾）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 装机后先验证这一句能跑通、且无 experimental 警告（本项目实测 Node 26 无警告）：
node -e "const{DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync(':memory:').prepare('select sqlite_version() v').get())"

# 2. 装 pnpm（项目 preinstall 有 only-allow pnpm 守卫）
npm i -g pnpm

# 3. 建用户与目录
sudo useradd -r -m -d /opt/babycry babycry
sudo -u babycry mkdir -p /opt/babycry/{app,data}
```

### 4.2 部署代码

```bash
# 只传 server 目录（uniapp/arduino 不需要上服务器）
rsync -av --exclude node_modules --exclude data \
  ./server/ babycry@<server-ip>:/opt/babycry/app/

cd /opt/babycry/app
pnpm install --prod
```

### 4.3 环境变量（`/opt/babycry/app/.env`，600 权限，勿提交）

```ini
PORT=3001
NO_SIMULATOR=true          # 生产必须关，否则模拟器持续灌假数据
TZ=Asia/Shanghai           # 腾讯云默认 UTC，不设会导致日/小时统计偏 8 小时
API_KEY=<足够长的随机串>    # 阶段一新增
CORS_ORIGIN=*              # 或收紧为具体来源
# ntfy（可选，见 .env.example）
NTFY_ENABLED=false
```

> 生成密钥：`openssl rand -hex 32`

### 4.4 systemd（`/etc/systemd/system/babycry.service`）

```ini
[Unit]
Description=Baby Cry Monitor server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=babycry
WorkingDirectory=/opt/babycry/app
EnvironmentFile=/opt/babycry/app/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
# 安全加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/babycry/app/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now babycry
sudo journalctl -u babycry -f        # 看日志
```

### 4.5 反向代理（阶段一：HTTP 反代；阶段二加 TLS）

> ⚠️ **2026-11-27 实际部署用的是 Caddy，不是 nginx**。
> 原因：目标机已预装 Caddy 且占用 80；且 Caddy 的 `reverse_proxy`
> **原生支持 WS 升级**，不必手写 `Upgrade`/`Connection` 头。
> 以下 nginx 写法**保留作参考**（若换的机器没有 Caddy 可用），
> 实际跑通的 Caddyfile 见
> 《[交接-2026-11-27-server上云与鉴权落地.md](交接-2026-11-27-server上云与鉴权落地.md)》§2.4。

```nginx
# 用一个不易猜的 location 前缀做「降低被发现概率」（不是安全措施）
location /bc-<随机串>/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # WS 必需
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;                    # WS 长连接
}
```

> ⚠️ **对板子无效**（固件路径写死 `/ws`）；仅对 App/浏览器有用。
> ~~板子阶段一只能直连 `ws://<ip>:3001/ws`，因此 **3001 仍需开**~~
> **已被推翻**：实际用 `HOST=127.0.0.1` 把 Node 锁在回环，**3001 无需对外开放**，
> 板子也走 Caddy 的 `/ws`（§6.1 已修）。

### 4.6 安全组规则（腾讯云控制台）

> **实际落地（2026-11-27）**：只放行 **4090（SSH）** 和 **80**。
> 3001 **完全不放行** —— 见 4.5 的回环隔离，旧方案的「限定源 IP」已不需要。

| 端口 | 来源 | 说明 |
|---|---|---|
| 4090（SSH） | 0.0.0.0/0 | 腾讯云会自动封禁暴力破解 IP |
| 80 | 0.0.0.0/0 | Caddy |
| ~~443~~ | — | 未开（无域名，见 §2.2） |
| ~~3001~~ | — | **不开**：Node 只绑 `127.0.0.1` |
| ICMP | 拒绝 | 降低扫描收录 |

### 4.7 数据备份

```bash
#!/bin/sh
# /opt/babycry/backup.sh —— SQLite 在线备份，不锁写
set -e
DAY=$(date +%F)
mkdir -p /opt/babycry/backup
sqlite3 /opt/babycry/app/data/babycry.db "VACUUM INTO '/opt/babycry/backup/babycry-$DAY.db'"
find /opt/babycry/backup -name 'babycry-*.db' -mtime +30 -delete
```

`crontab -e` 加：`0 4 * * * /opt/babycry/backup.sh`

## 5. 切换风险与回滚

| 风险 | 说明 | 应对 |
|---|---|---|
| **板子要重新配网** | 服务器地址在 NVS（`NVS_KEY_SERVER_URL`），走 BLE 写入 | 不用重烧固件，重新配网填新地址。**回滚同理** |
| **App 地址回落** | 装 App 会清空本地存储，回落到 `.env` 烘焙的旧 IP（`todo-配网安全.md` 挂账） | 同步改 `uniapp/.env.production` 的 `VITE_WS_URL`，或重新配对 |
| **时区算错** | 未设 `TZ` 时，`dataStore` 的 `strftime(...,'localtime')` 全偏 8 小时 | 必须在 `.env` 设 `TZ=Asia/Shanghai` |
| **模拟器污染** | 默认开模拟器，会持续写假数据进 SQLite | 必须 `NO_SIMULATOR=true` |
| 回滚 | 云上出问题临时切回 Mac | 板子重新配网指回局域网地址即可，两端都用同一套代码 |

## 6. 挂账（按优先级）

1. **阶段一 A：密钥鉴权**（WS + REST）——部署前置条件
2. **固件拼 key**（约 1 行 C）：`GET /ws?device=esp32&key=xxx`
3. **阶段一 B/C/D**：生产配置 / systemd / 备份
4. 阶段二：Nginx TLS + Cloudflare 证书
5. **阶段二：固件 wss 改造**（`WiFiClientSecure` + 内存实测，2-3h）
6. 安全组收紧为「仅家里 IP」

## 7. 待确认问题

- [ ] 换海外服务器的时间点？（决定阶段二何时开始）
- [ ] 家人是否需要在**外网**用 App？若只在局域网，阶段一的安全组限 IP 就够了
- [ ] 微信小程序端是否需要连公网 server？（小程序要求 wss，会强制推进阶段二）
- [ ] 是否接受「阶段一期间 3001 对公网开放（限源 IP）」这个过渡态？
