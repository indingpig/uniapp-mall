/**
 * H5 端蓝牙适配器挂载点（按浏览器能力二选一）
 *
 * - 浏览器支持 Web Bluetooth（Chrome/Edge，需 HTTPS 或 localhost）→ 挂真实适配器，
 *   可直接连接真机（见 utils/web-bluetooth-adapter.ts）
 * - 不支持（iOS Safari / 微信内置浏览器等）→ 挂模拟器，让配对流程在浏览器里走通
 *
 * 模拟行为：扫描 0.6s/1.5s 后先后发现两台设备；30s 无停止则 onEnd；
 *          连接 0.6s 成功；写入 serverUrl 后 1.5s 推送 server_connected
 *          （WiFi 密码为空时推送 error，用于验证失败路径）。
 */
import {
  BLE_CHAR_DEVICE_INFO_UUID,
  BLE_CHAR_SERVER_URL_UUID,
  BLE_CHAR_STATUS_UUID,
  BLE_CHAR_WIFI_PASS_UUID,
  BLE_CHAR_WIFI_SSID_UUID,
  BLE_SERVICE_UUID,
  DEVICE_NAME_PREFIX,
} from '@/constants/ble';
import * as webBle from '@/utils/web-bluetooth-adapter';

/** 浏览器是否支持 Web Bluetooth（支持则挂真实适配器，否则挂模拟器） */
export const WEB_BLUETOOTH_SUPPORTED = webBle.isWebBluetoothSupported();

/** 当前挂载的是否为模拟器（true = 浏览器不支持 Web Bluetooth，走假数据） */
export const BLE_MOCK_ENABLED = !WEB_BLUETOOTH_SUPPORTED;

export interface MockAdvertisement {
  deviceId: string;
  name: string;
  rssi: number;
}

const MOCK_DEVICES: MockAdvertisement[] = [
  { deviceId: 'mock-a3f2', name: 'BabyMonitor-A3F2', rssi: -52 },
  { deviceId: 'mock-cam02', name: 'BabyMonitor-Cam-02', rssi: -71 },
];

/* ---------- hex 编解码（与 useBLE 的写入协议一致） ---------- */
function hexToStr(hex: string): string {
  let str = '';
  for (let i = 0; i < hex.length; i += 2)
    str += String.fromCharCode(Number.parseInt(hex.substring(i, i + 2), 16));
  return str.replace(/\0/g, '');
}

function strToHex(str: string): string {
  let hex = '';
  for (let i = 0; i < str.length; i++)
    hex += str.charCodeAt(i).toString(16).padStart(2, '0');
  return hex;
}

/* ---------- 适配器 ---------- */
let adapterOpen = false;

export function openAdapter(): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => {
      adapterOpen = true;
      resolve(true);
    }, 300);
  });
}

export function closeAdapter(): void {
  adapterOpen = false;
}

/* ---------- 扫描器 ---------- */
interface MockScanOptions {
  services: string[];
  namePrefix: string;
  onAdvertisement: (adv: MockAdvertisement) => void;
  onError: (err: { errMsg: string }) => void;
  timeout: number;
  allowDuplicates: boolean;
  onEnd: () => void;
}

export interface MockScanner {
  startScan: (options: MockScanOptions) => void;
  stopScan: () => void;
}

let activeScanTimers: ReturnType<typeof setTimeout>[] = [];

export function createScanner(): MockScanner {
  return {
    startScan(options: MockScanOptions) {
      activeScanTimers = [];
      let ended = false;
      const finish = () => {
        if (ended)
          return;
        ended = true;
        activeScanTimers.forEach(t => clearTimeout(t));
        activeScanTimers = [];
        options.onEnd();
      };
      MOCK_DEVICES.forEach((dev, i) => {
        const t = setTimeout(() => {
          if (ended || adapterOpen === false)
            return;
          if (!dev.name.startsWith(options.namePrefix || DEVICE_NAME_PREFIX))
            return;
          options.onAdvertisement({ ...dev });
        }, 600 + i * 900);
        activeScanTimers.push(t);
      });
      const endTimer = setTimeout(finish, options.timeout || 30000);
      activeScanTimers.push(endTimer);
    },
    stopScan() {
      activeScanTimers.forEach(t => clearTimeout(t));
      activeScanTimers = [];
    },
  };
}

/* ---------- 外设（连接 / 服务发现 / 写入 / 状态通知） ---------- */
interface MockCharRef {
  serviceUuid: string;
  characterUuid: string;
}

export function characteristicOf(serviceUuid: string, characterUuid: string): MockCharRef {
  return { serviceUuid, characterUuid };
}

export function createPeripheral(_deviceId: string) {
  let _stateHandler: ((state: number) => void) | null = null;
  let statusHandler: ((hex: string) => void) | null = null;
  const creds = { ssid: '', pass: '', url: '' };

  return {
    connect: () => new Promise<void>(resolve => setTimeout(resolve, 600)),
    disconnect: () => {
      _stateHandler = null;
      statusHandler = null;
    },
    onStateChange: (cb: (state: number) => void) => {
      _stateHandler = cb;
    },
    discoverServices: (cb: (serviceUuid: string, characterUuid: string, props: number) => void) => {
      // 返回与 constants/ble 一致的 UUID，保证 matchUUID 命中
      const chars = [
        BLE_CHAR_WIFI_SSID_UUID,
        BLE_CHAR_WIFI_PASS_UUID,
        BLE_CHAR_SERVER_URL_UUID,
        BLE_CHAR_STATUS_UUID,
        BLE_CHAR_DEVICE_INFO_UUID,
      ];
      chars.forEach(c => cb(BLE_SERVICE_UUID, c, 8));
      return Promise.resolve();
    },
    observe: (_ref: MockCharRef, handlers: { onValue: (v: string) => void; onError: (e: { errMsg: string }) => void }) => {
      statusHandler = handlers.onValue;
      void handlers.onError;
    },
    write: (ref: MockCharRef, value: string, _type: number) => new Promise<void>((resolve) => {
      const text = hexToStr(value);
      if (ref.characterUuid === BLE_CHAR_WIFI_SSID_UUID)
        creds.ssid = text;
      if (ref.characterUuid === BLE_CHAR_WIFI_PASS_UUID)
        creds.pass = text;
      if (ref.characterUuid === BLE_CHAR_SERVER_URL_UUID) {
        creds.url = text;
        // 模拟设备拿到凭证后连接服务器：1.5s 后通过 Status 通知结果
        setTimeout(() => {
          if (!statusHandler)
            return;
          if (!creds.pass)
            statusHandler(strToHex('error:wifi 密码不能为空'));
          else
            statusHandler(strToHex('server_connected'));
        }, 1500);
      }
      setTimeout(resolve, 150);
    }),
  };
}

/* ---------- 运行时挂载 ----------
 * useBLE 通过 declare function 裸调用这些名字（无 import，避免双分支冲突），
 * 裸调用在运行时解析到全局 —— 按浏览器能力挂载真实适配器或模拟实现。
 */
const g = globalThis as unknown as Record<string, unknown>;
if (WEB_BLUETOOTH_SUPPORTED) {
  g.openAdapter = webBle.openAdapter;
  g.closeAdapter = webBle.closeAdapter;
  g.createScanner = webBle.createScanner;
  g.createPeripheral = webBle.createPeripheral;
  g.characteristicOf = webBle.characteristicOf;
}
else {
  g.openAdapter = openAdapter;
  g.closeAdapter = closeAdapter;
  g.createScanner = createScanner;
  g.createPeripheral = createPeripheral;
  g.characteristicOf = characteristicOf;
}
