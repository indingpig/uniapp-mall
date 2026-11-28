# 交接：接手入口（常青版）

> **用途**：新会话「从这里开始」——现状、下一步、挂账、排障与环境速查、文档索引。
> 本文档**随进度持续更新**（2026-11-28 全天收口后更新）。
> 已收口的历史交接文档已于 2026-11-28 删除归档（git 历史可找回）；结论蒸馏进本文与 AGENTS.md。
> ⚠️ 本文 IP/令牌均为占位符，安全约束见 AGENTS.md。

## 0. 三十秒看懂现状（2026-11-28 深夜）

| 维度 | 状态 |
|---|---|
| 代码仓库 | 🟢 4 笔分类提交已推送（`556eda7` 固件 / `bf183e5` server / `ebfe59d` uniapp / `c7b25ef` docs） |
| server | 🟢 **新错误契约已部署**（14:34 重启）：JSON 404、401 带业务码、WS 握手期 401；`NODE_ENV=production` 已进 .env；三项契约抽查全过 |
| **真机验证鉴权** | 🟢 **主线闭环（16:44）**：四项凭据齐写 → `Device token stored (len=64)` → `[ServerLink] connected` → 服务端 `[WS] esp32 connected` → App 认领 owner → `[WS] app connected (total: 2)`，Detector 状态机实时运转 |
| 固件 | 🟢 双修复已烧录：①createService 句柄上限 15→24（令牌特征值此前被协议栈**静默丢弃**——当天最大坑，见 §3）②服务表版本驱动蓝牙身份地址（表变则换地址，逼手机重新发现） |
| App | 🟢 全局 401 收敛、无身份门禁、认领引导条、server_auth 指引；解除配对自愈已回退（基于误判，见 §3） |
| 服务器 SSH | 🟢 **已加固**（passwordauthentication no / permitrootlogin no，fail2ban） |
| 传输加密 | 🔴 全程明文 HTTP —— 等换海外服务器 + 域名再做 |
| 服务器寿命 | ⏳ **约 2026-12-14 到期**，到期换国外机（届时一次性做 TLS + 域名） |

## 1. 下一步（按优先级）

主线（真机验证鉴权）已闭环，无阻塞项：

### 🔴 待实现：登录 / 注册 + 手机白名单（2026-11-28 方案定稿）

- **方案全文：`方案-登录注册与手机白名单.md`**（背景与决策、目标行为、server 设计、接口契约与业务码、限流、测试用例、App 逐文件改动、施工顺序、验证清单、上线步骤）
- 已定决策：手机号 + 密码，不发短信；白名单之外注册还要邀请码（所有者本人首次注册填服务器后台口令）；所有者在白名单里用 `号码:owner` 标出，有且仅一个；忘记密码走「所有者移除后，拿新邀请码重新注册」
- 现状：App 端登录/注册页已按设计规范 v1.1.28 建好但未接线（`uniapp/src/pages/login`、`pages/register`、`components/AppField.vue`、`api/auth.ts`）；server 没有 `/api/auth`。实现方照方案 §5 的施工顺序做，验证清单在 §6
- 涉及下线：`POST /api/family/claim`、`/join`、`/join-code`、`/invites/:code/accept`（先到先得 / 凭码加入，与白名单矛盾）

### 🟡 换海外服务器（约 12-14 前）

- 迁移操作照抄 11-27 文档 §2.2（Caddy + git sparse-checkout）；**目标规格 1 vCPU / 1 GB / 20 GB**（资源核算见方案文档 §7）
- TLS 三障碍换国外机后自动消失两个（ICP 备案 / Let's Encrypt 裸 IP），**固件 wss 改造绕不开**（`server_link.cpp` 拒绝 wss、无 TLS 栈，估 2-3h + 真机内存实测）

### 🟢 长期挂账（非阻塞）

