/**
 * Baby Cry Monitor - ESP32 主固件 (整合版)
 *
 * 功能模块:
 *   - ble_provision:  BLE 配网 (App 写入 WiFi 凭据 + 服务器地址, 均持久化 NVS)
 *   - wifi_connect:   WiFi 连接 + NVS 持久化, 状态机在 wifiLoop() 轮询
 *   - audio_pipeline: 唯一 I2S 采集链 (Core 0): 16kHz → 高通滤波
 *       → RMS/Peak 电平 → server 上报
 *       → 推理窗 (16000 样本 = 1s) → baby_infer AGC + run_classifier
 *       → 采集环形缓冲 → collect_server WS 推流 (App 采集页直连)
 *   - server_link:    WS 客户端连后端 (上报 audio/inference, 接收 listen 指令)
 *   - collect_server: WS 服务端 (App 采集页局域网直连录音) + mDNS babycry.local
 *
 * 交互流程:
 *   App 开启监听 → server 中继 {"cmd":"listen_on"} → 设备跑模型,
 *   识别结果回传 server 广播给 App; App 停止监听 → {"cmd":"listen_off"}。
 *   App 采集页连 ws://babycry.local/ws 采集训练数据 (与推理同一条滤波链)。
 *
 * 配网安全 (BOOT 键):
 *   出厂态 (NVS 无凭据) 常开广播 + LED 慢闪待配网;
 *   已配网设备平时无广播、拒绝凭据写入 —— BOOT 短按 3s 打开 5 分钟配网窗口
 *   (LED 快闪), 长按 10s 恢复出厂 (清 NVS + 重启)。
 *   BLE 写凭据走 Just Works 会话加密 (ESP_LE_AUTH_NO_BOND, 不持久绑定)。
 *
 * 接线 (INMP441):  WS→4, SCK→5, SD→6, VCC→3.3V, GND→GND, L/R→GND (左声道)
 */

#include <Arduino.h>
#include <WiFi.h>

// loopTask 默认栈 8KB: loop 里跑 run_classifier + HTTP/WS 收发, 实测 8KB 会
// "Stack canary watchpoint triggered" 崩溃 (audio_app 前科), 必须 16KB 且在
// setup()/loop() 之前定义
#define LOOP_TASK_STACK_SIZE 16384

#include "config.h"
#include "ble_provision.h"
#include "wifi_connect.h"
#include "audio_pipeline.h"
#include "baby_infer.h"
#include "server_link.h"
#include "collect_server.h"
#include "led.h"
#include <nvs_flash.h>

/* ================================================================== */
/*  全局状态                                                            */
/* ================================================================== */

static char deviceName[32] = "BabyMonitor-0000";
static bool s_listening = false;      // 设备是否在跑推理 (由 App 指令控制)
static bool s_collectStarted = false; // 采集服务是否已启动 (WiFi 连上后一次)
static bool s_serverStarted = false;  // server_link 是否已启动
static uint32_t s_lastHeapLog = 0;

/* 前向声明 (显式声明, 不依赖 Arduino 自动原型生成) */
void onServerCmd(const char* cmd);
void onServerLinkState(bool connected);
void startListening();
void stopListening();

/* ================================================================== */
/*  BOOT 键: 配网窗口开关 + 恢复出厂                                     */
/*  出厂态 (NVS 无凭据): 窗口常开, LED 慢闪待配网                        */
/*  已配网: 窗口常闭 + 停广播, BOOT 短按 3s 开 5 分钟窗口 (LED 快闪),    */
/*          长按 10s 恢复出厂 (清 NVS + 重启)                           */
/* ================================================================== */

static bool     s_btnDown = false;
static uint32_t s_btnDownAt = 0;
static uint32_t s_windowUntil = 0;   // 窗口截止时刻 (0 = 关; 出厂态常开不看它)
// GPIO0 防误触: 开机即低说明引脚被外部钳住 (USB 串口下载电路/按键卡死),
// 观测到一次高电平前不启用按键判定 —— 否则开个串口监视器 10s 后就会误清 NVS
static bool     s_btnArmed = false;

static bool isFactoryState() {
  return !wifiHasSavedCredentials();
}

static void closeProvisionWindow() {
  if (isFactoryState()) return;      // 出厂态不关
  s_windowUntil = 0;
  bleProvisionSetEnabled(false);
  led_off();
}

static void openProvisionWindow() {
  if (isFactoryState()) return;      // 出厂态本来就开
  s_windowUntil = millis() + PROVISION_WINDOW_MS;
  bleProvisionSetEnabled(true);
  Serial.printf("[Provision] 配网窗口开启 %lu 分钟\n",
                (unsigned long)(PROVISION_WINDOW_MS / 60000UL));
}

static void factoryReset() {
  Serial.println("[FactoryReset] 清除 NVS 并重启");
  bleProvisionUpdateStatus(BLE_STATUS_FACTORY_RESET);
  delay(200);                        // 给 BLE notify 留发送时间
  nvs_flash_erase();
  nvs_flash_init();
  ESP.restart();
}

static void bootButtonLoop() {
  bool pressed = digitalRead(BOOT_BTN_PIN) == LOW;

  if (!s_btnArmed) {
    if (!pressed) s_btnArmed = true;   // 观测到高电平 → 装填, 开始正常判定
    return;                            // 开机即低期间一律不判定
  }

  if (pressed && !s_btnDown) {
    s_btnDown = true;
    s_btnDownAt = millis();
    return;
  }
  if (!s_btnDown) return;

  if (!pressed) {
    // 松开: 按住 3s ~ 10s → 打开配网窗口
    uint32_t held = millis() - s_btnDownAt;
    s_btnDown = false;
    if (held >= BOOT_HOLD_WINDOW_MS && held < BOOT_HOLD_RESET_MS) {
      openProvisionWindow();
    }
    return;
  }

  // 持续按住达 10s: 立即恢复出厂 (不等松开, 即时反馈)
  if (millis() - s_btnDownAt >= BOOT_HOLD_RESET_MS) {
    factoryReset();
  }
}

