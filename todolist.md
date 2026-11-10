# TODO

> 2026-09-30 整理,依据:设计规范 v1.1(`uniapp/disign/`)逐屏核对 + 本轮开发发现的工程债。
> 2026-11-09 更新:信号条 RSSI 完成;样式体系收编(AppButton/原子类/色源真值);新增若干工程债。
> 规范文件可能被并行更新,动手前先重读对应章节。

## 高优先级:设计稿缺口(v1.1 范围内)

- [x] **首页·监听中态(设计稿 09)** — UI 壳完成(2026-09-30):徽章/停止监听/播放说明/间距例外
  - 剩余:音频流播放链路(WS PCM → 手机扬声器)待固件/服务端对齐后接入 `toggleListen()`
- [x] **首页·设备离线态完整变体(设计稿 07)** — 完成(2026-09-30):横幅/灰脸变体/重连按钮/事件卡空态/快捷操作禁用
  - 剩余:「已尝试 N 次」现为 App 端按设备 3s 重连节奏本地计数,真实重连次数待设备侧上报遥测
- [x] **信号条 RSSI 分档(规范 13.2)** — 完成(2026-11-09):配对页 `signalLevel()` 四档点亮
  - 映射 ≥-60→4 / ≥-70→3 / ≥-80→2 / 其余→1;扫描列表本身无「断连」态,0 格场景不存在

## 中优先级:跨端链路

- [ ] **WiFi 弧线分档** — 与信号条不同,需三端:固件加 WiFi RSSI 上报字段 → server 透传 → App 分档渲染(现为写死满格绿)

## 低优先级:工程卫生(碎片时间)

- [x] 推送远端 — 全部本地提交已同步(2026-11-10 拉取确认,origin/master 已含)
- [ ] **配对页五项修复真机回归**(`fef3453` 已推手机,未验证) — ①点设备「连接中…」反馈 ②步骤条横杠独立点亮(3 步中性) ③WiFi 其他网络弹框 ④弹框遮罩压暗顶栏(z-200) ⑤配网超时分层提示(server 没起时文案);验证需板子配网模式+串口日志配合
- [ ] `<route>` 块废弃警告 → 迁移到 `definePage()`(uni-pages 下个版本移除,不急)
- [ ] 首页快捷操作按钮(监听/静音提醒)收编 `AppButton` — 含 muted/禁用变体逐态迁移,2026-11-09 样式收编时刻意跳过(状态多,风险大)
- [ ] `colors.ts` 的 `zone1-3` 与 `babyStatus.ts` `VOLUME_ZONES` 双源合一 — 现两处注释互指,改动需两边同步

## 配网与设备管理(自 `配网与设备管理改进方案.md` 迁入,2026-11-10 删档)

> 原文档 2026-11-04 对照小米/涂鸦/Matter/HomeKit 制定(9 个改进点),迁移时已对照代码复核,
> 已完成项不列:4.2 恢复出厂(BOOT 长按 10s,实测通过)、2 的轻量部分(配对窗口 + Just Works 加密)。
> 阶段策略:先做设备/App 单侧能力(阶段一) → 测试服 ~100 行参照实现(阶段二) → 真服务端按契约重写(阶段三)。

- [ ] **改进点 5:WiFi 掉线自动重连**(实施顺序第 1,高频缺口) — 路由器半夜重启即永久失联,只能拔电
  - `wifiLoop()` 现首行 `if (!s_attempting) return;`,连接成功后掉线不再重试
  - 加「曾连接但掉线」检测(`WiFi.status()!=WL_CONNECTED` → 用 NVS 凭据重连);失败指数退避 3s→30s→60s 封顶,成功清零;LED 慢闪区分配网快闪
  - 纯固件单侧几十行;掉线计数顺带成为 App 离线横幅「已尝试 N 次」的真实数据源
- [ ] **改进点 1:扫描用 Service UUID 过滤**(实施顺序第 1,可与上并行) — 名字可仿冒且 Android 广播名常截断漏扫
  - UTS 插件已支持 `services` 参数,只差 `useBLE.ts:170`(`services: []`)传入 `BLE_SERVICE_UUID`,一处改动
- [ ] **改进点 3+7 剩余:写入口 URL 校验收敛**(实施顺序第 2) — 两处共用同一校验函数,一次做完
  - `ble_provision.cpp` ServerURL 写入与 `collect_server.cpp` `/setserver` 现在都只 `trim()` 不校验
  - 校验:`ws://`/`wss://` 前缀(第一天就放行 wss)+长度+去空白;`/setserver` 还需「仅未配网态开放」(需把配网状态暴露给 collect_server)
