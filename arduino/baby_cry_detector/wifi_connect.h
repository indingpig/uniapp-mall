/**
 * WiFi 连接模块
 *
 * 职责:
 *   - 管理 WiFi 连接状态机 (非阻塞, 在 wifiLoop() 中轮询)
 *   - NVS 持久化 WiFi 凭据, 开机自动重连
 *   - 连接状态通过回调上报 (通常转发给 BLE 模块通知 App)
 *
 * 与 BLE 模块解耦:
 *   - 通过 wifiConnectInit() 传入状态回调
 *   - 通过 wifiConnectBegin() 由上层 (BLE 凭据回调) 触发连接
 *
 * 使用:
 *   wifiConnectInit(onStatus);                     // setup 中初始化
 *   wifiConnectBegin(ssid, pass);                  // 收到新凭据时调用
 *   wifiLoop();                                    // loop 中轮询
 */
#pragma once

#include <Arduino.h>

/* 状态回调: 上报 WiFi 连接状态变化 (见 config.h BLE_STATUS_* 宏) */
typedef void (*WifiStatusCallback)(const char* status);

/**
 * 初始化 WiFi 模块
 * - 读取 NVS 中的已保存凭据
 * - 若有凭据, 立即开始自动重连
 * @param statusCb 状态回调 (可能为空)
 */
void wifiConnectInit(WifiStatusCallback statusCb);

/**
 * 使用新的凭据开始连接 (非阻塞)
 * @param ssid WiFi 名称
 * @param pass WiFi 密码
 */
void wifiConnectBegin(const String& ssid, const String& pass);

/**
 * 状态轮询 (必须在主 loop 中调用)
 * 处理连接结果: 成功/超时
 */
void wifiLoop();

/**
 * 当前是否已连接 WiFi
 */
bool wifiIsConnected();

/**
 * 获取本地 IP (未连接时返回 "0.0.0.0")
 */
String wifiGetIP();
