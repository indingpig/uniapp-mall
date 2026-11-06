# 配网安全阶段一：待办

> 2026-11-05 创建，2026-11-06 更新。

## 已完成并验证（2026-11-06）

- App 配对页完整流程（Just Works 加密）：扫描 → WiFi 列表点选 → 凭据 → `server_connected`
- 配网成功 → LED 灭、BLE 停广播
- BOOT 按住 3s 松手 → 打开 5 分钟配网窗口（LED 快闪）

## 待验证：恢复出厂改为 RST 三连击

固件改动（`arduino/baby_cry_detector/`）：

- `baby_cry_detector.ino` — 新增 `rstSeqBootCheck()`，恢复出厂由「BOOT 长按 10s」改为「3s 内连按 3 次 RST」；BOOT 只保留配网窗口
- `config.h` — 新增 `RST_SEQ_MAGIC` / `RST_SEQ_WINDOW_MS` / `RST_SEQ_TRIGGER_COUNT` / `NVS_KEY_RST_SEQ` / `NVS_KEY_LAST_RST`
- `audio_pipeline.cpp` — 注释同步（GPIO0 被 MCLK 占用后的后果表述）
- `server_link.cpp` — 支持 `ws://` 前缀；accept key 响应头名大小写不敏感 + value `trim()`

### 1. 实测 RST 键复位码（阻塞后续）

板子使用 ESP32-S3 原生 USB-Serial-JTAG：按 RST 会让 USB 重新枚举、串口断开，那一轮启动日志抓不到；而事后打开串口本身又会触发一次 `USB_UART_CHIP_RESET`，看到的永远是打开串口那次的码。

固件已把本次复位码写入 NVS `last_rst`，下次启动打印上一次的值，用来补上抓不到的那条：

```
[Boot] reset ROM code: 0x??   ← 本次（通常是开串口触发的 0x15）
[Boot] 上次复位码: 0x??        ← 上一次，按 RST 那一轮的码
```

操作：按一次 RST → 重新打开串口 → 读 `[Boot] 上次复位码`。

| 读到的码 | 含义 | 处理 |
|---|---|---|
| `0x01` | 上电级复位 | 当前 `romCode != 0x01` 的过滤可直接用，进入第 2 步 |
| `0x15` 或其他 | 与 USB 复位同码 / 非预期值 | `0x01` 判据失效，方案需重新设计 |

若为 `0x15`：复位码无法区分「按 RST」与「开串口」，纯计数方案在该硬件上不成立，需改设计方向（例如改用 BOOT 键的其他组合手势、或引入可读的硬件信号）。

### 2. 三击 RST → 恢复出厂

预期链路：第 2 击黄灯快闪 → 第 3 击红灯快闪 1s → 清 NVS → 重启后 LED 慢闪（回到出厂态）。

> ⚠️ 会清除已配网凭据，测完需重新配网。

### 3. 负向用例

- 双击 RST → 正常开机，不触发恢复出厂
- 插拔 USB、打开串口 → 计数不累计
- 运行中意外复位（panic / WDT）→ 计数清零，不累计

### 4. 重新配网回归

App 全流程再走一遍到 `server_connected`，确认清除凭据后能正常配网。

## 待实现

- [ ] **App 扫描按 Service UUID 过滤** — `uniapp/src/hooks/useBLE.ts:192` 的 `services: []` 改为传入 `BLE_SERVICE_UUID`（UTS 插件已支持该参数）
- [ ] **Server URL 校验收敛** — 抽一个共用校验函数（`ws://` / `wss://` 前缀、长度、去空白），接入两处：
  - BLE 写入：`ble_provision.cpp:101` 的 `ServerURLWriteCallback`
  - HTTP 写入：`collect_server.cpp:223` 的 `handleSetServer`
- [ ] **WiFi 掉线自动重连** — `wifi_connect.cpp` 增加掉线检测 + 指数退避（3s → 30s → 60s 封顶）

## 调试注意

- 串口抓日志进程不要与 `pio run -t upload` / esptool 同时运行，双进程抢串口会互相干扰
- 原生 USB 方案下，打开串口会复位芯片；观察启动日志时注意区分「串口打开」与「按键」造成的复位
- 提交前跑 `cd uniapp && pnpm run lint && pnpm run type-check`

## 相关文档

- 方案设计：`配网与设备管理改进方案.md`
