# 交接：后台保活 + ntfy 兜底推送（哭声提醒「被杀收不到」修复）

2026-11-19 实现。解决「App 装在手机上有很大概率被系统杀掉，哭声提醒收不到」。

## 1. 根因

旧链路：ESP32 → server detector → WS 广播 → **App 进程内** `useBabyMonitor` 收 `statusChange` → `maybeNotifyCry()` → `uni.createPushMessage` 本地通知（`uniapp/src/utils/notify.ts`）。整条链依赖 App 进程存活 + WS 连接；国产 ROM（锁屏省电/一键清理/划卡片）杀进程后链路全断，5s 轮询兜底同样死在进程里。

修复 = 双管齐下（用户已确认方案）：

1. **App 内前台服务保活**（主修复）：锁屏/切后台时保住进程与 JS 运行时，WS 与本地通知持续工作；
2. **server 端 ntfy 兜底推送**：App 被杀也能收到系统通知（ntfy App 独立存活，不依赖本 App）。

不走 uni-push：厂商通道（华为/OV/荣耀）要企业资质，个人侧载 App 拿不到；个推通道在激进 ROM 上同样被连锅端。

## 2. 已实现

### server 侧

| 文件 | 内容 |
|---|---|
| `server/src/services/notify.js`（新） | ntfy HTTP 推送：crying 时 POST `{topic,title,message,tags,priority}`；60s 节流防状态抖动重复；不 await 不拖慢 WS 广播；失败只 log；日志不回显 topic/token |
| `server/src/ws/handler.js` | ① `detector.on('statusChange')` 挂点：`to === 'crying'` → `pushCry()`；② 30s `isAlive` ping/pong 死连接清扫（doze/NAT 半开连接不发 FIN，主动 terminate 让 App 侧重连逻辑尽快触发；ESP32 固件 server_link.cpp 已手写 ping→pong 回执，不会被误杀） |
| `server/src/index.js` | 启动时打印 ntfy 配置状态（`logNotifyConfig()`） |
| `server/.env.example`（新） | 占位模板；真实值在本地 `.env` |

已验证（Windows 本机）：notify.js 单测（投递+节流+报文）通过；WS e2e（真实 server + 模拟 ESP32 rms=500 喂 detector → app 客户端收 crying 广播 + ntfy POST 到 mock sink）通过。

### uniapp 侧

| 文件 | 内容 |
|---|---|
| `src/uni_modules/uts-keepalive/`（新） | UTS 插件：Android 前台服务（IMPORTANCE_MIN 常驻通知 + PARTIAL_WAKE_LOCK + START_STICKY）、插件内置 AndroidManifest.xml（service + FOREGROUND_SERVICE 系权限）、app-ios 空桩 |
| `src/types/uts-keepalive.d.ts`（新） | vue-tsc 用 TS 声明（照 bin-bluetooth.d.ts 模式） |
| `src/utils/keepalive.ts`（新） | 业务封装：插件启停转发、电池优化白名单查询/申请、厂商自启动页跳转（MIUI/华为/荣耀/OV/vivo 组件表 + 应用详情页兜底）、`moveTaskToBack`、Android-only 判定 |
| `src/utils/monitorSettings.ts` | +`keepAlive` 字段，默认 true |
| `src/pages/settings/index.vue` | 新「后台保活」分区（开关/白名单状态行/自启动引导），仅 Android 显示 |
| `src/pages/home/index.vue` | `onBackPress` 拦截：保活开启时返回键 = `moveTaskToBack`（否则 Activity 销毁 → webview/JS 死，前台服务也保不住 WS） |
| `src/App.vue` | `onLaunch`：keepAlive 开 + 已配对 → 自动启动前台服务 |
| `src/hooks/useBabyMonitor.ts` | WS 25s 应用层心跳 ping（server 已有 pong 回执），与 server 端 30s 清扫互补 |
| `manifest.config.ts` | +FOREGROUND_SERVICE / FOREGROUND_SERVICE_DATA_SYNC / REQUEST_IGNORE_BATTERY_OPTIMIZATIONS |

