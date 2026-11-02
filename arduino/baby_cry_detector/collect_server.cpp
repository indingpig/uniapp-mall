#include "collect_server.h"

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <mbedtls/md.h>
#include <string.h>

#include "audio_pipeline.h"
#include "config.h"

/* ================================================================== */
/*  状态                                                                */
/* ================================================================== */

#define MDNS_NAME "babycry"

static WiFiServer s_server(80);
static WiFiClient s_wsClient;

// 全局缓冲: 避免在 loopTask 栈上分配大数组导致栈溢出 (audio_app 的教训)
static int16_t wsChunk[AUDIO_CHUNK_SAMPLES];   // WS 推流临时块 (2KB)
static uint8_t wsPayload[512];                 // WS 命令解析缓冲

/* ================================================================== */
/*  WebSocket (RFC 6455 最小实现, 服务端; 搬自 audio_app.ino)            */
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

static void wsSendBinary(WiFiClient& c, const uint8_t* payload, size_t len) {
  uint8_t hdr[10];
  size_t h = 0;
  hdr[h++] = 0x82;
  if (len < 126) {
    hdr[h++] = (uint8_t)len;
  } else if (len <= 0xFFFF) {
    hdr[h++] = 126;
    hdr[h++] = (uint8_t)(len >> 8);
    hdr[h++] = (uint8_t)(len & 0xFF);
  } else {
    hdr[h++] = 127;
    for (int i = 7; i >= 0; i--) hdr[h++] = (uint8_t)((uint64_t)len >> (i * 8));
  }
  c.write(hdr, h);
  c.write(payload, len);
}

static void wsSendText(WiFiClient& c, const char* text) {
  size_t len = strlen(text);
  uint8_t hdr[10];
  size_t h = 0;
  hdr[h++] = 0x81;
  if (len < 126) {
    hdr[h++] = (uint8_t)len;
  } else if (len <= 0xFFFF) {
    hdr[h++] = 126;
    hdr[h++] = (uint8_t)(len >> 8);
    hdr[h++] = (uint8_t)(len & 0xFF);
  } else {
    hdr[h++] = 127;
    for (int i = 7; i >= 0; i--) hdr[h++] = (uint8_t)((uint64_t)len >> (i * 8));
  }
  c.write(hdr, h);
  c.write((const uint8_t*)text, len);
}

static void startRecording() {
  audioPipelineCollectStart();
}

static void stopRecording() {
  audioPipelineCollectStop();   // 先停生产者, 再把剩余缓冲排干
  while (s_wsClient && s_wsClient.connected() &&
         audioPipelinePopChunk(wsChunk) == AUDIO_CHUNK_SAMPLES) {
    wsSendBinary(s_wsClient, (const uint8_t*)wsChunk, sizeof(wsChunk));
  }
  char msg[96];
  snprintf(msg, sizeof(msg), "{\"cmd\":\"done\",\"samples\":%u,\"lost\":%s}",
           audioPipelineCollectSamples(), audioPipelineCollectLost() ? "true" : "false");
  wsSendText(s_wsClient, msg);
  Serial.printf("[REC] stop: %u samples, lost=%s\n",
                audioPipelineCollectSamples(), audioPipelineCollectLost() ? "yes" : "no");
}

