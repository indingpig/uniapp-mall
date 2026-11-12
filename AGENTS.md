# AGENTS.md

# Git 提交安全约束（强制）

## 1. 核心原则

本项目的所有代码均可能被公开传播。任何提交到 Git 仓库的内容，都必须满足：

- 不包含任何真实凭据、密钥、令牌、密码或其他敏感信息。
- 不包含个人隐私、家庭网络信息、设备私有信息及未经脱敏的用户数据。
- 不允许因为开发调试方便、构建需要或测试需要，将敏感信息写入代码、配置文件、文档或测试数据。
- 不确定某项内容是否敏感时，默认按敏感信息处理，停止提交并向用户确认。

**安全约束优先于开发效率、功能实现和自动化提交。不得为了完成任务而绕过安全检查。**

## 2. 敏感信息定义

以下内容一律视为敏感信息，禁止提交到 Git 仓库。

### 2.1 账户和访问凭据

- API Key、Access Token、Refresh Token。
- GitHub Token、第三方平台 Token。
- 用户名、密码、数据库连接凭据。
- MQTT 用户名、密码及认证凭据。
- 云服务密钥、对象存储密钥、推送服务密钥。
- Webhook URL 中包含的认证参数。
- SSH 私钥、TLS 私钥、签名证书及其他私有密钥。

### 2.2 设备及网络信息

- 家庭 Wi-Fi SSID 和密码。
- MQTT Broker 的真实地址及认证信息。
- 家庭公网 IP、内网 IP、网络拓扑等私有信息。
- ESP32 等硬件设备的真实 MAC 地址、设备唯一标识及配对密钥。
- 生产环境服务器地址及设备接入凭据。

### 2.3 个人隐私和业务数据

- 宝宝的真实哭声录音、家庭成员录音及其他原始音频。
- 包含个人身份信息的图片、视频、日志和测试数据。
- 家庭住址、电话号码、个人账号等身份信息。
- 未经脱敏的设备运行日志、异常日志和数据导出文件。

### 2.4 其他敏感内容

- `.env`、本地配置文件和私有配置文件中的真实参数。
- 调试过程中复制的真实生产数据。
- 截图、文档、注释、示例代码中意外包含的真实凭据。
- 其他能够用于身份认证、设备控制或访问私人资源的信息。

## 3. 配置文件管理

必须将真实配置与项目代码分离。

1. 真实密钥和本地专属配置只能存放在本地，不得提交。
2. 可以提供 `.env.example`、`secrets.example.h` 等模板文件，但只能使用明显的占位符。
3. 示例配置不得包含真实服务器地址、真实设备 ID、真实账号或真实密钥。
4. 新增配置项时，必须同步检查 `.gitignore` 是否覆盖对应的本地配置文件。
5. 不得为了让其他开发者更方便运行项目，而直接把本地真实配置提交到仓库。

建议重点检查以下类型的文件：

- `.env`、`.env.local`、`.env.production`。
- `secrets.h`、`private_config.h`、`credentials.h`。
- `sdkconfig` 等包含本地设备或环境配置的文件。
- 私钥、证书、密钥库文件。
- 原始录音、私人测试数据和调试日志。

## 4. Git 提交前强制检查流程

每次执行 `git commit` 之前，必须按照以下顺序执行。

### 第一步：检查变更范围

检查：

- `git status`
- 已暂存文件列表。
- 新增、修改和删除的文件。
- 是否存在不应该提交的本地配置、日志、录音和测试数据。

不得未经检查就执行 `git add .` 或 `git add -A`。

优先使用明确的文件路径进行暂存，避免误将本地文件加入提交。

### 第二步：检查暂存区内容

必须检查完整的暂存区变更：

- 新增文件的完整内容。
- 修改文件的差异内容。
- 配置文件和测试文件。
- 文档、注释和示例代码。
- 文件名以及可能包含敏感信息的二进制文件。

不得只检查代码文件而忽略配置、文档和其他资源。

### 第三步：执行敏感信息扫描

在提交之前，必须使用项目已有的 Secret Scanner 检查待提交内容。

优先使用 Gitleaks 等专门的敏感信息扫描工具。

扫描范围至少应覆盖：

- 当前 Git 暂存区。
- 本次新增和修改的文件。
- 仓库中已经被 Git 跟踪的疑似敏感配置文件。

扫描结果出现疑似真实凭据时，不得直接忽略或自行认定安全。

如果扫描工具不可用，或者扫描未能完整执行，必须停止自动提交，并向用户说明检查未完成。

### 第四步：决定是否允许提交

只有同时满足以下条件才允许执行 `git commit`：

