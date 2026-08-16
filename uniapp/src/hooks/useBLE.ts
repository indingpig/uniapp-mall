// #ifndef H5
import type { Advertisement } from '@/uni_modules/bin-bluetooth';
// #endif
import { onBeforeUnmount, ref } from 'vue';
import {
  BLE_CHAR_DEVICE_INFO_UUID,
  BLE_CHAR_SERVER_URL_UUID,
  BLE_CHAR_STATUS_UUID,
  BLE_CHAR_WIFI_PASS_UUID,
  BLE_CHAR_WIFI_SSID_UUID,
  BLE_SERVICE_UUID,
  DEVICE_NAME_PREFIX,
} from '@/constants/ble';
// #ifndef H5
import {
  characteristicOf,
  closeAdapter,
  createPeripheral,
  createScanner,
  openAdapter,
} from '@/uni_modules/bin-bluetooth';
// #endif
// #ifdef H5
// H5 无原生蓝牙，声明类型占位，仅供编译通过（运行时不调用）
type Advertisement = Record<string, never>;
interface H5ScannerLike {
  startScan: (options: never) => void;
  stopScan: () => void;
}
interface H5PeripheralLike {
  connect: () => Promise<void>;
  disconnect: () => void;
  onStateChange: (cb: (state: number) => void) => void;
  discoverServices: (cb: (svc: string, char: string, props: number) => void) => Promise<void>;
  observe: (ref: never, handlers: { onValue: (v: string) => void; onError: (e: { errMsg: string }) => void }) => void;
  write: (ref: never, value: string, type: number) => Promise<void>;
}
declare function createScanner(): H5ScannerLike;
declare function createPeripheral(deviceId: string): H5PeripheralLike;
declare function characteristicOf(service: string, char: string): never;
declare function openAdapter(): Promise<boolean>;
declare function closeAdapter(): void;
// #endif

export interface BLEDevice {
  deviceId: string;
  name: string;
  RSSI: number;
}

interface PairedResult {
  success: boolean;
  message: string;
}

