# bin-bluetooth

跨平台 BLE 低功耗蓝牙插件（Central 中心设备），API 设计参考 [kable](https://github.com/JuulLabs/kable)。
支持 Android / iOS / HarmonyOS(Next) / 微信小程序 / 支付宝小程序，提供扫描、连接、服务发现、读写、订阅通知等能力。

## 平台底层
- Android：`android.bluetooth.*`（BluetoothLeScanner / BluetoothGatt），minSdkVersion 21
- iOS：`CoreBluetooth`（CBCentralManager / CBPeripheral），deploymentTarget 12
- HarmonyOS：`@kit.ConnectivityKit`（ble / access）
- 微信小程序：微信小程序蓝牙 API（`uni.openBluetoothAdapter` / `uni.createBLEConnection` / `uni.readBLECharacteristicValue` 等）
- 支付宝小程序：暂不支持

## 权限配置
### Android（宿主 manifest.json → app-android.distribute.permissions）
- `BLUETOOTH` / `BLUETOOTH_ADMIN`（API < 31）
- `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT`（API >= 31）
- `ACCESS_FINE_LOCATION`（API 23-30 扫描必需）
> 插件在 `openAdapter()` 中会按系统版本动态申请上述权限。

### iOS（宿主 manifest.json → app-ios.distribute.privacyDescription，或根目录 Info.plist）
- `NSBluetoothAlwaysUsageDescription`
- `NSBluetoothPeripheralUsageDescription`
> ⚠️ 必须配置：iOS 13+ 访问蓝牙时如果 Info.plist 缺少 `NSBluetoothAlwaysUsageDescription`，`CBCentralManager` 初始化会直接 SIGABRT 闪退（表现为「点击初始化/扫描即闪退」，不是弹窗）。可在 `manifest.json → app-plus.distribute.ios.privacyDescription` 配置，或在工程根目录新建 `Info.plist` 声明（二选一即可，两处均配则以 Info.plist 为准）。修改后**必须重新云打包或重做自定义调试基座**才能生效

### HarmonyOS（宿主工程 module.json5 → requestPermissions）
- `ohos.permission.ACCESS_BLUETOOTH`

### 微信小程序
- 无需在 manifest 中配置权限；首次调用蓝牙相关能力时，微信会弹窗请求用户授权（`scope.bluetooth`）
- 部分机型需开启系统定位后才能扫描到设备

### 支付宝小程序
- 无需在 manifest 中配置权限；首次调用蓝牙相关能力时，支付宝会弹窗请求用户授权
- 部分安卓机型需开启系统定位后才能扫描到设备

## API

```ts
import {
  openAdapter, closeAdapter, createScanner, createPeripheral, characteristicOf,
  IScanner, IPeripheral, Advertisement, BleWriteType, BleConnectionState,
  BLE_STATE_DISCONNECTED, BLE_STATE_CONNECTING, BLE_STATE_CONNECTED, BLE_STATE_DISCONNECTING
} from '@/uni_modules/bin-bluetooth'
```

| 方法 | 说明 |
| --- | --- |
| `openAdapter(): Promise<boolean>` | 初始化适配器并申请权限，返回是否成功 |
| `closeAdapter(): void` | 关闭适配器，停止扫描并释放全局资源 |
| `createScanner(): IScanner` | 创建扫描器 |
| `createPeripheral(deviceId): IPeripheral` | 根据 deviceId 创建外围设备 |
| `characteristicOf(serviceUuid, characteristicUuid)` | 构造特征引用 |

> 连接状态常量：`BLE_STATE_DISCONNECTED`(0) / `BLE_STATE_CONNECTING`(1) / `BLE_STATE_CONNECTED`(2) / `BLE_STATE_DISCONNECTING`(3)，用于与 `getState()`、`onStateChange()` 的返回值比较。

### Scanner
- `startScan(options: BleScanOptions)`：`services` 过滤、`namePrefix` 过滤、`onAdvertisement` 回调、`onError` 回调
  - `timeout?: number`：扫描超时时间（毫秒），不传默认 `15000`（15 秒）自动结束扫描；传 `0` 或负数表示不自动结束
  - `onEnd?: () => void`：扫描因超时自动结束时触发（手动 `stopScan()` 不会触发）
  - `allowDuplicates?: boolean`：是否允许重复上报同一设备。不传默认 `false`（同一设备一次扫描仅上报一次）；`true` 时同一设备的每个广播包都会回调，可持续获取最新 `rssi` / 广播数据
  - `onAdvertisement` 回调的 `Advertisement.advertisData: string | null`：厂商自定义数据段（Manufacturer Specific Data）的十六进制字符串（小写、无分隔符）。四端语义统一，均取广播数据中 AD Type `0xFF` 的厂商数据段（前 2 字节为小端公司标识，其后为厂商自定义内容），与微信小程序 `advertisData` 一致；广播未携带厂商数据时为 `null`。之所以用 hex 字符串而非 `ArrayBuffer`，是因为 `ArrayBuffer` 作为对象字段经 UTS↔原生回调传递时会丢失（与 `discoverServices` 说明同理，仅基础类型可靠透传），业务可自行将 hex 转回字节数组解析
- `stopScan()`

### Peripheral（kable 风格）
- `connect() / disconnect()`
- `getState() / onStateChange(cb)`：状态 `disconnected/connecting/connected/disconnecting`
- `discoverServices(onCharacteristic): Promise<void>`：发现服务与特征。每发现一个特征回调一次 `onCharacteristic(serviceUuid: string, uuid: string, properties: number)`，全部完成后 Promise `resolve()`。采用「回调逐条 + 基础类型参数」而非「Promise 返回对象数组」，是因为 iOS(Swift) 端自定义对象/`UTSJSONObject` 放进数组经 `Promise.resolve` 返回时字段值会丢失（数组长度保留但字段全 `undefined`），而基础类型经回调可靠透传（与扫描的 `onAdvertisement` 同理）
- `read(target): Promise<string>`：读取特征值，返回十六进制字符串（小写、无分隔符）。之所以用 hex 字符串而非 `ArrayBuffer`，是因为经典 uni-app（非 x）桥接层无法可靠透传 `ArrayBuffer`（会触发 fastjson 序列化崩溃），业务可自行将 hex 转回字节数组解析
- `write(target, value: string, wtype): Promise<void>`：写入特征值。`value` 为十六进制字符串（无分隔符，如 `"01ff"`；奇数长度自动前补 0）。`wtype`：`0`=带响应(withResponse)，`1`=无响应(withoutResponse)
- `observe(target, options: BleObserveOptions): void`：订阅通知/指示。`options` 含：
  - `onValue: (value: string) => void`：收到通知时持续回调，值为十六进制字符串
  - `onSuccess?: () => void`：订阅（开启通知/写 CCCD）成功回调
  - `onError?: (err) => void`：订阅失败回调
  - 采用「void 返回 + options 回调对象 + keepAlive」而非 Promise，是因为 `@UTSJS.keepAlive` 在返回 Promise 的方法上不生效，Promise 结算后持续回调会被回收（App 端需 HBuilderX ≥ 4.27）
- `stopObserve(target): Promise<void>`：取消订阅
- `readRssi() / requestMtu(mtu)`

## 使用示例

```ts
await openAdapter()
const scanner = createScanner()
scanner.startScan({
  services: [] as string[],
  namePrefix: null,
  onAdvertisement: (adv: Advertisement) => {
    console.log(adv.deviceId, adv.name, adv.rssi)
    if (adv.advertisData != null) {
      console.log('广播数据(hex)：', adv.advertisData)
    }
  },
  onError: null,
  timeout: 15000, // 可选，默认 15000（15 秒）；传 0 表示不自动结束
  allowDuplicates: false, // 可选，默认 false；true 时同一设备重复上报
  onEnd: () => { console.log('扫描已自动结束') } // 可选
})
// 连接
const p = createPeripheral(deviceId)
await p.connect()
// 发现特征（逐条回调返回，累积成数组；每条含 serviceUuid，可自行按 serviceUuid 分组）
type CharItem = { serviceUuid : string, uuid : string, properties : number }
const chars = new Array<CharItem>()
await p.discoverServices((serviceUuid : string, uuid : string, properties : number) => {
  chars.push({ serviceUuid, uuid, properties } as CharItem)
})
const target = characteristicOf('0000180d-0000-1000-8000-00805f9b34fb', '00002a37-0000-1000-8000-00805f9b34fb')
// 订阅通知：onValue 持续接收十六进制字符串，onSuccess/onError 返回订阅结果
p.observe(target, {
  onValue: (valueHex: string) => { /* 心率通知，hex 字符串 */ },
  onSuccess: () => { console.log('订阅成功') },
  onError: (e) => { console.log('订阅失败：', e.errMsg) }
})
// 写入：value 为十六进制字符串，0=带响应，1=无响应
await p.write(target, '01ff', 0)
// 读取：返回十六进制字符串
const valueHex = await p.read(target)
```

## 错误码
| 错误码 | 说明 |
| --- | --- |
| 9020001 | 蓝牙未开启或适配器不可用 |
| 9020002 | 蓝牙相关权限被拒绝 |
| 9020003 | 扫描失败 |
| 9020004 | 连接失败或连接超时 |
| 9020005 | 设备已断开连接 |
| 9020006 | 服务或特征未找到 |
| 9020007 | 读取特征值失败 |
| 9020008 | 写入特征值失败 |
| 9020009 | 订阅通知失败 |
| 9020010 | 参数错误 |

## 开发文档
[UTS 语法](https://uniapp.dcloud.net.cn/tutorial/syntax-uts.html)
[UTS API插件](https://uniapp.dcloud.net.cn/plugin/uts-plugin.html)
[UTS for HarmonyOS](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-for-harmony.html)
