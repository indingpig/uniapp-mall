/**
 * BLE 配网模块
 *
 * 职责:
 *   - 提供 BLE 外设服务 (广播/连接/特征值)
 *   - 接收 App 写入的 WiFi 凭据 (SSID/密码/服务器地址)
 *   - 通过 Status 特征值向 App 上报设备状态
 *
 * 与 WiFi 模块解耦:
 *   收到完整凭据后, 通过回调 (bleProvisionSetCredentialsCallback)
 *   通知上层, 由上层决定如何处理 (通常交给 wifi_connect)
 *
 * 使用:
 *   bleProvisionInit(deviceName);              // 初始化并开始广播
 *   bleProvisionSetCredentialsCallback(cb);    // 注册凭据回调
 *   bleProvisionUpdateStatus(BLE_STATUS_XXX);  // 任意模块上报状态
 */
#pragma once

#include <Arduino.h>

/* ================================================================== */
/*  BLE 服务/特征 UUID (与 App 端 constants/ble.ts 保持一致)            */
/* ================================================================== */

#define BLE_SERVICE_UUID            "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define BLE_CHAR_WIFI_SSID_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define BLE_CHAR_WIFI_PASS_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26a9"
#define BLE_CHAR_SERVER_URL_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26ab"
#define BLE_CHAR_DEVICE_TOKEN_UUID  "beb5483e-36e1-4688-b7f5-ea07361b26ae"  // 设备令牌 (2026-11-26 鉴权), 写
#define BLE_CHAR_STATUS_UUID        "beb5483e-36e1-4688-b7f5-ea07361b26aa"
#define BLE_CHAR_DEVICE_INFO_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26ac"
#define BLE_CHAR_WIFI_LIST_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26ad"  // 写"1"触发扫描, notify 逐条回 AP 列表

/* 服务属性句柄上限：每个特征值占 2 (声明+值)，带通知的再 +1 (CCCD)，服务声明占 1。
 * 框架 createService 默认 15，超限的特征值会被协议栈静默丢弃（2026-11-28 实证：
 * 加令牌后共 17 个，令牌没注册、手机发现不到、无任何报错）。
 * 留 6 个余量给后续特征值；启动自检 dumpGattTableOnce 会核对必需项。
 *   1(服务) + 2(SSID) + 2(密码) + 2(地址) + 3(状态) + 3(WiFi列表) + 2(设备信息) + 2(令牌) = 17 */
#define BLE_SERVICE_NUM_HANDLES     24

/* GATT 服务表版本：**每次增删服务里的特征值或描述符都 +1**。
 *
 * 为什么需要：Android 对已绑定的蓝牙设备缓存整张 GATT 属性表，重新连接时直接用
 * 缓存、不做发现；重新配对也不会刷新。2026-11-28 EMUI 实证：固件已注册令牌特征值
 * （板子侧 handle=0x38），手机发现清单里仍没有它——解绑重配、删蓝牙数据均无效。
 * 手机只对「没见过的地址」才做全新发现。所以表一变，板子就换一个蓝牙身份地址
 * （静态随机地址，由基准 MAC + 版本号确定性派生：同版本下重启不变、绑定关系保持）。
 *
 * 历史：1 = 加令牌前的 15 句柄表；2 = 含设备令牌特征值（句柄上限修复后） */
#define BLE_GATT_TABLE_VERSION      2

/* 凭据回调: App 写入 SSID+密码+服务器地址全部完成后触发 */
typedef void (*BleCredentialsCallback)(const String& ssid, const String& pass);

/**
 * 初始化 BLE 外设并开始广播
 * @param deviceName 广播设备名 (如 "BabyMonitor-XXXX")
 */
void bleProvisionInit(const char* deviceName);

/**
 * 注册凭据回调
 * @param cb 收到完整凭据时调用 (可能为空)
 */
void bleProvisionSetCredentialsCallback(BleCredentialsCallback cb);

/**
 * 上报状态给 App (通过 Status 特征值 notify)
 * @param status 见 config.h 中 BLE_STATUS_* 宏
 */
void bleProvisionUpdateStatus(const char* status);

/**
 * 刷新 DeviceInfo 特征值内容 (name/version/ip/has_wifi)
 * WiFi 连上(含重连)后由主固件调用, App 读 26ac 即得当前局域网 IP
 * (采集页自动寻址依赖; 读取无需加密/配对)
 */
void bleProvisionRefreshDeviceInfo();

/**
 * 当前是否有 App 通过 BLE 连接
 */
bool bleProvisionIsConnected();

/**
 * 配网窗口开关 (配网安全性, 改进点 2/4.2):
 *   - true:  恢复广播, 接受凭据写入
 *   - false: 停止广播, 拒绝凭据写入 (Status 回报 error:provisioning_closed)
 * 出厂态 (NVS 无凭据) 应保持 true, 由主固件在初始化时按凭据状态设定;
 * 已配网设备平时关闭, BOOT 短按重开
 */
void bleProvisionSetEnabled(bool enabled);
bool bleProvisionIsEnabled();

/**
 * 主循环轮询: 处理 WiFi 扫描结果回传 (App 写 WIFI_LIST 特征值后触发扫描)
 */
void bleProvisionLoop();
