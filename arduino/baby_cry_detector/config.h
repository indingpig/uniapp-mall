/**
 * 共享配置常量
 * 被 ble_provision / wifi_connect / 主固件引用
 */
#pragma once

#include <driver/i2s.h>   // AUDIO_I2S_PORT 用到 I2S_NUM_0

/* ================================================================== */
/*  NVS 存储                                                            */
/* ================================================================== */

#define NVS_NAMESPACE          "baby-monitor"
#define NVS_KEY_WIFI_SSID      "wifi_ssid"
#define NVS_KEY_WIFI_PASS      "wifi_pass"
#define NVS_KEY_SERVER_URL     "server_url"
#define SERVER_URL_MAX_LEN     96      // 服务器地址上限 (写入口校验, 见 server_url.h)
// 已废弃: NVS_KEY_RST_SEQ / NVS_KEY_LAST_RST (RST 连击方案, 2026-11-08 移除;
// 残留键值留在 NVS 里无害, 恢复出厂时会一并擦除)

/* ================================================================== */
/*  WiFi 连接参数                                                       */
/* ================================================================== */

#define WIFI_CONNECT_TIMEOUT_MS   30000   // 连接超时
#define WIFI_CHECK_INTERVAL_MS    3000    // 状态轮询间隔
#define WIFI_MAX_ATTEMPTS         10      // 超时前轮询次数

/* 掉线自动重连 (曾连上后掉线, 或首轮尝试放弃后的自愈):
 * 退避序列 3s → 30s → 60s 封顶, 连上即清零回 3s */
#define WIFI_BACKOFF_FIRST_MS     3000    // 掉线后首次重连退避
#define WIFI_BACKOFF_STEP2_MS     30000   // 第二档退避
#define WIFI_BACKOFF_MAX_MS       60000   // 退避封顶 (之后每次均此值)

/* ================================================================== */
/*  BLE 状态值 (通过 Status 特征值通知 App)                              */
/* ================================================================== */

#define BLE_STATUS_IDLE             "idle"
#define BLE_STATUS_SCANNING         "scanning"             // 正在扫描周边 WiFi (配网辅助)
#define BLE_STATUS_CONNECTING_WIFI  "connecting_wifi"
#define BLE_STATUS_WIFI_CONNECTED   "wifi_connected"
#define BLE_STATUS_SERVER_CONNECTED "server_connected"
#define BLE_STATUS_ERROR_WIFI       "error:wifi_failed"
#define BLE_STATUS_ERROR_WIFI_PASS  "error:wifi_password"  // 密码错误 (4 次握手超时), App 就地提示
#define BLE_STATUS_ERROR_PROVISION  "error:provisioning_closed"  // 配网窗口未开, 写入被拒
#define BLE_STATUS_ERROR_SERVER_URL "error:server_url"  // 服务器地址未通过校验, 写入被拒
#define BLE_STATUS_FACTORY_RESET    "factory_reset"  // 恢复出厂 (BOOT 长按 10s) 触发时经 BLE 通知

/* ================================================================== */
/*  BOOT 键: 配网窗口开关 + 长按恢复出厂 (双轨制主手势)                   */
/*  出厂态 (NVS 无凭据) 窗口常开; 已配网设备窗口常闭                    */
/*    按住 3s 松手 → 配网窗口; 按住 10s (按住中) → 恢复出厂              */
/* ================================================================== */

#define BOOT_BTN_PIN              0      // DevKitC 自带 BOOT 键 (GPIO0, 低电平按下)
#define BOOT_HOLD_WINDOW_MS       3000   // 按住 3s → 打开配网窗口
#define BOOT_HOLD_RESET_MS        10000  // 按住 10s → 恢复出厂 (按住中触发, 不等松手)
#define PROVISION_WINDOW_MS       (5UL * 60UL * 1000UL)  // 窗口时长: 5 分钟
#define PROV_LED_FAST_MS          100    // 窗口期 LED 快闪周期
#define PROV_LED_SLOW_MS          500    // 出厂态待配网 LED 慢闪周期

/* ================================================================== */
/*  音频链路 (audio_pipeline / baby_infer / collect_server / server_link) */
/*  硬件与参数必须与数据采集原型 audio_app、推理原型 esp32_microphone      */
/*  逐位一致: 训练数据 = 推理输入, 改动任何一项都要同步重训评估            */
/* ================================================================== */

#define AUDIO_SAMPLE_RATE         16000
#define AUDIO_I2S_PORT            I2S_NUM_0
#define AUDIO_PIN_WS              4     // INMP441 WS
#define AUDIO_PIN_SCK             5     // INMP441 SCK
#define AUDIO_PIN_SD              6     // INMP441 SD

#define AUDIO_CHUNK_SAMPLES       1024  // 采集任务每次 I2S 读取的样本数 (2KB)

// 推理窗大小 = EI_CLASSIFIER_RAW_SAMPLE_COUNT (模型元数据, 16000 = 1s @16kHz)。
// EI 模型头文件只能被 baby_infer.cpp 一个编译单元包含 (多处包含会链接期
// 重复定义), 因此这里用宏同步; baby_infer.cpp 有编译期一致性校验,
// 换模型窗口大小时改这里即可
#define INFER_WINDOW_SAMPLES      16000

// 电平表环形缓冲: 0.5s (16KB)。/rms 与串口电平用, 不影响数据链路
#define RMS_RING_SAMPLES          (AUDIO_SAMPLE_RATE / 2)

// 采集推流环形缓冲: 2s (64KB)。容忍 loop 侧 run_classifier 的阻塞;
// OOM 时可降到 1 (32KB), 代价是 App 消费不及时更容易触发 lost 重录
#define WS_RING_SECONDS           2
#define WS_RING_SAMPLES           (AUDIO_SAMPLE_RATE * WS_RING_SECONDS)

/* AGC (与 esp32_microphone.ino 的 apply_agc / audio_app_uni 的 audio.js 一致):
 * 每个推理窗(1s)按 目标RMS/实际RMS 计算增益, 限幅后归一化到训练分布 */
#define AGC_TARGET_RMS            2500.0f
#define AGC_MIN_GAIN              0.25f
#define AGC_MAX_GAIN              64.0f

/* server 上报节奏 (ws -> 后端, 消息 {"type":"audio","rms","peak"}):
 * 监听中 500ms —— 对齐后端 detector 滑动窗口的节奏;
 * 空闲 2s —— 仅作在线心跳 (后端 15s 无数据判离线) */
#define SERVER_REPORT_MS_ACTIVE   500
#define SERVER_REPORT_MS_IDLE     2000

#define SERVER_RECONNECT_MS       3000  // WS 断线重连间隔

/* 死链检测 (TCP 半开黑洞: 板子在发 audio, 服务端早已不可达, 但 TCP 写不报错,
 * 双方各揣着一条「假活」连接, App 周期性误判离线):
 * 固件每 SERVER_PING_MS 发一帧 WS ping (服务端 ws 库自动回 pong),
 * 超过 SERVER_DEAD_LINK_MS 未收到服务端任何字节即判死链, 主动断开走重连 */
#define SERVER_PING_MS            10000  // 心跳 ping 间隔
#define SERVER_DEAD_LINK_MS       30000  // 无任何下行字节的死链判定阈值 (≈3 个 ping 周期)