export function useBLE() {
  const scanning = ref(false);
  const devices = ref<BLEDevice[]>([]);
  const connectedDevice = ref<BLEDevice | null>(null);
  const statusText = ref('点击扫描查找设备');
  const paired = ref(false);
  const deviceInfo = ref<Record<string, unknown>>({});

  let scanner: ReturnType<typeof createScanner> | null = null;
  let peripheral: ReturnType<typeof createPeripheral> | null = null;
  let platformServiceUuid = '';
  const platformCharUuids = {
    wifiSSID: '',
    wifiPass: '',
    serverUrl: '',
    status: '',
    deviceInfo: '',
  };
  const observeUnsub: (() => void) | null = null;

  /* ===================== 工具 ===================== */

  function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  function strToHex(str: string): string {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
      hex += str.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
  }

  function hexToStr(hex: string): string {
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(Number.parseInt(hex.substring(i, i + 2), 16));
    }
    return str.replace(/\0/g, '');
  }

  function matchUUID(platformUUIDs: string[], targetFull: string): string {
    const needle = targetFull.toLowerCase();
    const exact = platformUUIDs.find(u => u.toLowerCase() === needle);
    if (exact)
      return exact;
    const tail8 = targetFull.slice(-8);
    const byTail = platformUUIDs.find(u => u.toLowerCase().endsWith(tail8));
    if (byTail)
      return byTail;
    const short4 = targetFull.slice(4, 8);
    return platformUUIDs.find(u => u.toLowerCase().includes(short4)) || '';
  }

  /* ===================== 扫描 ===================== */

  async function startScan(): Promise<void> {
    devices.value = [];

    const ok = await openAdapter();
    if (!ok) {
      statusText.value = '请开启手机蓝牙后再试';
      return;
    }

    scanning.value = true;
    statusText.value = '正在扫描设备...';
    scanner = createScanner();

    scanner.startScan({
      services: [] as string[],
      namePrefix: DEVICE_NAME_PREFIX,
      onAdvertisement: (adv: Advertisement) => {
        const name = adv.name || '';
        if (name.startsWith(DEVICE_NAME_PREFIX)) {
          if (!devices.value.some(d => d.deviceId === adv.deviceId)) {
            devices.value.push({ deviceId: adv.deviceId, name, RSSI: adv.rssi });
            devices.value.sort((a, b) => b.RSSI - a.RSSI);
          }
        }
      },
      onError: (err) => {
        scanning.value = false;
        statusText.value = `扫描错误: ${err.errMsg}`;
      },
      timeout: 15000,
      allowDuplicates: false,
      onEnd: () => {
        scanning.value = false;
        if (devices.value.length === 0) {
          statusText.value = '未发现设备, 请确保 ESP32 已通电';
        }
      },
    });
  }

  function stopScan(): void {
    if (scanner) { scanner.stopScan(); scanner = null; }
    scanning.value = false;
  }

  /* ===================== 连接 ===================== */

  async function connectDevice(device: BLEDevice): Promise<BLEDevice> {
    statusText.value = `正在连接 ${device.name}...`;
    stopScan();

    peripheral = createPeripheral(device.deviceId);
    await peripheral.connect();
    connectedDevice.value = device;

    // 连接状态监听
    peripheral.onStateChange((state) => {
      if (state === 0) { // BLE_STATE_DISCONNECTED
        statusText.value = '设备已断开';
        connectedDevice.value = null;
      }
    });

    await sleep(1000);
    statusText.value = '正在发现服务...';

    // 发现 services + characteristics
    const allChars: { serviceUuid: string; uuid: string; properties: number }[] = [];
    await peripheral.discoverServices((svcUuid, charUuid, props) => {
      allChars.push({ serviceUuid: svcUuid, uuid: charUuid, properties: props });
    });

    platformServiceUuid = matchUUID([...new Set(allChars.map(c => c.serviceUuid))], BLE_SERVICE_UUID);
    if (!platformServiceUuid) {
      throw new Error('未找到配对服务, 请确认固件已正确烧录');
    }

    const charUUIDs = allChars.map(c => c.uuid);
    platformCharUuids.wifiSSID = matchUUID(charUUIDs, BLE_CHAR_WIFI_SSID_UUID);
    platformCharUuids.wifiPass = matchUUID(charUUIDs, BLE_CHAR_WIFI_PASS_UUID);
    platformCharUuids.serverUrl = matchUUID(charUUIDs, BLE_CHAR_SERVER_URL_UUID);
    platformCharUuids.status = matchUUID(charUUIDs, BLE_CHAR_STATUS_UUID);
    platformCharUuids.deviceInfo = matchUUID(charUUIDs, BLE_CHAR_DEVICE_INFO_UUID);

    if (!platformCharUuids.status) {
      throw new Error('未找到状态特征值, 请确认固件已正确烧录');
    }

    // 启用 Status 通知 (会写 CCCD 描述符)
    try {
      await enableNotify();
    }
    catch (e) {
      console.warn('[BLE] Observe failed:', e);
    }

    // 不读取设备信息 (避免 Android BLE 底层 read 失败导致崩溃)
    // 设备信息在配网成功后通过状态通知获取

    statusText.value = '已连接, 请填写 WiFi 信息';
    return device;
  }

  function enableNotify(): void {
    if (!peripheral || !platformCharUuids.status)
      return;
    const ref = characteristicOf(platformServiceUuid, platformCharUuids.status);
    peripheral.observe(ref, {
      onValue: (hex: string) => {
        const raw = hexToStr(hex);
        console.log('[BLE] Status:', raw);
        if (raw === 'server_connected') {
          paired.value = true;
        }
        else if (raw.startsWith('error:')) {
          statusText.value = `配对失败: ${raw.replace('error:', '')}`;
        }
        else {
          statusText.value = `设备状态: ${raw}`;
        }
      },
      onError: (err) => {
        console.warn('[BLE] Observe error:', err.errMsg);
      },
    });
  }

  /* ===================== 写入凭据 ===================== */

  async function writeChar(charName: string, charId: string, value: string): Promise<void> {
    if (!peripheral)
      throw new Error('设备未连接');
    if (!charId)
      throw new Error(`${charName} 特征值未找到`);
    const ref = characteristicOf(platformServiceUuid, charId);
    await peripheral.write(ref, strToHex(value), 0); // 0 = withResponse
  }

  async function pair(ssid: string, password: string, serverUrl: string): Promise<PairedResult> {
    if (!connectedDevice.value)
      return { success: false, message: '未连接设备' };
    statusText.value = '正在配网...';

    try {
      await writeChar('SSID', platformCharUuids.wifiSSID, ssid);
      await sleep(200);
      await writeChar('Password', platformCharUuids.wifiPass, password);
      await sleep(200);
      await writeChar('Server URL', platformCharUuids.serverUrl, serverUrl);
      statusText.value = '固件已收到凭证, 等待联网...';

      const success = await waitForPairResult(30000);
      if (success) {
        statusText.value = '配对成功！设备已联网';
        paired.value = true;
        return { success: true, message: '配对成功' };
      }
      statusText.value = '配对超时, 请检查 WiFi 密码是否正确';
      return { success: false, message: '配对超时' };
    }
    catch (e) {
      statusText.value = `写入失败: ${(e as Error).message}`;
      return { success: false, message: (e as Error).message };
    }
  }

  function waitForPairResult(timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (paired.value) { resolve(true); return; }
        if (Date.now() - start > timeout) { resolve(false); return; }
        setTimeout(check, 500);
      };
      check();
    });
  }

  /* ===================== 清理 ===================== */

  function close(): void {
    if (peripheral) {
      peripheral.disconnect();
      peripheral = null;
    }
    if (scanner) {
      scanner.stopScan();
      scanner = null;
    }
    scanning.value = false;
    connectedDevice.value = null;
    closeAdapter();
  }

  onBeforeUnmount(close);

  return {
    scanning,
    devices,
    connectedDevice,
    statusText,
    paired,
    deviceInfo,
    startScan,
    stopScan,
    connectDevice,
    pair,
    close,
  };
}
