#include "ble_provision.h"
#include "config.h"
#include "server_url.h"
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLESecurity.h>
#include <BLE2902.h>
#include <Preferences.h>
#include <WiFi.h>
#include <vector>
#include <algorithm>

/* ================================================================== */
/*  静态状态                                                            */
/* ================================================================== */

static BLEServer*          s_server      = nullptr;
static BLECharacteristic*  s_charStatus  = nullptr;
static BLECharacteristic*  s_charWifiList = nullptr;

static BleCredentialsCallback s_credsCb  = nullptr;
static bool    s_bleConnected = false;
static bool    s_enabled = true;   // 配网窗口: 出厂态默认开, 主固件按 NVS 凭据状态设定

// 暂存 App 写入的凭据
static String s_pendingSSID;
static String s_pendingPass;

// WiFi 列表扫描: App 写 WIFI_LIST 只置位, 真正的 WiFi API 调用都在 bleProvisionLoop
// (loop task) 里做 —— BLE 回调跑在 BT 任务, 跨任务调 WiFi 容易撞上栈未就绪的状态
static bool     s_scanRequested = false;
static bool     s_scanStarted   = false;
static uint32_t s_scanRetryAt   = 0;
static uint8_t  s_scanRetries   = 0;

// 链路加密发起时机 (必须服务端主动: 部分 Android ROM 如鸿蒙写加密特征值被拒
// 时不会自动配对, 见 onConnect 注释)。触发点 = App 写 WiFiList 请求 —— 该写入
// 能到达就证明手机服务发现已完成, 之后到凭据写入之间隔着人的操作时间, 无竞态:
// 固定时刻发起 (500ms / 5s 兜底) 都实测撞上发现服务 → 配对/加密 FAIL → 手机断连
// (2026-11-08 串口日志, 即「配网偶发超时」的根因)
static bool          s_encryptPending = false;
static bool          s_encryptDone    = false;   // 本次连接只主动发起一次
static bool          s_encrypted      = false;   // 链路已加密 (onAuthenticationComplete 回填)
static esp_bd_addr_t s_encryptBda;
static uint32_t      s_scanWaitAt      = 0;      // 等待配对完成的起点
static const uint32_t BLE_PAIR_WAIT_MS = 20000;  // 配对等待上限, 超时给 App 明确错误

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
/*  Just Works 配对加密 (改进点 2 轻量部分)                              */
/*  无屏幕做不了 Passkey, MITM 由配网窗口 (物理存在证明) 兜住;            */
/*  ESP_LE_AUTH_BOND 持久绑定 (setAuthenticationMode, 见 init):          */
/*  首次配对系统弹框确认, 已配对手机重连静默加密不再弹框。               */
/*  恢复出厂擦 NVS 连带清掉设备侧绑定密钥 —— 手机须先删除配对记录,       */
/*  否则旧密钥加密失败靠 onAuthenticationComplete 退避重试重协商          */
/* ================================================================== */

class SecurityCallbacks : public BLESecurityCallbacks {
  uint32_t onPassKeyRequest() override { return 0; }
  void onPassKeyNotify(uint32_t) override {}
  bool onSecurityRequest() override { return true; }
  bool onConfirmPIN(uint32_t) override { return true; }
  void onAuthenticationComplete(esp_ble_auth_cmpl_t authCmpl) override {
    Serial.printf("[BLE] 配对/加密 %s\n", authCmpl.success ? "OK" : "FAIL");
    s_encrypted = authCmpl.success;
    if (!authCmpl.success) {          // 失败后退避重试 (无 UI 手势, Just Works 静默)
      s_encryptDone = false;
      s_encryptPending = true;
    }
  }
};

/* ================================================================== */
/*  特征值写入回调 (配网窗口未开时一律拒绝)                               */
/* ================================================================== */