| # | 项 | 说明 |
|---|---|---|
| 1 | episode 聚合推送 | `notify.js` 无分段聚合，哭 10 分钟推多条 ntfy（评审 P1-1） |
| 2 | 配网页默认服务器 URL 硬编码 | `todo-配网安全.md` |
| 3 | 后台保活功能回归 | 基座含保活代码但功能清单从未系统性真机回归；`server/.env` 的 `NTFY_ENABLED` 仍未配置 |
| 4 | 旧录音微窟窿 | 11-24 前录的长音频带 0.4% 嗅探缺口 |
| 5 | 鸿蒙端缺口 | `uts-keepalive` / `uts-wavrec` 无 `app-harmony` 实现 |
| 6 | 401 客户端文案分层 | 「网络不通 vs 身份失效」的提示区分（方案文档 §3 文案规则剩余项） |

- 紧急恢复后门：服务器 `.env` 加 `AUTH_MODE=off` 重启（用完改回 enforce）

### 🟡 第二优先（约 12-14 前）：换国外服务器 + TLS

- 迁移操作照抄 11-27 文档 §2.2（Caddy + git sparse-checkout）；**目标规格 1 vCPU / 1 GB / 20 GB**（资源核算见方案文档 §7）
- TLS 三障碍换国外机后自动消失两个（ICP 备案 / Let's Encrypt 裸 IP），**固件 wss 改造绕不开**（`server_link.cpp` 拒绝 wss、无 TLS 栈，估 2-3h + 真机内存实测）

### 🟢 长期挂账（非阻塞）

| # | 项 | 说明 |
|---|---|---|
| 1 | episode 聚合推送 | `notify.js` 无分段聚合，哭 10 分钟推多条 ntfy（评审 P1-1） |
| 2 | 配网页默认服务器 URL 硬编码 | `todo-配网安全.md` |
| 3 | 后台保活功能回归 | 基座含保活代码但功能清单从未系统性真机回归；`server/.env` 的 `NTFY_ENABLED` 仍未配置 |
| 4 | 旧录音微窟窿 | 11-24 前录的长音频带 0.4% 嗅探缺口 |
| 5 | 鸿蒙端缺口 | `uts-keepalive` / `uts-wavrec` 无 `app-harmony` 实现 |
| 6 | 401 的客户端语义分层 | 已做清身份+引导（今天）；更细的「网络不通 vs 身份失效」文案区分待做（方案文档 §3 文案规则） |

## 2. 已被推翻的旧结论（别按老方案做）

| 旧结论 | 为什么错了 | 现在怎么做 |
|---|---|---|
| 「安全组限制家里出口 IP」 | 家宽 IP 会变 | 只能靠 token 鉴权 |
| 「Nginx 特定路径保护」 | 固件剥路径，永远打 `/ws` | 路径混淆无效；鉴权已在握手期 |
| 「家里放斐讯 N1 做服务器」 | 无稳定公网入口 | 云服务器 |

## 3. 排障速查（血泪浓缩；证据链详版在 git 历史交接文档里）

### 设备/App「连不上」：先分清三条链路

```
[板子] --WS--> [server]    ← 链路 A（配对成功只证明这条）
[App]  --WS--> [server]    ← 链路 B（App 自己连 server）
[App]  --REST--> [server]  ← 链路 C（轮询兜底）
```

- 别只看 `/api/baby/status` 返回在线——那只反映板子（链路 A）
- 查手机端：`lsof -nP -iTCP:3001 | grep <手机IP>`；`adb logcat` grep `ConnectException`
- 快速恢复：`adb shell am force-stop com.sheldon.babycry`

### 在线状态语义（监护场景特有）

- server 是唯一裁判（WS 在 + 30s isAlive 清扫）；App 双通道取数 + 新鲜度哨兵 `lastDataOkAt`（15s 无真值显形 offline）
- **App 显形离线 = 「无法证实在线」**，监护场景保守报离线是正确取舍
- 病根模式：**失败分支静默保留旧数据**。新代码「轮询在跑但全失败」必须显式置离线；请求层已统一非 2xx/业务码 reject，空 `catch(() => {})` 是禁区

