#include "server_link.h"

#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <mbedtls/md.h>
#include <string.h>

#include "audio_pipeline.h"
#include "config.h"

/* ================================================================== */
/*  状态                                                                */
/* ================================================================== */

static ServerCmdCallback     s_cmdCb   = nullptr;
static ServerLinkStateCallback s_stateCb = nullptr;

static bool     s_started = false;
static bool     s_connected = false;
static bool     s_listening = false;
static String   s_host;
static uint16_t s_port = 80;

static WiFiClient s_client;
static uint32_t s_lastAttempt = 0;
static uint32_t s_lastAudioSend = 0;
static bool     s_inferDirty = false;
static char     s_inferLabel[24] = { 0 };
static float    s_inferScore = 0;
static uint32_t s_inferRms = 0;

static uint8_t  s_rxPayload[512];   // 下行帧解析缓冲

/* ================================================================== */
/*  base64 / SHA1 (与 audio_app.ino 的握手实现一致)                      */
/* ================================================================== */

static String base64Encode(const uint8_t* data, size_t len) {
  static const char tbl[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String out;
  for (size_t i = 0; i < len; i += 3) {
    uint32_t v = (uint32_t)data[i] << 16;
    if (i + 1 < len) v |= (uint32_t)data[i + 1] << 8;
    if (i + 2 < len) v |= data[i + 2];
    out += tbl[(v >> 18) & 63];
    out += tbl[(v >> 12) & 63];
    out += (i + 1 < len) ? tbl[(v >> 6) & 63] : '=';
    out += (i + 2 < len) ? tbl[v & 63] : '=';
  }
  return out;
}

static String wsAcceptKey(const String& key) {
  String s = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  uint8_t hash[20];
  const mbedtls_md_info_t* md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA1);
  mbedtls_md(md, (const uint8_t*)s.c_str(), s.length(), hash);
  return base64Encode(hash, 20);
}

/* ================================================================== */
/*  帧: 客户端发送 (必须带掩码)                                          */
/* ================================================================== */

static bool wsSendMasked(uint8_t opcode, const uint8_t* payload, size_t len) {
  if (!s_client || !s_client.connected()) return false;
  static uint8_t masked[256];
  if (len > sizeof(masked)) return false;

  uint8_t maskKey[4];
  uint32_t r = (uint32_t)esp_random();
  memcpy(maskKey, &r, 4);

  uint8_t hdr[14];
  size_t h = 0;
  hdr[h++] = 0x80 | opcode;                 // FIN + opcode
  if (len < 126) {
    hdr[h++] = 0x80 | (uint8_t)len;
  } else if (len <= 0xFFFF) {
    hdr[h++] = 0x80 | 126;
    hdr[h++] = (uint8_t)(len >> 8);
    hdr[h++] = (uint8_t)(len & 0xFF);
  } else {
    hdr[h++] = 0x80 | 127;
    for (int i = 7; i >= 0; i--) hdr[h++] = (uint8_t)((uint64_t)len >> (i * 8));
  }
  memcpy(hdr + h, maskKey, 4);
  h += 4;

  for (size_t i = 0; i < len; i++) masked[i] = payload[i] ^ maskKey[i & 3];
  return s_client.write(hdr, h) == h && s_client.write(masked, len) == len;
}

static bool wsSendText(const char* text) {
  return wsSendMasked(0x1, (const uint8_t*)text, strlen(text));
}

/* ================================================================== */
/*  帧: 接收 (服务端下行不带掩码)                                        */
/* ================================================================== */

/* 从 {"type":"cmd","cmd":"listen_on"} 里取字符串值 (不处理转义, 够用) */
static String extractJsonString(const char* json, const char* key) {
  String pattern = String("\"") + key + "\"";
  const char* p = strstr(json, pattern.c_str());
  if (p == nullptr) return "";
  p += pattern.length();
  while (*p && *p != ':') p++;
  if (*p != ':') return "";
  p++;
  while (*p == ' ') p++;
  if (*p != '"') return "";
  p++;
  String out;
  while (*p && *p != '"') out += *p++;
  return out;
}

/* 处理一帧下行; 返回 false 表示连接应关闭 (close 帧或协议错误) */
static bool handleFrame(uint8_t opcode, const uint8_t* payload, size_t len) {
  if (opcode == 0x8) {                       // close → 回应 close 并断开
    wsSendMasked(0x8, nullptr, 0);
    return false;
  }
  if (opcode == 0x9) {                       // ping → pong
    wsSendMasked(0xA, payload, len);
    return true;
  }
  if (opcode == 0x1 && len > 0 && len < sizeof(s_rxPayload)) {
    char text[513];
    memcpy(text, payload, len);
    text[len] = '\0';
    String cmd = extractJsonString(text, "cmd");
    if (cmd.length() > 0 && s_cmdCb) {
      Serial.printf("[ServerLink] cmd: %s\n", cmd.c_str());
      s_cmdCb(cmd.c_str());
    }
  }
  return true;   // 其他 opcode (0x2 binary / 0xA pong) 忽略
}

