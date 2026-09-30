# AGENTS.md

宝宝监护器（Baby Cry Monitor）：ESP32 通过 I2S 麦克风采集音频，用 Edge Impulse 训练的模型识别哭声；uni-app 移动端实时展示状态、音量与设备信息；Node.js 后端提供 REST API + WebSocket 推送。

## 目录结构

| 目录 | 说明 |
|------|------|
| `uniapp/` | 移动端 App（uni-app 3 + Vue 3 + TS + Pinia，@uni-helper/unh 工具链） |
| `server/` | Node.js 后端（Express + ws，内置状态模拟器，ESM） |
| `arduino/baby_cry_detector/` | ESP32 固件（PlatformIO，主工程 + 多个独立子工程） |

## 常用命令

### uniapp（在 `uniapp/` 下执行）

```bash
npm run dev          # H5 开发服务器
npm run dev -- --platform mp-weixin   # 微信小程序
npm run dev -- --platform app-plus    # App
npm run build        # 生产构建
npm run lint         # ESLint 检查
npm run lint:fix     # ESLint 自动修复
npm run type-check   # vue-tsc 类型检查
```

### server（在 `server/` 下执行）

```bash
npm run dev          # node --watch 开发运行，默认端口 3001（.env 的 PORT 可覆盖）
npm start            # 生产运行
NO_SIMULATOR=true npm run dev   # 关闭内置模拟器
```

- WebSocket 端点：`ws://localhost:3001/ws`；健康检查：`GET /api/health`
- 代码分层：`src/routes/`（Express 路由）、`src/services/`（业务与数据）、`src/ws/`（WebSocket）
- **ESM 项目**（`"type": "module"`）：使用 `import` 语法，相对导入必须带 `.js` 扩展名

### arduino（在仓库根目录执行，PlatformIO）

```bash
pio run                      # 编译默认环境 baby_cry_detector
pio run -e audio_app         # 编译其他子工程
pio run -t upload            # 烧录
pio device monitor           # 串口监视器（115200）
```

## 约定与注意事项

### uniapp

- **必须跨平台兼容（打包目标：App 的 iOS / Android / 鸿蒙，及 H5、小程序），代码优先使用 uni-app API（`uni.xxx`），不要用 Web 专属 API**：
  - 禁止直接使用 `window`、`document`、`navigator`、`localStorage`、`fetch`/`XMLHttpRequest` 等 Web 对象（App 端不在浏览器环境里运行，鸿蒙端同样）
  - 存储：`uni.setStorageSync` / `uni.getStorageSync` 等（已有封装 `src/utils/storage.ts`，业务代码优先用它）
  - 网络请求：`uni.request`（已有封装 `src/utils/request/`，业务代码统一走它）
  - 页面跳转、提示、蓝牙等系统能力一律用 `uni.xxx` 对应方法
  - 确需平台差异逻辑时，用条件编译（`#ifdef H5`、`#ifdef APP-PLUS` 等）隔离，不要写运行时环境嗅探

- **`src/pages.json` 和 `src/manifest.json` 是生成文件，不要手改**：
  - 改 `pages.config.ts`（全局样式、tabBar 等）和 `manifest.config.ts`（appid、权限模块等）
  - 页面由 vite-plugin-uni-pages 按 `src/pages/<name>/index.vue` 文件系统自动扫描注册，无需在 config 里逐个添加
- 组件自动导入（vite-plugin-uni-components + UniUIResolver）：uni-ui 组件直接用，无需 import；`components.d.ts` 为生成文件
- 路径别名 `@` → `src/`
- 全局 SCSS 已通过 vite `additionalData` 注入（`styles/uni.scss`、`page-layout.scss`、`state.scss`、`button.scss`、`list-item.scss`、`section.scss`），页面里直接使用其中的变量/类，不要重复 @use
- `styles/utilities.scss` 由 `App.vue` 全局引入，提供 Tailwind 风格原子类（布局/flex/间距/文字/颜色/圆角/定位等）：间距 1 单位 = 8rpx（`p-4` = 32rpx），颜色类直接映射 `uni.scss` 主题 token（`text-primary`、`bg-card`…）。写页面布局时优先用这套原子类，组件特有的复杂样式再走 scoped SCSS；新刻度加在文件内的 `$space-scale` 里。`.line-clamp-N` 会覆盖同元素上的 `display`，不要与 `.flex` 叠在同一节点。注意 scoped 样式（带 `[data-v]`，特异度更高）会压过同属性的全局原子类：同一属性不要既写在 scoped 又指望原子类生效；动态状态切换（如 `--active`）的颜色覆盖留在 scoped。`<text>` 在 H5 端渲染为 inline，垂直 margin 原子类（`mb-*`/`mt-*`）要同时加 `block` 才生效（flex 容器的子元素会被块化，无需加）。**禁止**在 flex 容器的子元素上加垂直 margin 类：items-center 按 margin-box 居中会造成错位，间距一律用容器 gap 或容器自身的 margin/padding
- 代码风格：`<script setup lang="ts">` + Composition API；ESLint 使用 @uni-helper/eslint-config，**强制分号**（`semi: true`），`console` 仅 warn
- 提交前跑 `npm run lint` 和 `npm run type-check`
- 蓝牙相关常量在 `src/constants/ble.ts`，BLE 逻辑集中在 `src/hooks/useBLE.ts`

### arduino

- PlatformIO 配置在**仓库根** `platformio.ini`（不在 arduino/ 目录），`src_dir` 指向 `arduino/baby_cry_detector/`
- **代码使用旧版 I2S 驱动 `driver/i2s.h`，必须用 arduino-esp32 2.0.x（platform espressif32@6.x）**；升级到 3.x 需整体迁移到 `ESP_I2S.h`，不要随手升级 platform
- 每个子目录（`audio_app/`、`audio_streamer/`、`i2s_recorder/`、`waveform_viewer/` 等）是独立子工程，各有自己的 setup/loop；通过各 `[env:*]` 的 `build_src_filter` 只编译该工程的文件 —— **给某环境新增源文件时，必须同步更新 platformio.ini 的 src_filter**
- **PlatformIO 不会把 `build_src_filter` 里的 `.ino` 当源文件编译**（可编译扩展只有 c/cpp/cc/cxx/c++/S/asm）：`src_dir` 根目录的 `.ino` 会先被转成临时的 `.ino.cpp` 再编译，所以过滤要用 `+<xxx.ino*>` 匹配转换后的文件名；子目录里的 `.ino` 永不转换，子工程若要编译须在环境里把 `src_dir` 指到该子目录（参考 `[env:audio_app]`）
- 依赖 Edge Impulse 推理库 `babyCry_inferencing`，`lib_extra_dirs` 同时列出两台开发机的库目录（家用 Windows 机 `D:/ArduinoProject/libraries`、Mac `/Users/sheldon/Documents/Arduino/libraries`），不存在的目录会被自动跳过
- Mac 上 `pio` 未进 PATH，用 `~/.platformio/penv/bin/pio`（VS Code PlatformIO 扩展自带）
- BLE + WiFi + EI 模型体积大，使用 `huge_app.csv` 分区（3MB App，无 OTA）
- 主固件 `baby_cry_detector` 的编译组成：`baby_cry_detector.ino` + `ble_provision.*` + `wifi_connect.*` + `led.*` + `config.h`

### 其他

- `.pio/`、`uniapp/dist/`、`uniapp/unpackage/`、`node_modules/` 均为构建产物，已在 .gitignore，不要提交
- `README.md` 的目录结构和 TODO 可能落后于代码（例如 pages 下已有 `pairing`、`ble-test` 等），**以代码为准**
