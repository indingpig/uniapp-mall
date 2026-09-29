# audio_app — WebSocket 流式录音采集

手机 App / 网页连接开发板，**开发板边录边推**，录音时长只受手机内存限制（不再有 5 秒上限）。

## 交互流程

```
手机选分类 → 点「开始录音」→ 板推送 PCM 流(实时, 边录边传)
          → 点「停止并保存」→ 板发 {"cmd":"done"} → 手机 AGC 归一化 + 封 WAV + 存本地
          → 或「停止并存内存」→ 攒多条 → 「打包下载全部」出 zip(按分类分文件夹)
```

## WiFi 连接方式（自动）

| 场景 | 行为 |
|---|---|
| 已保存家庭 WiFi | STA 模式，mDNS 地址 `http://babycry.local`（推荐，无信标杂音） |
| 无保存 / 连接失败(15s) | AP 热点 `BabyMonitor-Audio`，`http://192.168.4.1` |

**配网**：连热点后浏览器打开 `http://192.168.4.1/config`，输入家里 WiFi 名和密码，
保存后开发板重启并连入家庭网络（手机切回家里 WiFi，用 `babycry.local` 或串口打印的 IP 访问）。

> 开发板连家里 WiFi 时 IP 由路由器动态分配、会变，所以推荐用 `babycry.local`。
> 部分 Android / iOS 对 mDNS 支持不一，连不上时改用串口打印的实际 IP
> （`[STA] IP: x.x.x.x`）。

## WebSocket 协议（录音主通道）

连 `ws://<地址>/ws` 后：

| 方向 | 帧 | 说明 |
|---|---|---|
| App→板 | 文本 `{"cmd":"start"}` | 开始录音，板立即推送二进制音频帧 |
| App→板 | 文本 `{"cmd":"stop"}` | 停止，板推完缓冲后回一条 `done` |
| 板→App | **二进制帧** | 16kHz / 16-bit / 单声道 PCM，每帧 1024 样本（2KB） |
| 板→App | 文本 `{"cmd":"done","samples":N,"lost":bool}` | 收尾，`lost=true` 表示有覆盖丢帧 |

- 音频**已含高通滤波**（去 DC + 50Hz 工频 + 亚声频隆隆声），保证训练数据 = 推理输入
- PCM **无 WAV 头、无增益**，由接收端做 AGC 归一化（RMS→2500）并封装 WAV
- 新连接会重置录音状态，避免继承上次卡住的会话
- 板侧有 4 秒推流环形缓冲，消费不及会覆盖最旧并置 `lost` 标记（通知重录，不静默丢数据）

## HTTP 接口（开发板）

| 接口 | 作用 | 返回 |
|---|---|---|
| `GET /` | 采集页面（网页版用） | HTML |
| `GET /config` | WiFi 配网页 | HTML |
| `GET /config/save?ssid=&pass=` | 保存家庭 WiFi 并重启 | `{"ok":true}` |
| `GET /rms` | 实时电平（也含录音状态） | `{"rms":N,"rec":0/1,"samples":N}` |
| `GET /rec/start` | 兼容旧接口：等价于 WS `start` | `{"ok":true,"max_ms":0}` |
| `GET /rec/stop` | 兼容旧接口：等价于 WS `stop` | `{"ok":true,"samples":N,"lost":bool}` |

`/rec/*` 是为兼容早期 HTTP 版前端保留的，新前端走 WebSocket，不必使用。

## 两个前端（同一套协议）

- `index.html` — 网页版（零安装，浏览器打开开发板地址直接采集）
  - 改完页面需**重新生成 `index_html.h`** 并重新烧录固件（页面是编译进固件的）
  - 生成要求：UTF-8 **无 BOM**，用 `R"rawliteral(...)rawliteral"` 包裹，
    且页面内容中不得出现 `)rawliteral` 序列
  - 注意：**不要用 PowerShell 重定向/`Set-Content` 写这个头文件**，会把中文写成 GBK 乱码
- `audio_app_uni/` — uni-app Vue3 App（分类按钮 + 开始/停止 + 实时电平），
  复用同一套 WebSocket 协议，**固件无需改动**

## 固件说明

- `audio_app.ino`：STA / 软 AP 自动二选一（NVS 存凭据，无 `HOME_SSID` 编译期开关）
- 采集任务跑在 **Core 0**（I2S → 高通滤波 → `rmsRing` / `wsRing`），
  loop 在 Core 1 负责 HTTP 路由与 WS 推流
- `rmsRing` 1 秒、`wsRing` 4 秒；`wsChunk` 2KB
- **`LOOP_TASK_STACK_SIZE` 设为 16384**：loopTask 默认只有 8KB，
  在收请求 + 发送 15KB 页面时会栈溢出崩溃重启
  （`Stack canary watchpoint triggered (loopTask)`）
- `WiFi.setSleep(false)` + 主循环 `delay(1)`：防止 WiFi 省电导致推流卡顿
- 零第三方库，纯 Arduino core（WS 握手/分帧、Base64、SHA1 均自行实现）

## 已知问题

- 模型仍是用 iPhone 录音训练的，设备端（INMP441）置信度偏低；
  彻底解决需按 `audio_streamer/README.md` 用本设备录数据重训