/* ================================================================== */
/*  模块间回调 (胶水层)                                                 */
/* ================================================================== */

// WiFi 状态变化 → BLE 通知 App; 连上后启动采集服务与 server 链接
void onWifiStatus(const char* status) {
  bleProvisionUpdateStatus(status);
  if (strcmp(status, BLE_STATUS_WIFI_CONNECTED) == 0) {
    if (!s_collectStarted) {
      s_collectStarted = true;
      collectServerStart();
    }
    if (!s_serverStarted) {
      s_serverStarted = true;
      serverLinkStart(onServerCmd, onServerLinkState);
    }
  }
}

// BLE 收到完整 WiFi 凭据 → 交给 WiFi 模块连接
void onCredentialsReceived(const String& ssid, const String& pass) {
  wifiConnectBegin(ssid, pass);
}

// server 下发指令 (目前只有监听开关)
void onServerCmd(const char* cmd) {
  if (strcmp(cmd, "listen_on") == 0) {
    startListening();
  } else if (strcmp(cmd, "listen_off") == 0) {
    stopListening();
  } else {
    Serial.printf("[Cmd] 未知指令: %s\n", cmd);
  }
}

// server_link 连接状态 → BLE 通知 App; 配网闭环后关窗口停广播
void onServerLinkState(bool connected) {
  bleProvisionUpdateStatus(connected ? BLE_STATUS_SERVER_CONNECTED
                                     : BLE_STATUS_WIFI_CONNECTED);
  if (connected) {
    closeProvisionWindow();
  }
}

/* ================================================================== */
/*  监听开关                                                            */
/* ================================================================== */

void startListening() {
  if (s_listening) return;
  if (!inferStart()) {
    Serial.println("[Listen] ERR: 推理启动失败 (内存不足)");
    serverLinkSetListening(false);   // 把失败状态同步给 App
    return;
  }
  s_listening = true;
  serverLinkSetListening(true);
  Serial.println("[Listen] ON");
}

void stopListening() {
  if (!s_listening) return;
  inferStop();
  s_listening = false;
  serverLinkSetListening(false);
  Serial.println("[Listen] OFF");
}

/* ================================================================== */
/*  主程序                                                              */
/* ================================================================== */

static void printHeap(const char* tag) {
  Serial.printf("[Heap] %-14s free=%u min=%u\n",
                tag, ESP.getFreeHeap(), ESP.getMinFreeHeap());
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== Baby Cry Monitor ESP32 (整合版) ===");

  // 生成设备名 (基于 MAC 后 4 位)
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  snprintf(deviceName, sizeof(deviceName), "BabyMonitor-%s", mac.substring(8, 12).c_str());
  Serial.printf("[Info] Device: %s\n", deviceName);

  printHeap("boot");

  // WiFi 模块 (读取 NVS 自动重连)
  wifiConnectInit(onWifiStatus);

  // LED 指示灯 (板载 WS2812) 与 BOOT 键 (GPIO0, 低电平按下)
  led_init();
  pinMode(BOOT_BTN_PIN, INPUT_PULLUP);
  Serial.printf("[Boot] BOOT(GPIO0) at boot: %s%s\n",
                digitalRead(BOOT_BTN_PIN) == LOW ? "LOW" : "HIGH",
                digitalRead(BOOT_BTN_PIN) == LOW ? " (被外部钳住? 按键检测暂不启用)" : "");

  // BLE 配网模块 (WiFi 凭据 + 服务器地址写入并持久化)
  bleProvisionInit(deviceName);
  bleProvisionSetCredentialsCallback(onCredentialsReceived);

  // 配网窗口: 出厂态常开; 已配网设备默认关闭 + 停广播 (BOOT 短按重开)
  bleProvisionSetEnabled(!wifiHasSavedCredentials());

  // 音频采集链 (Core 0): I2S + 高通滤波, 常开
  audioPipelineStart();

  inferPrintInfo();
  printHeap("ready");
}

void loop() {
  // WiFi 连接状态机轮询
  wifiLoop();

  // BOOT 键检测 + 配网窗口超时 + LED 指示
  bootButtonLoop();
  if (s_windowUntil != 0 && millis() >= s_windowUntil) {
    closeProvisionWindow();
  }
  if (isFactoryState()) {
    led_blink(PROV_LED_SLOW_MS);        // 出厂态: 慢闪待配网
  } else if (s_windowUntil != 0) {
    led_blink(PROV_LED_FAST_MS);        // 窗口期: 快闪
  }

  // 采集服务端 (HTTP /rms, /setserver + WS 采集推流)
  collectServerLoop();

  // 后端 WS 客户端 (心跳/上报/收指令)
  serverLinkLoop();

  // 推理轮询: 窗口就绪才跑一次 (Core 1, 非阻塞)
  if (s_listening) {
    InferResult r;
    if (inferPoll(&r)) {
      serverLinkSetInference(r.label, r.score, r.srcRms);
    }
  }

  // 堆内存巡检 (整合后内存是最大风险点)
  uint32_t now = millis();
  if (now - s_lastHeapLog >= 30000) {
    s_lastHeapLog = now;
    printHeap(s_listening ? "listening" : "idle");
  }

  delay(1);
}
