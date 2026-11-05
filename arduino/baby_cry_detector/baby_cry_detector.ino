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
// GPIO0 防误触 (CH343 的 DTR/RTS 会把 GPIO0 钳低, 之前踩过误清 NVS):
//   1) 装填条件从「任一次高电平」改为「连续高电平 BTN_REARM_HIGH_MS」——
//      单次采样不足以证明按键真的空闲, 上电瞬间的毛刺不会让判定永久生效;
//   2) BLE 有客户端连接时一律不恢复出厂 (见 bootButtonLoop): 配网中手机还连着,
//      清 NVS 会立刻断连并丢掉刚写入的凭据, 而钳低恰好最容易在这个窗口里撞上。
static bool     s_btnArmed = false;
static uint32_t s_btnHighSince = 0;            // 连续高电平起始时刻 (0 = 尚未观测到)
static const uint32_t BTN_REARM_HIGH_MS = 2000;

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
  Serial.printf("[FactoryReset] GPIO0=%d BLE=%d, 清除 NVS 并重启\n",
                digitalRead(BOOT_BTN_PIN), bleProvisionIsConnected() ? 1 : 0);
  bleProvisionUpdateStatus(BLE_STATUS_FACTORY_RESET);
  delay(200);                        // 给 BLE notify 留发送时间
  nvs_flash_erase();
  nvs_flash_init();
  ESP.restart();
}

static void bootButtonLoop() {
  bool pressed = digitalRead(BOOT_BTN_PIN) == LOW;
  uint32_t now = millis();

  // 装填: 必须连续高电平保持 BTN_REARM_HIGH_MS; 开机即低 (被钳住) 期间永不装填
  if (!s_btnArmed) {
    if (pressed) {
      s_btnHighSince = 0;
      return;
    }
    if (s_btnHighSince == 0) {
      s_btnHighSince = now;
      return;
    }
    if (now - s_btnHighSince >= BTN_REARM_HIGH_MS) {
      s_btnArmed = true;
      Serial.println("[Btn] armed (GPIO0 idle high)");
    }
    return;
  }

  if (pressed && !s_btnDown) {
    s_btnDown = true;
    s_btnDownAt = now;
    s_btnHighSince = 0;
    Serial.println("[Btn] press");
    return;
  }
  if (!s_btnDown) return;

  if (!pressed) {
    // 松开: 按住 3s ~ 10s → 打开配网窗口
    uint32_t held = now - s_btnDownAt;
    s_btnDown = false;
    s_btnHighSince = now;
    Serial.printf("[Btn] release, held %lu ms\n", (unsigned long)held);
    if (held >= BOOT_HOLD_WINDOW_MS && held < BOOT_HOLD_RESET_MS) {
      openProvisionWindow();
    }
    return;
  }

  // 持续按住达 10s: 立即恢复出厂 (不等松开, 即时反馈)
  if (now - s_btnDownAt < BOOT_HOLD_RESET_MS) return;

  // 配网过程中手机还连着: 拒绝恢复出厂。这条同时是串口钳低 GPIO0 的兜底 ——
  // 误触发只可能发生在「有客户端连接」的窗口里, 直接不认;
  // 之后必须重新观测到连续高电平才会再装填, 不会连续误判。
  if (bleProvisionIsConnected()) {
    Serial.println("[Btn] hold 10s ignored: BLE client connected");
    s_btnDown = false;
    s_btnArmed = false;
    s_btnHighSince = 0;
    return;
  }

  // 出厂态没有可清的凭据: 清一遍只会白白重启, 把正在进行的手动配对打断
  if (isFactoryState()) {
    Serial.println("[Btn] hold 10s ignored: already factory state");
    s_btnDown = false;
    return;
  }

  factoryReset();
}

/* ================================================================== */
/*  模块间回调 (胶水层)                                                 */
/* ================================================================== */

// WiFi 状态变化 → BLE 通知 App; 连上后启动采集服务与 server 链接
void onWifiStatus(const char* status) {
  bleProvisionUpdateStatus(status);
  if (strcmp(status, BLE_STATUS_WIFI_CONNECTED) == 0) {
    led_off();   // 凭据已生效: 结束待配网/窗口闪烁, 之后由 server_connected 收尾
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

  // BLE 配网轮询 (WiFi 列表扫描结果回传)
  bleProvisionLoop();

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
