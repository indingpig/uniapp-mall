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
#define BLE_CHAR_STATUS_UUID        "beb5483e-36e1-4688-b7f5-ea07361b26aa"
#define BLE_CHAR_DEVICE_INFO_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26ac"

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
 * 当前是否有 App 通过 BLE 连接
 */
bool bleProvisionIsConnected();
