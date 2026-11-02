/**
 * 设备侧 WebSocket 客户端 (连接 Node 后端)
 *
 * 职责:
 *   - WiFi 连上后从 NVS 读服务器地址, 连 ws://<host:port>/ws?device=esp32
 *     (后端按 URL 含 "esp32" 识别设备身份, 无鉴权)
 *   - 上报: {"type":"audio","rms","peak"} 心跳 (监听中 500ms / 空闲 2s)
 *           {"type":"inference","label","score","rms"} (每有新识别结果时)
 *           {"type":"listenState","listening"} (监听状态变化时)
 *   - 接收: {"type":"cmd","cmd":"listen_on"|"listen_off"} → 回调上层
 *
 * RFC6455 客户端实现要点 (与 audio_app 的服务端实现配对参考):
 *   - 客户端发出的帧必须带 4 字节掩码 (XOR); 服务端下行帧不带掩码
 *   - 握手校验 Sec-WebSocket-Accept (SHA1 + 固定 GUID, 复用 mbedtls)
 *   - 断线 3s 重连; 重连成功后补发一次当前监听状态
 */
#pragma once

#include <Arduino.h>

typedef void (*ServerCmdCallback)(const char* cmd);
typedef void (*ServerLinkStateCallback)(bool connected);

/* WiFi 连上后调用一次: 从 NVS 读 server_url 并开始连接循环 */
void serverLinkStart(ServerCmdCallback cmdCb, ServerLinkStateCallback stateCb);

/* 主循环泵: 建连/重连/收帧/心跳, 非阻塞 (connect 尝试除外) */
void serverLinkLoop();

/* 监听状态由主固件持有, 变化时同步进来并主动广播一次 */
void serverLinkSetListening(bool on);

/* inferPoll 返回 true 后喂数据, 下一次 loop 发出 */
void serverLinkSetInference(const char* label, float score, uint32_t srcRms);

bool serverLinkIsConnected();
