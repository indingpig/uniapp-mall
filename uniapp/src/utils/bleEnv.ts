/**
 * 蓝牙环境差异开关（平台差异集中在此，页面文件内禁止条件编译指令）
 *
 * H5 真实蓝牙（Web Bluetooth）的 requestDevice 必须由用户手势触发，
 * 进页面自动扫描会被浏览器以 SecurityError 拒绝；mock 模拟器无此限制。
 * App / 小程序端无手势限制，进页面即可自动扫描。
 */
// #ifdef H5
import { BLE_MOCK_ENABLED } from '@/mock/ble-adapter';
// #endif

let autoBleOnMount = true;
// #ifdef H5
autoBleOnMount = BLE_MOCK_ENABLED;
// #endif

export const AUTO_BLE_ON_MOUNT = autoBleOnMount;