- 暂存区文件均经过检查。
- 不存在真实敏感信息。
- Secret Scanner 检查通过。
- 不存在未经授权的私人数据或设备信息。
- 本次提交范围与用户要求一致。

任何一项不满足，都必须阻止提交。

## 5. 发现敏感信息时的处理规则

一旦发现疑似敏感信息：

1. 立即停止提交和推送操作。
2. 不得在终端输出、聊天回复或日志中完整展示敏感信息。
3. 向用户报告文件路径、疑似问题类型及影响范围，但必须对敏感内容进行脱敏。
4. 优先使用占位符替换代码中的真实配置，并将真实配置迁移到本地忽略文件。
5. 必要时更新 `.gitignore`。
6. 如果敏感文件已经被 Git 跟踪，可以在确认不影响用户本地文件的前提下，从 Git 索引中移除，但不得擅自删除用户本地的真实配置。
7. 完成整改后，重新执行完整的提交前检查。

如果敏感信息已经进入 Git 历史或已经推送到远程仓库，不能仅通过删除当前文件就认定风险已经消除。必须提醒用户评估凭据轮换及 Git 历史清理。

不得擅自修改 Git 历史、强制推送或轮换用户的真实凭据。

## 6. Agent 的禁止行为

Agent 在任何情况下都不得：

- 为了方便调试而将真实密码、Token 或密钥写入项目代码。
- 将本地 `.env`、私有配置或真实录音加入 Git 暂存区。
- 将真实配置复制到示例文件、测试文件或 README。
- 因为 `.gitignore` 已经配置，就跳过实际提交内容检查。
- 因为扫描工具没有发现问题，就忽略明显可疑的敏感信息。
- 自动关闭、绕过或修改 Secret Scanner、Git Hooks 等安全机制。
- 在提交失败后通过 `--no-verify` 等方式绕过检查。
- 未经用户明确授权就执行 `git push`、强制推送或修改远程仓库设置。
- 将真实敏感信息发送给外部 API、在线代码分析服务或第三方工具。

## 7. 最终提交报告

每次自动提交完成后，必须向用户报告：

- 本次提交涉及的文件范围。
- 是否执行了敏感信息扫描。
- 扫描是否通过。
- 是否发现并处理了敏感信息。
- Git Commit Hash。

如果因安全检查未通过而阻止提交，必须明确说明阻止原因，不得将未完成的提交描述为成功。

## 8. 最终执行准则

**宁可停止提交，也不能冒险提交敏感信息。**

当安全检查存在任何不确定性时，停止自动提交，保留用户本地数据，并等待用户确认。


宝宝监护器（Baby Cry Monitor）：ESP32 通过 I2S 麦克风采集音频，用 Edge Impulse 训练的模型识别哭声；uni-app 移动端实时展示状态、音量与设备信息；Node.js 后端提供 REST API + WebSocket 推送。

## 目录结构

| 目录 | 说明 |
|------|------|
| `uniapp/` | 移动端 App（uni-app 3 + Vue 3 + TS，@uni-helper/unh 工具链） |
| `server/` | Node.js 后端（Express + ws，内置状态模拟器，ESM） |
| `arduino/baby_cry_detector/` | ESP32 固件（PlatformIO，主工程 + 多个独立子工程） |

## 常用命令

### uniapp（在 `uniapp/` 下执行）

```bash
pnpm run dev          # H5 开发服务器
pnpm run dev mp-weixin   # 微信小程序（unh 的 platform 是位置参数）
pnpm run dev app-plus    # App
pnpm run build        # 生产构建
pnpm run lint         # ESLint 检查
pnpm run lint:fix     # ESLint 自动修复
pnpm run type-check   # vue-tsc 类型检查
```

- **勿用旧写法 `pnpm run dev -- --platform mp-weixin`**：pnpm v11 会把 `--` 原样透传，unh 解析不到 platform，实际跑成 H5（2026-11-09 在 WSL 机踩坑验证）

#### 真机调试（HBuilderX CLI，Mac）

```bash
# 运行到 Android 真机：本地编译 → adb 覆盖安装自定义基座 → 推送程序文件 → 启动，
# 真机 console 日志实时回流到终端
/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android \
  --project <uniapp 绝对路径> --playground custom --customType local --deviceId <id>
```

