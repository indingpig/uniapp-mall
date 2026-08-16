/**
 * 共享配置常量
 * 被 ble_provision / wifi_connect / 主固件引用
 */
#pragma once

/* ================================================================== */
/*  NVS 存储                                                            */
/* ================================================================== */

#define NVS_NAMESPACE          "baby-monitor"
#define NVS_KEY_WIFI_SSID      "wifi_ssid"
#define NVS_KEY_WIFI_PASS      "wifi_pass"

/* ================================================================== */
/*  WiFi 连接参数                                                       */
/* ================================================================== */

#define WIFI_CONNECT_TIMEOUT_MS   30000   // 连接超时
#define WIFI_CHECK_INTERVAL_MS    3000    // 状态轮询间隔
#define WIFI_MAX_ATTEMPTS         10      // 超时前轮询次数

/* ================================================================== */
/*  BLE 状态值 (通过 Status 特征值通知 App)                              */
/* ================================================================== */

#define BLE_STATUS_IDLE             "idle"
#define BLE_STATUS_CONNECTING_WIFI  "connecting_wifi"
#define BLE_STATUS_WIFI_CONNECTED   "wifi_connected"
#define BLE_STATUS_SERVER_CONNECTED "server_connected"
#define BLE_STATUS_ERROR_WIFI       "error:wifi_failed"
