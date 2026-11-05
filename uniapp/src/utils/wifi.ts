/**
 * 手机侧 WiFi 辅助（配对页专用）
 *
 * 1. 读取系统「当前连接」的 SSID，只用于预选 —— 已保存的 WiFi 密码三端都不开放
 *    （Android 10+ 连配置里的 preSharedKey 都已脱敏），密码只能手输或扫码。
 * 2. 解析 WiFi 二维码：用户在系统 WiFi 设置里「分享」生成的
 *    `WIFI:T:WPA;S:<ssid>;P:<pass>;H:false;;`，由用户主动提供，
 *    不涉及读取系统凭据。
 *
 * 平台差异集中在这里，页面内不写条件编译指令：uni-pages 会把带平台条件块的页面
 * 包进条件编译，导致该页在部分端不注册（见 pages/collect/index.vue 的注释）。
 */

export interface WifiQr {
  ssid: string;
  password: string;
}

export type WifiQrScanResult
  = | { status: 'ok'; data: WifiQr }
    | { status: 'invalid' } // 扫到二维码了，但不是 WiFi 格式
    | { status: 'cancel' }; // 用户取消 / 平台不支持 / 无相机权限

/** Android 返回的 SSID 可能带双引号（"MyWiFi"），去掉首尾引号与空白 */
function normalizeSsid(raw?: string): string {
  return (raw ?? '').replace(/^"|"$/g, '').trim();
}

/**
 * 手机当前连接的 WiFi 名称。取不到（未连接 / 无定位权限 / 平台不支持）返回空串，
 * 调用方静默忽略即可 —— 这只是省一次手输，不阻塞配网。
 */
export function getConnectedSsid(): Promise<string> {
  // #ifdef H5
  return Promise.resolve('');
  // #endif

  // #ifndef H5
  return new Promise((resolve) => {
    try {
      uni.getConnectedWifi({
        success: res => resolve(normalizeSsid(res.wifi?.SSID)),
        fail: () => resolve(''),
        complete: () => {},
      });
    }
    catch {
      resolve('');
    }
  });
  // #endif
}

/**
 * 解析 WiFi 二维码，格式：WIFI:T:WPA;S:SSID;P:password;H:false;;
 * 值里的反斜杠是转义符（\; \: \, \\），按规范逐个还原。
 */
export function parseWifiQr(text: string): WifiQr | null {
  const raw = (text || '').trim();
  if (!/^WIFI:/i.test(raw))
    return null;

  const fields: Record<string, string> = {};
  let key = '';
  let value = '';
  let inValue = false;

  for (let i = 5; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      value += raw[++i];
      continue;
    }
    if (!inValue && ch === ':') {
      key = value;
      value = '';
      inValue = true;
      continue;
    }
    if (ch === ';') {
      if (key)
        fields[key.toUpperCase()] = value;
      key = '';
      value = '';
      inValue = false;
      continue;
    }
    value += ch;
  }
  if (key)
    fields[key.toUpperCase()] = value;

  const ssid = fields.S;
  if (!ssid)
    return null;
  return { ssid, password: fields.P ?? '' };
}

/** 调起扫码。App 端依赖 manifest 的 Barcode 模块与相机权限 */
export function scanWifiQr(): Promise<WifiQrScanResult> {
  // #ifdef H5
  return Promise.resolve({ status: 'cancel' });
  // #endif

  // #ifndef H5
  return new Promise((resolve) => {
    try {
      uni.scanCode({
        scanType: ['qrCode'],
        success: (res) => {
          const data = parseWifiQr(res.result);
          resolve(data ? { status: 'ok', data } : { status: 'invalid' });
        },
        fail: () => resolve({ status: 'cancel' }),
        complete: () => {},
      });
    }
    catch {
      resolve({ status: 'cancel' });
    }
  });
  // #endif
}
