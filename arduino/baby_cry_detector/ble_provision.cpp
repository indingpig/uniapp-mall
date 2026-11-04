#include "ble_provision.h"
#include "config.h"
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLESecurity.h>
#include <BLE2902.h>
#include <Preferences.h>

/* ================================================================== */
/*  静态状态                                                            */
/* ================================================================== */

static BLEServer*          s_server      = nullptr;
static BLECharacteristic*  s_charStatus  = nullptr;

static BleCredentialsCallback s_credsCb  = nullptr;
static bool    s_bleConnected = false;
static bool    s_enabled = true;   // 配网窗口: 出厂态默认开, 主固件按 NVS 凭据状态设定

// 暂存 App 写入的凭据
static String s_pendingSSID;
static String s_pendingPass;

/* ================================================================== */
/*  前向声明                                                            */
/* ================================================================== */

static void updateStatus(const String& status);

/* ================================================================== */
/*  配网窗口: 写入守门                                                   */
/* ================================================================== */

static bool writeAllowed(const char* what) {
  if (s_enabled) return true;
  Serial.printf("[BLE] 配网窗口未开启, 拒绝写入 %s\n", what);
  updateStatus(BLE_STATUS_ERROR_PROVISION);
  return false;
}

/* ================================================================== */
/*  Just Works 会话级加密 (改进点 2 轻量部分)                            */
/*  无屏幕做不了 Passkey, MITM 由配网窗口 (物理存在证明) 兜住;            */
/*  ESP_LE_AUTH_NO_BOND 不持久化绑定 —— 恢复出厂清 NVS 后不会出现        */
/*  「手机存旧绑定密钥连不上设备」的经典坑, 每次连接重新协商加密           */
/* ================================================================== */

class SecurityCallbacks : public BLESecurityCallbacks {
  uint32_t onPassKeyRequest() override { return 0; }
  void onPassKeyNotify(uint32_t) override {}
  bool onSecurityRequest() override { return true; }
  bool onConfirmPIN(uint32_t) override { return true; }
  void onAuthenticationComplete(esp_ble_auth_cmpl_t authCmpl) override {
    Serial.printf("[BLE] 配对/加密 %s\n", authCmpl.success ? "OK" : "FAIL");
  }
};

/* ================================================================== */
/*  特征值写入回调 (配网窗口未开时一律拒绝)                               */
/* ================================================================== */

class SSIDWriteCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    if (!writeAllowed("SSID")) return;
    s_pendingSSID = String(c->getValue().c_str());
    s_pendingSSID.trim();
    Serial.printf("[BLE] SSID received: [%s]\n", s_pendingSSID.c_str());
  }
};

class PassWriteCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    if (!writeAllowed("Password")) return;
    s_pendingPass = String(c->getValue().c_str());
    s_pendingPass.trim();
    Serial.println("[BLE] Password received (hidden)");
  }
};

class ServerURLWriteCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    if (!writeAllowed("ServerURL")) return;
    String url = String(c->getValue().c_str());
    url.trim();
    Serial.printf("[BLE] Server URL received: [%s]\n", url.c_str());

    // 持久化服务器地址 (重启后由 server_link 从 NVS 读取并连接后端)
    Preferences prefs;
    prefs.begin(NVS_NAMESPACE, false);
    prefs.putString(NVS_KEY_SERVER_URL, url);
    prefs.end();

    // 服务器地址是最后一个特征值 -> 凭据齐全
    if (s_pendingSSID.length() > 0 && s_pendingPass.length() > 0) {
      Serial.println("[BLE] All credentials received!");
      if (s_credsCb) {
        s_credsCb(s_pendingSSID, s_pendingPass);
      }
    }
    else {
      Serial.println("[BLE] Warning: SSID/密码不完整");
    }
  }
};

/* ================================================================== */
/*  连接回调                                                            */
/* ================================================================== */

