# uts-keepalive

宝宝监护器 Android 前台服务保活插件（UTS）。解决「App 被系统杀掉导致哭声推送收不到」的主因：锁屏/切后台时由前台服务保住进程与 JS 运行时，WebSocket 与本地哭声通知持续工作。

## 能力

- `start()`：启动前台服务（幂等）。IMPORTANCE_MIN 常驻通知「宝宝监护器运行中」+ `PARTIAL_WAKE_LOCK` + `START_STICKY`，同时写入「用户想要常驻」标记供开机自启判断
- `stop()`：停止服务并释放 WakeLock（同时关掉开机自启门控）
- `heartbeat()`：JS 活性上报。**停止上报超过 90s，常驻通知会自行改写为「监护已中断」**——防「服务还在、通知还在、实际没在监护」的假象
- `isRunning()`：服务运行标记（服务被系统强杀后不会自动回落）

## 集成要点

- **仅限 `#ifdef APP-PLUS` 条件编译内导入**（H5/小程序构建产物不得包含），统一走 `src/utils/keepalive.ts` 封装，业务代码不要直接 import 本插件
- 改动本插件（含 AndroidManifest.xml）后需**重打自定义基座**才生效
- service/receiver 声明在插件内置 `utssdk/app-android/AndroidManifest.xml`，云打包时自动合并；类名遵循 uni_modules 插件 ID 转驼峰规则（`uts-keepalive` → `uts.sdk.modules.utsKeepalive.*`）
- `heartbeat()` 由 `useBabyMonitor` 复用其 25s WS 心跳定时器调用，不要另开一个 interval

## 前台服务类型为什么是 connectedDevice

不是 `dataSync`（虽然最初是这么写的）：

- `dataSync` 受 **Android 15 起 24 小时内累计 6 小时上限**，到点回调 `Service.onTimeout()`，不 `stopSelf()` 就崩溃；本服务是常驻不退出的，targetSdk 升到 35 后会每天崩一次
- `dataSync` **禁止从 `BOOT_COMPLETED` 启动**（Android 15 起），开机自启会直接抛 `ForegroundServiceStartNotAllowedException`
- `connectedDevice` 无时长限制、不在 BOOT 受限名单，语义也更贴切（与局域网内的监护设备保持连接）。前置条件 `CHANGE_NETWORK_STATE` / `CHANGE_WIFI_STATE` 由应用 manifest 声明

## 已知边界

- 「划掉最近任务」在部分 ROM 上会连同前台服务一起杀——此场景由 server 端 ntfy 兜底推送覆盖
- `START_STICKY` 重建服务后 JS 运行时不会自动恢复。此时心跳早已过期，通知会如实显示「监护已中断」，用户点常驻通知回到 App 时重新拉起全链路
- **开机自启只拉起服务，不拉起 JS**（Android 10+ 限制后台启动 Activity，体验也差）：重启后通知同样显示「监护已中断」，需点开应用才恢复连接
- 用户手动「强行停止」应用后，服务与广播全被禁，直到用户再次手动启动——平台行为，无法对抗
- Doze 下系统会**忽略 WakeLock** 并限制网络，真正的杠杆是电池优化白名单
- iOS 无前台服务概念（app-ios 为空桩），被挂起后同样依赖 server 端系统级推送
- manifest 权限：插件内置声明 `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_CONNECTED_DEVICE` / `WAKE_LOCK` / `RECEIVE_BOOT_COMPLETED`，电池优化白名单申请在 JS 层（`src/utils/keepalive.ts`），需要应用 manifest 的 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`

## 编译验证（改本插件后建议先本地跑一遍）

`uts-keepalive` 在真机/基座构建前不会自动编译，改错了要等重打基座才发现。本地验证链（2026-11-19 实测通过）：

1. 用 HBuilderX 自带 `@dcloudio/uts` 的 `toKotlin()` 转译成 Kotlin。
   options 必须是 `{ input: {...}, output: {...} }` 两层嵌套，且 `output.imports` 要补
   `DEFAULT_IMPORTS`（`io.dcloud.uts.*` 等，见 `uni-uts-v1/dist/kotlin.js:340`）。
2. 用 HBuilderX 自带 `kotlinc` + Android SDK `android.jar` + `uts-runtime-release.jar`
   + `kotlinx-coroutines-core-jvm.jar` 编译，确认 exit 0 且产出
   `uts/sdk/modules/utsKeepalive/{KeepAliveService,BootReceiver}.class`（类名须与 manifest 一致）。
