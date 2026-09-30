# 👶 宝宝监护器 (Baby Cry Monitor)

基于 ESP32 + uni-app + Node.js 的婴儿哭声实时监测系统。硬件端通过 I2S 麦克风采集音频，使用 **Edge Impulse** 训练的机器学习模型识别哭声；Node.js 后端做状态判定与数据存储；移动端 App 实时展示宝宝状态、音量及事件流。

---

## 📁 项目结构

```
babycryMonitor/
├── uniapp/                          # 移动端 App（uni-app 3 + Vue 3 + TS）
│   ├── src/
│   │   ├── pages/                   # 页面
│   │   │   ├── home/                # 首页 - 状态监控主界面（设计稿 01）
│   │   │   ├── history/             # 历史记录
│   │   │   ├── stats/               # 数据统计
│   │   │   ├── settings/            # 设置
│   │   │   ├── pairing/             # 设备配对（BLE 扫描 + WiFi 配网）
│   │   │   └── ble-test/            # BLE 串口调试工具
│   │   ├── components/              # 公共组件
│   │   │   └── CustomTabBar.vue     # 自定义底部导航栏（浮动胶囊风格）
│   │   ├── hooks/                   # useBabyMonitor / useBLE / useCapsuleGap
│   │   ├── constants/               # 状态语义、音量分区等常量
│   │   ├── utils/                   # icons（SVG 图标库）、request 封装
│   │   ├── styles/                  # 全局 SCSS（主题变量 + 原子类 utilities.scss）
│   │   ├── static/
│   │   │   ├── icons/               # 设计稿图标库（SVG）
│   │   │   └── tabbar/              # 原生 tabBar 图标（custom 后不再使用）
│   │   └── api/                     # REST API 封装
│   ├── pages.config.ts              # 页面/tabBar 配置（生成 src/pages.json，勿手改）
│   ├── manifest.config.ts           # App 配置（生成 src/manifest.json，勿手改）
│   └── disign/                      # UI 设计稿导出 + 图标库（设计源文件）
│
├── server/                          # Node.js 后端（Express + ws，ESM）
│   └── src/
│       ├── index.js                 # 入口（HTTP + WebSocket 同端口）
│       ├── routes/                  # REST：baby / history / stats
│       ├── services/
│       │   ├── detector.js          # 状态机（基于 RMS 滑动窗口判定五态）
│       │   ├── simulator.js         # 内置状态模拟器（无硬件时联调用）
│       │   └── dataStore.js         # 历史数据存储
│       └── ws/handler.js            # WebSocket 广播与 ESP32 上报处理
│
├── arduino/                         # 硬件固件（ESP32，PlatformIO）
│   └── baby_cry_detector/           # 主工程 + 多个独立子工程
│
├── platformio.ini                   # PlatformIO 配置（在仓库根，src_dir 指向 arduino/）
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

- 端口：读 `.env` 的 `PORT`（当前 3001，代码默认 8080）
- 健康检查：`GET /api/health`；WebSocket：`ws://localhost:3001/ws`
- 无硬件联调：默认开启内置模拟器；`NO_SIMULATOR=true npm run dev` 可关闭

### 移动端 (uniapp)

```bash
cd uniapp
pnpm install
pnpm run dev                       # H5 开发服务器（默认连 ws://localhost:3001）
pnpm run dev -- --platform mp-weixin   # 微信小程序
pnpm run dev -- --platform app-plus    # App
```

### 硬件端 (ESP32 / PlatformIO)

```bash
pio run               # 编译默认环境 baby_cry_detector
pio run -t upload     # 烧录
pio device monitor    # 串口监视器（115200）
```

> 注意：必须使用 arduino-esp32 2.0.x（platform espressif32@6.x），代码依赖旧版 I2S 驱动 `driver/i2s.h`，不要随手升级 platform。I2S 麦克风默认引脚：WS=4, SCK=5, SD=6。

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
| `volume` | 服务端 → App | 音量广播（附带当时状态） |
| `statusChange` | 服务端 → App | 状态机切换事件 |

REST 接口：`/api/baby/status` `/api/baby/volume` `/api/baby/device`、`/api/history`、`/api/stats/*`。