/* 处理客户端帧: 文本命令 (start/stop), ping→pong, close→断开 */
static bool wsHandleIncoming(WiFiClient& c) {
  while (c.available() >= 2) {
    uint8_t b0 = c.read();
    uint8_t b1 = c.read();
    int opcode = b0 & 0x0F;
    bool masked = b1 & 0x80;
    uint64_t len = b1 & 0x7F;
    if (len == 126) {
      uint32_t t0 = millis();
      while (c.available() < 2 && millis() - t0 < 500) delay(1);
      if (c.available() < 2) return true;
      len = (uint16_t)c.read() << 8 | c.read();
    } else if (len == 127) {
      uint32_t t0 = millis();
      while (c.available() < 8 && millis() - t0 < 500) delay(1);
      if (c.available() < 8) return true;
      len = 0;
      for (int i = 0; i < 8; i++) len = (len << 8) | c.read();
    }
    uint8_t mask[4];
    if (masked) {
      uint32_t t0 = millis();
      while (c.available() < 4 && millis() - t0 < 500) delay(1);
      if (c.available() < 4) return true;
      for (int i = 0; i < 4; i++) mask[i] = c.read();
    }
    if (len > 512) return false;

    // 等全部 payload 到齐 (关键: 命令帧可能分片到达, 必须读完整再解析)
    size_t got = 0;
    uint32_t t0 = millis();
    while (got < len && millis() - t0 < 1000) {
      if (c.available() > 0) {
        got += c.read(wsPayload + got, (size_t)(len - got));
      } else {
        delay(1);
      }
    }
    if (got < len) return true;   // 数据不完整, 下轮再处理

    if (masked) for (uint64_t i = 0; i < len; i++) wsPayload[i] ^= mask[i & 3];

    if (opcode == 0x8) {          // close
      uint8_t closeFrame[2] = { 0x88, 0x00 };
      c.write(closeFrame, 2);
      return false;
    } else if (opcode == 0x9) {   // ping → pong
      uint8_t pong[2 + 125];
      pong[0] = 0x8A;
      pong[1] = (uint8_t)len;
      memcpy(pong + 2, wsPayload, (size_t)len);
      c.write(pong, 2 + (size_t)len);
    } else if (opcode == 0x1 && len > 0) {  // text 命令
      wsPayload[len] = 0;
      if (strstr((char*)wsPayload, "\"start\"")) {
        if (!collectServerIsRecording()) startRecording();
      } else if (strstr((char*)wsPayload, "\"stop\"")) {
        if (collectServerIsRecording()) stopRecording();
        else Serial.println("[WS] stop 但未在录音");
      } else {
        Serial.printf("[WS] 未知命令: %s\n", (char*)wsPayload);
      }
    }
  }
  return true;
}

/* ================================================================== */
/*  HTTP                                                               */
/* ================================================================== */

static void sendJson(WiFiClient& c, const char* body) {
  c.print("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-cache\r\nContent-Length: ");
  c.print(strlen(body));
  c.print("\r\nConnection: close\r\n\r\n");
  c.print(body);
}

static void handleRms(WiFiClient& c) {
  char body[96];
  snprintf(body, sizeof(body), "{\"rms\":%u,\"rec\":%d,\"samples\":%u}",
           audioPipelineRingRms(), collectServerIsRecording() ? 1 : 0,
           audioPipelineCollectSamples());
  sendJson(c, body);
}

static String urlDecode(const String& s) {
  String out;
  for (size_t i = 0; i < s.length(); i++) {
    char ch = s[i];
    if (ch == '+') { out += ' '; }
    else if (ch == '%' && i + 2 < s.length()) {
      char hex[3] = { s[i + 1], s[i + 2], 0 };
      out += (char)strtol(hex, nullptr, 16);
      i += 2;
    } else {
      out += ch;
    }
  }
  return out;
}

static String queryParam(const String& query, const char* key) {
  String pattern = String(key) + "=";
  int idx = query.indexOf(pattern);
  if (idx < 0) return "";
  int start = idx + pattern.length();
  int end = query.indexOf('&', start);
  if (end < 0) end = query.length();
  return urlDecode(query.substring(start, end));
}

/* 开发辅助: 免 BLE 写入服务器地址 (重启后由 server_link 从 NVS 读取) */
static void handleSetServer(WiFiClient& c, const String& query) {
  String url = queryParam(query, "url");
  if (url.length() == 0) {
    sendJson(c, "{\"ok\":false,\"err\":\"empty_url\"}");
    return;
  }
  Preferences prefs;
  prefs.begin(NVS_NAMESPACE, false);
  prefs.putString(NVS_KEY_SERVER_URL, url);
  prefs.end();
  Serial.printf("[SetServer] saved: %s\n", url.c_str());
  sendJson(c, "{\"ok\":true}");
  delay(300);
  ESP.restart();
}

