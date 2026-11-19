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
 *   监听偏好持久化 (2026-11-19 语义调整): 出厂态不开推理 (结果无处上报且
 *   挤占配网内存); 配网成功默认开 (NVS 固化); App 开关 listen_on/off 是
 *   持久偏好, 设备重启仍生效, 不随 App 在线启停。
 *   App 采集页连 ws://babycry.local/ws 采集训练数据 (与推理同一条滤波链)。
 *
 * 配网安全 (BOOT 双手势; RST 连击已废弃, 见下方「恢复出厂」节):
 *   出厂态/窗口期 LED 快闪可配网, 无凭据且窗口已关 LED 慢闪;
 *   已配网设备平时无广播、拒绝凭据写入 —— BOOT 按住 3s 松手打开 5 分钟
 *   配网窗口 (LED 快闪); 恢复出厂 = BOOT 按住 10s (擦 NVS, 等松手才重启)。
 *   BLE 写凭据走 Just Works 加密 (ESP_LE_AUTH_BOND 持久绑定):
 *   首次配对系统弹框, 已配对手机重连静默加密。
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

/* ================================================================== */
/*  全局状态                                                            */
/* ================================================================== */

static char deviceName[32] = "BabyMonitor-0000";
static bool s_listening = false;      // 推理是否在跑 (开关语义见 onServerCmd)
static bool s_bleSession = false;     // BLE 会话活跃 (配网/采集): 期间暂停推理, 见 loop
static bool s_inferWanted = true;     // 监听偏好 (NVS 持久化): 配网成功默认开, App 可关
static bool s_provisioned = false;    // 是否已配网 (出厂态不开推理)
static bool s_collectStarted = false; // 采集服务是否已启动 (WiFi 连上后一次)
static bool s_serverStarted = false;  // server_link 是否已启动
static uint32_t s_lastHeapLog = 0;

/* 前向声明 (显式声明, 不依赖 Arduino 自动原型生成) */
void onServerCmd(const char* cmd);
void onServerLinkState(bool connected);
void startListening();
void stopListening();
static void persistInferWanted();

/* ================================================================== */
/*  恢复出厂                                                            */
/*  RST 键连击方案已废弃 (2026-11-08): RST 接 CHIP_PU 是纯硬件复位,     */
/*  软件读不到, 跨重启计数推断在「每按一次断一次 USB」的现实中节奏极难  */
/*  命中 (3s/6s 窗口多轮实测均失败), 且与插 USB 上电同码无法区分。      */
/*  恢复出厂统一走 BOOT 长按 10s (见下方 BOOT 键节)。                   */
/* ================================================================== */

static bool isFactoryState() {
  return !wifiHasSavedCredentials();
}

// 监听偏好落盘 (NVS)。调用点都在指令/配网回调里, 不在音频热路径
static void persistInferWanted() {
  Preferences prefs;
  prefs.begin(NVS_NAMESPACE, false);
  prefs.putBool(NVS_KEY_INFER_ON, s_inferWanted);
  prefs.end();
}

// 擦 NVS 并重启。由 BOOT 长按触发, 此时 GPIO0 仍被手指按住 —— 立即重启会因
// strap 采到低电平进 ROM 下载模式, 看起来像死机, 故红灯闪烁等待松手再重启
static void factoryResetNow() {
  Serial.println("[FactoryReset] 清除 NVS 并重启");
  nvs_flash_erase();
  nvs_flash_init();
  while (digitalRead(BOOT_BTN_PIN) == LOW) {
    neopixelWrite(RGB_BUILTIN, 64, 0, 0);
    delay(120);
    neopixelWrite(RGB_BUILTIN, 0, 0, 0);
    delay(120);
  }
  ESP.restart();
}