- `deviceId` 用 `adb devices` 查询；HBuilderX 未启动时先执行 `cli open`
- 自定义基座一次性构建好即可复用，只在原生插件/权限变动时重做
- CLI 卡住不退出时：`pkill -f "cli launch app-android"` 后重跑（HBuilderX 主进程不用动）；调用时**不要接管道**（`| tail` 等会缓冲到进程结束才输出，看起来像卡死）
- 卡住分两种：日志还在流 = 只杀 CLI；**连编译都没起来（卡在「项目 xxx 开始编译」后无任何输出，ps 里也无编译子进程）= HBuilderX 任务队列已僵死，须连主进程一起重启**（`pkill -x HBuilderX` → `open -a HBuilderX` → `cli open` 后再推；2026-11-10 实测，重跑三次无效、重启后一次成功）
- **HBuilderX 空闲较久（约 10 分钟+）后的第一次 `cli launch` 容易僵死**（连「开始编译」都出不来）；重启 HBuilderX 后首推必成功，之后的连续快速推送也不僵。2026-11-10 样本：每次僵死都发生在空闲后首推，每次重启后立刻正常；曾误判为 H5 dev server 并发冲突（同时运行 H5 时确实也僵过，但停掉后仍僵，非根因）。**做法：距上次推送较久时，直接先重启 HBuilderX 再推，别浪费一轮 40 秒的僵死等待**

#### 小程序调试（Windows/WSL 机专用；Mac 原生路径无需这些步骤）

- 开发者工具**拒绝 UNC 路径**：把 dist 映射成本地符号链接后导入 GUI（一次即可）：
  `mklink /D D:\bc-mp \\wsl.localhost\Ubuntu\home\sheldon\projects\babycryMonitor\uniapp\dist\dev\mp-weixin`
- 之后全自动：改代码 → vite 重编译 → WSL dist 更新 → IDE 监听 `D:\bc-mp` 自动刷新模拟器
- mp-weixin 的 appid 是真实小程序 ID（`manifest.config.ts`），预览/真机调试可用；开发者工具需扫码登录
- **别依赖 `cli.bat`**：当前版本（2.02.2609250）CLI 有已知问题：服务端口开着却报「已关闭」、宣称可交互输入 y 确认但实际没有该交互、HTTP `/v2/open` 会把 IDE 搞崩；走 GUI 导入 + 文件监听最稳

### server（在 `server/` 下执行）

```bash
pnpm run dev          # node --watch 开发运行，默认端口 3001（.env 的 PORT 可覆盖）
pnpm start            # 生产运行
NO_SIMULATOR=true pnpm run dev   # 关闭内置模拟器
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
- 全局 SCSS 已通过 vite `additionalData` 注入（`styles/uni.scss`、`page-layout.scss`、`state.scss`、`list-item.scss`、`section.scss`），页面里直接使用其中的变量/类，不要重复 @use；按钮一律用共享组件 `components/AppButton.vue`（vite-plugin-components 已自动注册），不要在页面里手搓按钮样式
- **吸顶与状态栏避让**：顶栏吸顶直接用原子类 `.sticky-top`（sticky/top-0/z-100/不透明底）；状态栏避让 padding 必须写在**吸顶元素自身**（`padding-top: calc(var(--status-bar-height) + 呼吸间距)`），不要写在 `.page` 上——吸顶后 `.page` 的避让不跟着走，顶栏会钻进系统状态栏
- **状态栏高度一律用 `var(--status-bar-height)`**（uni-app 内置：App=真实高度、H5=0、微信小程序=25px）；**禁止用 `env(safe-area-inset-top)`** 做 Android 状态栏避让（App webview 里恒为 0，仅 iOS 刘海部分场景有值）；底部安全区仍用 `env(safe-area-inset-bottom)`
- **颜色单一真值源**：SCSS 用 `styles/uni.scss` 的 `$color-*` token；TS/模板侧（`getIcon` 第二参、行内 `:style`、图表配色）用 `constants/colors.ts` 的语义名（`colors.primary`、`getIcon('bell', 'primary')`），**禁止硬编码 hex**。`src/utils/icons.ts` 是生成文件——改 `getIcon` 逻辑要改 `scripts/gen-icons.mjs` 后重跑，不要直接手改生成产物
- **新增样式前先查现有抽象**：列表行 `@include list-row($gap)`（list-item.scss，含相邻行自动分割线）、空态 `@include empty-state` 系列（state.scss）、按钮 `AppButton`、原子类 utilities.scss——避免再造「定义了没人用」的死抽象
- **排障速查**（历史踩坑，按现象查）：
  - 元素渲染成 `<!---->` 且零报错 → 查其用到的导入是否在平台条件编译块内（eslint import 排序会穿越边界）
  - 入口页变成别的页面 → 看 `src/pages.json` 第一个 path；dev server 启动时 pages.json 必须存在
  - 全屏页底部贴边 / flex 卡片被撑破 → uni-h5 `view` 默认 content-box，容器加 `box-sizing: border-box` + `min-width: 0`
  - 设备连不上 server → 先核对设备与 server 主机是否同网段（本机多网卡/WiFi 漫游会换 IP），再查服务端与防火墙
- `styles/utilities.scss` 由 `App.vue` 全局引入，提供 Tailwind 风格原子类（布局/flex/间距/文字/颜色/圆角/定位等）：间距 1 单位 = 8rpx（`p-4` = 32rpx），颜色类直接映射 `uni.scss` 主题 token（`text-primary`、`bg-card`…）。写页面布局时优先用这套原子类，组件特有的复杂样式再走 scoped SCSS；新刻度加在文件内的 `$space-scale` 里。`.line-clamp-N` 会覆盖同元素上的 `display`，不要与 `.flex` 叠在同一节点。注意 scoped 样式（带 `[data-v]`，特异度更高）会压过同属性的全局原子类：同一属性不要既写在 scoped 又指望原子类生效；动态状态切换（如 `--active`）的颜色覆盖留在 scoped。`<text>` 在 H5 端渲染为 inline，垂直 margin 原子类（`mb-*`/`mt-*`）要同时加 `block` 才生效（flex 容器的子元素会被块化，无需加）。**禁止**在 flex 容器的子元素上加垂直 margin 类：items-center 按 margin-box 居中会造成错位，间距一律用容器 gap 或容器自身的 margin/padding
- 代码风格：`<script setup lang="ts">` + Composition API；ESLint 使用 @uni-helper/eslint-config，**强制分号**（`semi: true`），`console` 仅 warn
- **包管理器统一用 pnpm**（两台开发机都是）：锁文件只有 `pnpm-lock.yaml`（package-lock.json 已删除），两个子项目的 `preinstall` 有 `only-allow pnpm` 守卫，误用 `npm install` 会直接报错；Windows 开发机装 pnpm：`npm install -g pnpm`（或 `iwr https://get.pnpm.io/install.ps1 -useb | iex`）。uniapp 的 pnpm 配置在 `pnpm-workspace.yaml`（allowBuilds 放行 esbuild/ttf2woff2/vue-demi 的安装脚本，trustPolicy 误报豁免见文件内注释）
- 提交前跑 `pnpm run lint` 和 `pnpm run type-check`
- 蓝牙相关常量在 `src/constants/ble.ts`，BLE 逻辑集中在 `src/hooks/useBLE.ts`

