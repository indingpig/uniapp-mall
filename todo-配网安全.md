# 临时 TODO：配网安全阶段一收尾

> 2026-11-05 创建，做完可删。
> 背景：固件侧配网安全已实现并烧录（`269ce82` feat(firmware)），方案见
> 《配网与设备管理改进方案.md》（`1394ac6`）。当前设备在**家用 Windows 机**
> COM3 上，处于出厂态：BLE 广播 `BabyMonitor-3004`、LED 慢闪。

## 公司可做（Mac，不需要设备）

- [ ] **点 1：App 扫描改 Service UUID 过滤** — `uniapp/src/hooks/useBLE.ts:138`
  `services: []` 传 `BLE_SERVICE_UUID`（UTS 插件已支持该参数），
  提交前跑 `pnpm run lint` + `pnpm run type-check`
- [ ] **点 3/7：Server URL 校验收敛** — 写一个共用校验函数
  （`ws://` / `wss://` 前缀、长度、去空白），BLE 写入
  （`ble_provision.cpp` ServerURLWriteCallback）与 `/setserver`
  （`collect_server.cpp:223` handleSetServer）两处接入
- [ ] **点 5：WiFi 掉线自动重连** — `wifi_connect.cpp`，掉线检测 + 指数退避
  （3s → 30s → 60s 封顶），方案文档改进点 5 有完整设计；Mac 可编译
  （EI 库在 `~/Documents/Arduino/libraries`，pio 在 `~/.platformio/penv/bin/pio`），
  实测回家做

## 需要设备在手（回家，Windows 机烧录/串口）

- [ ] **App 配对页完整流程**（Just Works 加密首次真机验证，重点！）
  Android 个别机型写加密特征值报错 → App 侧补 `createBond()`
- [ ] 配网成功（server_connected）→ LED 灭、BLE 停广播（扫不到设备 = 正常）
- [ ] BOOT 短按 3s → 配网窗口重开（LED 快闪 + 广播 5 分钟）
- [ ] BOOT 长按 10s → 恢复出厂（LED 回慢闪、可重新配网）
- [ ] **验证按键前先断开串口监视器**：CH343 串口被持有（无论 DTR 电平）
  会把 GPIO0 钳低，按键检测不装填、不生效（启动日志会打
  `BOOT(GPIO0) at boot: LOW (被外部钳住?)`）
- [ ] 串口日志确认：`pio device monitor`（115200）；被动抓日志用
  pyserial 脚本（`C:\Users\Sheldon\AppData\Local\Temp\read_serial.py` 可参考）
