#include "collect_server.h"

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <mbedtls/md.h>
#include <string.h>

#include "audio_pipeline.h"
#include "collect_page_html.h"
#include "config.h"
#include "server_url.h"
#include "ble_provision.h"
#include "wifi_connect.h"

/* ================================================================== */
/*  状态                                                                */
/* ================================================================== */

#define MDNS_NAME "babycry"

static WiFiServer s_server(80);
static WiFiClient s_wsClient;

// 全局缓冲: 避免在 loopTask 栈上分配大数组导致栈溢出 (audio_app 的教训)
static int16_t wsChunk[AUDIO_CHUNK_SAMPLES];   // WS 推流临时块 (2KB)
static uint8_t wsPayload[512];                 // WS 命令解析缓冲

/* 推流诊断 (2026-11-24, lost=yes 定位):
 *   s_maxWriteUs   单次 WS 二进制帧写耗时峰值 —— 偏大 = TCP 阻塞 (App 消费慢 / 射频迟滞)
 *   s_writeOver25ms 写耗时 >25ms 的次数 (25ms = 2KB 在健康链路的量级)
 *   s_maxIterUs    推流节拍间隔峰值 —— 偏大且写不阻塞 = 主循环被别的活饿死
 * 判读: highWater 贴满 + write 阻塞大 → 下游慢; iter 大 + write 快 → loop 饿死 */
static uint32_t s_maxWriteUs = 0;
static uint32_t s_writeOver25ms = 0;
static uint32_t s_maxIterUs = 0;
static uint32_t s_lastStreamUs = 0;

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
  if (!audioPipelineCollectStart()) {
    // wsRing 分配失败 (内部堆不足): 明确告知客户端, 别让 App 干等
    char msg[80];
    snprintf(msg, sizeof(msg), "{\"cmd\":\"error\",\"message\":\"ring_alloc_failed\"}");
    wsSendText(s_wsClient, msg);
    return;
  }
  s_maxWriteUs = 0;
  s_writeOver25ms = 0;
  s_maxIterUs = 0;
  s_lastStreamUs = 0;
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
  Serial.printf("[REC] diag: highWater=%u/%u lostEvents=%u maxWrite=%luus writeOver25ms=%lu maxIter=%luus\n",
                audioPipelineCollectHighWater(), (unsigned)WS_RING_SAMPLES,
                audioPipelineCollectLostEvents(),
                (unsigned long)s_maxWriteUs, (unsigned long)s_writeOver25ms,
                (unsigned long)s_maxIterUs);
  audioPipelineCollectFree();   // 64KB 还给推理 (监护模式是常态)
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
    // 严格小于 sizeof(wsPayload): text 分支要写 wsPayload[len]='\0', len==512 时
    // 会越界 1 字节破坏相邻 BSS (server_link.cpp 的 s_rxPayload 同款判定是对的)
    if (len >= sizeof(wsPayload)) return false;

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
      // RFC6455: 控制帧载荷上限 125 字节。客户端 ping 超长时必须截断回显 ——
      // pong 是 127 字节栈缓冲, 原实现按 len(≤511) memcpy 会溢出 loopTask 栈
      size_t plen = (len > 125) ? 125 : (size_t)len;
      uint8_t pong[2 + 125];
      pong[0] = 0x8A;
      pong[1] = (uint8_t)plen;
      memcpy(pong + 2, wsPayload, plen);
      c.write(pong, 2 + plen);
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

/* 开发辅助: 免 BLE 写入服务器地址 (重启后由 server_link 从 NVS 读取)
 * 仅未配网态 / 配网窗口期开放 (改进点 3+7 运行时侧): 已配网设备的改指向
 * 收敛到 BOOT 短按 3s + App 重配网, 防 LAN 内任意主机改地址 */
static void handleSetServer(WiFiClient& c, const String& query) {
  if (wifiHasSavedCredentials() && !bleProvisionIsEnabled()) {
    Serial.println("[SetServer] rejected: 已配网且窗口未开");
    sendJson(c, "{\"ok\":false,\"err\":\"not_allowed\"}");
    return;
  }
  String url = queryParam(query, "url");
  if (url.length() == 0) {
    sendJson(c, "{\"ok\":false,\"err\":\"empty_url\"}");
    return;
  }
  if (!serverUrlValid(url)) {
    Serial.printf("[SetServer] rejected (invalid): [%s]\n", url.c_str());
    sendJson(c, "{\"ok\":false,\"err\":\"bad_url\"}");
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

/* 板载采集页 (2026-11-24 移植自 audio_app/index.html): PC 浏览器直录,
 * WAV 直接落电脑, 免手机搬运。控制走 WS 文本命令 (与 App 同协议), 见页面 JS */
static void sendHtml(WiFiClient& c) {
  c.print("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-cache\r\nContent-Length: ");
  c.print(COLLECT_PAGE_HTML_LEN);
  c.print("\r\nConnection: close\r\n\r\n");
  c.write((const uint8_t*)COLLECT_PAGE_HTML, COLLECT_PAGE_HTML_LEN);
}

static void route(WiFiClient& c, const String& path, const String& query) {
  if (path == "/" || path == "/index.html") {
    sendHtml(c);
  } else if (path == "/rms") {
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
    // 已配网设备: 采集客户端连上即 IP 已交付, 立即关闭配网窗口 —— 推流期间
    // 广播/BLE 活动会与推流争抢堆 (2026-11-16 实测: 窗口开着录音, 堆 23KB 起
    // 步整机挂死断网), 关窗后回到旧纯 WS 流程的运行条件。出厂态(无凭据)不关,
    // 保留配网与采集共用窗口的语义
    if (wifiHasSavedCredentials() && bleProvisionIsEnabled()) {
      bleProvisionSetEnabled(false);
      Serial.println("[WS] 配网窗口已自动关闭 (采集会话开始)");
    }
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
    // 广播服务类型: 桌面 mDNS 浏览工具可按服务发现 (Android App 原生 socket
    // 不走 mDNS 解析, 不受影响 —— App 端寻址走 BLE 读 DeviceInfo)
    MDNS.addService("http", "tcp", 80);
    Serial.printf("[mDNS] http://%s.local\n", MDNS_NAME);
  }
  Serial.printf("[Collect] server on %s:80\n", WiFi.localIP().toString().c_str());
}

bool collectServerIsRecording() {
  return audioPipelineCollectActive();
}

bool collectServerIsClientActive() {
  return s_wsClient && s_wsClient.connected();
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
      audioPipelineCollectReset();   // 含释放 wsRing, 防会话中断后 64KB 悬挂
      Serial.println("[WS] collect client disconnected");
    }
    if (s_wsClient && s_wsClient.connected() && collectServerIsRecording()) {
      // 每次循环最多推一个块 (2KB 有界写, 块间回到 available() 不会被饿死)
      if (audioPipelinePopChunk(wsChunk) == AUDIO_CHUNK_SAMPLES) {
        uint32_t t0 = micros();
        wsSendBinary(s_wsClient, (const uint8_t*)wsChunk, sizeof(wsChunk));
        uint32_t wus = micros() - t0;
        if (wus > s_maxWriteUs) s_maxWriteUs = wus;
        if (wus > 25000) s_writeOver25ms++;
        uint32_t nowUs = micros();
        if (s_lastStreamUs != 0 && nowUs - s_lastStreamUs > s_maxIterUs) {
          s_maxIterUs = nowUs - s_lastStreamUs;
        }
        s_lastStreamUs = nowUs;
      }
    }
  }

  delay(1);   // 关键: 让出 CPU, WiFi 栈才能处理新连接和收到的数据
}
