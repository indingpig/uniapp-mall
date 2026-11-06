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
 * 配网安全 (BOOT + RST 双键分工):
 *   出厂态 (NVS 无凭据) 常开广播 + LED 慢闪待配网;
 *   已配网设备平时无广播、拒绝凭据写入 —— BOOT 按住 3s 松手打开 5 分钟
 *   配网窗口 (LED 快闪); 恢复出厂 = 3s 内连按 3 次 RST 键 (清 NVS + 重启,
 *   计数持久化 NVS, 只认上电级复位, 串口/烧录不误触)。
 *   BLE 写凭据走 Just Works 会话加密 (ESP_LE_AUTH_BOND, 持久绑定)。
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
#include <Preferences.h>
#include "esp32s3/rom/rtc.h"   // rtc_get_reset_reason: ROM 级复位码 (区分 RST 键/串口/esp_restart)

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
/*  RST 键连击恢复出厂 (与 BOOT 键职责分开)                              */
/*  RST 接 CHIP_PU 是纯硬件复位, 固件读不到电平; 改为每次重启后查 NVS    */
/*  计数: 只有上电级复位 (ROM 码 0x1, RST 键/插 USB 同码) 才累计 ——      */
/*  串口开关 (0x15)、esp_restart (0x3)、panic 等一律清零, 插拔串口、    */
/*  烧录不会误累计; 正常使用也不可能在 3s 内上电 3 次。标志持久化 NVS    */
/*  (EN 复位是否保留 RTC 内存未验证, NVS 与上电方式无关, 更稳)。        */
/* ================================================================== */

static bool isFactoryState() {
  return !wifiHasSavedCredentials();
}

static uint32_t s_rstSeqClearAt = 0;   // 计数清零时刻 (0 = 无定时)

// 擦 NVS 并重启。启动早期 (BLE 未初始化) 直接可调
static void factoryResetNow() {
  Serial.println("[FactoryReset] 清除 NVS 并重启");
  nvs_flash_erase();
  nvs_flash_init();
  ESP.restart();
}

// setup() 最前面调用: 读上次计数 → 累计 / 触发恢复出厂 / 清零
static void rstSeqBootCheck() {
  uint32_t romCode = rtc_get_reset_reason(0);   // PRO_CPU
  Serial.printf("[Boot] reset ROM code: 0x%02X (%s)\n", romCode,
                romCode == 0x01 ? "上电级: RST 键/插 USB, 计入连击" : "不计入连击");

  Preferences prefs;
  prefs.begin(NVS_NAMESPACE, false);

  // 原生 USB-Serial-JTAG 方案下, 按 RST 会让 USB 重新枚举, 那一轮的启动日志抓不到;
  // 打开串口本身又会复位一次 (USB_UART_CHIP_RESET) —— 所以把本次复位码存 NVS,
  // 下次启动打印上一次的值, 补上抓不到的那条
  uint32_t prevCode = prefs.getUInt(NVS_KEY_LAST_RST, 0xFFFFFFFFUL);
  if (prevCode != 0xFFFFFFFFUL) {
    Serial.printf("[Boot] 上次复位码: 0x%02X\n", prevCode);
  }
  prefs.putUInt(NVS_KEY_LAST_RST, romCode);

  uint32_t v = prefs.getUInt(NVS_KEY_RST_SEQ, 0);

  if (romCode != 0x01) {
    v = 0;
  } else if ((v >> 16) == RST_SEQ_MAGIC && (v & 0xFFFF) + 1 >= RST_SEQ_TRIGGER_COUNT) {
    // 达标: 先落盘清零, 避免重启后再次命中
    prefs.putUInt(NVS_KEY_RST_SEQ, 0);
    prefs.end();
    if (isFactoryState()) {
      Serial.println("[RstSeq] 出厂态无凭据可清, 跳过恢复出厂");
      return;
    }
    for (int i = 0; i < 5; i++) {     // 红灯快闪 1s: 「确认要清了」的可见反馈
      neopixelWrite(RGB_BUILTIN, 64, 0, 0);
      delay(100);
      neopixelWrite(RGB_BUILTIN, 0, 0, 0);
      delay(100);
    }
    factoryResetNow();                // 不返回
    return;
  } else {
    v = ((v >> 16) == RST_SEQ_MAGIC) ? (v & 0xFFFF) + 1 : 1;
  }
  prefs.putUInt(NVS_KEY_RST_SEQ, (RST_SEQ_MAGIC << 16) | v);
  prefs.end();

  s_rstSeqClearAt = millis() + RST_SEQ_WINDOW_MS;
  Serial.printf("[RstSeq] 连击 %lu/%lu, %lus 内再按 RST 继续累计\n",
                (unsigned long)v, (unsigned long)RST_SEQ_TRIGGER_COUNT,
                (unsigned long)(RST_SEQ_WINDOW_MS / 1000UL));
  if (v >= 2) {                       // 第 2 次起黄灯快闪提示, 第 1 次免打扰
    for (int i = 0; i < 3; i++) {
      neopixelWrite(RGB_BUILTIN, 48, 32, 0);
      delay(120);
      neopixelWrite(RGB_BUILTIN, 0, 0, 0);
      delay(120);
    }
  }
}

