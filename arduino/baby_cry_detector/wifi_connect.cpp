#include "wifi_connect.h"
#include "config.h"
#include <WiFi.h>
#include <Preferences.h>

/* ================================================================== */
/*  静态状态                                                            */
/* ================================================================== */

static WifiStatusCallback s_statusCb = nullptr;

static bool    s_attempting = false;    // 是否正在尝试连接
static uint32_t s_attemptStart = 0;     // 本次尝试开始时间
static uint32_t s_lastCheck = 0;        // 上次轮询时间
static int     s_failCount = 0;         // 失败计数
static bool    s_hasSaved = false;      // NVS 是否存有凭据 (出厂态判定)

static Preferences s_prefs;

static String s_currentSSID;
static String s_currentPass;

/* ================================================================== */
/*  状态上报                                                            */
/* ================================================================== */

static void reportStatus(const char* status) {
  if (s_statusCb) {
    s_statusCb(status);
  }
}

/* ================================================================== */
/*  对外接口                                                            */
/* ================================================================== */

void wifiConnectBegin(const String& ssid, const String& pass) {
  s_currentSSID = ssid;
  s_currentPass = pass;

  Serial.printf("[WiFi] Connecting to %s...\n", ssid.c_str());
  reportStatus(BLE_STATUS_CONNECTING_WIFI);

  WiFi.disconnect();
  WiFi.begin(ssid.c_str(), pass.c_str());

  s_attempting = true;
  s_attemptStart = millis();
  s_failCount = 0;
  s_lastCheck = 0;
}

void wifiConnectInit(WifiStatusCallback statusCb) {
  s_statusCb = statusCb;
  s_prefs.begin(NVS_NAMESPACE, false);

  // 读取已保存的凭据
  String savedSSID = s_prefs.getString(NVS_KEY_WIFI_SSID, "");
  String savedPass  = s_prefs.getString(NVS_KEY_WIFI_PASS, "");
  s_hasSaved = (savedSSID.length() > 0 && savedPass.length() > 0);

  if (s_hasSaved) {
    Serial.printf("[WiFi] Found saved WiFi: %s\n", savedSSID.c_str());
    wifiConnectBegin(savedSSID, savedPass);
  }
  else {
    Serial.println("[WiFi] No saved credentials, waiting for BLE provisioning");
  }
}

void wifiLoop() {
  if (!s_attempting) return;

  uint32_t now = millis();
  if (now - s_lastCheck < WIFI_CHECK_INTERVAL_MS) return;
  s_lastCheck = now;

  if (WiFi.status() == WL_CONNECTED) {
    // 连接成功
    Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());

    // 持久化凭据
    s_prefs.putString(NVS_KEY_WIFI_SSID, s_currentSSID);
    s_prefs.putString(NVS_KEY_WIFI_PASS, s_currentPass);
    // 本次上电内立刻脱离出厂态: 否则 isFactoryState() 到重启前都为真,
    // LED 一直慢闪, closeProvisionWindow() 也会被它的早退挡掉 (广播不停)
    s_hasSaved = true;

    reportStatus(BLE_STATUS_WIFI_CONNECTED);

    s_attempting = false;
    s_failCount = 0;
  }
  else if (now - s_attemptStart > WIFI_CONNECT_TIMEOUT_MS) {
    // 超时失败
    s_failCount++;
    Serial.printf("[WiFi] Attempt %d failed (timeout)\n", s_failCount);

    if (s_failCount >= WIFI_MAX_ATTEMPTS) {
      Serial.println("[WiFi] Giving up, waiting for new credentials");
      reportStatus(BLE_STATUS_ERROR_WIFI);
      WiFi.disconnect();
      s_attempting = false;
      s_failCount = 0;
    }
    else {
      // 重试
      WiFi.disconnect();
      WiFi.begin(s_currentSSID.c_str(), s_currentPass.c_str());
      s_attemptStart = now;
    }
  }
  else {
    // 仍在连接中, 无操作
  }
}

bool wifiIsConnected() {
  return WiFi.status() == WL_CONNECTED;
}

bool wifiHasSavedCredentials() {
  return s_hasSaved;
}

String wifiGetIP() {
  return WiFi.localIP().toString();
}
