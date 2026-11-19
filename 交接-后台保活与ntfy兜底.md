# 交接：后台保活 + ntfy 兜底推送（哭声提醒「被杀收不到」修复）

2026-11-19 实现。解决「App 装在手机上有很大概率被系统杀掉，哭声提醒收不到」。

> **第二轮（同日，评审跟进）**：`report.md` 评审指出 P0——「推理随观众在线启停」是存量设计，
> 但 ntfy 让误报第一次真的能推到手机（App 全灭后设备退化为纯 RMS 阈值判哭）。已修：
> **推理常开** + **失联看门狗** + 白名单 fail-safe，见 §7。

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
3. **家人手机装 ntfy App**（GitHub release / F-Droid / Play）订阅同一 topic；ntfy App 自己也开电池白名单。本期只发 Android，家人同用 Android 即可（若日后有 iOS 家人，装 ntfy iOS App 走 APNs 通道或 Bark，与本 App 是否上 iOS 无关）。
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
- **iOS 本期不打包**（2026-11-19 决策）：Apple Developer 账号 + 证书/描述文件维护成本高于收益，`manifest.config.ts` 的 `ios.appid` 已置空。代码仍保持跨平台兼容（uni.xxx API + 条件编译），将来要上 iOS 时回填 appid 与证书即可，业务代码不用动。即便日后上 iOS，前台服务保活也**完全不适用**（无此概念），挂起/被杀后同样只能依赖 server 系统级推送。
- UTS 插件编译（Mac HBuilderX 首次构建基座时如报错）：
  - service 类名命名空间按 uni_modules 插件 ID 转驼峰：`uts-keepalive` → `uts.sdk.modules.utsKeepalive.KeepAliveService`（AndroidManifest.xml 里已按此写）；
  - `WakeLock` 嵌套类 import 写的是 `android.os.PowerManager.WakeLock`，若报错改二进制名 `android.os.PowerManager$WakeLock`（index.uts 内有注释标注）；
  - `onStartCommand` 覆写参数/返回值必须用 `Int` 不能用 `number`（DCloud 文档明确要求）。
- plus.android 桥可靠性结论（本次沿用 saveWav.ts 的 2026-11-17 真机结论）：类名 importClass + new 的对象方法齐全；桥接返回实例的方法调用一律 try/catch，失败按「已豁免/已跳转失败」降级，不阻塞 UI。

## 6. 与家庭共享交接的关系

《交接-家庭共享.md》§7 将「服务端推送通道」列为本期不做——本工作是其前身落地：ntfy 兜底已实现 server 主动推送，但仍是「全客户端同一主题」广播（无按成员定向）；按成员定向推送（推送目标注册表，照 familyStore JSON 持久化模式）留待推送通道正式立项。

## 7. 第二轮：推理常开 + 失联看门狗（评审 P0 修复，2026-11-19）

`report.md` 评审（§四 P0/P1/P2）指出：保活修好了「通知送不出去」，但没修「没有通知可送」——
推理随最后一个 App 断开被 `listen_off` 关掉，设备退化到纯 RMS 阈值判哭（RMS≥200，空调外机/洗衣机
都触发），而 ntfy 会把这些误报真的推到手机。三个修复已落地：

### 7.1 推理常开（固件 + server + App）

| 层 | 改动 |
|---|---|
| 固件 `baby_cry_detector.ino` | `setup()` 在 `audioPipelineStart()` 后调 `startListening()`；失败（内存不足）由 loop 30s 重试；`onServerCmd` 对 listen_on/off 只打日志置空（保留协议，等「远程听声」立项赋新义）；`stopListening()` 删除 |
| server `handler.js` | 删两处自动指令：设备重连补发 `listen_on`、末位 App 断开发 `listen_off`；`listenWanters` 引用计数保留（将来远程听声的注册表），监听状态一律以设备 listenState 回执为准 |
| App `home/index.vue` | 监听按钮改只读展示「监护中/监护启动中」（tap 只出提示，不下发指令）；音量卡的「正在通过手机扬声器播放宝宝的声音」改为真实文案——播放路由本就没落地，常开后恒显示构成误导 |

⚠️ 真机验证点：推理常开的内存可持续性。`inferStart` 是 32KB `malloc` 采样 buffer + EI tensor
arena，全走内部堆（未用 PSRAM）。固件本有 30s 一次的 `[Heap] min` 巡检日志——烧录后跑数小时，
min free heap 不持续下降即通过；持续下降再考虑迁 PSRAM 或 arena 优化。

### 7.2 失联看门狗（notify.js + handler.js）