- [ ] **改进点 4.3:OTA**(实施顺序第 3,与恢复出厂当时一并排的运维兜底) — 前置:分区表 `huge_app.csv` 无 OTA 槽,先换 `nvs+otadata+2×3MB ota_0/1`(借一次 USB 烧录写新表);局域网用 ArduinoOTA,产品化演进服务端下发固件(配合改进点 8 版本号比对)
- [ ] **改进点 4.1:SoftAP 降级配网** — BLE 不可用(手机不支持/权限)时兜底;可搬 `audio_app` 的 AP+Web 配网(`http://192.168.4.1/config`),极简替代是给 `/setserver` 配 AP 模式;SmartConfig 已淘汰勿用
- [ ] **ServerLink 死链检测(2026-11-10 真机新发现)** — 板子每 2s 必发 audio,server 侧却每 20~40s 出现 15s+ 空窗,板子串口无 disconnect(TCP 半开黑洞),App 周期性误判离线
  - `server_link.cpp` 无应用层心跳/超时:server 侧 ping 它会回 pong(已实现),但自己不发 ping、也不检测「多久没收到 server 任何字节」;需心跳 + 死链超时主动重连
- [ ] **改进点 8:设备信息/遥测上报**(实施顺序第 4) — 卡着本清单两项跨端任务(WiFi 弧线分档缺 RSSI、离线横幅「已尝试 N 次」缺重连计数)
  - 版本号构建注入(`build_flags -DFW_VERSION` 用 git describe);DeviceInfo 动态组装 `{name,version,has_wifi,server_url_set}` 并在配网状态变化时 notify——现 `ble_provision.cpp:434` 仍写死 `version:"1.0","has_wifi":false`,已配网设备在 App 里永远显示「未配网」
  - 上行加遥测:`audio` 心跳带 `rssi` 或独立 `telemetry` 消息(rssi/reconnects/uptime_s/heap_free),server 透传给 App
- [ ] **改进点 6:服务端设备身份认证**(实施顺序第 5,改动小) — 与改进点 2 对偶:2 防「配网时谁写设备」,6 防「运行时谁冒充设备」;现在任何人 `ws://host:3001/ws?esp32` 即可顶掉真设备伪造哭声
  - token(TOFU 语义:配网时 App 下发,固件存 NVS,连接带 `?esp32&token=`,server 校验不符即拒绝)+cmd 下行白名单(listen_on/listen_off);产品化再升级 wss
- [ ] **改进点 9.1:server 补 deviceOnline/deviceOffline 广播**(成本极小,可提前) — 设备 WS open/close 时推给 App,离线态从 detector 15s 看门狗「猜」变「通知」(README TODO「连接/断连状态同步」欠账)
- [ ] **改进点 2 剩余:Passkey / WiFiProv 级配网认证**(先出方案评审) — 现有窗口+Just Works 兜底,家庭场景够用,产品化再上高级认证
- [ ] ~~改进点 9.3 多设备~~ **砍掉**(2026-11-10 决策:不做多设备,家庭共享走单设备多观众,见 v1.2「家庭共享」节) — 9.2 owner_token 绑定模型同步降级为可选:家人手机无需配对、直连 server 观看即可,设备所有权由 BLE 配网窗口(物理存在)兜底;解绑/换绑等产品化阶段再评估
- [ ] **阶段二配套:产出 `PROTOCOL.md`** — 消息类型/token 位置/遥测字段固化成契约文档,作为测试服与真服之间的兼容承诺

### 四个契约决策(现在锁死,真服务端立项前不变)

| 决策 | 定什么 |
|------|--------|
| 设备身份 | `device_id`(沿用 MAC 尾号)+ `device_secret`(配网时 App 下发、存 NVS) |
| 认证语义 | token 走 TOFU:首连登记、不一致即拒绝;字段位置不变前提下真服可收紧为预注册,固件零改动 |
| TLS 路径 | `server_link.cpp` 是手写 RFC6455 over WiFiClient,换 `WiFiClientSecure` 只动传输层、帧协议不动,wss 不是返工点 |
| URL 校验 | 校验函数从第一天就放行 `wss://` 前缀,服务端升级 wss 时设备只改配网 URL |

## 规范排期后的(v1.2,勿提前做)

灵敏度阈值二级页(3 段滑杆)、消息中心、夜间模式、隐私说明页、小程序端启用。

