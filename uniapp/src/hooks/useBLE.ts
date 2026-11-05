// #ifndef H5
import type { Advertisement } from '@/uni_modules/bin-bluetooth';
// #endif
import { onBeforeUnmount, ref } from 'vue';
import {
  BLE_CHAR_DEVICE_INFO_UUID,
  BLE_CHAR_SERVER_URL_UUID,
  BLE_CHAR_STATUS_UUID,
  BLE_CHAR_WIFI_LIST_UUID,
  BLE_CHAR_WIFI_PASS_UUID,
  BLE_CHAR_WIFI_SSID_UUID,
  BLE_SERVICE_UUID,
  DEVICE_NAME_PREFIX,
} from '@/constants/ble';
import { CACHE_KEY } from '@/constants/cache';
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
// H5 无原生蓝牙：引入模拟器（运行时把 openAdapter 等实现挂到全局），让配对流程可在浏览器完整走通
import '@/mock/ble-adapter';

type H5Advertisement = Record<string, string | number>;
interface H5ScannerLike {
  startScan: (options: {
    services: string[];
    namePrefix: string;
    onAdvertisement: (adv: H5Advertisement) => void;
    onError: (err: { errMsg: string }) => void;
    timeout: number;
    allowDuplicates: boolean;
    onEnd: () => void;
  }) => void;
  stopScan: () => void;
}
declare function createScanner(): H5ScannerLike;
interface H5PeripheralLike {
  connect: () => Promise<void>;
  disconnect: () => void;
  onStateChange: (cb: (state: number) => void) => void;
  discoverServices: (cb: (svc: string, char: string, props: number) => Promise<void>) => Promise<void>;
  observe: (ref: { serviceUuid: string; characterUuid: string }, handlers: { onValue: (v: string) => void; onError: (e: { errMsg: string }) => void }) => void;
  write: (ref: { serviceUuid: string; characterUuid: string }, value: string, type: number) => Promise<void>;
}
declare function createPeripheral(deviceId: string): H5PeripheralLike;
declare function characteristicOf(service: string, char: string): { serviceUuid: string; characterUuid: string };
declare function openAdapter(): Promise<boolean>;
declare function closeAdapter(): void;
// #endif

export interface BLEDevice {
  deviceId: string;
  name: string;
  RSSI: number;
}

export interface WifiAp {
  ssid: string;
  rssi: number;
  auth: number; // 0 = 开放网络, 其余需要密码
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
  const wifiList = ref<WifiAp[]>([]);
  const wifiScanning = ref(false);

  let scanner: ReturnType<typeof createScanner> | null = null;
  let peripheral: ReturnType<typeof createPeripheral> | null = null;
  let platformServiceUuid = '';
  const platformCharUuids = {
    wifiSSID: '',
    wifiPass: '',
    serverUrl: '',
    status: '',
    deviceInfo: '',
    wifiList: '',
  };

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