- `to === OFFLINE` 开确认窗口（`NTFY_OFFLINE_CONFIRM_MS`，默认 60s）：窗口结束**仍离线才推**
  「监护器失联」，期间恢复静默取消——detector 15s 无数据即转 offline，WiFi 瞬断很常见，直接推会误报；
- 恢复（`from === OFFLINE`）时取消未确认看门狗；仅当失联推送真发过才补发「监护已恢复」，瞬断不打扰。

### 7.3 白名单 fail-safe（keepalive.ts）

`isIgnoringBatteryOptimizations` 查询失败由「按已豁免」改为**按未豁免**返回（评审 P2-1）：
监护场景下假「已豁免」比多一次引导更危险；重复申请无害（已豁免时系统弹窗直接返回）。

### 7.4 第二轮验证状态

| 项 | 状态 |
|---|---|
| uniapp lint / type-check | ✅ |
| 固件 `pio run` 编译 | ✅（真机烧录与内存观测 ⏳ 未做） |
| server e2e 5 项 | ✅ 哭声推送回归 / 失联确认推送 / 恢复推送 / 瞬断抑制 / App 断开不下发 listen_off |
| episode 聚合（评审 P1-1，按「段」推送防刷屏） | ⏳ 未做，依赖推理常开已就位，下轮可加 |
| APK targetSdkVersion 核实（评审 P1-2，Android 15 dataSync 6h 限制） | ⏳ 打包后核实，超限则换 specialUse 类型 |

## 8. 第三轮：幽灵通知 / 前台服务类型 / 开机自启 / 白名单引导（2026-11-19）

上一轮评审留下的 P2 与两个新发现的硬伤一并处理。核心认知：**保活真正危险的失败模式不是
「被杀」，而是「假活」**——服务还在、通知还写着「后台监护已开启」，实际 WS 已断、哭声通知
永远不会发。监护场景下用户看到通知会安心睡觉，这比明确失败危害大得多。

### 8.1 幽灵通知：活性心跳（P0）

| 层 | 改动 |
|---|---|
| 插件 `index.uts` | 新增 `heartbeat()`；`KeepAliveService` 实现 `Runnable`，主线程 `Handler` 每 30s 检查一次 JS 心跳时间戳，超过 90s 无心跳（`BEAT_TIMEOUT_MS`）就把常驻通知改写为「监护已中断 / 与设备失联或 App 被系统回收，点开恢复监护」 |
| 心跳载体 | `SharedPreferences('baby_keepalive')`：进程被 `START_STICKY` 重建后服务仍能读到上一份心跳，判断依据不依赖内存态 |
| `utils/keepalive.ts` | 新增 `pingKeepAlive()` 封装（APP-PLUS 条件编译内，失败只 warn） |
| `hooks/useBabyMonitor.ts` | 复用既有 25s WS 心跳定时器顺带上报，不额外开 interval；`startPing()` 首次连接即打一次 |

选择「服务主动检查」而非「JS 定时写 — 服务定时读」两套定时器，是因为服务侧必须有独立
判断能力：JS 进程已被回收时，任何 JS 侧的定时器都不存在了。

### 8.2 前台服务类型：`dataSync` → `connectedDevice`（P1，评审 P1-2 闭环）

`dataSync` 有两个致命属性：

1. **Android 15 起 24 小时内累计 6 小时上限**，到点回调 `Service.onTimeout()`，不 `stopSelf()`
   就抛 `RemoteServiceException` 崩溃。本服务设计为常驻不退出，targetSdk 升到 35 后会每天崩一次。
2. **Android 15 起禁止从 `BOOT_COMPLETED` 启动 `dataSync` 类型前台服务**，直接抛
   `ForegroundServiceStartNotAllowedException`——开机自启根本做不成。

`connectedDevice` 无时长限制、不在 BOOT 受限名单，语义也更贴切（与局域网内的监护设备保持连接）。
前置条件 `CHANGE_NETWORK_STATE` / `CHANGE_WIFI_STATE` 应用 manifest 早已声明。

> 当前仓库里的 APK 仍是 `targetSdkVersion=28`（`aapt2 dump badging` 实测），所以上述两项限制
> 尚未生效；本次改类型是**为将来升 targetSdk 预留通路**，不是修现存 bug。

### 8.3 开机自启（P2）

- `BootReceiver`：收 `BOOT_COMPLETED` / `LOCKED_BOOT_COMPLETED` / `MY_PACKAGE_REPLACED`；
- `RECEIVE_BOOT_COMPLETED` 权限（插件 manifest 与应用 manifest 双声明）；
- **受 SharedPreferences 门控**：`start()` 写 `enabled=true`，`stop()` 写 `false`——用户手动关掉
  后台保活后，重启不该把服务又拉起来；
