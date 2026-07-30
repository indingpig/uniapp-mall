# 👶 宝宝监护器 (Baby Cry Monitor)

基于 ESP32 + uni-app 的婴儿哭声实时监测系统。硬件端通过 I2S 麦克风采集音频，使用 **Edge Impulse** 训练的机器学习模型识别哭声，移动端 App 实时展示宝宝状态、音量及设备信息。

---

## 📁 项目结构

```
babycryMonitor/
├── uniapp/                          # 移动端 App（uni-app + Vue 3）
│   ├── src/
│   │   ├── pages/                   # 页面
│   │   │   ├── home/                # 首页 - 宝宝状态监控主界面
│   │   │   ├── history/             # 历史记录
│   │   │   ├── stats/               # 数据统计
│   │   │   └── settings/            # 设置
│   │   ├── components/              # 公共组件
│   │   │   └── CustomTabBar.vue     # 自定义底部导航栏（浮动胶囊风格）
│   │   ├── stores/                  # Pinia 状态管理
│   │   ├── utils/                   # 工具函数 & HTTP 请求封装
│   │   ├── styles/                  # 全局 SCSS 变量
│   │   └── api/                     # API 类型定义
│   ├── package.json
│   └── vite.config.ts
│
├── arduino/                         # 硬件固件（ESP32）
│   └── baby_cry_detector/
│       ├── baby_cry_detector.ino    # 主程序（I2S 音频采集 + 哭声检测）
│       ├── led.cc / led.h           # LED 状态指示模块
│       ├── back.js / back_.js       # 数据处理辅助脚本
│       ├── i2s_recorder/            # I2S 录音子程序
│       │   ├── i2s_recorder.ino
│       │   ├── recv_wav.py          # Python WAV 接收工具
│       │   └── output.wav           # 测试音频样本
│       └── waveform_viewer/         # 波形可视化
│           └── waveform_viewer.ino
│
└── .gitignore
```

---

## 🚀 快速开始

### 移动端 (uniapp)

```bash
# 进入 uni-app 项目目录
cd uniapp

# 安装依赖
npm install

# 启动开发服务器（H5 模式）
npm run dev

# 编译为微信小程序
npm run dev -- --platform mp-weixin

# 编译为 App
npm run dev -- --platform app-plus
```

### 硬件端 (Arduino)

1. 使用 **Arduino IDE** 打开 `arduino/baby_cry_detector/baby_cry_detector.ino`
2. 选择开发板：**ESP32 Dev Module**
3. 安装依赖库（如需要）：
   - ESP32 I2S 驱动（通常内置）
4. 连接 I2S 麦克风（默认引脚：WS=4, SCK=5, SD=6）
5. 编译上传到开发板

---

## 🛠️ 技术栈

### 前端

| 技术 | 说明 |
|------|------|
| **uni-app 3.x** | 跨平台框架（H5 / 微信小程序 / App） |
| **Vue 3.4** | Composition API + `<script setup>` |
| **TypeScript** | 类型安全 |
| **Pinia** | 状态管理 |
| **SCSS** | 样式预处理 |
| **Vite 5** | 构建工具 |

### 硬件

| 技术 | 说明 |
|------|------|
| **ESP32** | 主控芯片 |
| **I2S 麦克风** | 数字音频输入 (INMP441 / SPH0645 等) |
| **Arduino Framework** | 开发框架 |
| **Edge Impulse** | 声音分类模型训练与部署 |
| **Python** | WAV 数据接收工具 |

---

## 📱 功能特性

- 🍼 **实时状态监控** — 显示宝宝当前状态（安睡/清醒/哭泣/玩耍）
- 🔊 **音量监测** — 实时 dB 数值 + 进度条可视化
- 🔋 **设备信息** — 设备连接状态、电池电量
- 🌓 **深色模式** — 支持浅色/深色主题切换
- 📊 **数据统计** — 历史数据图表分析
- 🛡️ **多平台适配** — 自定义胶囊式 TabBar，兼容小程序/App/H5

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

- [x] 首页 UI — 状态卡片、音量卡片、设备卡片
- [x] 自定义胶囊 TabBar（全平台适配）
- [ ] 首页接入真实硬件数据（当前为 Mock 数据）
- [ ] 历史记录页面 — 哭声事件时间线
- [ ] 数据统计页面 — 图表可视化
- [ ] 设置页面 — 设备绑定 / 阈值调节 / 通知开关
- [ ] 深色模式适配
- [ ] 哭声实时推送通知
- [ ] 设备连接 / 断连状态同步

---

## 📄 许可

MIT License
