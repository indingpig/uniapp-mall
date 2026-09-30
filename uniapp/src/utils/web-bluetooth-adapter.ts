/**
 * H5 端真实蓝牙适配器（Web Bluetooth API）
 *
 * 与 mock/ble-adapter.ts 模拟器实现同一套接口（openAdapter / createScanner /
 * createPeripheral / characteristicOf），由 ble-adapter.ts 按浏览器能力二选一挂载。
 *
 * 能力边界：
 *   - 仅 Chrome / Edge 支持（桌面 + Android），iOS Safari、微信内置浏览器不支持
 *   - 需要 HTTPS 或 localhost（Secure Context）
 *   - requestDevice 弹出的是浏览器原生设备选择器，用户选中后回调一次
 *     onAdvertisement，因此扫描列表只会出现用户选中的那一台
 *   - 扫描必须由用户手势触发（配对页点「扫描」按钮即满足）
 */
import {
  BLE_SERVICE_UUID,
  DEVICE_NAME_PREFIX,
} from '@/constants/ble';

/* ---------- Web Bluetooth 最小类型（TS lib.dom 尚未收录，仅声明本项目用到的部分） ---------- */

interface WBCharacteristicProperties {
  read?: boolean;
  write?: boolean;
  writeWithoutResponse?: boolean;
  notify?: boolean;
  indicate?: boolean;
}

interface WBCharacteristic extends EventTarget {
  uuid: string;
  properties: WBCharacteristicProperties;
  startNotifications: () => Promise<WBCharacteristic>;
  writeValue: (value: BufferSource) => Promise<void>;
  writeValueWithResponse?: (value: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
}

interface WBService {
  uuid: string;
  getCharacteristics: () => Promise<WBCharacteristic[]>;
}

interface WBGATTServer {
  connected: boolean;
  connect: () => Promise<WBGATTServer>;
  disconnect: () => void;
  getPrimaryService: (service: string | number) => Promise<WBService>;
}

interface WBDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: WBGATTServer;
}

interface WBBluetooth {
  requestDevice: (options: {
    filters?: Array<{ services?: Array<string | number>; name?: string; namePrefix?: string }>;
    optionalServices?: Array<string | number>;
    acceptAllDevices?: boolean;
  }) => Promise<WBDevice>;
}

function getBluetooth(): WBBluetooth | undefined {
  return (navigator as unknown as { bluetooth?: WBBluetooth }).bluetooth;
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!getBluetooth();
}

export function openAdapter(): Promise<boolean> {
  // Web Bluetooth 无「打开适配器」概念，仅校验能力；真实扫描在用户手势里弹出选择器
  return Promise.resolve(isWebBluetoothSupported());
}

export function closeAdapter(): void {
  // 浏览器无需显式关闭适配器
}

/* ---------- hex 编解码（与 useBLE / mock 的写入协议一致） ---------- */

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return bytes;
}

function dataViewToHex(dv: DataView): string {
  let hex = '';
  for (let i = 0; i < dv.byteLength; i++)
    hex += dv.getUint8(i).toString(16).padStart(2, '0');
  return hex;
}

/* ---------- 扫描 ---------- */

interface WBScanOptions {
  services: string[];
  namePrefix: string;
  onAdvertisement: (adv: { deviceId: string; name: string; rssi: number }) => void;
  onError: (err: { errMsg: string }) => void;
  timeout: number;
  allowDuplicates: boolean;
  onEnd: () => void;
}

export interface WBScanner {
  startScan: (options: WBScanOptions) => void;
  stopScan: () => void;
}

/** 扫描选中的设备缓存：deviceId → BluetoothDevice（连接阶段按 id 取回） */
const selectedDevices = new Map<string, WBDevice>();

