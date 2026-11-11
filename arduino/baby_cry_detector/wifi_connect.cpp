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
static volatile bool s_authFail = false; // 断连原因 = 密码错误 (4 次握手超时)

// 掉线自愈: WiFi 库不会自己重连, 曾连上后掉线 (或首轮尝试放弃) 时
// 按退避序列反复重连, 路由器半夜重启等故障不再「永久失联只能拔电」
static bool     s_everConnected = false;    // 本次上电是否曾连上 (掉线检测基准)
static bool     s_reconnectMode = false;    // 处于退避重连态 (LED 慢闪依据)
static bool     s_reconnectPending = false; // 已排定一次延后重连
static uint32_t s_nextRetryAt = 0;          // 排定的重连发起时刻
static uint32_t s_backoff = WIFI_BACKOFF_FIRST_MS; // 下次失败的退避值
static uint32_t s_reconnectCount = 0;       // 本轮掉线已尝试次数 (供遥测)

static Preferences s_prefs;

static String s_currentSSID;
static String s_currentPass;

/* ================================================================== */
/*  内部工具                                                            */
/* ================================================================== */

static void reportStatus(const char* status) {
  if (s_statusCb) {
    s_statusCb(status);
  }
}

// 发起一次连接尝试 (App 新凭据 / 退避重连共用)
static void startAttempt(uint32_t now) {
  WiFi.disconnect();
  WiFi.begin(s_currentSSID.c_str(), s_currentPass.c_str());
  s_attempting = true;
  s_attemptStart = now;
  s_lastCheck = 0;
  s_authFail = false;
}

// 退避序列推进: 3s → 30s → 60s 封顶
static uint32_t nextBackoff(uint32_t cur) {
  if (cur < WIFI_BACKOFF_STEP2_MS) return WIFI_BACKOFF_STEP2_MS;
  return WIFI_BACKOFF_MAX_MS;
}

// 排定一次延后重连 (进入退避重连态)
static void scheduleReconnect(uint32_t now, uint32_t delayMs) {
  s_reconnectMode = true;
  s_reconnectPending = true;
  s_nextRetryAt = now + delayMs;
}

/* ================================================================== */
/*  对外接口                                                            */
/* ================================================================== */

void wifiConnectBegin(const String& ssid, const String& pass) {
  s_currentSSID = ssid;
  s_currentPass = pass;

  Serial.printf("[WiFi] Connecting to %s...\n", ssid.c_str());
  reportStatus(BLE_STATUS_CONNECTING_WIFI);

  // App 新凭据接入: 清掉上一轮掉线自愈的中间态
  s_reconnectMode = false;
  s_reconnectPending = false;
  s_reconnectCount = 0;
  s_backoff = WIFI_BACKOFF_FIRST_MS;
  s_failCount = 0;
  startAttempt(millis());
}

