#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <driver/i2s.h>
#include <math.h>
#include <mbedtls/md.h>
#include <string.h>
#include "index_html.h"

/* loopTask 默认栈只有 8KB, 而 serveHttp() 里 String 拼接 + sendHtml() 一次性
 * 写出 15KB 页面会在栈上留下较多临时对象, 实测触发
 * "Stack canary watchpoint triggered (loopTask)" 崩溃重启.
 * 必须在 setup()/loop() 之前定义, Arduino core 才会用它创建 loopTask. */
#define LOOP_TASK_STACK_SIZE 16384

/**
 * Baby Monitor 数据采集 — WebSocket 流式录音 (无时长限制)
 *
 * 连接方式 (与之前一致):
 *   - 已保存家庭 WiFi → STA 模式, mDNS: http://babycry.local (推荐, 无信标杂音)
 *   - 无保存/连接失败 → AP 热点 BabyMonitor-Audio, http://192.168.4.1
 *   - 配网: 连热点后打开 http://192.168.4.1/config
 *
 * 录音 (WebSocket, 开发板边录边推, 时长只受手机内存限制):
 *   App 连 ws://<ip>/ws 后:
 *     App→板 {"cmd":"start"}          开始录音 (开发板实时推送高通滤波后的 PCM)
 *     App→板 {"cmd":"stop"}           停止, 板返回 {"cmd":"done","samples":N,"lost":bool}
 *   PCM: 16kHz / 16-bit / 单声道 (含高通滤波, 无 WAV 头, 由手机端 AGC+封 WAV)
 *
 * HTTP 接口:
 *   GET /rms           实时电平
 *   GET /config        配网页
 *   GET /config/save   保存家庭 WiFi
 *   GET /              采集网页 (用 WebSocket 录音)
 */

/* ================================================================== */
/*  配置                                                                */
/* ================================================================== */

#define AP_SSID       "BabyMonitor-Audio"
#define AP_PASS       ""
#define NVS_NS        "audio-app"
#define NVS_KEY_SSID  "ssid"
#define NVS_KEY_PASS  "pass"
#define MDNS_NAME     "babycry"

#define I2S_PORT      I2S_NUM_0
#define I2S_WS        4
#define I2S_SCK       5
#define I2S_SD        6
#define SAMPLE_RATE   16000
#define CHUNK_SAMPLES 1024

#define RING_SECONDS        1                 // /rms 电平表缓冲
#define RING_SAMPLES        (SAMPLE_RATE * RING_SECONDS)
#define WS_RING_SECONDS     4                 // 录音推流缓冲 (瞬态阻塞容忍)
#define WS_RING_SAMPLES     (SAMPLE_RATE * WS_RING_SECONDS)

/* ================================================================== */
/*  配网页                                                               */
/* ================================================================== */

