# audio_app_uni — uni-app 版录音采集 App（Vue 3）

把网页版采集器做成真正的手机 App（uni-app + **Vue 3**，一套代码编译 iOS / Android / H5）。
**开发板固件无需任何改动** —— 复用了同一套 WebSocket 音频流协议。

> 要求：HBuilderX 3.2.16 及以上（Vue 3 编译器）；`manifest.json` 已设 `"vueVersion": "3"`。
> 全项目使用 Composition API `<script setup>`（页面 + App.vue 生命周期均从 `@dcloudio/uni-app` 导入）。

## 与网页版的关系

| | 网页版 (audio_app/) | uni-app (本目录) |
|---|---|---|
| 形态 | 浏览器打开 192.168.4.1 | 安装的 App |
| 协议 | WebSocket 二进制流 | 相同 |
| 固件 | audio_app.ino | **同一份固件** |
| 音频逻辑 | index.html 内 JS | common/audio.js（同源函数，Node 可测） |

## 目录结构

```
audio_app_uni/
├── manifest.json          # App 配置 (HBuilderX 打开后填 appid 再打包)
├── pages.json             # 页面路由
├── main.js / App.vue      # 入口 (App 端保持屏幕常亮)
├── common/audio.js        # 音频纯逻辑: 滚动缓冲 / AGC / WAV (UMD)
├── pages/index/index.vue  # 采集主页面
└── test/test_audio.mjs   # Node 回归测试: node test/test_audio.mjs
```

## 运行步骤

1. **准备**：Windows 装 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（免费）
2. **导入**：HBuilderX → 文件 → 导入 → 从本地目录导入 `audio_app_uni`
3. **运行**：
   - 真机调试（推荐）：手机 USB 连电脑 → 运行 → 运行到手机或模拟器（Android 直接跑；iOS 需 Mac + Xcode 或用云打包）
   - H5 预览：运行 → 运行到浏览器（体验网页版效果，此时和 audio_app 网页版等价）
4. **打包**：发行 → 原生 App 云打包（免费），生成 APK / IPA
5. **使用**：手机连开发板热点（或开发板连家里 WiFi），App 里填开发板地址
   （默认 `http://babycry.local`；热点模式下改为 `http://192.168.4.1`）
   → 连接 → 听到声音按类别按钮保存

> 开发板连家里 WiFi 时 IP 由路由器动态分配（会变），所以默认用 mDNS 的
> `babycry.local`，比写死 IP 可靠。注意 iOS/部分 Android 对 mDNS 支持不一，
> 连不上时改用串口打印的实际 IP。

## 文件保存位置

- **Android**：`下载/BabyCry/` 目录（`cry_001.wav`、`babble_001.wav`...），文件管理里直接可见
- **iOS**：App 沙盒 `_doc/audio/`（受沙盒限制；如需直接进"文件"App，可改用 H5 版，或后续加 UIDocumentPicker 原生插件）
- **H5**：浏览器下载目录

## 已验证

- `common/audio.js` 纯逻辑：Node 回归测试全过（AGC 电平归一化、WAV 头字节、滚动缓冲顺序）
- WAV 文件经 Python `wave` 模块交叉验证：16000Hz / 单声道 / 16bit ✓
- 固件侧不变（audio_app.ino 已验证），只需重新烧录含**站模式**的最新固件即可同时支持两种连接方式

## 平台注意

- **二进制 WebSocket**：App 端（iOS/Android）`SocketTask.onMessage` 对二进制帧返回 ArrayBuffer，直接 `new Int16Array(data)` 使用；若收到字符串说明平台把二进制转文本了（少见），页面会提示
- **屏幕常亮**：App.vue 里 `uni.setKeepScreenOn` 已开启
- **App 端连不上时**：先确认手机与开发板在同一网络（热点模式 = 连上 BabyMonitor-Audio；站模式 = 同一家庭 WiFi），再确认 WebSocket 地址正确

## 后续可扩展（需要时再做）

- 采集列表页：浏览/删除/重命名已存片段
- 一键上传到 Edge Impulse 或 PC 接收端（uni.uploadFile）
- iOS 保存到"文件"App（原生插件）
- 接入设备推理结果（开发板同时跑模型，App 显示实时识别 + 保存阳性样本）
