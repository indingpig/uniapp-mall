/**
 * BLE 配网测试固件 (含真实 WiFi 连接)
 *
 * 用途: 验证 App ↔ ESP32 BLE 通信, 并通过 BLE 收到 WiFi 凭证后真正连接 WiFi
 *
 * 流程:
 *   1. 广播为 "BabyMonitor-TEST"
 *   2. App 连接 → 写入 SSID / 密码 / 服务器地址
 *   3. 凭据收齐后, loop() 中启动 WiFi 连接
 *   4. 状态通过 BLE 通知实时上报 (connecting_wifi / wifi_connected / error:wifi_failed)
 *   5. 连接成功后将凭据存入 NVS, 下次开机自动联网
 *
 * 接线: 无需额外接线, 仅需 ESP32 开发板 USB 供电
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <WiFi.h>
#include <Preferences.h>

/* ================================================================== */
/*  UUID 定义 (与 App 的 ble.ts 保持一致)                               */
/* ================================================================== */

#define BLE_SERVICE_UUID            "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define BLE_CHAR_WIFI_SSID_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define BLE_CHAR_WIFI_PASS_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26a9"
#define BLE_CHAR_SERVER_URL_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26ab"
#define BLE_CHAR_STATUS_UUID        "beb5483e-36e1-4688-b7f5-ea07361b26aa"
#define BLE_CHAR_DEVICE_INFO_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26ac"

/* ================================================================== */
/*  NVS 存储 Key                                                       */
/* ================================================================== */

#define NVS_NAMESPACE "baby-test"
#define NVS_KEY_SSID    "ssid"
#define NVS_KEY_PASS    "pass"

/* ================================================================== */
/*  全局对象                                                            */
/* ================================================================== */

BLEServer*         bleServer      = nullptr;
BLECharacteristic* charStatus     = nullptr;

Preferences prefs;

bool    bleConnected = false;
char    deviceName[32] = "BabyMonitor-TEST";

// WiFi 凭据 (由 BLE 回调写入, loop 读取)
String   g_ssid;
String   g_pass;
bool     g_credentialsReady = false;   // 三个特征值都已收到
bool     g_wifiAttempted   = false;    // 本次凭据已尝试连接 (避免反复重试)

// 已保存的 WiFi 信息
String   savedSSID = "";
String   savedPass  = "";

/* ================================================================== */
/*  前向声明                                                            */
/* ================================================================== */

void updateStatus(const String& status);
void startWiFiConnection(const String& ssid, const String& pass);

/* ================================================================== */
/*  BLE 写入回调                                                        */
/* ================================================================== */

class SSIDCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    g_ssid = String(c->getValue().c_str());
    g_ssid.trim();
    Serial.printf("[BLE] SSID received: [%s]\n", g_ssid.c_str());
    g_credentialsReady = false;
    g_wifiAttempted = false;
  }
};

class PassCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    g_pass = String(c->getValue().c_str());
    g_pass.trim();
    Serial.println("[BLE] Password received (hidden)");
    g_credentialsReady = false;
    g_wifiAttempted = false;
  }
};

class ServerURLCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String url = String(c->getValue().c_str());
    url.trim();
    Serial.printf("[BLE] Server URL received: [%s]\n", url.c_str());

    // 服务器地址是最后一个特征值 → 凭据齐全, 可以开始配网
    if (g_ssid.length() > 0 && g_pass.length() > 0) {
      g_credentialsReady = true;
      g_wifiAttempted = false;
      Serial.println("[BLE] All credentials received! WiFi connecting in loop()...");
    } else {
      Serial.println("[BLE] Warning: SSID/密码不完整");
    }
  }
};

class ConnCallback : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override {
    bleConnected = true;
    updateStatus("idle");
    Serial.println("========================================");
    Serial.println("[BLE] App connected!");
    Serial.printf("[BLE] MTU: %d\n", BLEDevice::getMTU());
    Serial.println("========================================");
  }

  void onDisconnect(BLEServer* s) override {
    bleConnected = false;
    Serial.println("[BLE] App disconnected, restarting advertising...");
    BLEDevice::startAdvertising();
  }
};

/* ================================================================== */
/*  状态更新                                                            */
/* ================================================================== */

void updateStatus(const String& status) {
  if (charStatus) {
    charStatus->setValue(status.c_str());
    charStatus->notify();
  }
  Serial.printf("[Status] → %s\n", status.c_str());
}

/* ================================================================== */
/*  WiFi 连接 (在 loop 中调用, 不阻塞 BLE)                              */
/* ================================================================== */

void startWiFiConnection(const String& ssid, const String& pass) {
  updateStatus("connecting_wifi");
  Serial.printf("[WiFi] Connecting to %s...\n", ssid.c_str());
  WiFi.disconnect();
  WiFi.begin(ssid.c_str(), pass.c_str());
}

