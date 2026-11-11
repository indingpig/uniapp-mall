/**
 * 服务器地址校验 (改进点 3+7: 写入口收敛)
 *
 * 两个写入口共用同一校验:
 *   - BLE ServerURL 特征值写入 (ble_provision.cpp)
 *   - HTTP /setserver (collect_server.cpp)
 * 之前两处都只 trim() 不校验, 设备会被指到不可达/任意协议地址。
 *
 * 契约 (todolist「四个契约决策」): 校验从第一天就放行 wss:// ——
 * 服务端升级 wss 时设备只改配网 URL, 本函数不构成返工点。
 */
#pragma once

#include <Arduino.h>
#include "config.h"

inline bool serverUrlValid(const String& rawUrl) {
  String url = rawUrl;
  url.trim();                                   // 去首尾空白
  if (url.length() == 0 || url.length() > SERVER_URL_MAX_LEN)
    return false;

  const bool isWs  = url.startsWith("ws://");
  const bool isWss = url.startsWith("wss://");
  if (!isWs && !isWss)
    return false;

  // 前缀后必须有 host ("ws://" 裸前缀、"ws:///path" 均拒),
  // 且不容内部空白 (trim 只管首尾)
  String rest = url.substring(isWs ? 5 : 6);
  if (rest.length() == 0 || rest[0] == '/' || rest.indexOf(' ') >= 0)
    return false;

  return true;
}
