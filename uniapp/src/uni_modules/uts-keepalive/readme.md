# uts-keepalive

宝宝监护器 Android 前台服务保活插件（UTS）。解决「App 被系统杀掉导致哭声推送收不到」的主因：锁屏/切后台时由前台服务保住进程与 JS 运行时，WebSocket 与本地哭声通知持续工作。

## 能力

- `start()`：启动前台服务（幂等）。IMPORTANCE_MIN 常驻通知「宝宝监护器运行中」+ `PARTIAL_WAKE_LOCK` + `START_STICKY`
- `stop()`：停止服务并释放 WakeLock
- `isRunning()`：服务运行标记（服务被系统强杀后不会自动回落）

## 集成要点

- **仅限 `#ifdef APP-PLUS` 条件编译内导入**（H5/小程序构建产物不得包含），统一走 `src/utils/keepalive.ts` 封装，业务代码不要直接 import 本插件
- 改动本插件（含 AndroidManifest.xml）后需**重打自定义基座**才生效
- service 声明在插件内置 `utssdk/app-android/AndroidManifest.xml`，云打包时自动合并；类名遵循 uni_modules 插件 ID 转驼峰规则（`uts-keepalive` → `uts.sdk.modules.utsKeepalive.KeepAliveService`）

## 已知边界

- 「划掉最近任务」在部分 ROM 上会连同前台服务一起杀——此场景由 server 端 ntfy 兜底推送覆盖
- `START_STICKY` 重建服务后 JS 运行时不会自动恢复，用户点常驻通知回到 App 时重新拉起
- iOS 无前台服务概念（app-ios 为空桩），被挂起后同样依赖 server 端系统级推送
- manifest 权限：插件内置声明 `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_DATA_SYNC` / `WAKE_LOCK`，电池优化白名单申请在 JS 层（`src/utils/keepalive.ts`），需要应用 manifest 的 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