/* ================================================================== */
/*  BOOT 键: 配网窗口开关                                                */
/*  出厂态 (NVS 无凭据): 窗口常开, LED 慢闪待配网                        */
/*  已配网: 窗口常闭 + 停广播, BOOT 按住 3s 松手开 5 分钟窗口 (LED 快闪) */
/* ================================================================== */

static bool     s_btnDown = false;
static uint32_t s_btnDownAt = 0;
static uint32_t s_windowUntil = 0;   // 窗口截止时刻 (0 = 关; 出厂态常开不看它)
// GPIO0 防误触 (CH343 的 DTR/RTS 会把 GPIO0 钳低): 装填条件为「连续高电平
// BTN_REARM_HIGH_MS」—— 单次采样不足以证明按键真的空闲, 上电瞬间的毛刺
// 不会让判定永久生效; 被钳住期间永不装填, 解除钳制后须连续空闲 2s 才恢复。
static bool     s_btnArmed = false;
static uint32_t s_btnHighSince = 0;            // 连续高电平起始时刻 (0 = 尚未观测到)
static const uint32_t BTN_REARM_HIGH_MS = 2000;

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
    // 松开: 按住满 3s → 打开配网窗口 (恢复出厂已移到 RST 键, 无时长上限)
    uint32_t held = now - s_btnDownAt;
    s_btnDown = false;
    s_btnHighSince = now;
    Serial.printf("[Btn] release, held %lu ms\n", (unsigned long)held);
    if (held >= BOOT_HOLD_WINDOW_MS) {
      openProvisionWindow();
    }
    return;
  }
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

  // LED (板载 WS2812) 与 BOOT 键 (GPIO0, 低电平按下) 先就绪:
  // RST 连击的恢复出厂反馈要在这之后立刻可用
  led_init();
  pinMode(BOOT_BTN_PIN, INPUT_PULLUP);
  Serial.printf("[Boot] BOOT(GPIO0) at boot: %s%s\n",
                digitalRead(BOOT_BTN_PIN) == LOW ? "LOW" : "HIGH",
                digitalRead(BOOT_BTN_PIN) == LOW ? " (被外部钳住? 按键检测暂不启用)" : "");

  // RST 连击检测: 达标则在此擦 NVS 重启, 永不返回 (必须在读 NVS 凭据之前)
  rstSeqBootCheck();

  // 生成设备名 (基于 MAC 后 4 位)
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  snprintf(deviceName, sizeof(deviceName), "BabyMonitor-%s", mac.substring(8, 12).c_str());
  Serial.printf("[Info] Device: %s\n", deviceName);

  printHeap("boot");

  // WiFi 模块 (读取 NVS 自动重连)
  wifiConnectInit(onWifiStatus);

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

  // RST 连击计数窗口到期: 清零 (下次上电从 1 重新计)
  if (s_rstSeqClearAt != 0 && millis() >= s_rstSeqClearAt) {
    s_rstSeqClearAt = 0;
    Preferences prefs;
    prefs.begin(NVS_NAMESPACE, false);
    prefs.putUInt(NVS_KEY_RST_SEQ, 0);
    prefs.end();
  }

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