class ServerConnectionCallback : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override {
    s_bleConnected = true;
    updateStatus(BLE_STATUS_IDLE);
    Serial.println("[BLE] App connected");
  }

  void onDisconnect(BLEServer* s) override {
    s_bleConnected = false;
    if (s_enabled) {
      Serial.println("[BLE] App disconnected, restarting advertising");
      BLEDevice::startAdvertising();
    } else {
      Serial.println("[BLE] App disconnected, advertising stays off");
    }
  }
};

/* ================================================================== */
/*  状态上报                                                            */
/* ================================================================== */

static void updateStatus(const String& status) {
  if (s_charStatus) {
    s_charStatus->setValue(status.c_str());
    s_charStatus->notify();
  }
  Serial.printf("[Status] -> %s\n", status.c_str());
}

void bleProvisionUpdateStatus(const char* status) {
  updateStatus(String(status));
}

bool bleProvisionIsConnected() {
  return s_bleConnected;
}

void bleProvisionSetCredentialsCallback(BleCredentialsCallback cb) {
  s_credsCb = cb;
}

void bleProvisionSetEnabled(bool enabled) {
  if (s_enabled == enabled) return;
  s_enabled = enabled;
  if (enabled) {
    BLEDevice::startAdvertising();
    Serial.println("[BLE] 配网窗口开启, 恢复广播");
  } else {
    BLEDevice::stopAdvertising();
    Serial.println("[BLE] 配网窗口关闭, 停止广播");
  }
}

bool bleProvisionIsEnabled() {
  return s_enabled;
}

/* ================================================================== */
/*  初始化                                                              */
/* ================================================================== */

void bleProvisionInit(const char* deviceName) {
  BLEDevice::init(deviceName);
  BLEDevice::setMTU(256);

  // Security Manager: Just Works 会话级加密, 凭据特征值要求加密链路后生效
  BLEDevice::setSecurityCallbacks(new SecurityCallbacks());
  BLESecurity* sec = new BLESecurity();
  sec->setAuthenticationMode(ESP_LE_AUTH_NO_BOND);
  sec->setCapability(ESP_IO_CAP_NONE);
  sec->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
  sec->setRespEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);

  s_server = BLEDevice::createServer();
  s_server->setCallbacks(new ServerConnectionCallback());

  BLEService* service = s_server->createService(BLE_SERVICE_UUID);

  // WiFi SSID (Write, 要求加密链路 —— 防空中嗅探 WiFi 密码)
  BLECharacteristic* cSSID = service->createCharacteristic(
    BLE_CHAR_WIFI_SSID_UUID, BLECharacteristic::PROPERTY_WRITE);
  cSSID->setAccessPermissions(ESP_GATT_PERM_WRITE_ENCRYPTED);
  cSSID->setCallbacks(new SSIDWriteCallback());

  // WiFi Password (Write, 要求加密链路)
  BLECharacteristic* cPass = service->createCharacteristic(
    BLE_CHAR_WIFI_PASS_UUID, BLECharacteristic::PROPERTY_WRITE);
  cPass->setAccessPermissions(ESP_GATT_PERM_WRITE_ENCRYPTED);
  cPass->setCallbacks(new PassWriteCallback());

  // Server URL (Write, 要求加密链路)
  BLECharacteristic* cURL = service->createCharacteristic(
    BLE_CHAR_SERVER_URL_UUID, BLECharacteristic::PROPERTY_WRITE);
  cURL->setAccessPermissions(ESP_GATT_PERM_WRITE_ENCRYPTED);
  cURL->setCallbacks(new ServerURLWriteCallback());

  // Status (Notify + Read)
  s_charStatus = service->createCharacteristic(
    BLE_CHAR_STATUS_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  s_charStatus->addDescriptor(new BLE2902());
  s_charStatus->setValue(BLE_STATUS_IDLE);

  // Device Info (Read)
  BLECharacteristic* cDevInfo = service->createCharacteristic(
    BLE_CHAR_DEVICE_INFO_UUID, BLECharacteristic::PROPERTY_READ);
  String info = "{\"name\":\"" + String(deviceName) + "\","
    "\"version\":\"1.0\","
    "\"has_wifi\":false}";
  cDevInfo->setValue(info.c_str());

  service->start();

  // 广播
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.printf("[BLE] Advertising as '%s'\n", deviceName);
}
