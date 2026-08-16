#include "ble_provision.h"
#include "config.h"
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

/* ================================================================== */
/*  静态状态                                                            */
/* ================================================================== */

static BLEServer*          s_server      = nullptr;
static BLECharacteristic*  s_charStatus  = nullptr;

static BleCredentialsCallback s_credsCb  = nullptr;
static bool    s_bleConnected = false;

// 暂存 App 写入的凭据
static String s_pendingSSID;
static String s_pendingPass;

/* ================================================================== */
/*  前向声明                                                            */
/* ================================================================== */

static void updateStatus(const String& status);

/* ================================================================== */
/*  特征值写入回调                                                       */
/* ================================================================== */

class SSIDWriteCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    s_pendingSSID = String(c->getValue().c_str());
    s_pendingSSID.trim();
    Serial.printf("[BLE] SSID received: [%s]\n", s_pendingSSID.c_str());
  }
};

class PassWriteCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    s_pendingPass = String(c->getValue().c_str());
    s_pendingPass.trim();
    Serial.println("[BLE] Password received (hidden)");
  }
};

class ServerURLWriteCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String url = String(c->getValue().c_str());
    url.trim();
    Serial.printf("[BLE] Server URL received: [%s]\n", url.c_str());

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
    Serial.println("[BLE] App disconnected, restarting advertising");
    BLEDevice::startAdvertising();
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

/* ================================================================== */
/*  初始化                                                              */
/* ================================================================== */

void bleProvisionInit(const char* deviceName) {
  BLEDevice::init(deviceName);
  BLEDevice::setMTU(256);

  s_server = BLEDevice::createServer();
  s_server->setCallbacks(new ServerConnectionCallback());

  BLEService* service = s_server->createService(BLE_SERVICE_UUID);

  // WiFi SSID (Write)
  BLECharacteristic* cSSID = service->createCharacteristic(
    BLE_CHAR_WIFI_SSID_UUID, BLECharacteristic::PROPERTY_WRITE);
  cSSID->setCallbacks(new SSIDWriteCallback());

  // WiFi Password (Write)
  BLECharacteristic* cPass = service->createCharacteristic(
    BLE_CHAR_WIFI_PASS_UUID, BLECharacteristic::PROPERTY_WRITE);
  cPass->setCallbacks(new PassWriteCallback());

  // Server URL (Write)
  BLECharacteristic* cURL = service->createCharacteristic(
    BLE_CHAR_SERVER_URL_UUID, BLECharacteristic::PROPERTY_WRITE);
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