export function createScanner(): WBScanner {
  return {
    startScan(options: WBScanOptions) {
      const bt = getBluetooth();
      if (!bt) {
        options.onError({ errMsg: '当前浏览器不支持 Web Bluetooth' });
        options.onEnd();
        return;
      }
      bt.requestDevice({
        filters: [{ namePrefix: options.namePrefix || DEVICE_NAME_PREFIX }],
        optionalServices: [BLE_SERVICE_UUID],
      })
        .then((device) => {
          selectedDevices.set(device.id, device);
          options.onAdvertisement({ deviceId: device.id, name: device.name || '', rssi: -1 });
          options.onEnd();
        })
        .catch((err: DOMException) => {
          // NotFoundError = 用户直接关掉了设备选择器，视为主动停止而非错误
          if (err?.name === 'NotFoundError') {
            options.onEnd();
            return;
          }
          options.onError({ errMsg: err?.message || String(err) });
          options.onEnd();
        });
    },
    stopScan() {
      // Chrome 的设备选择器没有编程取消手段，由用户关闭（回调里已按主动停止处理）
    },
  };
}

/* ---------- 外设（连接 / 服务发现 / 写入 / 状态通知） ---------- */

interface WBCharRef {
  serviceUuid: string;
  characterUuid: string;
}

export function characteristicOf(serviceUuid: string, characterUuid: string): WBCharRef {
  return { serviceUuid, characterUuid };
}

export function createPeripheral(deviceId: string) {
  let stateHandler: ((state: number) => void) | null = null;
  let gatt: WBGATTServer | null = null;
  const chars = new Map<string, WBCharacteristic>();

  /** GATT properties → Android 风格 properties 位掩码（useBLE 不消费，保持语义即可） */
  function propsBitmask(p: WBCharacteristicProperties): number {
    let mask = 0;
    if (p.read)
      mask |= 2;
    if (p.writeWithoutResponse)
      mask |= 4;
    if (p.write)
      mask |= 8;
    if (p.notify)
      mask |= 16;
    if (p.indicate)
      mask |= 32;
    return mask;
  }

  function charOf(ref: WBCharRef): WBCharacteristic | undefined {
    return chars.get(ref.characterUuid.toLowerCase());
  }

  return {
    connect: () => new Promise<void>((resolve, reject) => {
      const device = selectedDevices.get(deviceId);
      if (!device?.gatt) {
        reject(new Error('设备信息已失效, 请重新扫描连接'));
        return;
      }
      device.addEventListener('gattserverdisconnected', () => {
        stateHandler?.(0); // 0 = BLE_STATE_DISCONNECTED
      });
      device.gatt.connect()
        .then((server) => {
          gatt = server;
          resolve();
        })
        .catch((err: Error) => reject(new Error(`连接失败: ${err.message}`)));
    }),

    disconnect() {
      gatt?.disconnect();
      gatt = null;
    },

    onStateChange(cb: (state: number) => void) {
      stateHandler = cb;
    },

    async discoverServices(cb: (serviceUuid: string, characterUuid: string, props: number) => void) {
      if (!gatt)
        throw new Error('未连接');
      const service = await gatt.getPrimaryService(BLE_SERVICE_UUID);
      const list = await service.getCharacteristics();
      for (const c of list) {
        chars.set(c.uuid.toLowerCase(), c);
        cb(BLE_SERVICE_UUID, c.uuid, propsBitmask(c.properties));
      }
    },

    observe(
      ref: WBCharRef,
      handlers: { onValue: (v: string) => void; onError: (e: { errMsg: string }) => void },
    ) {
      const c = charOf(ref);
      if (!c) {
        handlers.onError({ errMsg: '特征值不存在' });
        return;
      }
      c.startNotifications()
        .then((notifying) => {
          notifying.addEventListener('characteristicvaluechanged', (event: Event) => {
            const dv = (event.target as unknown as { value: DataView }).value;
            handlers.onValue(dataViewToHex(dv));
          });
        })
        .catch((err: Error) => handlers.onError({ errMsg: err.message }));
    },

    async write(ref: WBCharRef, value: string, type: number) {
      const c = charOf(ref);
      if (!c)
        throw new Error('特征值不存在');
      const bytes = hexToBytes(value);
      if (type === 0) {
        // withResponse：优先新 API，旧 Chrome 回退 writeValue
        if (typeof c.writeValueWithResponse === 'function') {
          await c.writeValueWithResponse(bytes);
          return;
        }
        await c.writeValue(bytes);
        return;
      }
      if (typeof c.writeValueWithoutResponse === 'function') {
        await c.writeValueWithoutResponse(bytes);
        return;
      }
      await c.writeValue(bytes);
    },
  };
}