/* 解析所有已到达的帧; 返回 false 表示连接应关闭 */
static bool wsProcessIncoming() {
  while (s_client.available() >= 2) {
    uint8_t b0 = s_client.read();
    uint8_t b1 = s_client.read();
    uint8_t opcode = b0 & 0x0F;
    bool masked = b1 & 0x80;
    uint64_t len = b1 & 0x7F;
    if (len == 126) {
      if (s_client.available() < 2) return true;   // 分片未到齐, 下轮继续
      len = (uint16_t)s_client.read() << 8 | s_client.read();
    } else if (len == 127) {
      if (s_client.available() < 8) return true;
      len = 0;
      for (int i = 0; i < 8; i++) len = (len << 8) | s_client.read();
    }
    if (masked) {
      // 服务端按协议不发掩码帧; 真收到说明对端不是预期服务器, 丢弃掩码字节继续
      for (int i = 0; i < 4 && s_client.available() > 0; i++) s_client.read();
    }
    if (len > sizeof(s_rxPayload)) return false;   // 超长, 异常连接

    size_t got = 0;
    uint32_t t0 = millis();
    while (got < len && millis() - t0 < 1000) {
      if (s_client.available() > 0) {
        got += s_client.read(s_rxPayload + got, (size_t)(len - got));
      } else {
        delay(1);
      }
    }
    if (got < len) return true;                    // 不完整, 下轮再收
    if (!handleFrame(opcode, s_rxPayload, (size_t)len)) return false;
  }
  return true;
}

/* ================================================================== */
/*  连接                                                                */
/* ================================================================== */

/* 解析 ws:// 或 http:// 前缀的 host[:port] (path 固定 /ws?device=esp32, 忽略传入路径);
 * App 配网下发的是 ws:// 形式, 兼容 http:// (老流程) */
static bool parseServerUrl(const String& url) {
  String u = url;
  u.trim();
  if (u.startsWith("https://") || u.startsWith("wss://")) {
    Serial.println("[ServerLink] ERR: 暂不支持加密连接, 请使用 ws://");
    return false;
  }
  if (u.startsWith("ws://")) u = u.substring(5);
  else if (u.startsWith("http://")) u = u.substring(7);
  int slash = u.indexOf('/');
  if (slash >= 0) u = u.substring(0, slash);       // 忽略 URL 里的路径
  int colon = u.indexOf(':');
  if (colon >= 0) {
    s_host = u.substring(0, colon);
    s_port = (uint16_t)u.substring(colon + 1).toInt();
  } else {
    s_host = u;
    s_port = 80;
  }
  if (s_host.length() == 0 || s_port == 0) return false;
  return true;
}

static void setConnected(bool on) {
  if (s_connected == on) return;
  s_connected = on;
  if (s_stateCb) s_stateCb(on);
}

static bool tryConnect() {
  if (s_host.length() == 0) return false;

  s_client.stop();
  if (!s_client.connect(s_host.c_str(), s_port)) {
    Serial.printf("[ServerLink] connect %s:%u failed\n", s_host.c_str(), s_port);
    return false;
  }

  /* --- 握手 --- */
  uint8_t rawKey[16];
  for (size_t i = 0; i < sizeof(rawKey); i++) rawKey[i] = (uint8_t)(esp_random() & 0xFF);
  String key = base64Encode(rawKey, sizeof(rawKey));

  String req = String("GET /ws?device=esp32 HTTP/1.1\r\n") +
               "Host: " + s_host + ":" + s_port + "\r\n" +
               "Upgrade: websocket\r\n" +
               "Connection: Upgrade\r\n" +
               "Sec-WebSocket-Key: " + key + "\r\n" +
               "Sec-WebSocket-Version: 13\r\n\r\n";
  s_client.print(req);

  static char respBuf[1024];
  size_t respLen = 0;
  uint32_t t0 = millis();
  bool done = false;
  while (millis() - t0 < 3000) {
    while (s_client.available()) {
      if (respLen >= sizeof(respBuf) - 1) { done = true; break; }
      respBuf[respLen++] = (char)s_client.read();
      if (respLen >= 4 && memcmp(respBuf + respLen - 4, "\r\n\r\n", 4) == 0) { done = true; break; }
    }
    if (done) break;
    delay(1);
  }
  respBuf[respLen] = '\0';
  if (respLen == 0 || !done) {
    Serial.println("[ServerLink] handshake timeout");
    return false;
  }

  String resp(respBuf);
  if (!resp.startsWith("HTTP/1.1 101")) {
    Serial.printf("[ServerLink] handshake rejected: %.32s\n", respBuf);
    return false;
  }
  String expect = wsAcceptKey(key);
  // Node ws 库响应头为全小写, 查找用大写副本 (toUpperCase 不改变偏移),
  // 值比较仍用原文 (base64 区分大小写)
  String respUpper = resp;
  respUpper.toUpperCase();
  int accIdx = respUpper.indexOf("SEC-WEBSOCKET-ACCEPT:");
  String accVal = (accIdx >= 0) ? resp.substring(accIdx + 21) : String();
  accVal.trim();   // 冒号后有一个空格, 必须去掉再比较
  if (accIdx < 0 || !accVal.startsWith(expect)) {
    Serial.printf("[ServerLink] accept key mismatch (found=%d)\n", accIdx >= 0);
    return false;
  }

  s_lastAudioSend = 0;   // 连上立即发一帧心跳
  setConnected(true);
  Serial.printf("[ServerLink] connected ws://%s:%u/ws (free heap=%u)\n",
                s_host.c_str(), s_port, ESP.getFreeHeap());
  return true;
}

