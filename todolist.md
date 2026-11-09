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

- [ ] 推送远端 — 2026-11-09 晚新增 **5 个本地提交**未推送（死页面清理/AppID/电池字段/type-check 修复/.gitattributes）
- [ ] `<route>` 块废弃警告 → 迁移到 `definePage()`(uni-pages 下个版本移除,不急)
- [ ] 首页快捷操作按钮(监听/静音提醒)收编 `AppButton` — 含 muted/禁用变体逐态迁移,2026-11-09 样式收编时刻意跳过(状态多,风险大)
- [ ] `colors.ts` 的 `zone1-3` 与 `babyStatus.ts` `VOLUME_ZONES` 双源合一 — 现两处注释互指,改动需两边同步

## 规范排期后的(v1.2,勿提前做)

灵敏度阈值二级页(3 段滑杆)、消息中心、夜间模式、隐私说明页、多设备 vs 单设备决策、小程序端启用。

- [ ] **真实设备身份与注册表(三端,衔接「多设备 vs 单设备」决策)** — 2026-11-09 确认的现状:
  App 显示的「设备」是 server `routes/baby.js /device` 的**写死假数据**(name/battery/signal 全硬编码,
  仅 isOnline 真实),server `ws/handler.js` 单槽位(`esp32Client`),身份=URL 含 'esp32',无设备列表——
  所以「重置+重新配对」后列表永远不变,配对产物只有设备 NVS 凭据 + 手机本地 `PAIRED_DEVICE`(仅名字)
  - 设备:WS 握手时上报真实身份(BLE Device Info 已有 name,或 URL 带 &name=)
  - server:维护注册表({name, lastSeen, online}),`/api/device(s)` 返回真数据
  - App:首页/设置渲染真名;`PAIRED_DEVICE` 可在重装后从 server 自动恢复
  - 方案背景见 `配网与设备管理改进方案.md` 阶段二

## 已修复留档

- [x] 商城模板残留死页面 cart/category/mine — 删除（`d946b54`）；pages.json 里三条 `#ifdef APP || H5` 手动条目一并清掉（uni-pages 会合并保留旧条目，删源文件不够）
- [x] type-check 9 个历史错误 — 清零（`b83b59e`）：新增 `src/types/bin-bluetooth.d.ts`（以 interface.uts 为真值源）与 `src/shime-uni.d.ts`；useBLE/ble-test 删 H5 本地 declare 占位块（vue-tsc 不处理条件编译，两分支声明同时可见会冲突），H5 运行时仍走 mock 全局兜底；`scope.bluetooth` 权限键用 Record 断言绕过插件类型缺口
- [x] 电池字段处置 — 落地（`3bb5622`）：设置页「电量 X%」→「充电宝供电」，DeviceData.batteryPercent 废弃，server 去硬编码 85
- [x] `.gitattributes` 统一行尾符（`39c2618`，* text=auto eol=lf，bat/ps1/cmd 保持 CRLF，图片字体证书 binary）

- [x] 设备重置后首连成功进配对页但跳回扫描页 — 修复(2026-11-09 重设计 `30dd3a9`):phase 状态机 wifi/pairing/done 不回退扫描态(状态互斥),掉线切 `deviceLost` 灰态条;同日真机全程配网未复现
- [x] 重新配网后 ServerLink 一直拨旧服务器地址(App 配网超时) — 修复(`132f848`):wifi_connected 每次触发无条件 `serverLinkStart()` 重读 NVS;真机端到端验证通过
