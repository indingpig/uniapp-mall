# 配网安全阶段一：待办

> 2026-11-05 创建，2026-11-08 更新（RST 连击方案废弃，BOOT 双手势定稿）。

## 已完成并验证（2026-11-08）

- **BOOT 双手势**（两轮实测通过，恢复出厂唯一入口）：
  - 按住 3s 松手 → 开 5 分钟配网窗口（3s 处黄灯快闪提示「可松手」）
  - 按住 10s（按住中触发）→ 擦 NVS → 红灯闪烁**等待松手**才重启
    （直接重启会因 GPIO0 仍被按住而进 ROM 下载模式，看似死机）
- **重新配网回归**：App 全流程（扫描 → WiFi 列表选网 → 凭据写入 → 设备连服务器）
  → `server_connected` → LED 灭、BLE 停广播
- **服务端链路**：设备经 `ws://192.168.1.24:3001/ws` 在线，detector 状态机用真实数据跑通；
  服务端跑在 Windows 侧（`NO_SIMULATOR=true`，WSLENV 穿透环境变量）

## 已废弃：RST 三连击恢复出厂（2026-11-08 决策）

- **原因**：RST 接 CHIP_PU 是纯硬件复位，软件读不到，只能跨重启查 NVS 计数推断。
  实测死结：每按一次断一次 USB，计数落盘要 0.65s、窗口内还要再按 —— 3s/6s 窗口
  多轮均失败；且 RST 与插 USB 上电同码（0x01）无法防误触。行业同款方案
  （Shelly 断电计数）门槛为 5-6 次且只作兜底，三连击的可靠性/体验不成立。
- **处置**：代码已整体移除（原实现见 git 历史 `4c5e584`）；恢复出厂统一走
  BOOT 长按 10s。固件挂死场景用 BOOT+RST 进 ROM 下载模式重烧（开发场景足够）。

## 待真机验证（2026-11-11 真机联调更新）

- [x] **配对与扫描绑定** — ① 已验证（2026-11-09 日志 `配对/加密 OK` → 扫描 → 回列表）；
  ③ 已验证（2026-11-11：手机与板子在 11-09 已建立 BOND 绑定（`ESP_LE_AUTH_BOND`，持久），
  重连静默加密、不弹框、直接扫出列表 —— 不弹框为预期行为，非 bug）
  - 待验证 ②：拒绝配对后 20s 的超时提示。重测路径：手机删除 `BabyMonitor-3004` 配对记录 →
    重新配网时故意不确认弹框 → 应 20s 提示「未完成配对」
- [x] **出厂态配网窗口限时** — 完整验证：5 分钟整关闭（2026-11-09）+
  **关闭后 BOOT 3s 重开恢复广播快闪（2026-11-11 真机）**
- [x] **配对页「连接中」按钮** — 真机回归通过（2026-11-11，配对页五项修复全部正常：
  连接中反馈/步骤条横杠/其他网络弹框/遮罩压暗顶栏/无溢出变形）

## 待办

- [x] **BLE 首连加密竞态（「配网超时」根因，固件）** — 已修复（2026-11-08）：
  发起点从「连接后固定延迟」改为 App 的 WiFiList 写入触发（该写入能到达即证明
  服务发现已完成），实测一次配对成功、全程零 FAIL。残留两个无害/待办现象：
  ① 连接后偶有一次 App 侧快速断开重连（无加密动作，App 自身流程行为）；
  ② 引出下一条「配网页默认 URL」问题
- [ ] **配网页默认服务器 URL** — 硬编码公司内网 IP（`pairing/index.vue:42`），
  换网络忘改就把设备指到不可达地址（2026-11-08 实踩，靠 `/setserver` 端点救回）；
  方向：记忆上次配对值 / 设置页可配
- [ ] **配对页按规范 5.4 重设计（App，v1.1.22-23）** — 紧凑布局（设备状态条 +
  单卡 + 高级设置折叠 + 吸底 CTA）、成功弹框（联网信息卡三行）、失败提示分级
  （就地错误/瞬时 toast/掉线灰态）；失败分级需要固件补充错误码区分
  （`WL_WRONG_PASSWORD` → `error:wifi_password` 等）
- [ ] **App 服务器地址烘焙问题** — `.env.production` 固化 IP（现为 192.168.3.5），
  换网络即失效；方向：运行时可配置
- [x] **App 扫描按 Service UUID 过滤** — 完成（2026-11-11，已过 lint/type-check，待真机）：
  `useBLE.ts` `services: [BLE_SERVICE_UUID]`；固件广播确认带该 UUID（addServiceUUID + scan response）