static void route(WiFiClient& c, const String& path, const String& query) {
  if (path == "/rms") {
    handleRms(c);
  } else if (path == "/setserver") {
    handleSetServer(c, query);
  } else {
    c.print("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  }
}

static String getHeader(const String& headers, const char* name) {
  String pattern = String(name) + ":";
  int idx = headers.indexOf(pattern);
  if (idx < 0) return "";
  int start = idx + pattern.length();
  while (start < (int)headers.length() && (headers[start] == ' ' || headers[start] == '\t')) start++;
  int end = headers.indexOf('\r', start);
  if (end < 0) end = headers.length();
  return headers.substring(start, end);
}

/* 处理请求: 返回 true 表示连接已被升级为 WebSocket(保留), false 则关 */
static bool serveHttp(WiFiClient& c) {
  static char reqBuf[2049];
  size_t reqLen = 0;
  uint32_t t0 = millis();
  bool done = false;
  while (millis() - t0 < 3000) {
    while (c.available()) {
      if (reqLen >= sizeof(reqBuf) - 1) { done = true; break; }   // 超长, 截断
      reqBuf[reqLen++] = (char)c.read();
      if (reqLen >= 4 && memcmp(reqBuf + reqLen - 4, "\r\n\r\n", 4) == 0) { done = true; break; }
    }
    if (done) break;
    yield();
  }
  reqBuf[reqLen] = '\0';
  if (reqLen == 0) return false;
  String req(reqBuf);

  int eol = req.indexOf('\r');
  String firstLine = (eol >= 0) ? req.substring(0, eol) : req;
  int sp = firstLine.indexOf(' ');
  String fullPath = (sp >= 0) ? firstLine.substring(sp + 1) : "/";
  sp = fullPath.indexOf(' ');
  if (sp >= 0) fullPath = fullPath.substring(0, sp);

  // WebSocket 升级
  String upgrade = getHeader(req, "Upgrade");
  if (fullPath == "/ws" && upgrade.equalsIgnoreCase("websocket")) {
    String key = getHeader(req, "Sec-WebSocket-Key");
    c.print("HTTP/1.1 101 Switching Protocols\r\n");
    c.print("Upgrade: websocket\r\n");
    c.print("Connection: Upgrade\r\n");
    c.print(String("Sec-WebSocket-Accept: ") + wsAcceptKey(key) + "\r\n\r\n");
    s_wsClient = c;
    // 新连接: 重置采集状态, 避免继承上次卡住/未结束的会话
    audioPipelineCollectReset();
    Serial.println("[WS] collect client connected (state reset)");
    return true;
  }

  String path = fullPath;
  String query = "";
  int q = fullPath.indexOf('?');
  if (q >= 0) {
    path = fullPath.substring(0, q);
    query = fullPath.substring(q + 1);
  }
  route(c, path, query);
  c.flush();            // 确保响应发出
  delay(10);            // 给 TCP 一点时间把缓冲发出去再关闭
  return false;
}

/* ================================================================== */
/*  公开接口                                                            */
/* ================================================================== */

void collectServerStart() {
  s_server.begin();
  if (MDNS.begin(MDNS_NAME)) {
    Serial.printf("[mDNS] http://%s.local\n", MDNS_NAME);
  }
  Serial.printf("[Collect] server on %s:80\n", WiFi.localIP().toString().c_str());
}

bool collectServerIsRecording() {
  return audioPipelineCollectActive();
}

void collectServerLoop() {
  // 新 HTTP / WS 连接
  WiFiClient c = s_server.available();
  if (c) {
    bool isWs = serveHttp(c);
    if (!isWs) {
      c.stop();
    }
  }

  // WS: 处理命令 + 推流
  if (s_wsClient && s_wsClient.connected()) {
    if (!wsHandleIncoming(s_wsClient)) {
      s_wsClient.stop();
      Serial.println("[WS] collect client disconnected");
    }
    if (s_wsClient && s_wsClient.connected() && collectServerIsRecording()) {
      // 每次循环最多推一个块 (2KB 有界写, 块间回到 available() 不会被饿死)
      if (audioPipelinePopChunk(wsChunk) == AUDIO_CHUNK_SAMPLES) {
        wsSendBinary(s_wsClient, (const uint8_t*)wsChunk, sizeof(wsChunk));
      }
    }
  }

  delay(1);   // 关键: 让出 CPU, WiFi 栈才能处理新连接和收到的数据
}
