# TODO

> 2026-09-30 整理,依据:设计规范 v1.1(`uniapp/disign/`)逐屏核对 + 本轮开发发现的工程债。
> 规范文件可能被并行更新,动手前先重读对应章节。

## 高优先级:设计稿缺口(v1.1 范围内)

- [x] **首页·监听中态(设计稿 09)** — UI 壳完成(2026-09-30):徽章/停止监听/播放说明/间距例外
  - 剩余:音频流播放链路(WS PCM → 手机扬声器)待固件/服务端对齐后接入 `toggleListen()`
- [x] **首页·设备离线态完整变体(设计稿 07)** — 完成(2026-09-30):横幅/灰脸变体/重连按钮/事件卡空态/快捷操作禁用
  - 剩余:「已尝试 N 次」现为 App 端按设备 3s 重连节奏本地计数,真实重连次数待设备侧上报遥测
- [ ] **信号条 RSSI 分档(规范 13.2)** — 配对页设备列表,0–4 格按 RSSI 点亮
  - 纯 App 端可做(扫描 API 直接给 RSSI),映射:≥-60dBm→4 格;断连=0 格

## 中优先级:跨端链路

- [ ] **WiFi 弧线分档** — 与信号条不同,需三端:固件加 WiFi RSSI 上报字段 → server 透传 → App 分档渲染(现为写死满格绿)
- [ ] **电池字段处置** — 充电宝供电决策落地:设置页「电量 X%」改「充电宝供电」,废弃 `DeviceData.batteryPercent`(server `routes/baby.js` 里现为硬编码 85)

## 低优先级:工程卫生(碎片时间)

- [ ] 删除商城模板残留:`pages/cart`、`pages/category`、`pages/mine` 三个死页面
- [ ] 加 `.gitattributes` 统一行尾符 — 根治 `manifest.json`/`components.d.ts` 幻影改动与 CRLF warning
- [ ] 清 type-check 的 11 个历史错误 — uts 模块类型声明、App.vue shims、`scope.bluetooth` 权限键
- [x] 推送远端 — 已同步（2026-10-02）
- [ ] `<route>` 块废弃警告 → 迁移到 `definePage()`(uni-pages 下个版本移除,不急)

## 规范排期后的(v1.2,勿提前做)

灵敏度阈值二级页(3 段滑杆)、消息中心、夜间模式、隐私说明页、多设备 vs 单设备决策、小程序端启用。

## 排障口诀(近期踩坑速查)

- 元素渲染成 `<!---->` 且零报错 → 查其用到的导入是否在平台条件编译块内(eslint 排序会穿越边界)
- 入口页变成别的页面 → 看 `src/pages.json` 第一个 path;dev server 启动时 pages.json 必须存在
- 全屏页底部贴边 / flex 卡片被撑破 → uni-h5 view 默认 content-box,容器加 `box-sizing: border-box` + `min-width: 0`
