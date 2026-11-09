/**
 * bin-bluetooth UTS 插件的 TS 类型声明（供 vue-tsc/type-check 使用）。
 * 真值源是 utssdk/interface.uts（三端共享接口），两端字段必须保持一致；
 * 运行时实现由 uni 编译器按平台解析（App=utssdk/app-*，小程序=utssdk/mp-*），
 * H5 端经 mock/ble-adapter 挂到 globalThis（import 被条件编译剥离后走全局兜底）。
 */

declare module '@/uni_modules/bin-bluetooth' {
  /* UUID 字符串，形如 "0000180d-0000-1000-8000-00805f9b34fb" 或短 UUID "180d" */
  export type Uuid = string;

  export type BleConnectionState = number;
  export const BLE_STATE_DISCONNECTED: BleConnectionState;
  export const BLE_STATE_CONNECTING: BleConnectionState;
  export const BLE_STATE_CONNECTED: BleConnectionState;
  export const BLE_STATE_DISCONNECTING: BleConnectionState;

  /* 错误码，以 902 开头，遵循 uni 错误码规范 */
  export type BleErrorCode
    = | 9020001
      | 9020002
      | 9020003
      | 9020004
      | 9020005
      | 9020006
      | 9020007
      | 9020008
      | 9020009
      | 9020010;

  /* 对应 UTS 的 BleFail extends IUniError */
  export interface BleFail {
    errSubject?: string;
    errCode: BleErrorCode;
    errMsg: string;
    data?: unknown;
  }

  /* 扫描到的广播；advertisData 为厂商数据段（AD Type 0xFF）hex 字符串，无则为 null */
  export interface Advertisement {
    deviceId: string;
    name: string | null;
    rssi: number;
    serviceUuids: Uuid[];
    advertisData: string | null;
  }

  /* 特征引用（服务 UUID + 特征 UUID） */
  export interface CharacteristicRef {
    serviceUuid: Uuid;
    characteristicUuid: Uuid;
  }

  /* 订阅参数（void 返回 + keepAlive，原因见 interface.uts） */
  export interface BleObserveOptions {
    /* 通知内容：十六进制字符串（小写、无分隔符） */
    onValue: (value: string) => void;
    onSuccess?: (() => void) | null;
    onError?: ((err: BleFail) => void) | null;
  }

  /* 扫描参数 */
  export interface BleScanOptions {
    /* 服务 UUID 过滤，空数组表示不过滤 */
    services: Uuid[];
    /* 设备名前缀过滤，null 表示不过滤 */
    namePrefix: string | null;
    onAdvertisement: (adv: Advertisement) => void;
    onError: ((err: BleFail) => void) | null;
    /* 毫秒；默认 15000；0/负数表示不自动结束 */
    timeout?: number | null;
    onEnd?: (() => void) | null;
    allowDuplicates?: boolean | null;
  }

  export interface IScanner {
    startScan: (options: BleScanOptions) => void;
    stopScan: () => void;
  }

  export interface IPeripheral {
    readonly deviceId: string;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    getState: () => BleConnectionState;
    onStateChange: (cb: (state: BleConnectionState) => void) => void;
    /* 逐特征回调，全部发现后 resolve */
    discoverServices: (cb: (serviceUuid: string, uuid: string, properties: number) => void) => Promise<void>;
    /* 读特征值：十六进制字符串（小写、无分隔符） */
    read: (target: CharacteristicRef) => Promise<string>;
    /* 写特征值；wtype: 0=带响应 1=无响应 */
    write: (target: CharacteristicRef, value: string, wtype: number) => Promise<void>;
    observe: (target: CharacteristicRef, options: BleObserveOptions) => void;
    stopObserve: (target: CharacteristicRef) => Promise<void>;
    readRssi: () => Promise<number>;
    requestMtu: (mtu: number) => Promise<number>;
  }

  export const openAdapter: () => Promise<boolean>;
  export const closeAdapter: () => void;
  export const createScanner: () => IScanner;
  export const createPeripheral: (deviceId: string) => IPeripheral;
  export const characteristicOf: (serviceUuid: Uuid, characteristicUuid: Uuid) => CharacteristicRef;
}