- [x] **Server URL 校验收敛** — 完成（2026-11-11，已烧录，待真机）：`server_url.h` 两处共用
  （`ws://`/`wss://` 前缀、长度、去空白、host 非空）接入 `ble_provision.cpp` ServerURLWriteCallback
  与 `collect_server.cpp` handleSetServer；`/setserver` 另加「未配网态/窗口期才开放」门槛。
  **附带修复**：已配网设备开机未关窗（`s_enabled` 默认 true 等 server_connected 才关），
  现主固件开机即按出厂/已配网分流关窗
- [x] **WiFi 掉线自动重连** — 代码完成（2026-11-11）：掉线检测（曾连上 + STA 断开）+ 退避 3s→30s→60s 封顶，首轮放弃也转入退避重连；掉线期 LED 慢闪，重连计数供改进点 8 遥测。**待真机验证**（详见主单「配网与设备管理」改进点 5）

- [x] **ServerLink 死链检测** — 完成（2026-11-11，真机端到端验证通过）：
  固件每 10s 发一帧 WS ping（server 的 ws 库自动回 pong），30s 未收到服务端任何字节即判死链
  主动断开走重连；对抗「TCP 半开黑洞」（板子每 2s 必发 audio 但 server 早已不可达，
  TCP 写不报错、双方各揣一条假活连接，App 周期性误判离线）。
  验证：SIGSTOP 暂停 node → 精确 30s 触发「死链」日志 → 3s 间隔重试 → CONT 后 1s 重连成功；
  正常链路 2 分钟+ 零误报。首版曾误报：活性刷新放在 wsProcessIncoming 之后（帧全被消费，
  available() 恒为 0），已修（刷新移到处理之前）
- [x] **WiFi 掉线自动重连** — 代码完成（2026-11-11）：掉线检测（曾连上 + STA 断开）+ 退避 3s→30s→60s 封顶，首轮放弃也转入退避重连；掉线期 LED 慢闪，重连计数供改进点 8 遥测。**待真机验证**（详见主单「配网与设备管理」改进点 5）

## 调试注意

- 日志走板载原生 USB（`CDC_ON_BOOT=1`），**CH343 串口口看不到运行日志**
- **打开串口本身会触发一次 USB 复位**（USB_UART_CHIP_RESET）——启动日志永远是
  「开串口那一次」的；按 RST 后当轮日志抓不到属预期
- pyserial 抓日志脚本在 USB 重枚举时会抛 SerialException 退出，属预期
- 提交前跑 `cd uniapp && pnpm run lint && pnpm run type-check`

### WSL 开发机烧录路线（2026-11-11 实测，usbipd 未装）

- **编译在 WSL**：`~/.local/bin/pio`（pip --user 装的 PlatformIO 6.2）；EI 库已拷到
  `~/ArduinoProject/libraries`，`platformio.ini` lib_extra_dirs 第三条即它
- **烧录在 Windows**：WSL 构建的 `firmware.bin` 拷到 `C:\Users\Sheldon\AppData\Local\Temp\bcflash\`，
  用 `.platformio\penv\Scripts\python.exe`（自带 pyserial）跑 `tool-esptoolpy\esptool.py`，
  **只烧 app**：`write_flash 0x10000 firmware.bin`（bootloader/分区表不动）
- **PIO 工具链下载在国内直连只有 12KB/s**：走 Windows 侧代理（v2rayN 默认口
  `192.168.16.1:10809`）设 `HTTPS_PROXY` 环境变量即可（~800KB/s）；大包（框架 246MB）
  代理也会中途卡死（pio 不续传），用 curl 分块并行下载 + `pio pkg install -t file://` 本地装，
  装完要**手改 `~/.platformio/packages/<包>/.piopm`** 补 `spec.owner`（file:// 安装缺 owner，
  pio 不认会重新下载）
- **烧录后瞬态坑**：flash 完直接开串口，板子可能出现「SYN 发得出、SYN-ACK 收不进」
  的假死（真机抓包证实单向丢包）；用 esptool 跑一次进出下载模式（如 `chip_id`）再开串口即恢复
- **WSL server 供板子连接**：portproxy 已改指向 WSL IP（`0.0.0.0:3001 → 192.168.23.72:3001`，
  **WSL 重启后 IP 会变，需重新 netsh set**）+ 防火墙放行规则 `BabyMonitor-WS-3001`（TCP 3001 入站）；
  3001 曾被上次联调遗留的僵尸 node 占用，netstat 查两个监听者即此症
- **板子 NVS 里的服务器地址**是 `ws://192.168.1.24:3001/ws`（Windows LAN IP）

## 相关文档

- 方案设计：已并入 `todolist.md`「配网与设备管理」节（原文档 2026-11-10 删档）