const char CONFIG_HTML[] = R"rawliteral(<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WiFi 配置</title>
<style>
body{background:#0f1420;color:#e8ecf4;font-family:-apple-system,"PingFang SC",sans-serif;padding:24px;max-width:420px;margin:0 auto}
h2{margin:8px 0 16px}
input{display:block;width:100%;box-sizing:border-box;background:#1a2133;border:0;border-radius:10px;color:#e8ecf4;padding:14px;margin-bottom:12px;font-size:16px}
button{width:100%;background:#5b9fe0;border:0;border-radius:12px;color:#fff;padding:16px;font-size:16px}
#msg{margin-top:12px;font-size:14px}
</style></head><body>
<h2>配置家庭 WiFi</h2>
<p style="color:#8a94a8;font-size:14px">保存后开发板重启并连接该 WiFi（无信标，录音更干净）。手机切回家里 WiFi 后，访问 http://babycry.local 或串口打印的 IP。</p>
<input id="ssid" placeholder="WiFi 名称 (SSID)">
<input id="pass" type="password" placeholder="WiFi 密码">
<button onclick="save()">保存并连接</button>
<div id="msg"></div>
<script>
async function save(){
  const ssid=document.getElementById('ssid').value.trim();
  const pass=document.getElementById('pass').value;
  if(!ssid){document.getElementById('msg').textContent='请填写 WiFi 名称';return;}
  const r=await fetch('/config/save?ssid='+encodeURIComponent(ssid)+'&pass='+encodeURIComponent(pass));
  const j=await r.json();
  document.getElementById('msg').textContent=j.ok?'已保存，开发板重启中…':'失败: '+(j.err||'');
}
</script>
</body></html>)rawliteral";

/* ================================================================== */
/*  高通滤波 (去除 DC + 50Hz 工频 + 亚声频隆隆声)                        */
/* ================================================================== */

typedef struct {
  float x1, y1, x2, y2, x3, y3;
} HighPassState;

static float hpProcess(HighPassState* st, float x) {
  float y = x - st->x1 + 0.99f * st->y1;
  st->x1 = x;
  st->y1 = y;
  float h1 = 0.9607f * (st->y2 + y - st->x2);
  st->x2 = y;
  st->y2 = h1;
  float h2 = 0.9607f * (st->y3 + h1 - st->x3);
  st->x3 = h1;
  st->y3 = h2;
  return h2;
}

static int16_t hpProcessI16(HighPassState* st, int16_t x) {
  float v = hpProcess(st, (float)x);
  if (v > 32767.0f) v = 32767.0f;
  else if (v < -32768.0f) v = -32768.0f;
  return (int16_t)v;
}

/* ================================================================== */
/*  音频状态                                                            */
/* ================================================================== */

static int16_t rmsRing[RING_SAMPLES];                    // 电平表
static volatile uint32_t rmsHead = 0;

static int16_t wsRing[WS_RING_SAMPLES];                  // 录音推流缓冲
static volatile uint32_t wsRingHead = 0;                 // 生产(采集任务)
static volatile uint32_t wsRingTail = 0;                 // 消费(loop 推 WS)
static volatile bool wsRecording = false;
static volatile uint32_t wsSamples = 0;
static volatile bool wsLost = false;

static WiFiServer server(80);
static Preferences prefs;
static WiFiClient wsClient;

// 全局缓冲: 避免在 loopTask 栈上分配大数组导致栈溢出
static int16_t wsChunk[CHUNK_SAMPLES];         // WS 推流临时块 (2KB)
static uint8_t wsPayload[512];                 // WS 命令解析缓冲

/* ================================================================== */
/*  WebSocket (RFC 6455 最小实现, 服务端)                               */
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
  wsRingHead = 0;
  wsRingTail = 0;
  wsSamples = 0;
  wsLost = false;
  wsRecording = true;
  Serial.println("[REC] start (WS stream)");
}

static void stopRecording() {
  wsRecording = false;
  // 把剩余缓冲推完
  while (wsClient && wsClient.connected() && wsRingHead - wsRingTail >= CHUNK_SAMPLES) {
    for (int i = 0; i < CHUNK_SAMPLES; i++) {
      wsChunk[i] = wsRing[wsRingTail % WS_RING_SAMPLES];
      wsRingTail++;
    }
    wsSendBinary(wsClient, (const uint8_t*)wsChunk, sizeof(wsChunk));
  }
  char msg[96];
  snprintf(msg, sizeof(msg), "{\"cmd\":\"done\",\"samples\":%u,\"lost\":%s}",
           wsSamples, wsLost ? "true" : "false");
  wsSendText(wsClient, msg);
  Serial.printf("[REC] stop: %u samples, lost=%s\n", wsSamples, wsLost ? "yes" : "no");
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
      wsRecording = false;
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
        if (!wsRecording) startRecording();
      } else if (strstr((char*)wsPayload, "\"stop\"")) {
        if (wsRecording) stopRecording();
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

static void sendHtml(WiFiClient& c, const char* html) {
  size_t len = strlen(html);
  c.print("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-cache\r\nContent-Length: ");
  c.print(len);
  c.print("\r\nConnection: close\r\n\r\n");
  // 分块写出, 避免一次性 15KB 写入长时间占用 loopTask
  const size_t CHUNK = 1024;
  for (size_t off = 0; off < len; off += CHUNK) {
    size_t n = (len - off < CHUNK) ? (len - off) : CHUNK;
    c.write((const uint8_t*)html + off, n);
    yield();
  }
}

static void handleRms(WiFiClient& c) {
  uint32_t n = (rmsHead < RING_SAMPLES) ? rmsHead : RING_SAMPLES;
  uint32_t rms = 0;
  if (n > 0) {
    double sum = 0;
    for (uint32_t i = 0; i < n; i++) {
      double v = rmsRing[(rmsHead - 1 - i) % RING_SAMPLES];
      sum += v * v;
    }
    rms = (uint32_t)sqrt(sum / n);
  }
  char body[96];
  snprintf(body, sizeof(body), "{\"rms\":%u,\"rec\":%d,\"samples\":%u}",
           rms, wsRecording ? 1 : 0, wsSamples);
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

static void handleConfigSave(WiFiClient& c, const String& query) {
  String ssid = queryParam(query, "ssid");
  String pass = queryParam(query, "pass");
  if (ssid.length() == 0) {
    sendJson(c, "{\"ok\":false,\"err\":\"empty_ssid\"}");
    return;
  }
  prefs.putString(NVS_KEY_SSID, ssid);
  prefs.putString(NVS_KEY_PASS, pass);
  Serial.printf("[WiFi] 保存配置: %s\n", ssid.c_str());
  sendJson(c, "{\"ok\":true}");
  delay(300);
  ESP.restart();
}

static void handleRecStart(WiFiClient& c) {
  wsRecording = true;
  wsSamples = 0;
  wsLost = false;
  Serial.println("[REC] start (HTTP)");
  sendJson(c, "{\"ok\":true,\"max_ms\":0}");
}

static void handleRecStop(WiFiClient& c) {
  wsRecording = false;
  char body[96];
  snprintf(body, sizeof(body), "{\"ok\":true,\"samples\":%u,\"lost\":%s}",
           wsSamples, wsLost ? "true" : "false");
  Serial.printf("[REC] stop (HTTP): %u samples\n", wsSamples);
  sendJson(c, body);
}

static void route(WiFiClient& c, const String& path, const String& query) {
  if (path == "/" || path == "/index.html") {
    sendHtml(c, INDEX_HTML);
  } else if (path == "/config") {
    sendHtml(c, CONFIG_HTML);
  } else if (path == "/config/save") {
    handleConfigSave(c, query);
  } else if (path == "/rms") {
    handleRms(c);
  } else if (path == "/rec/start") {
    handleRecStart(c);
  } else if (path == "/rec/stop") {
    handleRecStop(c);
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
  Serial.println("[serveHttp] 等待请求...");
  // 固定缓冲, 不在栈上反复扩容 String (原先 req += ch 会碎片化堆并放大栈占用)
  static char reqBuf[2049];
  size_t reqLen = 0;
  uint32_t t0 = millis();
  bool done = false;
  while (millis() - t0 < 3000) {
    while (c.available()) {
      if (reqLen >= sizeof(reqBuf) - 1) { done = true; break; }   // 超长, 截断
      reqBuf[reqLen++] = (char)c.read();
      // 只检查最后 4 字节, 避免每字节都构造 String 比较
      if (reqLen >= 4 && memcmp(reqBuf + reqLen - 4, "\r\n\r\n", 4) == 0) { done = true; break; }
    }
    if (done) break;
    yield();
  }
  reqBuf[reqLen] = '\0';
  if (reqLen == 0) {
    Serial.println("[serveHttp] 超时, 没收到请求!");
    return false;
  }
  String req(reqBuf);

  int eol = req.indexOf('\r');
  String firstLine = (eol >= 0) ? req.substring(0, eol) : req;
  Serial.printf("[serveHttp] 收到: %s\n", firstLine.c_str());
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
    wsClient = c;
    // 新连接: 重置录音状态, 避免继承上次卡住/未结束的会话状态
    wsRecording = false;
    wsSamples = 0;
    wsLost = false;
    wsRingHead = 0;
    wsRingTail = 0;
    Serial.println("[WS] client connected (state reset)");
    return true;
  }

  String path = fullPath;
  String query = "";
  int q = fullPath.indexOf('?');
  if (q >= 0) {
    path = fullPath.substring(0, q);
    query = fullPath.substring(q + 1);
  }
  Serial.printf("[serveHttp] 路由: %s\n", path.c_str());
  route(c, path, query);
  c.flush();            // 确保响应发出
  delay(10);            // 给 TCP 一点时间把缓冲发出去再关闭
  return false;
}

/* ================================================================== */
/*  音频采集任务 (Core 0): 高通滤波 → rmsRing → (录音时) wsRing           */
/* ================================================================== */

void audioTask(void* param) {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 512,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };
  i2s_pin_config_t pins = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD
  };
  i2s_driver_install(I2S_PORT, &config, 0, nullptr);
  i2s_set_pin(I2S_PORT, &pins);
  i2s_zero_dma_buffer(I2S_PORT);

  int16_t buf[CHUNK_SAMPLES];
  HighPassState hp = { 0, 0, 0, 0, 0, 0 };
  for (;;) {
    size_t bytesRead = 0;
    if (i2s_read(I2S_PORT, buf, sizeof(buf), &bytesRead, portMAX_DELAY) != ESP_OK) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    int n = bytesRead / 2;
    for (int i = 0; i < n; i++) {
      int16_t sf = hpProcessI16(&hp, buf[i]);

      rmsRing[rmsHead % RING_SAMPLES] = sf;
      rmsHead++;

      if (wsRecording) {
        if (wsRingHead - wsRingTail >= WS_RING_SAMPLES) {
          wsLost = true;             // 消费不及时, 覆盖最旧
          wsRingTail++;
        }
        wsRing[wsRingHead % WS_RING_SAMPLES] = sf;
        wsRingHead++;
        wsSamples++;
      }
    }
  }
}

/* ================================================================== */
/*  setup / loop                                                        */
/* ================================================================== */

void setup() {
  Serial.begin(115200);
  delay(300);

  prefs.begin(NVS_NS, false);
  String savedSSID = prefs.getString(NVS_KEY_SSID, "");
  String savedPass = prefs.getString(NVS_KEY_PASS, "");

  bool staOk = false;
  if (savedSSID.length() > 0) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(savedSSID.c_str(), savedPass.c_str());
    Serial.printf("[STA] connecting to %s", savedSSID.c_str());
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
      delay(500);
      Serial.print(".");
    }
    staOk = (WiFi.status() == WL_CONNECTED);
  }

  if (staOk) {
    Serial.printf("\n[STA] IP: %s\n", WiFi.localIP().toString().c_str());
    WiFi.setSleep(false);
    if (MDNS.begin(MDNS_NAME)) {
      Serial.printf("[mDNS] http://%s.local\n", MDNS_NAME);
    }
  } else {
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);
    WiFi.setTxPower(WIFI_POWER_8_5dBm);
    Serial.printf("[AP] SSID: %s  IP: %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
    Serial.println("[AP] 配网: 浏览器打开 http://192.168.4.1/config");
  }

  server.begin();
  xTaskCreatePinnedToCore(audioTask, "audioTask", 8192, nullptr, 1, nullptr, 0);
  Serial.println("[OK] 就绪 (WebSocket 流式录音)");
}

void loop() {
  // 新 HTTP / WS 连接
  WiFiClient c = server.available();
  if (c) {
    Serial.println("[HTTP] new client");
    bool isWs = serveHttp(c);
    if (!isWs) {
      c.stop();
    }
  }

  // WS: 处理命令 + 推流
  if (wsClient && wsClient.connected()) {
    if (!wsHandleIncoming(wsClient)) {
      wsClient.stop();
      Serial.println("[WS] client disconnected");
    }
    if (wsClient && wsClient.connected() && wsRecording) {
      // 每次循环最多推一个块 (blocking 写入, 但 2048B 写入有界,
      // 且每块之间 loop 会回到 server.available(), /rec/stop 不会被饿死)
      if (wsRingHead - wsRingTail >= CHUNK_SAMPLES) {
        for (int i = 0; i < CHUNK_SAMPLES; i++) {
          wsChunk[i] = wsRing[wsRingTail % WS_RING_SAMPLES];
          wsRingTail++;
        }
        wsSendBinary(wsClient, (const uint8_t*)wsChunk, sizeof(wsChunk));
      }
    }
  }

  delay(1);   // 关键: 让出 CPU, WiFi 栈才能处理新连接和收到的数据
}