### BLE 配对：句柄上限、缓存与写入顺序（2026-11-28 全天血泪，结论以本节为准）

- **「手机发现不到某特征值」的第一嫌疑是固件服务句柄上限**：框架 `createService` 默认只给 15 个
  属性句柄，超限的特征值被协议栈**静默丢弃**——不报错、不注册，手机发现不到，板子侧
  `getHandle()` 恒为 0。修法：`createService(uuid, BLE_SERVICE_NUM_HANDLES)` 显式给够
  （现值 24），启动自检 `[BLE] GATT table (board side)` 会打印全部句柄并对缺项报错。
  **判别口诀：先看板子侧这张表，再看手机发现清单**——缺项在板子侧是固件问题，两边都有
  而只有手机缺才是手机缓存问题。别像我今天那样先怀疑手机缓存，绕了一大圈
- **Android 对已绑定设备的 GATT 缓存极其顽固（EMUI 实证）**：手机有旧绑定时不重新发现服务，
  **关开蓝牙 / 删蓝牙 App 数据 / 解除配对 / 板子恢复出厂+重新配对，全都刷不掉**；换手机也
  可能踩。可靠解 = 固件侧已落地：`BLE_GATT_TABLE_VERSION` 版本一变，板子换确定性派生的
  静态随机地址（`applyBleIdentity`），手机对新地址只能全新发现。**以后增删特征值：改表 +
  版本号 +1，两件事一起做**
- 新特征值一律 append 到服务表末尾（别插中间平移句柄——早上还实证过旧缓存写错属性）
- 配网四写顺序：SSID → Password → **Device Token** → Server URL（固件把收到 URL 当凭据齐全的触发点）
- 板子报 `error:server_auth` = 令牌被 server 握手期拒绝（已停止重连）→ 查高级设置 DEVICE_TOKEN
  与服务器 `.env`；重配对或重启恢复。`error:ssid` = SSID 非法（App 写错特征值的防御线）
- **教训：静默失败最耗人**。今天整天 = 特征值被静默丢弃（无报错）+ 手机缓存静默沿用（无报错）
  叠加，靠「板子侧主动打印真实 GATT 表」才一次定位。以后固件任何注册动作，启动自检直接打印结果

### 采集对账

```bash
adb shell ls -la /storage/emulated/0/Android/data/com.sheldon.babycry/files/BabyCry/
# 样本数 = (字节 - 44) / 2；秒 = 样本数 / 16000
```

判据：`44 + 样本数×2 == 字节数`；固件 done 样本数 = 页面收到数 = 文件样本数三方一致。

### server 数据 / 家庭重置

- 删 `server/data/family.json` = 重置家庭注册表（各手机重新认领/加入）
- server 改路由/服务后**必须重启进程**；改完先跑 `cd server && pnpm test`（契约测试 15 例）

## 4. 环境速查（本机踩过的坑）

### Mac 本机

- pio 未进 PATH：`~/.platformio/penv/bin/pio`；板子烧录+日志走 USB2 原生口（USB1/CH343 口 C-to-C 不供电）
- **烧录前先停串口监听进程**（占着 /dev/cu.usbmodem* 会让 upload 失败）；pyserial 直读且 open 后立即 `dtr=False`；系统 python 无 pyserial，用 `~/.platformio/penv/bin/python`
- HBuilderX 空闲 10 分钟+ 后首推必僵：先重启再推；cli 命令**不接管道**（`| tail`/grep 会缓冲）
- zsh 会话丢 PATH：`export NVM_DIR && . "$NVM_DIR/nvm.sh"` + `PNPM_HOME=/Users/sheldon/Library/pnpm`

### GitHub 推送中继（全通道被 reset 时，2026-11-28 实证）

