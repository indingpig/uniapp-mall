# 报告：哭声提醒「送出家门」链路的方案评估

> 评估对象：工作区两次提交（`d9a12b0` 配置脱钩、`1be24f3` 后台保活 + ntfy 兜底推送）
> 评估时间：2026-11-19
> 评估视角：项目初衷 = **人不在宝宝身边时，也能及时知道孩子在哭**

---

## 一、结论摘要

| 维度 | 评价 |
|---|---|
| 架构方向 | ✅ 正确。App 保活 + server 兜底推送的双层结构是手机上唯一可行的形态 |
| 工程实现 | ✅ 高于预期。UTS 前台服务、心跳双向兜底、错误降级都处理得细致 |
| 是否闭环 | ❌ **未闭环**。存在一处结构性缺口，会让方案在「真正出门」时失效 |
| 可否验收 | ❌ 暂不可。commit message 中的「通过」仅覆盖 server 侧代码路径 |

**一句话**：这次改动修好了「通知送不出去」，但没修「没有通知可送」。

---

## 二、背景：为什么会有这次改动

最初的问题链条是：

```
ESP32 识别哭声 → server 判定 → App 收到 → App 弹本地通知
                                    ↑
                          断点：App 被系统杀掉后整条链归零
```

`uni.createPushMessage` 是**本地通知**，不发远程推送。国产 Android ROM 锁屏省电、一键清理、划掉卡片都会杀进程，杀完链路全断。5 秒轮询兜底同样跑在进程里，一起死。

这次改动的思路是双管齐下，方向正确：

1. **App 内前台服务保活**（主修复）——锁屏/切后台时保住进程与 JS 运行时
2. **server 端 ntfy 兜底推送**——App 被杀了也能收到系统通知

并且明确排除了 uni-push：厂商通道（华为/OV/荣耀）要企业资质，个人侧载 App 拿不到（已在 [交接文档](交接-后台保活与ntfy兜底.md) §1 记录）。这个判断经核实是准确的。

---

## 三、改动内容与逐项评价

### 3.1 配置脱钩（`d9a12b0`）

| 项 | 内容 |
|---|---|
| 动作 | `git rm --cached` 掉 `server/.env` 与 `uniapp/.env.{development,production,staging}`，本地文件保留 |
| 补充 | `.gitignore` 加 `.env` / `.env.*`（排除 `*.example`），新增四份占位模板 |
| 遗留 | git 历史中仍有旧内容（仅 PORT / CORS_ORIGIN / 内网 IP，无凭据），交接文档已如实注明 |

**评价：处理得当。** 按 AGENTS.md §3/§5 的要求，敏感配置与代码分离、模板只用占位符、从索引移除但不删用户本地文件——三条都做到了。关于历史清理，「由维护者评估」是正确的边界，因为清史会改写提交哈希，属于需要用户明确授权的操作。

### 3.2 server 侧 ntfy 兜底

[server/src/services/notify.js](server/src/services/notify.js) —— 67 行，质量不错：

- 不 `await`，推送成败与 WS 广播解耦，不拖慢事件层
- `AbortSignal.timeout(5000)` 防止请求悬挂
- 失败只记日志，且**日志不回显 topic / token**（这一点很少有人会想到）
- 未启用/未配置主题时静默跳过，启动日志只报「是否配置」不报真值

[server/src/ws/handler.js](server/src/ws/handler.js) 的两处接线：

- `statusChange` 挂点 `to === 'crying'` → `pushCry()`
- 30 秒 `isAlive` ping/pong 死连接清扫，注释明确写了「ESP32 固件已回 pong，不误杀」