void wifiConnectInit(WifiStatusCallback statusCb) {
  s_statusCb = statusCb;
  s_prefs.begin(NVS_NAMESPACE, false);

  // 断连原因监听: 4 次握手超时 (reason 15) = 密码错误, 要尽早告知 App 就地提示
  // (若等 30s×10 次重试跑完才报, App 的配对等待早超时了)
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    if (info.wifi_sta_disconnected.reason == 15)
      s_authFail = true;
  }, WiFiEvent_t::ARDUINO_EVENT_WIFI_STA_DISCONNECTED);

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
  uint32_t now = millis();

  // 1) 掉线检测: 曾连上、不在尝试、也无已排定的重连, 而 STA 已断 → 进入退避重连
  if (!s_attempting && !s_reconnectPending &&
      s_everConnected && WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] 掉线 (曾连上), 进入退避重连");
    s_backoff = WIFI_BACKOFF_FIRST_MS;
    s_reconnectCount = 0;
    scheduleReconnect(now, s_backoff);
    return;
  }

  // 2) 退避到期 → 发起重连尝试
  //    (s_backoff 在发起时即前移: 本次失败就用该值排下一次)
  if (!s_attempting && s_reconnectPending &&
      (int32_t)(now - s_nextRetryAt) >= 0) {
    s_reconnectPending = false;
    s_reconnectCount++;
    Serial.printf("[WiFi] 重连尝试 #%lu (退避 %lus)\n",
                  (unsigned long)s_reconnectCount,
                  (unsigned long)(s_backoff / 1000));
    startAttempt(now);
    s_backoff = nextBackoff(s_backoff);
    reportStatus(BLE_STATUS_CONNECTING_WIFI);
    return;
  }

  if (!s_attempting) return;

  if (now - s_lastCheck < WIFI_CHECK_INTERVAL_MS) return;
  s_lastCheck = now;

  if (WiFi.status() == WL_CONNECTED) {
    // 连接成功
    Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    if (s_reconnectMode) {
      Serial.printf("[WiFi] 掉线重连成功 (尝试 %lu 次)\n", (unsigned long)s_reconnectCount);
    }

    // 持久化凭据
    s_prefs.putString(NVS_KEY_WIFI_SSID, s_currentSSID);
    s_prefs.putString(NVS_KEY_WIFI_PASS, s_currentPass);
    // 本次上电内立刻脱离出厂态: 否则 isFactoryState() 到重启前都为真,
    // LED 一直慢闪, closeProvisionWindow() 也会被它的早退挡掉 (广播不停)
    s_hasSaved = true;

    reportStatus(BLE_STATUS_WIFI_CONNECTED);

    s_attempting = false;
    s_failCount = 0;
    s_everConnected = true;
    s_reconnectMode = false;
    s_reconnectPending = false;
    s_backoff = WIFI_BACKOFF_FIRST_MS;   // 成功清零: 下一轮掉线从 3s 起步
  }
  else if (now - s_attemptStart > WIFI_CONNECT_TIMEOUT_MS) {
    if (s_reconnectMode) {
      // 退避重连的单次尝试失败 → 永不放弃, 按退避排下一次 (60s 封顶)
      Serial.printf("[WiFi] 重连尝试 #%lu 失败, %lus 后再试\n",
                    (unsigned long)s_reconnectCount,
                    (unsigned long)(s_backoff / 1000));
      WiFi.disconnect();
      s_attempting = false;
      s_reconnectPending = true;
      s_nextRetryAt = now + s_backoff;
    }
    else {
      // 首轮 (开机自动连 / App 配网) 超时失败
      s_failCount++;
      Serial.printf("[WiFi] Attempt %d failed (timeout)\n", s_failCount);

      if (s_failCount >= WIFI_MAX_ATTEMPTS) {
        // 首轮放弃: 对 App 报错收尾, 但不再「等新凭据」等死 ——
        // 转入退避重连 (路由器此刻才恢复 / 凭据本就有效时能自愈)
        Serial.println("[WiFi] 首轮放弃, 转入退避重连");
        reportStatus(BLE_STATUS_ERROR_WIFI);
        WiFi.disconnect();
        s_attempting = false;
        s_failCount = 0;
        s_backoff = WIFI_BACKOFF_STEP2_MS;   // 刚跑完 5 分钟, 30s 后再试
        scheduleReconnect(now, s_backoff);
      }
      else {
        // 重试
        WiFi.disconnect();
        WiFi.begin(s_currentSSID.c_str(), s_currentPass.c_str());
        s_attemptStart = now;
      }
    }
  }
  else {
    // 仍在连接中: 密码错误要尽早告知 (App 的配对等待只有 30s)
    if (s_authFail) {
      s_authFail = false;
      Serial.println("[WiFi] 密码错误 (4-Way Handshake Timeout)");
      reportStatus(BLE_STATUS_ERROR_WIFI_PASS);
    }
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

bool wifiIsReconnecting() {
  return s_reconnectMode;
}

uint32_t wifiGetReconnectCount() {
  return s_reconnectCount;
}