static void disconnect() {
  s_client.stop();
  setConnected(false);
  Serial.println("[ServerLink] disconnected");
}

/* ================================================================== */
/*  上报                                                                */
/* ================================================================== */

static void sendAudio() {
  uint32_t rms;
  int32_t peak;
  audioPipelineLevel(&rms, &peak);
  char msg[96];
  snprintf(msg, sizeof(msg), "{\"type\":\"audio\",\"rms\":%u,\"peak\":%d}",
           rms, peak);
  if (!wsSendText(msg)) disconnect();
}

static void sendInference() {
  char msg[160];
  snprintf(msg, sizeof(msg),
           "{\"type\":\"inference\",\"label\":\"%s\",\"score\":%.3f,\"rms\":%u}",
           s_inferLabel, s_inferScore, s_inferRms);
  if (wsSendText(msg)) {
    s_inferDirty = false;
  } else {
    disconnect();
  }
}

static void sendListenState() {
  char msg[64];
  snprintf(msg, sizeof(msg), "{\"type\":\"listenState\",\"listening\":%s}",
           s_listening ? "true" : "false");
  wsSendText(msg);
}

/* ================================================================== */
/*  公开接口                                                            */
/* ================================================================== */

void serverLinkStart(ServerCmdCallback cmdCb, ServerLinkStateCallback stateCb) {
  s_cmdCb = cmdCb;
  s_stateCb = stateCb;

  Preferences prefs;
  prefs.begin(NVS_NAMESPACE, true);
  String url = prefs.getString(NVS_KEY_SERVER_URL, "");
  prefs.end();

  if (url.length() == 0) {
    Serial.println("[ServerLink] 未配置服务器地址 (BLE 配网时写入, 或 /setserver?url=)");
    s_started = true;   // 仍然启动循环, 期间 /setserver 写入后重启生效
    return;
  }
  if (!parseServerUrl(url)) {
    Serial.printf("[ServerLink] ERR: 服务器地址无效: %s\n", url.c_str());
    return;
  }
  s_started = true;
  Serial.printf("[ServerLink] target: %s:%u (from NVS)\n", s_host.c_str(), s_port);
}

void serverLinkSetListening(bool on) {
  if (s_listening == on) return;
  s_listening = on;
  if (s_connected) sendListenState();
}

void serverLinkSetInference(const char* label, float score, uint32_t srcRms) {
  strlcpy(s_inferLabel, label, sizeof(s_inferLabel));
  s_inferScore = score;
  s_inferRms = srcRms;
  s_inferDirty = true;
}

bool serverLinkIsConnected() {
  return s_connected;
}

void serverLinkLoop() {
  if (!s_started) return;

  if (!s_connected) {
    if (millis() - s_lastAttempt >= SERVER_RECONNECT_MS) {
      s_lastAttempt = millis();
      if (tryConnect() && s_listening) sendListenState();   // 重连补发监听状态
    }
    return;
  }

  if (!wsProcessIncoming()) {
    disconnect();
    return;
  }
  if (!s_client.connected()) {
    disconnect();
    return;
  }

  uint32_t now = millis();
  uint32_t interval = s_listening ? SERVER_REPORT_MS_ACTIVE : SERVER_REPORT_MS_IDLE;
  if (now - s_lastAudioSend >= interval) {
    s_lastAudioSend = now;
    sendAudio();
  }
  if (s_inferDirty) sendInference();
}
