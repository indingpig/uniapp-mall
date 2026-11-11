/**
 * WiFi 连接模块
 *
 * 职责:
 *   - 管理 WiFi 连接状态机 (非阻塞, 在 wifiLoop() 中轮询)
 *   - NVS 持久化 WiFi 凭据, 开机自动重连
 *   - 掉线自愈: 曾连上后掉线按退避序列 (3s→30s→60s 封顶) 自动重连
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
 * NVS 中是否已保存 WiFi 凭据 (wifiConnectInit 时读取)
 * 用于判定「出厂态」: 无凭据 = 配网窗口常开
 */
bool wifiHasSavedCredentials();

/**
 * 获取本地 IP (未连接时返回 "0.0.0.0")
 */
String wifiGetIP();

/**
 * 是否处于「曾连上后掉线 (或首轮放弃) 的退避重连」状态
 * 用于 LED 慢闪区分配网快闪 (主固件 loop 中指示)
 */
bool wifiIsReconnecting();

/**
 * 本轮掉线以来已发起的重连尝试次数 (连上即清零, 新一轮掉线重新计数)
 * 改进点 8 遥测字段的数据源: App 离线横幅「已尝试 N 次」
 */
uint32_t wifiGetReconnectCount();
