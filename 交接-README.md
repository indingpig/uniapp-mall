# 交接：接手入口（常青版）

> **用途**：新会话「从这里开始」——现状、下一步、挂账、排障与环境速查、文档索引。
> 本文档**随进度持续更新**（2026-11-28 重写，取代按日期堆积的入口文档）。
> 已收口的历史交接文档（UTS 6 连败 / 内存重整与 3.x 迁移 / 采集丢样 / Bug A·B / 家庭共享 / 后台保活 / 配网崩溃 / 麦克风排障）
> 已于 2026-11-28 删除归档，**git 历史可找回**；其结论已蒸馏进本文与 AGENTS.md。
> ⚠️ 本文 IP/令牌均为占位符，安全约束见 AGENTS.md。

## 0. 三十秒看懂现状（2026-11-28）

| 维度 | 状态 |
|---|---|
| 代码仓库 | 🟢 干净，全部已推送（分支 `wsl_babycry`，`9eb80c9`） |
| server | 🟢 云服务器运行中：Caddy 反代 :80 → Node（只绑 127.0.0.1:3001），systemd 常驻 |
| 鉴权 | 🟢 全链路 token（`8a3b860`）：家人 token / 板子设备令牌 / 匿名一律 401；公网 10 项攻击测试全过 |
| 真机功能 | 🟢 原生直录（音频不过 JS 桥）、后台保活基座、3.x+PSRAM 固件均已闭环（11-25 前） |
| **真机验证鉴权** | 🔴 **唯一未闭环**：板子与 App 仍是旧版，服务端已强制鉴权 → 当前都连不上 |
| 传输加密 | 🔴 全程明文 HTTP —— 等换海外服务器 + 域名再做 |
| 服务器寿命 | ⏳ **约 2026-12-14 到期**（11-27 起算 17 天），到期换国外机，届时一次性做 TLS + 域名 |

## 1. 下一步（按阻塞关系）

### 🔴 第一优先：真机验证鉴权（11-27 文档 §4 五项清单）

服务端已强制鉴权，旧固件/旧 App 一律被拒。按顺序：

| # | 待验证 | 怎么做 | 判据 |
|---|---|---|---|
| 1 | 固件烧录 | `~/.platformio/penv/bin/pio run -t upload`（插 USB，走 USB2 原生口） | 串口 `[ServerLink] device token loaded (len=64)` |
| 2 | 令牌写入板子 | App 配对页「高级设置」填 `DEVICE_TOKEN` + 服务器地址 | 串口 `[BLE] Device token stored (len=64)` |
| 3 | 板子连上 server | 配网后观察 | server 日志 `[WS] esp32 connected` |
| 4 | App 认领 + 连接 | 进家庭共享页认领 owner | 日志 `[WS] app connected` |
| 5 | **令牌顺序** | 确认令牌在 Server URL **之前**写入 | 反了板子连上即断，需重配 |

- 前置：P30 插 USB（`adb devices` 确认）；四个非显然设计点（认领接口必须开放等）见 11-27 文档 §3，别"简化"掉
- App 侧鉴权改动是纯 JS（`8a3b860`），**无需重打基座**，`cli launch` 热推即可；固件侧必须烧录
- 紧急恢复：服务器 `.env` 加 `AUTH_MODE=off` 重启（日志持续告警），用完必须改回 `enforce`

### 🟡 第二优先（约 12-14 前）：换国外服务器 + TLS

- 迁移操作照抄 11-27 文档 §2.2（Caddy + git sparse-checkout 那套，换机即重放）
- TLS 三障碍换国外机后自动消失两个（ICP 备案 / Let's Encrypt 裸 IP 签证），**固件 wss 改造绕不开**：
  `server_link.cpp` 拒绝 wss、无 TLS 栈，估 2-3h + 真机内存实测（PSRAM 后 ready free ≈ 133K，
  TLS 握手约需 40-50K，看着够但必须验）

### 🟢 长期挂账（非阻塞）

| # | 项 | 说明 |
|---|---|---|
| 1 | episode 聚合推送 | `notify.js` 无分段聚合，哭 10 分钟推多条 ntfy（评审 P1-1） |
| 2 | 配网页默认服务器 URL 硬编码 | `todo-配网安全.md` |
| 3 | 后台保活功能回归 | 基座已含保活代码（aapt2 四件套验证过），但功能清单从未系统性真机回归：锁屏后本地通知 / 划卡杀进程后 ntfy / 重启自恢复 / 白名单首弹一次 / 四 tab 返回键退后台 / 断网 90s 通知变「监护已中断」。另 `server/.env` 的 `NTFY_ENABLED` 截至最后记录仍未配置（兜底推送实际未开） |
| 4 | 旧录音微窟窿 | 11-24 前录的长音频带 0.4% 嗅探缺口，是否重录自行权衡 |
| 5 | 首页问候语硬编码 | 全新访客空态显示「你好，Sheldon」（`home/index.vue` 回退值），改中性回退 |
| 6 | 鸿蒙端缺口 | `uts-keepalive` / `uts-wavrec` 无 `app-harmony` 实现（仅空桩） |

## 2. 已被推翻的旧结论（别按老方案做）

| 旧结论 | 为什么错了 | 现在怎么做 |
|---|---|---|
| 「安全组限制家里出口 IP」 | 家宽 IP 会变（v4 动态；v6 前缀随光猫重启/租约变化） | 只能靠 token 鉴权 |
| 「Nginx 特定路径保护」 | 固件会 `substring` 剥掉填的路径，永远打 `/ws` | 路径混淆对板子无效，且本身不算鉴权 |
| 「家里放斐讯 N1 做服务器」 | 无稳定公网入口 | 云服务器（板子/手机都是出站连接，家里不需要入站） |

