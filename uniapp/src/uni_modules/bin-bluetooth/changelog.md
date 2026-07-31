## 1.5.0（2026-07-22）
- 【重要 / 破坏性变更】读写与订阅的数据载体由 `ArrayBuffer` 改为十六进制字符串（小写、无分隔符）：
  - `read(target)` 返回 `Promise<string>`（原 `Promise<ArrayBuffer>`）
  - `write(target, value, wtype)` 的 `value` 改为十六进制字符串（原 `ArrayBuffer`）
  - 订阅通知回调值改为十六进制字符串
  - 原因：经典 uni-app（非 x）桥接层无法可靠透传 `ArrayBuffer`，会触发 fastjson 序列化崩溃；改用基础类型字符串可靠透传，业务侧可自行 hex↔字节数组互转
- 【破坏性变更】`observe` 由 `observe(target, cb): Promise<void>` 改为 `observe(target, options: BleObserveOptions): void`：
  - `BleObserveOptions` 含 `onValue`（持续接收通知）、可选 `onSuccess`（订阅成功）、可选 `onError`（订阅失败）
  - 修复订阅成功后收不到设备通知的问题：原实现返回 Promise，`@UTSJS.keepAlive` 在返回 Promise 的方法上不生效，Promise 结算后回调被回收；改为「void 返回 + options 回调对象 + keepAlive」（与 `startScan` 一致）后可持续接收通知（App 端需 HBuilderX ≥ 4.27）
- 修复 iOS 云打包 Swift 编译错误（UTS→Swift 类型转换）：
  - `hexToData` 中 `Math.floor(...) as number` 被编译为非法的 `Int as! NSNumber`，改用 `Number.from(clean.length) / 2`
  - 扫描超时 `setTimeout(..., to)` 中 `to` 源自可选 `timeout` 被推断为 `NSNumber`，而延时参数要求 `Int`，改为 `to.toInt()`
- 补充 iOS 蓝牙隐私描述配置：缺失 `NSBluetoothAlwaysUsageDescription` 时，`CBCentralManager` 初始化访问蓝牙会直接 SIGABRT 闪退（表现为「点击初始化/扫描即闪退」）。需在宿主工程根目录 `Info.plist` 或 `manifest.json → app-plus.distribute.ios.privacyDescription` 中声明，且必须重新云打包/重做自定义调试基座后生效
## 1.4.0（2026-07-20）
- 新增支付宝小程序（mp-alipay）端实现，底层对接支付宝小程序蓝牙 API（`uni.*` 映射为 `my.*`）
- 五端（Android/iOS/HarmonyOS/微信小程序/支付宝小程序）统一 `openAdapter/createScanner/createPeripheral` 接口
- 内部处理支付宝差异：特征值以十六进制字符串回传时自动转 `ArrayBuffer`；服务/特征字段命名（`serviceId`/`characteristicId`）兼容；初始化失败弹窗引导（可跳转小程序设置页）
## 1.3.0（2026-07-20）
- 扫描 API 新增可选参数 `allowDuplicates`：是否允许重复上报同一设备（不传默认 `false`，同一设备一次扫描过程仅上报一次；`true` 则每个广播包都回调）
  - Android/HarmonyOS 原生按广播包持续上报，`false` 时插件内部按 `deviceId` 去重
  - iOS 通过 `CBCentralManagerScanOptionAllowDuplicatesKey` 控制；微信小程序透传 `allowDuplicatesKey`
- 扫描数据新增 `Advertisement.advertisData`（十六进制字符串）：四端语义统一，均取广播数据中 AD Type `0xFF` 的厂商自定义数据段（Manufacturer Specific Data，前 2 字节为小端公司标识），与微信小程序 `advertisData` 一致；未携带厂商数据时为 null。之所以用 hex 字符串而非 `ArrayBuffer`，是因为 `ArrayBuffer` 作为对象字段经 UTS↔原生回调传递时会丢失，仅基础类型可靠透传
- 微信小程序：`openAdapter()` 新增授权/开关引导——初始化失败时诊断并弹窗引导（微信蓝牙权限被拒 → 跳转系统设置；系统蓝牙未开启 → 提示开启）；初始化成功后在安卓端检查系统定位/定位授权，未就绪时引导（定位未开会导致搜索不到设备）
- 微信小程序：修复第二次扫描搜不到设备（主动 `getBluetoothDevices` 补充上报被缓存的已发现设备）；`startScan` 自动确保适配器已初始化，`stopScan`/`closeAdapter` 补齐回调避免未捕获 Promise 拒绝

## 1.2.0（2026-07-20）
- 新增微信小程序（mp-weixin）端实现，底层对接微信小程序蓝牙 API
- 四端（Android/iOS/HarmonyOS/微信小程序）统一 `openAdapter/createScanner/createPeripheral` 接口
- 支持扫描、连接、服务发现、读写、订阅通知、RSSI、MTU

## 1.1.0（2026-07-17）
- 扫描 API 新增超时能力：`BleScanOptions` 增加可选参数 `timeout`（毫秒，不传默认 15000/15 秒自动结束扫描，传 0 或负数表示不自动结束）
- 新增可选回调 `onEnd`：扫描因超时自动结束时触发，便于复位业务状态
- 三端（Android/iOS/HarmonyOS）统一实现超时自动 `stopScan`

## 1.0.0（2026-07-17）
- 重构为跨平台 BLE（Central 中心设备）插件，API 参考 kable 设计
- 新增统一接口层 interface.uts（IScanner / IPeripheral / Advertisement / 错误码）
- 实现 Android（BluetoothGatt）、iOS（CoreBluetooth）、HarmonyOS（ConnectivityKit）三端
- 支持扫描、连接、服务发现、读写、订阅通知、RSSI、MTU
