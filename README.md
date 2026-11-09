# 👶 宝宝监护器 (Baby Cry Monitor)

基于 ESP32 + uni-app + Node.js 的婴儿哭声实时监测系统。硬件端通过 I2S 麦克风采集音频，使用 **Edge Impulse** 训练的机器学习模型识别哭声；Node.js 后端做状态判定与数据存储；移动端（App / 微信小程序 / H5）实时展示宝宝状态、音量及事件流。

---

## 📁 项目结构

```
babycryMonitor/
├── uniapp/                          # 移动端（uni-app 3 + Vue 3 + TS，@uni-helper/unh 工具链）
│   ├── src/
│   │   ├── pages/                   # 页面（vite-plugin-uni-pages 按目录自动注册）
│   │   │   ├── home/                # 首页 - 状态监控主界面
│   │   │   ├── history/             # 历史记录
│   │   │   ├── stats/               # 数据统计
│   │   │   ├── settings/            # 设置
│   │   │   ├── pairing/             # 设备配对（BLE 扫描 + WiFi 配网 + 失败分级）
│   │   │   ├── collect/             # 哭声数据采集页（开发者工具：录音→WAV）
│   │   │   └── ble-test/            # BLE 串口调试工具
│   │   ├── components/              # AppButton / AppSwitch / BabyStatusCard / CustomTabBar 等
│   │   ├── hooks/                   # useBabyMonitor / useBLE / useCapsuleGap
│   │   ├── constants/               # babyStatus（状态语义/音量分区）/ ble / cache / colors（TS 色源）
│   │   ├── utils/                   # icons（getIcon）、request 封装、storage 封装
│   │   ├── types/                   # 手写 d.ts（bin-bluetooth UTS 插件类型声明）
│   │   ├── api/                     # REST API 封装
│   │   ├── mock/                    # H5 蓝牙模拟器（ble-adapter，配对流程浏览器可走通）
│   │   └── styles/                  # 全局 SCSS（主题 token + 原子类 utilities.scss）
│   ├── scripts/gen-icons.mjs        # 图标构建（SVG → getIcon 字体/映射，改图标逻辑改这里后重跑）
│   ├── pages.config.ts              # 页面/tabBar 配置（生成 src/pages.json，勿手改）
│   ├── manifest.config.ts           # 多端配置（生成 src/manifest.json，勿手改；含小程序真实 AppID）
│   └── disign/                      # UI 设计稿导出 + 图标库（设计源文件，勿改名）
│
├── server/                          # Node.js 后端（Express + ws，ESM）
│   └── src/
│       ├── index.js                 # 入口（HTTP + WebSocket 同端口）
│       ├── routes/                  # REST：baby / history / stats
│       ├── services/
│       │   ├── detector.js          # 状态机（RMS 滑动窗口 + 设备端 EI 推理标签）
│       │   ├── simulator.js         # 内置状态模拟器（无硬件时联调用）
│       │   └── dataStore.js         # 历史数据存储
│       └── ws/handler.js            # WebSocket 广播与 ESP32 上报处理
│
├── arduino/                         # 硬件固件（ESP32-S3，PlatformIO）
│   └── baby_cry_detector/           # 主固件 + 实验子工程（audio_app / ble_test / ble_echo_test 等）
│
├── platformio.ini                   # PlatformIO 配置（在仓库根，src_dir 指向 arduino/）
├── todolist.md                      # TODO 与已修复留档（单一真值源）
└── AGENTS.md                        # AI 协作约定（目录/命令/注意事项）
```

---

## 🚀 快速开始

### 后端 (server)