**状态判定逻辑**（`server/src/services/detector.js`）：实时音量（RMS）是输入，状态是基于最近 10 个采样（约 5 秒）滑动窗口的推断结论 —— 哭闹需窗口内 ≥6 个样本 RMS≥200（约 46 dB）且带 5 秒冷却；持续 10 秒安静（≤80 ≈ 38 dB）切换到安睡；中等音量持续 30 秒进入清醒活跃。前端三段变色音量条的分区阈值见 `uniapp/src/constants/babyStatus.ts`。

---

## 🛠️ 技术栈

### 前端

| 技术 | 说明 |
|------|------|
| **uni-app 3.x** | 跨平台框架（H5 / 微信小程序 / App） |
| **Vue 3.4** | Composition API + `<script setup>` |
| **TypeScript** | 类型安全 |
| **SCSS** | 主题 token + Tailwind 风格原子类（`styles/utilities.scss`） |
| **Vite 5** | 构建工具（@uni-helper/unh 工具链） |

### 后端

| 技术 | 说明 |
|------|------|
| **Node.js + Express** | REST API |
| **ws** | WebSocket 实时推送 |
| **无数据库** | 内存数据存储（重启即清空） |

### 硬件

| 技术 | 说明 |
|------|------|
| **ESP32** | 主控芯片 |
| **I2S 麦克风** | 数字音频输入 (INMP441 / SPH0645 等) |
| **PlatformIO** | 构建框架（arduino-esp32 2.0.x） |
| **Edge Impulse** | 声音分类模型训练与部署 |

---

## 📱 功能特性

- 🍼 **实时状态监控** — 五态语义显示（安睡/清醒/清醒活跃/哭闹/离线），绿=平稳、琥珀=留意、红=立即提醒
- 🔊 **实时音量** — dB 数值 + 三段变色音量条（分区阈值与后端状态机对应）
- 📝 **今日事件** — 从历史记录推导的状态切换时间线（哭声提醒/有动静/开始安睡）
- 🔋 **设备信息** — 连接状态、电量、信号
- 🛡️ **自定义胶囊 TabBar** — `CustomTabBar` 组件 + `pages.config.ts` tabBar `custom: true`（H5/App 已验证；小程序端如遇异常需迁移至微信 `custom-tab-bar/` 官方机制）
- 🌓 **深色模式** — 支持浅色/深色主题切换

---

## 🎨 设计稿

`uniapp/disign/` 目录是 UI 设计的唯一样式来源（勿改名）：

- `宝宝监控App-设计稿导出/` — 6 张页面设计稿（首页、配对三态、设置、状态图例）
- `宝宝监控App-图标库/` — 29 个 SVG 图标，单色图标统一 `currentColor`（多端可换色），已随页面需要拷入 `src/static/icons/` 并注册进 `src/utils/icons.ts`

---

## 📋 TODO

### 🔧 硬件端 (ESP32)

- [x] I2S 麦克风音频采集
- [x] 哭声检测（Edge Impulse 声音分类模型）
- [ ] 区分更多状态（安睡 / 清醒 / 玩耍）
- [ ] 音量分贝计算
- [ ] 电池电量检测与上报
- [ ] Wi-Fi / 蓝牙连接与 App 通信

### 📱 移动端 (App)

- [x] 首页 UI 按设计稿 01 重做 — 状态卡、三段音量条、今日事件、监听/静音按钮
- [x] 自定义胶囊 TabBar — 组件已挂载到 4 个 tab 页（H5/App 验证通过）
- [ ] 配对页按设计稿重做 — 三步进度条、扫描/不支持蓝牙引导态
- [ ] 设置页按设计稿重做 — 设备卡、监控设置（开关/阈值）、通用组
- [ ] 历史记录页面 — 哭声事件时间线
- [ ] 数据统计页面 — 图表可视化
- [ ] 监听功能 — 实时音频流（当前按钮为占位）
- [ ] 静音提醒持久化 + 推送联动（当前为本地状态）
- [ ] 深色模式适配
- [ ] 哭声实时推送通知
- [ ] 设备连接 / 断连状态同步
- [ ] 接入真实 ESP32 数据（当前联调走后端内置模拟器）
- [ ] 清理模板遗留空白页（cart / category / mine）

---

## 📄 许可

MIT License
