/**
 * BLE 串口回显测试固件
 *
 * 用途: 验证 App BLE 写入 → ESP32 串口输出是否正常
 *
 * 工作方式:
 *   1. ESP32 广播为 "BabyMonitor-ECHO"
 *   2. App 连接后, 写入任意文本到 TX 特征值
 *   3. ESP32 串口打印收到的内容
 *   4. ESP32 同时通过 RX 特征值通知回显 "[ECHO] 原文"
 *
 * UUID 说明: 使用与主项目相同的 Service UUID, 方便复用 App 的 BLE 基础设施
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

/* ============================ UUID ============================ */

// 使用与主项目相同的 Service UUID
#define SERVICE_UUID          "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
// 写入 (App → ESP32)
#define CHAR_TX_UUID          "beb5483e-36e1-4688-b7f5-000000000001"
// 通知 (ESP32 → App)
#define CHAR_RX_UUID          "beb5483e-36e1-4688-b7f5-000000000002"

/* ============================ 全局 ============================ */

BLECharacteristic* charRx = nullptr;
char deviceName[32] = "BabyMonitor-ECHO";

/* ============================ 回调 ============================ */

class TxCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String msg = String(c->getValue().c_str());
    msg.trim();

    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Serial.printf(" 收到 App 消息 (%d bytes):\n", msg.length());
    Serial.printf("   >>> %s\n", msg.c_str());
    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // 回显给 App
    String echo = "[ECHO] " + msg;
    if (charRx) {
      charRx->setValue(echo.c_str());
      charRx->notify();
      Serial.println(" 已回显给 App");
    }
  }
};

class ConnCallback : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override {
    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Serial.println(" App 已连接!");
    Serial.printf(" MTU: %d\n", BLEDevice::getMTU());
    Serial.println(" 现在可以在 App 中输入文本并发送, 这里会实时打印");
    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }
  void onDisconnect(BLEServer* s) override {
    Serial.println(" App 已断开, 重新广播...");
    BLEDevice::startAdvertising();
  }
};

/* ============================ 初始化 ============================ */

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n╔══════════════════════════════════════╗");
  Serial.println(  "║   BLE 串口回显测试                 ║");
  Serial.println(  "║   设备: BabyMonitor-ECHO            ║");
  Serial.println(  "╚══════════════════════════════════════╝\n");

  BLEDevice::init(deviceName);
  BLEDevice::setMTU(256);

  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ConnCallback());

  BLEService* service = server->createService(SERVICE_UUID);

  // TX 特征值 - App 写入
  BLECharacteristic* charTx = service->createCharacteristic(
    CHAR_TX_UUID, BLECharacteristic::PROPERTY_WRITE);
  charTx->setCallbacks(new TxCallback());

  // RX 特征值 - ESP32 通知回显
  charRx = service->createCharacteristic(
    CHAR_RX_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  charRx->addDescriptor(new BLE2902());
  charRx->setValue("ready");

  service->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->start();

  Serial.printf("广播中: %s\n", deviceName);
  Serial.println("等待 App 连接...\n");
}

void loop() {
  delay(100);
}