/* ================================================================== */
/*  BOOT 键: 配网窗口开关 + 长按恢复出厂                                  */
/*  出厂态 (NVS 无凭据): 窗口常开, LED 慢闪待配网                        */
/*  已配网: 窗口常闭 + 停广播                                           */
/*    按住 3s 松手 → 开 5 分钟配网窗口 (LED 快闪)                        */
/*    按住 10s (按住中) → 恢复出厂; 3s 处黄灯提示「可松手」, 10s 起红灯   */
/* ================================================================== */

static bool     s_btnDown = false;
static bool     s_btnHint3s = false; // 本次按住是否已给过「到窗口阈值」提示
static uint32_t s_btnDownAt = 0;
static uint32_t s_windowUntil = 0;   // 配网窗口截止时刻 (0 = 关)
// GPIO0 防误触 (CH343 的 DTR/RTS 会把 GPIO0 钳低): 装填条件为「连续高电平
// BTN_REARM_HIGH_MS」—— 单次采样不足以证明按键真的空闲, 上电瞬间的毛刺
// 不会让判定永久生效; 被钳住期间永不装填, 解除钳制后须连续空闲 2s 才恢复。
static bool     s_btnArmed = false;
static uint32_t s_btnHighSince = 0;            // 连续高电平起始时刻 (0 = 尚未观测到)
static const uint32_t BTN_REARM_HIGH_MS = 2000;

static void closeProvisionWindow() {
  s_windowUntil = 0;
  bleProvisionSetEnabled(false);   // 内部已打 "[BLE] 配网窗口关闭, 停止广播"
  led_off();
}

static void openProvisionWindow() {
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
    s_btnHint3s = false;
    s_btnHighSince = 0;
    Serial.println("[Btn] press");
    return;
  }
  if (!s_btnDown) return;

  if (!pressed) {
    // 松开: 按住满 3s → 打开配网窗口
    // (长按 10s 恢复出厂在按住中已触发并重启, 到不了这个分支)
    uint32_t held = now - s_btnDownAt;
    s_btnDown = false;
    s_btnHighSince = now;
    Serial.printf("[Btn] release, held %lu ms\n", (unsigned long)held);
    if (held >= BOOT_HOLD_WINDOW_MS) {
      openProvisionWindow();
    }
    return;
  }

  // 仍按住: 渐进反馈 + 长按恢复出厂
  uint32_t held = now - s_btnDownAt;
  if (!s_btnHint3s && held >= BOOT_HOLD_WINDOW_MS) {
    s_btnHint3s = true;                // 黄灯快闪: 已到窗口阈值 ——
    for (int i = 0; i < 3; i++) {      // 松手 = 开配网窗口, 继续按住到 10s = 恢复出厂
      neopixelWrite(RGB_BUILTIN, 48, 32, 0);
      delay(120);
      neopixelWrite(RGB_BUILTIN, 0, 0, 0);
      delay(120);
    }
  }
  if (held >= BOOT_HOLD_RESET_MS) {
    Serial.println("[Btn] held 10s -> factory reset");
    factoryResetNow();                 // 擦 NVS → 红灯闪烁等松手 → 重启, 不返回
  }
}

/* ================================================================== */
/*  模块间回调 (胶水层)                                                 */
/* ================================================================== */

// WiFi 状态变化 → BLE 通知 App; 连上后启动采集服务与 server 链接
void onWifiStatus(const char* status) {
  // WiFi 连上(含重连)即刷新 DeviceInfo 里的 IP —— 采集页 BLE 读 26ac 自动取址的
  // 数据源; 先刷新再 notify, App 收到 wifi_connected 后立读即得最新值
  if (strcmp(status, BLE_STATUS_WIFI_CONNECTED) == 0) {
    bleProvisionRefreshDeviceInfo();
  }
  bleProvisionUpdateStatus(status);
  if (strcmp(status, BLE_STATUS_WIFI_CONNECTED) == 0) {
    led_off();   // 凭据已生效: 结束待配网/窗口闪烁, 之后由 server_connected 收尾
    // WiFi 连上 (含配网成功/掉线重连) 按偏好自动开推理: startListening 内部
    // 有偏好/出厂态门禁, 重连时已在跑则空操作
    startListening();
    if (!s_collectStarted) {
      s_collectStarted = true;
      collectServerStart();
    }
    // 无条件 (重)启动: serverLinkStart 每次都重读 NVS 里的服务器地址 ——
    // 「已有凭据的设备重新配网」时, App 新写的 URL 只落了盘, 运行中的
    // ServerLink 还带着开机时的旧地址在拨, WiFi 每次连上都必须重载
    // (2026-11-09 真机实测: 先连旧网触发过 wifi_connected, 重新配网后一直拨旧 IP)
    s_serverStarted = true;
    serverLinkStart(onServerCmd, onServerLinkState);
  }
}