Mac 对 GitHub 的 SSH:22 / SSH:443 / HTTPS 同时被 reset 时（gh 未装、无本地代理），走云服务器中继：

```bash
# /tmp/git-ssh-relay.sh（易失，重建法）——外跳 nc 管道不依赖 sshd 转发权限
# ssh -i ~/.ssh/id_rsa -o IdentitiesOnly=yes \
#   -o ProxyCommand="ssh -i ~/.ssh/id_ed25519_babycry -p 4090 ubuntu@<SERVER_IP> nc ssh.github.com 443" "$@"
GIT_SSH_COMMAND=/tmp/git-ssh-relay.sh git push "ssh://git@ssh.github.com:443/indingpig/uniapp-mall.git" wsl_babycry
```

- 钥匙映射（`~/.ssh/config` 有 alias）：GitHub indingpig 账号 = `id_rsa`（`github.com-indingpig`）；服务器 = `id_ed25519_babycry`（alias `babycry-server`）
- `ssh.github.com:443` 主机钥匙已核验入 known_hosts（与 github.com 同钥，SHA256:+DiY3wvv…）
- 服务器 `git pull` 遇 TLS 重置：`git -c url.https://gh-proxy.com/https://github.com/.insteadOf=https://github.com/ pull`

### 云打包（UTS 插件改动后必须，JS 热推对原生无效）

```bash
/Applications/HBuilderX.app/Contents/MacOS/cli pack \
  --project <uniapp 绝对路径> --platform android --iscustom true \
  --android.packagename com.sheldon.babycry --android.androidpacktype 0 \
  --android.certalias babycry \
  --android.certfile ~/.keystores/babycry.keystore \
  --android.certpassword "$(cat ~/.keystores/babycry.password)" \
  --android.storepassword "$(cat ~/.keystores/babycry.password)"
```

- **改完 UTS 插件先本地自查**：`cd uniapp && node scripts/check-uts.mjs`；产物命名 `baby-monitor_v<版本>_<yyyymmdd>.apk` 入 `unpackage/release/android/`

### server 运维（详见 11-27 文档 §7；SSH 已加固仅密钥）

```bash
ssh babycry-server    # ~/.ssh/config alias（地址见本机 config，不入库）
sudo systemctl status babycry / journalctl -u babycry -f
cd /opt/babycry/app && git pull && cd server && pnpm test && sudo systemctl restart babycry
# 服务器 pull 遇 TLS 重置 → 加 gh-proxy 前缀（见上）
```

## 5. 文档索引

| 文档 | 什么时候看 |
|---|---|
| [交接-2026-11-27-server上云与鉴权落地.md](交接-2026-11-27-server上云与鉴权落地.md) | 部署方式与鉴权设计的完整记录（WS 握手 401 为 11-28 增量） |
| [方案-接口状态码与业务码设计.md](方案-接口状态码与业务码设计.md) | 接口契约唯一真值（已实施已部署）；动 REST/WS 错误返回或请求层时必读 |
| [方案-server上云与安全加固.md](方案-server上云与安全加固.md) | 风险分析与长期方案（部署细节已被 11-27 取代） |
| [todo-配网安全.md](todo-配网安全.md) | 配网挂账（含默认 URL 硬编码） |
| [AGENTS.md](AGENTS.md) | 施工约定全集（UTS 避坑、3.x/PSRAM 坑、Git 安全约束） |
| git 历史 | 已收口的 9 份交接文档（2026-11-28 清理）：`git log --diff-filter=D --name-only -- '交接-*'` |

## 6. 接手自检

```bash
cd /Users/sheldon/code/workplace/uniapp-mall
git status --short            # 应干净（或仅未跟踪杂项）
adb devices                   # 真机验证需接 P30
ls /dev/cu.usb*               # 板子（插 USB2 原生口；先停串口监听再烧录）
cd server && pnpm test        # 契约测试 15 例应全绿
```

然后按 §1 优先级开工。