  /* WiFi 列表: notify 分片按 \n 分行重组, SSID 是 UTF-8 多字节, 手写解码 */
  function hexToBytes(hex: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i + 1 < hex.length; i += 2) {
      bytes.push(Number.parseInt(hex.substring(i, i + 2), 16));
    }
    return bytes;
  }

  function bytesToUtf8(bytes: number[]): string {
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      let len = 1;
      let cp = b;
      if (b >= 0xC0 && b < 0xE0) {
        len = 2;
        cp = b & 0x1F;
      }
      else if (b >= 0xE0 && b < 0xF0) {
        len = 3;
        cp = b & 0x0F;
      }
      else if (b >= 0xF0 && b < 0xF8) {
        len = 4;
        cp = b & 0x07;
      }
      else if (b >= 0x80) {
        out += '\uFFFD';
        i++;
        continue;
      }
      if (i + len > bytes.length) {
        out += '\uFFFD';
        break;
      }
      for (let k = 1; k < len; k++) cp = (cp << 6) | (bytes[i + k] & 0x3F);
      out += String.fromCodePoint(cp);
      i += len;
    }
    return out;
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
    // 先置扫描中再等适配器：避免 await 窗口期内页面状态机误判为"扫描超时"
    scanning.value = true;

    const ok = await openAdapter();
    if (!ok) {
      scanning.value = false;
      statusText.value = '请开启手机蓝牙后再试';
      return;
    }
    statusText.value = '正在扫描设备...';
    scanner = createScanner();

    scanner.startScan({
      services: [] as string[],
      namePrefix: DEVICE_NAME_PREFIX,
      onAdvertisement: (adv: Advertisement) => {
        const name = adv.name || '';
        if (name.startsWith(DEVICE_NAME_PREFIX)) {
          if (!devices.value.some(d => d.deviceId === adv.deviceId)) {
            devices.value.push({ deviceId: String(adv.deviceId), name, RSSI: Number(adv.rssi) });
            devices.value.sort((a, b) => b.RSSI - a.RSSI);
          }
        }
      },
      onError: (err) => {
        scanning.value = false;
        statusText.value = `扫描错误: ${err.errMsg}`;
      },
      timeout: 30000, // 设计规范 v1.1.13：扫描超时态按 30s 无结果判定
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
    if (scanner) {
      scanner.stopScan();
      scanner = null;
    }
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
    await peripheral.discoverServices(async (svcUuid, charUuid, props) => {
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
    // WiFi 列表特征值: 旧固件可能没有, 缺失时配对页回退手输 SSID
    platformCharUuids.wifiList = matchUUID(charUUIDs, BLE_CHAR_WIFI_LIST_UUID);

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
        console.warn('[BLE] Status:', raw);
        if (raw === 'server_connected') {
          paired.value = true;
          uni.setStorageSync(CACHE_KEY.PAIRED_DEVICE, { name: connectedDevice.value?.name ?? '' });
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

  /* ===================== WiFi 列表 (免手输 SSID) ===================== */

  let wifiListBuf: number[] = [];
  let wifiListTimer: ReturnType<typeof setTimeout> | null = null;

  function endWifiScan() {
    wifiScanning.value = false;
    if (wifiListTimer) {
      clearTimeout(wifiListTimer);
      wifiListTimer = null;
    }
  }

  function handleWifiListChunk(hex: string) {
    wifiListBuf.push(...hexToBytes(hex));
    // 逐行提取以 \n 结尾的完整行 (分片重组)
    let nl = wifiListBuf.indexOf(0x0A);
    while (nl >= 0) {
      const lineBytes = wifiListBuf.splice(0, nl + 1);
      lineBytes.pop();
      nl = wifiListBuf.indexOf(0x0A);
      if (lineBytes.length === 0)
        continue;
      const line = bytesToUtf8(lineBytes).trim();
      if (!line)
        continue;
      try {
        const obj = JSON.parse(line) as { ssid?: string; rssi?: number; auth?: number; done?: boolean; error?: string };
        if (obj.done) {
          endWifiScan();
          statusText.value = wifiList.value.length > 0
            ? `已获取 ${wifiList.value.length} 个 WiFi`
            : '未扫描到周边 WiFi, 请手输 WiFi 名称';
          return;
        }
        if (obj.error) {
          endWifiScan();
          statusText.value = '设备扫描 WiFi 失败, 请手输 WiFi 名称';
          return;
        }
        if (obj.ssid)
          wifiList.value.push({ ssid: obj.ssid, rssi: obj.rssi ?? -100, auth: obj.auth ?? 1 });
      }
      catch { /* 不完整或非 JSON 行, 跳过 */ }
    }
  }

  /**
   * 触发设备扫描周边 WiFi, 结果经 WIFI_LIST 特征值 notify 回来 (见 handleWifiListChunk)。
   * 旧固件无此特征值时抛错, 配对页回退手输 SSID。
   */
  async function startWifiScan(): Promise<void> {
    if (!peripheral || !connectedDevice.value)
      throw new Error('设备未连接');
    if (!platformCharUuids.wifiList)
      throw new Error('固件不含 WiFi 列表功能, 请手输 WiFi 名称');
    if (wifiScanning.value)
      return;

    wifiList.value = [];
    wifiListBuf = [];
    wifiScanning.value = true;
    statusText.value = '正在获取周边 WiFi 列表...';

    // 兜底: 固件未实现/notify 丢失时 6s 收尾, 不永远转圈
    wifiListTimer = setTimeout(() => {
      if (!wifiScanning.value)
        return;
      endWifiScan();
      statusText.value = wifiList.value.length > 0
        ? `已获取 ${wifiList.value.length} 个 WiFi`
        : '获取 WiFi 列表超时, 请手输 WiFi 名称';
    }, 6000);

    const listRef = characteristicOf(platformServiceUuid, platformCharUuids.wifiList);
    peripheral.observe(listRef, {
      onValue: (hex: string) => handleWifiListChunk(hex),
      onError: (err) => {
        console.warn('[BLE] WiFiList observe error:', err.errMsg);
        endWifiScan();
        statusText.value = '获取 WiFi 列表失败';
      },
    });
    // observe 写 CCCD 是异步的, 稍候再触发扫描, 避免通知先于订阅到达
    await sleep(150);
    await writeChar('WiFiList', platformCharUuids.wifiList, '1');
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
        uni.setStorageSync(CACHE_KEY.PAIRED_DEVICE, { name: connectedDevice.value?.name ?? '' });
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
        if (paired.value) {
          resolve(true);
          return;
        }
        if (Date.now() - start > timeout) {
          resolve(false);
          return;
        }
        setTimeout(check, 500);
      };
      check();
    });
  }

  /* ===================== 清理 ===================== */

  function close(): void {
    endWifiScan();
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
    wifiList,
    wifiScanning,
    startScan,
    stopScan,
    connectDevice,
    startWifiScan,
    pair,
    close,
  };
}