// BLE 收到完整 WiFi 凭据 → 交给 WiFi 模块连接
void onCredentialsReceived(const String& ssid, const String& pass) {
  // 配网成功即置「监听开」偏好并持久化 (用户确认的产品策略: 新配网设备默认监护)
  s_provisioned = true;
  s_inferWanted = true;
  persistInferWanted();
  wifiConnectBegin(ssid, pass);
}

// server 下发指令。listen_on/off = 监听偏好开关: 写 NVS 持久化, 设备重启仍
// 生效, 不随 App 在线启停 (2026-11-19 语义: 旧「随观众在线启停」在末位 App
// 离开时停推理, 设备退化纯 RMS 阈值判哭, ntfy 兜底推误报 —— P0 已修)。
// 用户主动关闭视为自愿放弃检测, 推理停后不再有哭声上报
void onServerCmd(const char* cmd) {
  if (strcmp(cmd, "listen_on") == 0 || strcmp(cmd, "listen_off") == 0) {
    s_inferWanted = (strcmp(cmd, "listen_on") == 0);
    persistInferWanted();
    Serial.printf("[Cmd] 监听偏好持久化: %s\n", s_inferWanted ? "开" : "关");
    if (s_inferWanted) startListening();
    else stopListening();
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
    startListening();   // 配网闭环即恢复推理, 不等 App 断开 BLE (常开)
  }
}

/* ================================================================== */
/*  监听（偏好持久化 + 出厂态不开）                                      */
/* ================================================================== */

/**
 * 启动推理并置监听态。实际能否启动由两道门禁决定:
 *   - s_inferWanted: App 的持久偏好 (listen_off 后拒绝启动)
 *   - s_provisioned: 出厂态不开 (推理结果无处上报, 且挤占配网内存)
 * inferStart 需要一块较大的连续内部堆（32KB 采样 buffer + EI tensor arena，
 * 未走 PSRAM），启动早期被 WiFi/BLE 碎片挤占会失败：不放弃，loop 里 30s
 * 重试 (同样过门禁)。
 * BLE 会话（配网/采集）期间由 loop 主动暂停推理让内存，会话结束/配网闭环
 * （onServerLinkState）即按偏好恢复。
 */