- **只拉起服务，不试图拉起 JS**（Android 10+ 限制后台启动 Activity，且体验极差）。JS 起不来时
  心跳早已过期，通知会如实显示「监护已中断」，点击通知回到 App 才恢复全链路。

### 8.4 电池白名单首次自动引导 + 常驻服务状态展示

- `hooks/useBatteryWhitelistPrompt.ts`（新）：首页 `onShow` 时，若「Android + 已配对 + 保活开着 +
  未豁免 + 本次安装没提示过」则弹一次引导。**点「暂不」也记为已提示**（`CACHE_KEY.BATTERY_PROMPT_DONE`），
  监护 App 反复弹系统级授权会招人烦，设置页入口一直都在。
- 设置页「后台保活」分区新增**常驻服务状态**行（运行中 / 未运行），顺带把此前无人调用的
  `isKeepAliveRunning()` 死抽象接上；文案明确写了「被系统清理后显示未运行，点开应用会自动恢复」。
- 分区底部补一行脚注说明重启后服务自动恢复、但连接需点开应用重建。

### 8.5 四个 tab 页统一返回键拦截

`onBackPress` 此前只有首页挂，其他三个 tab（历史/统计/设置）按返回会 finish 主 Activity →
webview/JS 死亡 → 前台服务还在、通知还在的幽灵态。抽成 `hooks/useBackToBackground.ts`，
首页 + history/stats/settings 四处统一调用。非 tab 页（配对/详情等）不挂：那里的返回是页面栈
语义，不该劫持。

### 8.6 本轮验证（重要：UTS 首次真正过编译）

上一轮的 `uts-keepalive` **从未被编译过**——`dist/cache/` 下只有 `bin-bluetooth` 的 Kotlin 产物，
没有本插件的。本轮补上了完整验证链：

| 步骤 | 工具 | 结果 |
|---|---|---|
| UTS → Kotlin 转译 | HBuilderX 自带 `@dcloudio/uts` 的 `toKotlin()` | ✅ 产出 `index.kt`（8.2KB） |
| Kotlin → class 编译 | HBuilderX 自带 `kotlinc` + `android-35/android.jar` + `uts-runtime-release.jar` | ✅ exit 0，产出 `KeepAliveService.class` / `BootReceiver.class` |
| 类名与 manifest 一致性 | 比对 class 路径 | ✅ 均为 `uts/sdk/modules/utsKeepalive/*` |
| uniapp lint / type-check | `pnpm run lint` / `type-check` | ✅ |
| H5 build（确认插件未混入产物） | `pnpm run build` + grep | ✅ 产物中无 `uts-keepalive`/`KeepAliveService` |

> 复现方式：`toKotlin()` 的 options 必须是 `{ input: {...}, output: {...} }` 两层嵌套，
> 且 `output.imports` 要补 `DEFAULT_IMPORTS`（`io.dcloud.uts.*` 等，见 `uni-uts-v1/dist/kotlin.js:340`），
> 否则生成代码缺 import、`console` 与 `UTSAndroid` 全部无法解析。

### 8.7 仍未做的（真机验证，需重打基座）

| 项 | 状态 |
|---|---|
| **重打自定义基座**（插件改动必做，现有 APK 里没有保活代码） | ⏳ 未做 |
| 断网/杀 JS 后通知是否真的变「监护已中断」（90s 内） | ⏳ 需真机 |
| 重启手机后服务是否自动恢复 + 通知是否如实显示中断态 | ⏳ 需真机 |
| 白名单引导弹窗只在首次出现 | ⏳ 需真机 |
| 四个 tab 按返回均退后台不退出 | ⏳ 需真机 |
| `server/.env` 的 `NTFY_ENABLED` 仍缺失（兜底推送实际未开） | ⚠️ 待用户配置 |

### 8.8 iOS 打包下线（2026-11-19 决策）

**决定：本期不打包 iOS。**

- `uniapp/manifest.config.ts` 的 `distribute.ios.appid` 置空（原 `com.sheldon.babycry` 已移除）
- 理由：Apple Developer 账号年费 + 证书/描述文件维护，对当前使用场景（家人内部用）成本高于收益；
  且 iOS 侧本就无法实现前台服务保活，功能上天然残缺
- **代码层面不降级**：仍保持跨平台兼容（`uni.xxx` API + 条件编译，见 AGENTS.md「约定与注意事项」），
  将来要上 iOS 时回填 `appid` + 证书即可，业务代码不需要改
- `uts-keepalive` 的 `app-ios` 空桩保留（占位，不影响 Android 构建）
- README 平台表述同步改为「App Android·鸿蒙」