/* 诊断用: 写入原始字节 hex (排查句柄错位/CCCD 残留等诡异写入, 上限 32 字节) */
static String hexDump(const std::string& v) {
  String out;
  for (size_t i = 0; i < v.length() && i < 32; i++) {
    char buf[4];
    snprintf(buf, sizeof(buf), "%02x", (uint8_t)v[i]);
    out += buf;
  }
  return out;
}

class SSIDWriteCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    if (!writeAllowed("SSID")) return;
    std::string raw = c->getValue();
    s_pendingSSID = String(raw.c_str());
    s_pendingSSID.trim();
    Serial.printf("[BLE] SSID received: [%s] len=%u hex=%s\n",
                  s_pendingSSID.c_str(), (unsigned)raw.length(), hexDump(raw).c_str());
  }
};

class PassWriteCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    if (!writeAllowed("Password")) return;
    std::string raw = c->getValue();
    s_pendingPass = String(raw.c_str());
    s_pendingPass.trim();
    Serial.printf("[BLE] Password received (hidden) len=%u\n", (unsigned)raw.length());
  }
};

class ServerURLWriteCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    if (!writeAllowed("ServerURL")) return;
    std::string raw = c->getValue();
    String url = String(raw.c_str());
    url.trim();

    // 写入口校验 (与 /setserver 共用 server_url.h): 拒非法值并回报 App 就地提示
    if (!serverUrlValid(url)) {
      Serial.printf("[BLE] Server URL rejected (invalid): [%s] len=%u hex=%s\n",
                    url.c_str(), (unsigned)raw.length(), hexDump(raw).c_str());
      bleProvisionUpdateStatus(BLE_STATUS_ERROR_SERVER_URL);
      return;
    }
    Serial.printf("[BLE] Server URL received: [%s]\n", url.c_str());

    // 持久化服务器地址 (重启后由 server_link 从 NVS 读取并连接后端)
    Preferences prefs;
    prefs.begin(NVS_NAMESPACE, false);
    prefs.putString(NVS_KEY_SERVER_URL, url);
    prefs.end();

    // 服务器地址是最后一个特征值 -> 凭据齐全
    // 密码为空 = 开放网络：产品上不支持（无 WiFi 场景走手机热点/随身 WiFi，自带密码），
    // App 端已在提交前拦截；这里按凭据不完整处理，双保险
    if (s_pendingSSID.length() > 0 && s_pendingPass.length() > 0) {
      Serial.println("[BLE] All credentials received!");
      if (s_credsCb) {
        s_credsCb(s_pendingSSID, s_pendingPass);
      }
    }
    else {
      Serial.println("[BLE] Warning: SSID/密码不完整 (开放网络不支持空密码)");
    }
  }
};

class WifiListWriteCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    if (!writeAllowed("WiFiList")) return;
    // 连接后第一个应用层写入 = 手机服务发现已完成, 此刻发起加密不与 discovery 撞车
    if (!s_encryptDone && !s_encryptPending && s_bleConnected) {
      s_encryptPending = true;
    }
    if (s_scanRequested) return;  // 已在扫描, 忽略重复触发
    Serial.println("[BLE] WiFi scan requested");
    s_scanRequested = true;
    s_scanStarted = false;
    s_scanRetries = 0;
    s_scanRetryAt = 0;
    s_scanWaitAt = millis();
    updateStatus(BLE_STATUS_SCANNING);
  }
};

/* ================================================================== */
/*  连接回调                                                            */
/* ================================================================== */

class ServerConnectionCallback : public BLEServerCallbacks {
  // 连接即由服务端主动发起加密 (Just Works, 静默完成):
  // 部分 Android ROM (如鸿蒙) 写加密特征值被拒时不会自动触发配对,
  // 必须服务端先发 Security Request, 否则凭据写入报 GATT_INSUF_AUTHENTICATION
  void onConnect(BLEServer* server, esp_ble_gatts_cb_param_t* param) override {
    s_bleConnected = true;
    updateStatus(BLE_STATUS_IDLE);
    // 服务端主动发起加密的原因见 s_encryptPending 注释; 触发点不在连接时
    // (手机还在发现服务, 会撞车), 而在 App 的 WiFiList 写入
    memcpy(s_encryptBda, param->connect.remote_bda, sizeof(esp_bd_addr_t));
    s_encryptPending = false;
    s_encryptDone = false;
    s_encrypted = false;
    const uint8_t* bda = param->connect.remote_bda;
    Serial.printf("[BLE] App connected (%02x:%02x:%02x:%02x:%02x:%02x)\n",
                  bda[0], bda[1], bda[2], bda[3], bda[4], bda[5]);
  }