void checkWiFiStatus() {
  static unsigned long lastCheck = 0;

  // 每 3 秒检查一次连接结果
  if (millis() - lastCheck < 3000) return;
  lastCheck = millis();

  if (g_wifiAttempted) {
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
      updateStatus("wifi_connected");

      // 持久化
      prefs.putString(NVS_KEY_SSID, g_ssid);
      prefs.putString(NVS_KEY_PASS, g_pass);
      savedSSID = g_ssid;
      savedPass  = g_pass;

      g_wifiAttempted = false;
      g_credentialsReady = false;

      // 配网完成, 通知 App (测试固件到此为止, 不连 WebSocket)
      delay(1000);
      updateStatus("server_connected");
    }
    else if (WiFi.status() == WL_DISCONNECTED) {
      static int failCount = 0;
      failCount++;
      Serial.printf("[WiFi] Attempt %d...\n", failCount);
      if (failCount > 10) { // 约 30 秒超时
        Serial.println("[WiFi] Failed! Wrong password or no signal?");
        updateStatus("error:wifi_failed");
        failCount = 0;
        g_wifiAttempted = false;
        g_credentialsReady = false;
        WiFi.disconnect();
      }
    }
    else {
      // 仍在连接中
    }
  }
}

/* ================================================================== */
/*  BLE 初始化                                                          */
/* ================================================================== */

void setupBLE() {
  BLEDevice::init(deviceName);
  BLEDevice::setMTU(256);

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ConnCallback());

  BLEService* service = bleServer->createService(BLE_SERVICE_UUID);

  // WiFi SSID (Write)
  BLECharacteristic* cSSID = service->createCharacteristic(
    BLE_CHAR_WIFI_SSID_UUID, BLECharacteristic::PROPERTY_WRITE);
  cSSID->setCallbacks(new SSIDCallback());

  // WiFi Password (Write)
  BLECharacteristic* cPass = service->createCharacteristic(
    BLE_CHAR_WIFI_PASS_UUID, BLECharacteristic::PROPERTY_WRITE);
  cPass->setCallbacks(new PassCallback());

  // Server URL (Write)
  BLECharacteristic* cURL = service->createCharacteristic(
    BLE_CHAR_SERVER_URL_UUID, BLECharacteristic::PROPERTY_WRITE);
  cURL->setCallbacks(new ServerURLCallback());

  // Status (Notify + Read)
  charStatus = service->createCharacteristic(
    BLE_CHAR_STATUS_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  charStatus->addDescriptor(new BLE2902());
  charStatus->setValue("idle");

  // Device Info (Read)
  BLECharacteristic* charDeviceInfo = service->createCharacteristic(
    BLE_CHAR_DEVICE_INFO_UUID, BLECharacteristic::PROPERTY_READ);
  String info = "{\"name\":\"" + String(deviceName) + "\","
    "\"version\":\"test-1.0\","
    "\"has_wifi\":" + String(savedSSID.length() > 0 ? "true" : "false") + "}";
  charDeviceInfo->setValue(info.c_str());

  service->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.printf("[BLE] Advertising as '%s'\n", deviceName);
}

/* ================================================================== */
/*  setup / loop                                                        */
/* ================================================================== */

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n╔══════════════════════════════════════╗");
  Serial.println(  "║   BLE 配网测试固件 (含真实 WiFi)     ║");
  Serial.println(  "║   设备名: BabyMonitor-TEST           ║");
  Serial.println(  "╚══════════════════════════════════════╝\n");

  // 读取 NVS 中保存的 WiFi 凭据
  prefs.begin(NVS_NAMESPACE, false);
  savedSSID = prefs.getString(NVS_KEY_SSID, "");
  savedPass  = prefs.getString(NVS_KEY_PASS, "");
  if (savedSSID.length() > 0) {
    Serial.printf("[Info] Found saved WiFi: %s\n", savedSSID.c_str());
    Serial.println("[Info] 将自动连接 (30 秒内); 失败后等待 App 重新配网");
  }

  setupBLE();

  // 如果之前有保存的 WiFi, 自动连接
  if (savedSSID.length() > 0 && savedPass.length() > 0) {
    g_ssid = savedSSID;
    g_pass  = savedPass;
    g_credentialsReady = true;
    g_wifiAttempted = true;
    startWiFiConnection(g_ssid, g_pass);
  }
}

void loop() {
  // 检查是否有新的凭据需要连接
  if (g_credentialsReady && !g_wifiAttempted) {
    g_wifiAttempted = true;
    startWiFiConnection(g_ssid, g_pass);
  }

  // 监控 WiFi 连接结果
  checkWiFiStatus();

  // 每 60 秒打印一次状态
  static unsigned long lastLog = 0;
  if (millis() - lastLog > 60000) {
    Serial.printf("[Info] BLE: %s | WiFi: %s | IP: %s | Heap: %d\n",
                  bleConnected ? "CONN" : "adv",
                  WiFi.status() == WL_CONNECTED ? "CONN" : "idle",
                  WiFi.localIP().toString().c_str(),
                  ESP.getFreeHeap());
    lastLog = millis();
  }

  delay(100);
}