已验证：`pnpm run lint` / `type-check` / H5 `build` 全过（UTS 插件导入全部包在 APP-PLUS 条件编译内，H5 构建不受影响）。

### .env 合规整改（随本次一起做）

`.gitignore` 此前无 .env 条目，`server/.env`、`uniapp/.env.*` 四个文件都被 git 跟踪（含真实内网 IP，违反 AGENTS.md）。已 `git rm --cached`（本地文件保留）+ gitignore 加 `.env` / `.env.*`（排除 `.example`）+ 四份占位模板。**git 历史中仍有旧内容**（仅 PORT/CORS/内网 IP，无凭据），是否清史由用户自行评估。

## 3. 上线前必须做（人工步骤）

1. **重打自定义基座**：uts-keepalive 是 UTS 插件，改动必须重打基座才生效（Mac HBuilderX 既有流程）。首推前按 AGENTS.md 的经验：先重启 HBuilderX。
2. **server `.env` 填真实配置**（勿提交）：
   ```
   NTFY_ENABLED=true
   NTFY_URL=https://ntfy.sh
   NTFY_TOPIC=<足够长的随机串>     # 公共 ntfy.sh 上主题名等同密码
   NTFY_TOKEN=                    # 自托管+开启鉴权时才需要
   ```
3. **家人手机装 ntfy App**（GitHub release / F-Droid / Play）订阅同一 topic；ntfy App 自己也开电池白名单。iOS 用 ntfy iOS App（APNs 通道）或 Bark。
4. **本 App 内授予**：设置页「后台保活」→ 电池优化白名单弹窗点允许 + 「允许自启动」跳转设置。

## 4. 真机验证清单

1. 通知栏出现「宝宝监护器运行中」常驻通知（低优先级，不响铃）；
2. 锁屏 30 分钟后模拟哭声（server 模拟器或真 ESP32）→ **本地通知到**（前台服务保活生效）；
3. 划掉最近任务卡杀进程 → **ntfy 通知到**（兜底链路生效）；
4. 设置页关闭「后台保活」→ 常驻通知消失，锁屏后哭声提醒大概率丢失（ntfy 兜底仍在）。

## 5. 已知边界与 UTS 排障速查

- **START_STICKY 重建进程后 JS 运行时不会自动恢复**：常驻通知回来了但 WS 是死的，用户点通知回 App 后 onLaunch 重新拉起全链路。不做后台自动拉起 Activity（Android 10+ 限制 + 体验差）。
- **划掉最近任务**：部分 ROM 连前台服务一起杀——这正是 ntfy 兜底存在的意义。
- **自启动组件名随 ROM 版本漂移**：跳转失败自动降级应用详情页，设置页文案已引导手动路径。
- **iOS 完全不适用**：无前台服务概念，挂起/被杀后同样依赖 server 系统级推送（本期 ntfy 兜底已覆盖；将来若要「来自本 App 的 iOS 通知」再上 uni-push APNs）。
- UTS 插件编译（Mac HBuilderX 首次构建基座时如报错）：
  - service 类名命名空间按 uni_modules 插件 ID 转驼峰：`uts-keepalive` → `uts.sdk.modules.utsKeepalive.KeepAliveService`（AndroidManifest.xml 里已按此写）；
  - `WakeLock` 嵌套类 import 写的是 `android.os.PowerManager.WakeLock`，若报错改二进制名 `android.os.PowerManager$WakeLock`（index.uts 内有注释标注）；
  - `onStartCommand` 覆写参数/返回值必须用 `Int` 不能用 `number`（DCloud 文档明确要求）。
- plus.android 桥可靠性结论（本次沿用 saveWav.ts 的 2026-11-17 真机结论）：类名 importClass + new 的对象方法齐全；桥接返回实例的方法调用一律 try/catch，失败按「已豁免/已跳转失败」降级，不阻塞 UI。

## 6. 与家庭共享交接的关系

《交接-家庭共享.md》§7 将「服务端推送通道」列为本期不做——本工作是其前身落地：ntfy 兜底已实现 server 主动推送，但仍是「全客户端同一主题」广播（无按成员定向）；按成员定向推送（推送目标注册表，照 familyStore JSON 持久化模式）留待推送通道正式立项。