### 8.9 编译过程中发现的两个致命 bug（2026-11-19 实机编译暴露）

本轮真机编译把两个「静态检查发现不了、重打基座才会炸」的问题暴露了出来，都已修复。

#### bug 1：UTS tree-shaking 把 service/receiver 类整个删掉（必崩）

**现象**：`cli launch app-android` 编译成功、无报错，但产物 `dist/cache/uts_custom_android/.../uts-keepalive/index.kt`
只有 **2966 字节**，`index.jar` 里只有 `IndexKt.class`。`KeepAliveService` 与 `BootReceiver`
**两个类完全不存在**，只在 `setClassName(...)` 里剩下字符串字面量。

**后果**：若直接重打基座，manifest 指向的类不存在 → `startForegroundService()` 抛
`ClassNotFoundException`，保活功能整个不可用，且编译期毫无提示。

**根因**：HBuilderX 真实构建走的是 `bundleKotlin()`（native binding），它对「未被导出代码实际引用」
的 class 做 tree-shaking。两个类只被 manifest 和字符串字面量引用，Java/Kotlin 侧没有任何强引用，
于是被判定为死代码删除。本地用 `toKotlin()` 验证时**不会**触发（该路径保留全部类），
这正是此前「本地编译通过」骗过验证的原因——**教训：验证必须用 `bundleKotlin` 而非 `toKotlin`**。

**修复**：`index.uts` 的 `start()` 里加两行真实引用，让类进入依赖图：

```uts
const serviceClass = KeepAliveService().javaClass;
const bootReceiverClass = BootReceiver().javaClass;
```

修复后产物 `index.kt` 9655 字节、`index.jar` 含三个 class
（`KeepAliveService` / `BootReceiver` / `IndexKt`），`classes.dex` 同步三个类。

#### bug 2：`isIgnoringBatteryOptimizations` 真机必抛 TypeError

**现象**（真机日志）：

```
[keepalive] 电池优化状态查询失败（按未豁免处理）:,
TypeError: powerManager.isIgnoringBatteryOptimizations is not a function  at utils/keepalive.ts:215
```

**根因**：`getSystemService('power')` 返回的是**安卓服务实例**，不是可 `new` 的类包装。对它
`importClass` 只会返回原对象、**不挂方法表**，所以直接 `.isIgnoringBatteryOptimizations()` 必然报错。
这正是 `keepalive.ts` 头注释里记录过、但此前没被踩到的 plus.android 桥限制。

**后果**：`isIgnoringBatteryOptimizations()` 恒返回 `false` → 设置页的「电池优化白名单」
**永远显示「未豁免」**，用户点进去却被告知已豁免/或无弹窗，白名单引导形同虚设——
而白名单恰恰是后台存活率的最大杠杆。

**修复**：改用 plus 桥的 `invoke`：

```ts
const powerManager = main.getSystemService('power');
const ignored = bridge.invoke(powerManager, 'isIgnoringBatteryOptimizations', main.getPackageName());
```

同时在 `AndroidBridge` 接口补 `invoke` 声明。

#### 本轮编译验证结论

| 项 | 结果 |
|---|---|
| `cli launch app-android`（真机自定义基座推送） | ✅ 编译成功、wjs 同步、App 启动 |
| `cli compile app-android --uni_module uts-keepalive`（官方编译入口） | ✅ 无报错 |
| 产物类完整性（jar + dex） | ✅ `KeepAliveService` / `BootReceiver` / `IndexKt` 三件齐全 |
| 本地 `kotlinc` 全量编译（含 UTS 源映射插件） | ✅ exit 0，三 class |
| uniapp lint / type-check | ✅ |

#### ⚠️ 仍待人工执行：重打自定义基座

`cli launch` 输出 `手机端自定义基座"uniapp"已是最新版本…跳过更新`，实测手机上的基座
`lastUpdateTime=2026-11-18 09:05`、MD5 与 `dist/debug/android_debug.apk`（2026-11-05 构建）**完全一致**，
`aapt2` 检查其中 `KeepAliveService`/`BootReceiver`/`RECEIVE_BOOT_COMPLETED`/`connectedDevice` **全部为 0**。

即：**当前手机上跑的仍是没有任何保活代码的旧基座**。UTS 插件属 Kotlin 层，靠 wgt 热更新推不进去，
必须在 HBuilderX 菜单 **发行 → 制作自定义调试基座** 重新打包（CLI 无此命令，仅能 `base info` 查询），
打包完成后 `cli launch` 才会真正覆盖安装。这一步无法由自动化代替。