### arduino

- PlatformIO 配置在**仓库根** `platformio.ini`（不在 arduino/ 目录），`src_dir` 指向 `arduino/baby_cry_detector/`
- **代码使用旧版 I2S 驱动 `driver/i2s.h`，必须用 arduino-esp32 2.0.x（platform espressif32@6.x）**；升级到 3.x 需整体迁移到 `ESP_I2S.h`，不要随手升级 platform
- 每个子目录（`audio_app/`、`audio_streamer/`、`i2s_recorder/`、`waveform_viewer/` 等）是独立子工程，各有自己的 setup/loop；通过各 `[env:*]` 的 `build_src_filter` 只编译该工程的文件 —— **给某环境新增源文件时，必须同步更新 platformio.ini 的 src_filter**
- **PlatformIO 不会把 `build_src_filter` 里的 `.ino` 当源文件编译**（可编译扩展只有 c/cpp/cc/cxx/c++/S/asm）：`src_dir` 根目录的 `.ino` 会先被转成临时的 `.ino.cpp` 再编译，所以过滤要用 `+<xxx.ino*>` 匹配转换后的文件名；子目录里的 `.ino` 永不转换，子工程若要编译须在环境里把 `src_dir` 指到该子目录（参考 `[env:audio_app]`）
- 依赖 Edge Impulse 推理库 `babyCry_inferencing`，`lib_extra_dirs` 同时列出两台开发机的库目录（Windows 开发机 `D:/ArduinoProject/libraries`、Mac `/Users/sheldon/Documents/Arduino/libraries`），不存在的目录会被自动跳过
- Mac 上 `pio` 未进 PATH，用 `~/.platformio/penv/bin/pio`（VS Code PlatformIO 扩展自带）
- BLE + WiFi + EI 模型体积大，使用 `huge_app.csv` 分区（3MB App，无 OTA）
- 主固件 `baby_cry_detector` 的编译组成：`baby_cry_detector.ino` + `ble_provision.*` + `wifi_connect.*` + `led.*` + `config.h`

### 其他

- `.pio/`、`uniapp/dist/`、`uniapp/unpackage/`、`node_modules/` 均为构建产物，已在 .gitignore，不要提交
- `README.md` 的目录结构和 TODO 可能落后于代码（例如 pages 下已有 `pairing`、`ble-test` 等），**以代码为准**