> **「多设备 vs 单设备」决策已定(2026-11-10):不做多设备,做家庭共享(单设备多观众)** ——
> 给家里人(如爷爷奶奶)用,及时知道孩子是否哭泣。拆解见下「家庭共享」节。

- [ ] **家庭共享:单设备多观众(2026-11-10 决策落地拆解)**
  - [x] 加入机制(方案一 MVP)已实现(工作区,2026-11-10):App 空态「加入家庭监护」(App 扫码/非 App 手填)+设置页「分享给家人」**二维码弹框**(uqrcodejs 生成,遮罩白卡对齐配对页规范,含复制地址);`utils/server.ts` 单一地址解析(配对/加入地址优先,env 兜底,WS+REST 同源),useBabyMonitor 暴露 `reconnect()`;lint/type-check 零错,H5 全流程冒烟通过(加入→空态切正常页→离线态渲染→分享弹框+QR 渲染);设置页设备卡未配对占位态+未配对时家庭共享节整体隐藏(`hasLocalPairing()` 统一口径,storage.ts);join 密钥留后续
  - [x] 实时分发免开发:server `broadcastToApps` 本就广播给全部 app 连接,多观众天然支持(H5 单端已验,双端同屏待同网实测)
  - [ ] **哭声推送通知(核心诉求)** — App 前台已有本地通知(`maybeNotifyCry`);后台/杀进程收不到,需真推送
    - 路线:server 检测 crying → 调 uniPush/APNs 推送 API(只需 server 能出网,**不要求公网可达**,推送走厂商通道)
    - 纯 App 侧替代:Android 前台服务保活(可行但耗电、易被杀);iOS 无解,必走 APNs
  - [ ] 远程访问(**仅爷爷奶奶不同住时需要**):server 公网化(frp/云主机)+wss,或等「真服务端」立项
  - [ ] server 24h 常驻形态:家里放常开主机(树莓派/旧电脑/NAS),当前 dev Mac 不常开
- [ ] **真实设备身份与注册表(三端)** — 2026-11-09 确认的现状:
  App 显示的「设备」是 server `routes/baby.js /device` 的**写死假数据**(name/signal 全硬编码,
  仅 isOnline 真实),server `ws/handler.js` 单槽位(`esp32Client`),身份=URL 含 'esp32',无设备列表——
  所以「重置+重新配对」后列表永远不变,配对产物只有设备 NVS 凭据 + 手机本地 `PAIRED_DEVICE`(仅名字)
  - ~~衔接多设备决策~~ → 决策已定,按**单设备**收敛:不做设备列表
  - 设备:WS 握手时上报真实身份(BLE Device Info 已有 name,或 URL 带 &name=)
  - server:维护注册表({name, lastSeen, online}),`/api/device` 返回真数据
  - App:首页/设置渲染真名;`PAIRED_DEVICE` 可在重装后从 server 自动恢复(家人手机装 App 填 server 地址即可观看,无需配对)
  - 方案细化已迁入本文件上方「配网与设备管理」节(原文档 2026-11-10 删档)

## 已修复留档

- [x] 商城模板残留死页面 cart/category/mine — 删除（`d946b54`）；pages.json 里三条 `#ifdef APP || H5` 手动条目一并清掉（uni-pages 会合并保留旧条目，删源文件不够）
- [x] type-check 9 个历史错误 — 清零（`b83b59e`）：新增 `src/types/bin-bluetooth.d.ts`（以 interface.uts 为真值源）与 `src/shime-uni.d.ts`；useBLE/ble-test 删 H5 本地 declare 占位块（vue-tsc 不处理条件编译，两分支声明同时可见会冲突），H5 运行时仍走 mock 全局兜底；`scope.bluetooth` 权限键用 Record 断言绕过插件类型缺口
- [x] 电池字段处置 — 落地（`3bb5622`）：设置页「电量 X%」→「充电宝供电」，DeviceData.batteryPercent 废弃，server 去硬编码 85
- [x] `.gitattributes` 统一行尾符（`39c2618`，* text=auto eol=lf，bat/ps1/cmd 保持 CRLF，图片字体证书 binary）

- [x] 设备重置后首连成功进配对页但跳回扫描页 — 修复(2026-11-09 重设计 `30dd3a9`):phase 状态机 wifi/pairing/done 不回退扫描态(状态互斥),掉线切 `deviceLost` 灰态条;同日真机全程配网未复现
- [x] 重新配网后 ServerLink 一直拨旧服务器地址(App 配网超时) — 修复(`132f848`):wifi_connected 每次触发无条件 `serverLinkStart()` 重读 NVS;真机端到端验证通过