**后者值得单独表扬**：写代码时核对过 [server_link.cpp:131-134](arduino/baby_cry_detector/server_link.cpp#L131-L134) 的 ping→pong 回执逻辑，避免了「清扫把真设备踢掉」这个很容易踩的坑。

### 3.3 App 侧后台保活

[uniapp/src/uni_modules/uts-keepalive/utssdk/app-android/index.uts](uniapp/src/uni_modules/uts-keepalive/utssdk/app-android/index.uts) 的 API 处理是完整的：

- `START_STICKY` 重建、`PARTIAL_WAKE_LOCK`、`IMPORTANCE_MIN` 常驻通知，三件套齐了
- `Build.VERSION.SDK_INT` 对 26 / 29 / 34 的分支都做了
- `startForeground(NOTIFICATION_ID, notification, FOREGROUND_SERVICE_TYPE_DATA_SYNC)` 三参重载，与 manifest 的 `foregroundServiceType` 一致

[uniapp/src/pages/home/index.vue](uniapp/src/pages/home/index.vue) 的 `onBackPress` 拦截是关键一步：默认返回会 `finish` 主 Activity → webview/JS 死亡 → 前台服务也保不住 WebSocket。这个因果链条把握得很准，注释也写清楚了。

[uniapp/src/utils/keepalive.ts](uniapp/src/utils/keepalive.ts) 的厂商自启动跳转表（MIUI / 华为 / 荣耀 / OPPO / vivo / 一加，含降级到应用详情页）覆盖了国内主流 ROM，且沿用了 `saveWav.ts` 的 plus.android 桥接结论，风格统一。

---

## 四、核心问题（按严重度）

### 🔴 P0：保活与「推理常开」是两件事，当前方案把检测能力绑在了观众在线状态上

这是本次改动**没有触及**、但决定方案成败的问题。

**现状代码路径**：

1. [baby_cry_detector.ino:53](arduino/baby_cry_detector/baby_cry_detector.ino#L53) —— `s_listening` 控制是否跑推理
2. [baby_cry_detector.ino:339-344](arduino/baby_cry_detector/baby_cry_detector.ino#L339-L344) —— 只有 `s_listening` 为真才调 `inferPoll()`
3. [handler.js:150-158](server/src/ws/handler.js#L150-L158) —— 最后一个 App 断开时下发 `listen_off`

```js
listenWanters.delete(ws);
...
else if (clientType === 'app' && deviceListening && listenWanters.size === 0) {
  sendToEsp32({ type: 'cmd', cmd: 'listen_off' });   // ← 仍在
}
```

**推论**：保活让 `listenWanters` 保持非空，从而维持推理运行——**但这意味着推理的存活仍以「你的手机活着」为前提**。

一旦出现下列任一情况，`listenWanters` 归零 → `listen_off` → EI 模型停止：

- 手机没电关机
- 手机断网（通勤地铁、电梯、飞行模式）
- 你手动划掉了 App（保活也挡不住手划）
- 前台服务被 ROM 强杀（交接文档 §5 已承认部分 ROM 会连前台服务一起杀）

**降级后果**：设备退回每 2 秒一帧的无标签 RMS，`detector.js` 只能用 `RMS≥200` 判哭。空调外机、洗衣机、抽油烟机、关门声都能触发 crying。**这时 ntfy 会真的推送——推的是误报。**

**这是最危险的一类失败**：系统看起来在工作，实际上判断依据已经退化成不可靠的阈值。而误报会把你在几天内训练成「忽视这个通知」，从此系统归零。

**建议**：`inferStart()` 移入 `setup()` 常开，`listen_on/off` 降级为「是否把音频流推给手机听」——那才是「监听」这个词本来的含义。`listenWanters` 的引用计数逻辑设计是对的，保留即可。

### 🔴 P0：缺少「设备失联」告警

`detector.js` 有 `offline` 状态（15 秒无数据触发），但 [notify.js](server/src/services/notify.js) 只挂了 `crying`，离线不通知任何人。

对监护类系统，这是比漏报更危险的失败模式：**设备断电 / WiFi 掉了 / server 崩了，你手机上什么都不会发生，而你把「什么都没发生」默认解读为「宝宝没事」。**

**建议**：`to === STATUS.OFFLINE` 时推「监护器失联」，恢复时推「已恢复」。成本极低，价值极高。

### 🟡 P1：60 秒节流挡不住状态抖动

`detector.js` 的判定节奏：

| 判定 | 所需条件 |
|---|---|
| 进入 crying | 10 个样本中 6 个 `cry` |
| 退出 crying | 10 个样本中 6 个 `quiet`（RMS≤80） |
| 上报间隔 | 500ms（监听中）/ 2s（空闲） |

即状态切换的时间尺度约 3–5 秒，而 `NTFY_CRY_THROTTLE_MS = 60000`。

**在 label 稳定时这个节流够用**（模型说哭就是哭，不易抖动）。**但在推理停摆、退化为纯 RMS 时**，环境噪声在 200 附近波动就能造成 8–10 秒周期的 `crying → awake → crying` 震荡，60 秒节流完全挡不住（每次间隔都超过 60 秒）。

**根因仍是 P0 的推理常开**。推理恢复后，建议进一步引入 episode 聚合：把「哭闹」当一段而非一次状态转换，段内最多 4 条推送（开始 / 3 分钟 / 10 分钟 / 恢复），既防刷屏也防漏提醒。

### 🟡 P1：Android 15 对 dataSync 前台服务有每日时长上限

当前 `foregroundServiceType="dataSync"`。据 Android 官方行为变更文档，**targetSdk ≥ 35（Android 15）的应用，`dataSync` 类型前台服务每 24 小时累计限时 6 小时**，超时后系统会停止服务。

这与「7×24 监护」直接冲突：半夜服务被系统静默停掉，且**不会有任何提示**。

**当前是否受影响需要确认**：本仓库 [manifest.config.ts](uniapp/manifest.config.ts) 未显式设置 `targetSdk`，实际值由 HBuilderX 版本与云打包配置决定。**这一项必须在打包后核实 APK 的 targetSdkVersion。**

**若受影响**，两条路：改用 `specialUse` 类型（需声明用途，适合监护场景），或接受限制、把 ntfy 定位为「真正的保底」而非「补充」。

### 🟡 P2：`isIgnoringBatteryOptimizations()` 失败时返回 `true`，方向反了

[keepalive.ts:196](uniapp/src/utils/keepalive.ts#L196)：

```ts
catch (e) {
  console.warn('[keepalive] 电池优化状态查询失败（按已豁免处理）:', e);
  return true;
}
```

注释解释是「避免设置页状态行误导用户去重复设置」。但在监护场景下这个取舍是反的：**查询失败却显示「已豁免」，用户以为设置好了，实际没有 → 电池优化没关 → 锁屏后进程被杀 → 通知收不到，而界面一切正常。**

建议改为返回 `false` 并提示「无法确认，请手动检查」。

### 🟢 P2：`running` 是纯内存态，进程重建后会失真

[index.uts:34](uniapp/src/uni_modules/uts-keepalive/utssdk/app-android/index.uts#L34) 的 `running` 标记在进程被杀后归零，但服务可能已被 `START_STICKY` 重建。此时 `isRunning()` 返回 `false`，设置页显示「未运行」，而服务实际在跑。

影响仅限 UI 显示准确性，不影响功能。可用 `ActivityManager.getRunningServices()` 或 binder 探活修正，优先级不高。

---

## 五、验证状态复核

commit message 与交接文档称「已验证」，实际覆盖范围如下：

| 验证项 | 状态 | 说明 |
|---|---|---|
| `lint` / `type-check` / H5 build | ✅ 已过 | 静态检查，可信 |
| notify.js 单测（投递 + 节流 + 报文） | ✅ 已过 | server 侧逻辑正确 |
| WS e2e（模拟 ESP32 触发 crying → 广播 + ntfy POST） | ✅ 已过 | 仅覆盖「推理正常」路径 |
| **真机：保活生效、后台收到通知** | ⏳ **未做** | 需重打自定义基座后验证 |
| **真机：App 被杀后 ntfy 到达** | ⏳ **未做** | 兜底链路的核心价值所在 |
| **真机：锁屏 30 分钟以上** | ⏳ **未做** | 最具决定性的实验 |
| **推理停摆时的行为** | ❌ **未测** | 见 P0，当前代码会退化到 RMS 阈值 |
| **APK targetSdkVersion** | ❌ **未核实** | 决定是否受 Android 15 限制 |

**结论：server 侧代码路径已验证，端到端链路未验证。** 在真机跑通前不宜标记为「已完成」。

---

## 六、建议的下一步

按依赖关系排序，前三步是**必须**，且互相独立、可分别上线：

| 序 | 动作 | 范围 | 前置依赖 |
|---|---|---|---|
| 1 | **推理常开**：`inferStart()` 移入 `setup()`；server 删除末位 App 触发 `listen_off` 的分支 | 固件 + server 各约 20 行 | 无 |
| 2 | **失联看门狗**：`offline` 状态接入 `pushCry` 同款出口 | notify.js 约 10 行 | 无 |
| 3 | **episode 聚合**：哭闹按「段」推送，3 分钟 / 10 分钟升级，安静 60 秒收口 | 新增 alertPolicy.js | 建议在 1 之后 |
| 4 | 重打自定义基座，做真机验证（锁屏 30 分钟 / 手划杀进程 / 断电断网三类场景） | 人工 | 1、2 |
| 5 | 核实 APK 的 `targetSdkVersion`，决定是否调整前台服务类型 | 人工 | 打包后 |
| 6 | `isIgnoringBatteryOptimizations` 失败分支改为返回 `false` | 2 行 | 无 |

**第 1 步是前置条件**——不做它，第 4 步的真机验证是在测试一个「推理本来就关着」的错误状态，结论没有参考价值。

---

## 七、对整体方案的判断

这次改动**方向对、实现细、边界诚实**（交接文档 §5 主动列出了 START_STICKY 后 JS 不恢复、部分 ROM 连前台服务一起杀等已知限制，这是很好的工程习惯）。

但它解决的是「通知送不出去」，而项目初衷里还有一半是「**判断得准**」。当前代码在 App 不在线时会退化到纯音量阈值，这一半没有补齐。

补齐之后，三层职责会非常清晰：

| 层 | 职责 | 实现位置 |
|---|---|---|
| 识别 | 判断「在不在哭」 | 固件 EI 模型 |
| 决策 | 该不该提醒、提醒几次、提醒谁 | server（episode 策略 + 看门狗） |
| 送达 | 把字送到通知栏 | App 本地通知 + ntfy 兜底 |
| 呈现 | 哭了多久、音量、历史、听声音 | App |

**现在的代码，第三层已经做扎实了；第四层原本就有；缺的是第一层的常开和第二层的策略。**

补完这两块，这套系统才算真正实现「我不在他身边，也知道他哭了」。

---

## 附：本次评估未涉及的内容

- 服务端数据层历史遗留问题（`MAX_HISTORY=500` 导致周/月统计恒空、`/api/history` 分页失效、`hourlyStats` 跨天混算）——已在 [todolist.md](todolist.md) 记录，与本链路无关
- 设备身份认证（伪造哭声风险）——属于产品化阶段议题
- iOS 端能力（无开发者账号，ntfy / Bark 走 APNs 已可覆盖）