void startListening() {
  if (s_listening) return;
  if (!s_inferWanted || !s_provisioned) return;   // 偏好关闭 / 出厂态: 不启动
  if (!inferStart()) {
    Serial.println("[Listen] ERR: 推理启动失败 (内存不足), 30s 后重试");
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
  // max = 最大可分配连续块: 32KB 推理缓冲 / EI arena 这类大块 malloc 成败
  // 看它最准 —— free 充足但碎片化时大块照样分配失败 (整合固件最大风险点)
  Serial.printf("[Heap] %-14s free=%u max=%u min=%u\n",
                tag, ESP.getFreeHeap(), ESP.getMaxAllocHeap(), ESP.getMinFreeHeap());
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== Baby Cry Monitor ESP32 (整合版) ===");

  // LED (板载 WS2812) 与 BOOT 键 (GPIO0, 低电平按下)
  led_init();
  pinMode(BOOT_BTN_PIN, INPUT_PULLUP);
  Serial.printf("[Boot] BOOT(GPIO0) at boot: %s%s\n",
                digitalRead(BOOT_BTN_PIN) == LOW ? "LOW" : "HIGH",
                digitalRead(BOOT_BTN_PIN) == LOW ? " (被外部钳住? 按键检测暂不启用)" : "");

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

  // 配网窗口: 出厂态限时开窗 (超时停广播, BOOT 短按 3s 重开);
  // 已配网设备开机即关窗停广播 —— s_enabled 默认 true, 若等 server_connected
  // 才收口, server 连不上时 BLE 写入口/广播会无限期敞开 (2026-11-11 真机抓到:
  // server 不可达的已配网设备持续广播, /setserver 门控也被架空)
  if (isFactoryState()) {
    openProvisionWindow();
  } else {
    closeProvisionWindow();
  }

  // 音频采集链 (Core 0): I2S + 高通滤波, 常开
  audioPipelineStart();

  // 监听偏好 (NVS): 配网成功默认开, App listen_on/off 持久化于此。
  // 出厂态 (无凭据) 不开推理 —— 结果无处上报且挤占配网内存 (2026-11-19
  // 真机: 常开推理 + BLE + 首次 WiFi 扫描内存不足, 中断看门狗复位)
  Preferences prefs;
  prefs.begin(NVS_NAMESPACE, true);
  s_inferWanted = prefs.getBool(NVS_KEY_INFER_ON, true);
  prefs.end();
  s_provisioned = !isFactoryState();

  // 已配网设备按偏好启动推理; 出厂态由 onWifiStatus (WiFi 连上) 自动开
  startListening();

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
  if (s_windowUntil != 0) {
    led_blink(PROV_LED_FAST_MS);        // 窗口期 (含出厂态首个窗口): 快闪 = 可配网
  } else if (isFactoryState() || wifiIsReconnecting()) {
    led_blink(PROV_LED_SLOW_MS);        // 出厂态待配网 / 掉线退避重连中: 慢闪
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

  // BLE 会话 (配网/采集) 期间暂停推理: inferStart 的 32KB 采样 buffer + EI
  // tensor arena 占内部堆, 已配网设备重开配网窗口时, 首次 WiFi start + 列表
  // 扫描要做 RF 校准与大块分配, 同活时内存不足触发中断看门狗静默复位
  // (2026-11-19 真机 TG1WDT, 复现: 配网页点「刷新列表」必崩)。收到凭据后的
  // wifiConnectBegin 同样吃内存, 故暂停范围取整个 BLE 会话而非仅扫描窗口。
  // 恢复走 startListening (偏好/出厂态门禁在内部), 用户已关监护则不自动重开
  bool bleConnected = bleProvisionIsConnected();
  if (bleConnected != s_bleSession) {
    s_bleSession = bleConnected;
    if (bleConnected) {
      if (s_listening) {
        inferStop();
        s_listening = false;
        serverLinkSetListening(false);
        Serial.println("[Listen] PAUSED (BLE 会话, 为配网让出内存)");
      }
    } else {
      startListening();   // 会话结束恢复常开; 内存不足由下方 30s 重试兜底
    }
  }

  // 堆内存巡检 (整合后内存是最大风险点)
  uint32_t now = millis();
  if (now - s_lastHeapLog >= 30000) {
    s_lastHeapLog = now;
    printHeap(s_listening ? "listening" : "idle");
  }

  // 推理启动失败重试: 30s 一试 (启动早期内存被占用的场景)。门禁与
  // startListening 一致; BLE 会话期间不重试 —— 会话内暂停是有意为之
  static uint32_t s_lastInferRetry = 0;
  if (!s_listening && s_inferWanted && s_provisioned && !s_bleSession
      && now - s_lastInferRetry >= 30000) {
    s_lastInferRetry = now;
    startListening();
  }

  delay(1);
}
