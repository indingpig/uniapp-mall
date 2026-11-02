/**
 * 采集服务端 (搬自 audio_app.ino, 供 App 采集页局域网直连)
 *
 * 职责:
 *   - WiFi 连上后启动: WiFiServer(80) + mDNS babycry.local
 *   - WS 服务端: App 发 {"cmd":"start"/"stop"}, 板实时推送高通滤波后的
 *     PCM (16kHz/16bit/单声道, 每帧 1024 样本), 停止时回
 *     {"cmd":"done","samples":N,"lost":bool} —— 协议与 audio_app README 一致
 *   - HTTP: GET /rms 实时电平; GET /setserver?url= 写入服务器地址并重启
 *     (开发辅助, 免 BLE 配网; 正式路径仍是 BLE 写 ServerURL 特征值)
 *
 * 不含: 采集网页 (audio_app 的 index.html) / AP 配网 —— 由 BLE 配网与 App 采集页替代。
 */
#pragma once

#include <Arduino.h>

/* WiFi 连接成功后调用一次: 启动 HTTP/WS 服务并注册 mDNS */
void collectServerStart();

/* 主循环泵: 接受连接 / WS 收帧 / 采集推流 */
void collectServerLoop();

bool collectServerIsRecording();