  void onDisconnect(BLEServer* s) override {
    s_bleConnected = false;
    s_encryptPending = false;
    s_encryptDone = false;
    s_encrypted = false;
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

/* ================================================================== */
/*  WiFi 列表扫描 (App 写 WIFI_LIST 触发, loop 中回传结果)               */
/*  notify 按 ≤20 字节分片, 行以 \n 结尾; App 端按行重组 + JSON 解析     */
/* ================================================================== */

static const size_t WIFI_LIST_CHUNK = 20;      // 兜底 MTU(23) 下最大可发载荷
static const int    WIFI_LIST_NOTIFY_GAP_MS = 15;  // notify 间隔, 防洪泛丢包

static String jsonEscape(const String& s) {
  String out;
  out.reserve(s.length() + 4);
  for (size_t i = 0; i < s.length(); i++) {
    char ch = s[i];
    if (ch == '"' || ch == '\\') {
      out += '\\';
      out += ch;
    }
    else if ((uint8_t)ch < 0x20) {
      out += ' ';  // 控制字符不可进 JSON, 降级为空格
    }
    else {
      out += ch;
    }
  }
  return out;
}

static void notifyChunked(const String& payload) {
  if (!s_charWifiList || !s_bleConnected) return;
  size_t total = payload.length();
  for (size_t i = 0; i < total; i += WIFI_LIST_CHUNK) {
    size_t len = (total - i < WIFI_LIST_CHUNK) ? (total - i) : WIFI_LIST_CHUNK;
    s_charWifiList->setValue((uint8_t*)(payload.c_str() + i), len);
    s_charWifiList->notify();
    delay(WIFI_LIST_NOTIFY_GAP_MS);
  }
}

static void sendWifiListResults() {
  int n = WiFi.scanComplete();
  if (n < 0) {
    Serial.printf("[BLE] WiFi scan failed (%d)\n", n);
    notifyChunked("{\"error\":\"scan_failed\"}\n");
    notifyChunked("{\"done\":true}\n");
    return;
  }

  // 按信号强度降序的索引数组, 同名 SSID 去重 (保留最强)
  std::vector<int> idx(n);
  for (int i = 0; i < n; i++) idx[i] = i;
  std::sort(idx.begin(), idx.end(), [&](int a, int b) {
    return WiFi.RSSI(a) > WiFi.RSSI(b);
  });

  String seen;
  int sent = 0;
  for (int k = 0; k < n; k++) {
    int i = idx[k];
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;               // 隐藏网络无法直接选择, 跳过
    if (seen.indexOf('\x01' + ssid + '\x01') >= 0) continue;  // 同名去重
    seen += '\x01' + ssid + '\x01';

    String line = "{\"ssid\":\"" + jsonEscape(ssid) + "\","
      + "\"rssi\":" + String(WiFi.RSSI(i)) + ","
      + "\"auth\":" + String((int)WiFi.encryptionType(i)) + "}\n";
    notifyChunked(line);
    sent++;
  }
  notifyChunked("{\"done\":true,\"count\":" + String(sent) + "}\n");
  WiFi.scanDelete();
  Serial.printf("[BLE] WiFi scan sent %d APs (%d seen)\n", sent, n);
}

void bleProvisionLoop() {
  // -- 发起链路加密: 由 App 的 WiFiList 写入触发 (见 s_encryptPending 注释) --
  if (s_encryptPending && !s_encryptDone && s_bleConnected) {
    s_encryptPending = false;
    s_encryptDone = true;   // 只主动发起一次; 若 FAIL 由 onAuthenticationComplete 退避重试
    esp_err_t err = esp_ble_set_encryption(s_encryptBda, ESP_BLE_SEC_ENCRYPT);
    Serial.printf("[BLE] set_encryption: %s\n", esp_err_to_name(err));
  }

  if (!s_scanRequested) return;

  // -- 扫描必须建立在加密链路上: 未加密就先发起配对并等待, 手机确认后自动继续。
  //    没有在 ATT 层用 ESP_GATT_PERM_WRITE_ENCRYPTED 卡住 WiFiList 写入 ——
  //    那样写入到不了回调, 服务端就不会发 Security Request,
  //    鸿蒙这类不自动配对的 ROM 会直接卡死 --
  if (!s_encrypted) {
    if (!s_encryptDone && !s_encryptPending) s_encryptPending = true;
    if ((uint32_t)(millis() - s_scanWaitAt) > BLE_PAIR_WAIT_MS) {
      Serial.println("[BLE] WiFi scan aborted: pairing not completed");
      notifyChunked("{\"error\":\"pairing_timeout\"}\n");
      notifyChunked("{\"done\":true}\n");
      s_scanRequested = false;
      s_scanStarted = false;
      s_scanRetries = 0;
      s_scanRetryAt = 0;
    }
    return;
  }

  // -- 启动扫描: WiFi 栈刚切到 STA 时 esp_wifi_scan_start 会报 STATE 错误,
  //    「首次点获取 WiFi 列表必定失败」就是这个原因。隔 150ms 重试, 别急着回错误 --
  if (!s_scanStarted) {
    if (s_scanRetryAt != 0 && (int32_t)(millis() - s_scanRetryAt) < 0) return;
    WiFi.mode(WIFI_STA);
    int16_t started = WiFi.scanNetworks(/* async */ true);
    if (started == WIFI_SCAN_FAILED) {
      if (++s_scanRetries > 20) {                   // 约 3 秒还起不来才认输
        Serial.println("[BLE] WiFi scan start failed: WiFi not ready");
        notifyChunked("{\"error\":\"scan_failed\"}\n");
        notifyChunked("{\"done\":true}\n");
        s_scanRequested = false;
        s_scanRetries = 0;
        s_scanRetryAt = 0;
        return;
      }
      s_scanRetryAt = millis() + 150;
      return;
    }
    s_scanStarted = true;
    s_scanRetryAt = 0;
    Serial.printf("[BLE] WiFi scan started (retries=%u)\n", s_scanRetries);
    return;
  }

  int8_t state = WiFi.scanComplete();
  if (state == WIFI_SCAN_RUNNING) return;           // 还在扫
  if (state >= 0) {
    sendWifiListResults();
  }
  else {
    Serial.printf("[BLE] WiFi scan failed (%d)\n", state);
    notifyChunked("{\"error\":\"scan_failed\"}\n");
    notifyChunked("{\"done\":true}\n");
    WiFi.scanDelete();
  }
  s_scanRequested = false;
  s_scanStarted = false;
  s_scanRetries = 0;
  s_scanRetryAt = 0;
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
  // 持久化绑定: 密钥存 NVS。若用 NO_BOND, 设备每次重启后手机侧旧密钥全部作废,
  // 鸿蒙/安卓会报「PIN 码或配对密钥错误」且反复弹配对框。恢复出厂 nvs_flash_erase
  // 会连同绑定一并清除, 语义自洽
  sec->setAuthenticationMode(ESP_LE_AUTH_BOND);
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

  // WiFi List (Write 触发扫描 + Notify 回列表, 免手输 SSID)
  s_charWifiList = service->createCharacteristic(
    BLE_CHAR_WIFI_LIST_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);
  s_charWifiList->addDescriptor(new BLE2902());
  s_charWifiList->setCallbacks(new WifiListWriteCallback());

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