> 📦 本项目统一使用 [pnpm](https://pnpm.io/zh/) 作为包管理器（Mac / Windows 两台开发机一致），`npm install` 会被 preinstall 守卫拦截。

```bash
cd server
pnpm install
pnpm run dev       # node --watch 开发运行
```

- 端口：`PORT` 环境变量（代码默认 8080，`.env` 当前设 3001）
- 健康检查：`GET /api/health`；WebSocket：`ws://localhost:3001/ws`
- 无硬件联调：默认开启内置模拟器；`NO_SIMULATOR=true pnpm run dev` 可关闭

### 移动端 (uniapp)

```bash
cd uniapp
pnpm install
pnpm run dev           # H5 开发服务器（默认连 ws://localhost:3001）
pnpm run dev mp-weixin # 微信小程序（产物 dist/dev/mp-weixin）
pnpm run dev app-plus  # App
```

> ⚠️ unh 的 platform 是**位置参数**。pnpm v11 下旧写法 `pnpm run dev -- --platform mp-weixin` 会把 `--` 原样透传、实际跑成 H5，勿用。
> 小程序调试链路（Windows/WSL 机的符号链接方案、微信开发者工具导入）见 [AGENTS.md](AGENTS.md)「小程序调试」小节。

### 硬件端 (ESP32 / PlatformIO)

```bash
pio run               # 编译默认环境 baby_cry_detector
pio run -e audio_app  # 编译其他子工程（另有 ble_test / ble_echo_test 环境）
pio run -t upload     # 烧录
pio device monitor    # 串口监视器（115200）
```

> 注意：必须使用 arduino-esp32 2.0.x（platform espressif32@6.x），代码依赖旧版 I2S 驱动 `driver/i2s.h`，不要随手升级 platform。主固件依赖 Edge Impulse 库 `babyCry_inferencing`（`lib_extra_dirs` 按开发机路径二选一自动跳过）。I2S 麦克风默认引脚：WS=4, SCK=5, SD=6。

---

## 🔌 通信协议

ESP32 与 App 共用同一个 WebSocket 端点，ESP32 客户端的 URL 需带 `esp32` 参数：

```
ws://localhost:3001/ws?esp32        # ESP32 上报端
ws://localhost:3001/ws              # App 订阅端
```

| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `init` | 服务端 → App | 连接后推送当前状态与持续时长 |
| `audio` | ESP32 → 服务端 | `{ type, rms, peak }` 音频采样 |
| `inference` | ESP32 → 服务端 | Edge Impulse 端侧推理结果（如 `label: 'babycry'`） |
| `volume` | 服务端 → App | 音量广播（附带当时状态） |
| `statusChange` | 服务端 → App | 状态机切换事件 |
| `listenState` | 服务端 → App | 监听（音频流播放）状态同步 |
| `cmd` | 服务端 → ESP32 | 下行指令 |
| `pong` | 双向 | 心跳保活 |

REST 接口：`/api/baby/status` `/api/baby/volume` `/api/baby/device`、`/api/history`、`/api/stats/*`。

**状态判定逻辑**（`server/src/services/detector.js`）：输入是实时音量（RMS）+ 设备端 EI 推理标签（有 `label` 时以模型为准）。基于最近 10 个采样（约 5 秒）滑动窗口推断 —— 哭闹需窗口内 ≥6 个样本命中（`label==='babycry'` 或 RMS≥200，约 46 dB）且触发后 5 秒冷却；持续 10 秒安静（RMS≤80 ≈ 38 dB）切换到安睡；15 秒无数据判离线。前端三段变色音量条的分区（60/80/100 分档）见 `uniapp/src/constants/babyStatus.ts` 的 `VOLUME_ZONES`。

---

## 🛠️ 技术栈

### 前端

| 技术 | 说明 |
|------|------|
| **uni-app 3.x** | 跨平台框架（H5 / 微信小程序 / App iOS·Android·鸿蒙） |
| **Vue 3.4** | Composition API + `<script setup>` |
| **TypeScript** | 类型安全（vue-tsc 已清零历史错误） |
| **SCSS** | 主题 token + Tailwind 风格原子类（`styles/utilities.scss`） |
| **Vite 5** | 构建工具（@uni-helper/unh 工具链） |
| **UTS 插件** | `bin-bluetooth` 跨平台 BLE（App/小程序/H5-mock 三端） |

### 后端

| 技术 | 说明 |
|------|------|
| **Node.js + Express** | REST API（ESM） |
| **ws** | WebSocket 实时推送 |
| **无数据库** | 内存数据存储（重启即清空） |

### 硬件

| 技术 | 说明 |
|------|------|
| **ESP32-S3** | 主控芯片 |
| **I2S 麦克风** | 数字音频输入（INMP441 / SPH0645 等） |
| **PlatformIO** | 构建框架（arduino-esp32 2.0.x） |
| **Edge Impulse** | 声音分类模型训练与端侧部署 |

---

## 📱 功能特性

- 🍼 **实时状态监控** — 五态语义显示（安睡/清醒/清醒活跃/哭闹/离线），绿=平稳、琥珀=留意、红=立即提醒
- 🔊 **实时音量** — dB 数值 + 三段变色音量条（分区阈值见 `VOLUME_ZONES`）
- 📝 **今日事件** — 从历史记录推导的状态切换时间线（哭声提醒/有动静/开始安睡）
- 📶 **配对** — BLE 扫描（RSSI 四档信号条）+ WiFi 配网（扫码填入、失败分级提示、成功弹窗）
- 🔋 **设备信息** — 连接状态、供电方式（充电宝供电）、信号
- 🛡️ **自定义胶囊 TabBar** — `CustomTabBar` 组件 + `pages.config.ts` tabBar `custom: true`（小程序端如遇异常需迁移至微信 `custom-tab-bar/` 官方机制）
- 🌓 **深色模式** — 支持浅色/深色主题切换

---

## 🎨 设计稿

`uniapp/disign/` 目录是 UI 设计的唯一样式来源（勿改名）：

- `宝宝监控App设计稿导出/` — 页面设计稿（首页、配对三态、设置、状态图例）
- `宝宝监控App图标库/` — SVG 图标，统一 `currentColor`（多端可换色），经 `uniapp/scripts/gen-icons.mjs` 构建进 `src/utils/icons.ts` 的 `getIcon()` 体系（改图标逻辑改脚本后重跑，勿手改生成物）

---

## 📋 TODO

已迁移至 [todolist.md](todolist.md)（含优先级分层、已修复留档与 v1.2 排期），README 不再维护清单副本。

---

## 📄 许可

MIT License