## 3. 排障速查（血泪浓缩；证据链详版在 git 历史交接文档里）

### 设备/App「连不上」：先分清三条链路

```
[板子] --WS--> [server]    ← 链路 A（配对成功只证明这条）
[App]  --WS--> [server]    ← 链路 B（App 自己连 server）
[App]  --REST--> [server]  ← 链路 C（轮询兜底）
```

- 别只看 `/api/baby/status` 返回在线——那只反映板子（链路 A）
- 查手机端：`lsof -nP -iTCP:3001 | grep <手机IP>`；`adb logcat` grep `ConnectException`（看 App 实际往哪个 IP 打）
- 快速恢复：`adb shell am force-stop com.sheldon.babycry` 重启 App（实测立刻恢复在线）

### 在线状态语义（监护场景特有）

- server 是唯一裁判（WS 在 + 30s isAlive 清扫）；App 双通道取数（WS 推 / HTTP 轮询）
  + 新鲜度哨兵 `lastDataOkAt`（任一通道成功才刷新，15s 无真值显形 offline）
- **App 显形离线 = 「无法证实在线」**——手机断网时板子可能还在线，保守报离线是监护场景的正确取舍
- 病根模式：**失败分支静默保留旧数据 = 假在线之源**。新代码里「轮询在跑但全失败」必须显式置离线，空 `catch(() => {})` 是禁区

### 采集对账（录音完整性三方对账）

```bash
adb shell ls -la /storage/emulated/0/Android/data/com.sheldon.babycry/files/BabyCry/
# 样本数 = (字节 - 44) / 2；秒 = 样本数 / 16000
```

判据：`44 + 样本数×2 == 字节数` 且时长 ≈ 录音时长；
**固件 done 样本数 = 页面收到数 = 文件样本数三方一致才算过**。

### server 数据 / 家庭重置

- 删 `server/data/family.json` = 重置家庭注册表（gitignored，各手机重新认领/加入）
- server 改路由/服务后**必须重启进程**（`node --watch` 对新增文件热加载不可靠，实证踩过）

## 4. 环境速查（本机踩过的坑）

### Mac 本机

- pio 未进 PATH：`~/.platformio/penv/bin/pio`；板子烧录+日志统一走 USB2 原生口（USB1/CH343 口 C-to-C 不供电）
- HBuilderX 空闲 10 分钟+ 后首推必僵：先重启 HBuilderX 再推（详见 AGENTS.md「真机调试」段）
- zsh 会话丢 PATH：`export NVM_DIR && . "$NVM_DIR/nvm.sh"` + `PNPM_HOME=/Users/sheldon/Library/pnpm`
- 沙箱 `/bin/ps` 被拦截时 cli 命令误报「未检测到已打开的 HBuilderX」（`pgrep -x HBuilderX` 可证实际在跑），需更宽权限

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

- **不接管道**（`| tail` 会缓冲到进程结束才输出）；「已有安装包在云端队列中」= 上一次已提交成功，**别取消重排**
- `cli base info` 查 `custom.lastTime` 确认基座是否更新；产物命名 `baby-monitor_v<版本>_<yyyymmdd>.apk` 入 `unpackage/release/android/`
- **改完 UTS 插件先本地自查**：`cd uniapp && node scripts/check-uts.mjs`（秒级复现云端错误；
  bin-bluetooth 误报 12 条已过滤，升级该市场插件别以此判定可用性）

### server 运维（完整见 11-27 文档 §7）

```bash
SSH="ssh -i ~/.ssh/id_ed25519_babycry -p 4090 ubuntu@<SERVER_IP>"
sudo systemctl status babycry          # Node（127.0.0.1:3001）
sudo journalctl -u babycry -f
# 更新代码: cd /opt/babycry/app && git pull && cd server && pnpm install --prod && sudo systemctl restart babycry
```

## 5. 文档索引

| 文档 | 什么时候看 |
|---|---|
| [交接-2026-11-27-server上云与鉴权落地.md](交接-2026-11-27-server上云与鉴权落地.md) | **部署与鉴权唯一真值**：实际部署方式（Caddy + sparse-checkout，与旧方案差异表）、鉴权四设计点、§4 未验证清单、公网扫描现状 |
| [方案-server上云与安全加固.md](方案-server上云与安全加固.md) | 风险分析与长期方案（§4 部署细节已被 11-27 实际落地取代） |
| [方案-接口状态码与业务码设计.md](方案-接口状态码与业务码设计.md) | 动服务端 REST/WS 错误返回，或 App 请求层 / 401 处理时（**待拍板后实施**） |
| [调研-插件市场替代方案.md](调研-插件市场替代方案.md) | 考虑引入市场插件时 |
| [todo-配网安全.md](todo-配网安全.md) | 配网挂账（含默认 URL 硬编码） |
| [AGENTS.md](AGENTS.md) | 施工约定全集（UTS 避坑、3.x/PSRAM 坑、HBuilderX CLI、Git 安全约束） |
| git 历史 | 已收口的 9 份交接文档（2026-11-28 清理）：`git log --diff-filter=D --name-only -- '交接-*'` 可列出，检出任意历史版本即可找回 |

其余根目录 md（todo-产品 / todolist / report 评审 / Edge Impulse 指南）按需查阅，多为专项或历史文档。

## 6. 接手自检

```bash
cd /Users/sheldon/code/workplace/uniapp-mall
git status --short            # 应干净（或仅本次文档清理）
adb devices                   # 真机验证需接 P30
ls /dev/cu.usb*               # 板子（插 USB2 原生口）
```

然后按 §1 优先级开工。
