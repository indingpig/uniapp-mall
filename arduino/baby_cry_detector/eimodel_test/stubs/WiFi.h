#pragma once
#include <stdint.h>
#include <stddef.h>
#include "Arduino.h"

class IPAddress {
  uint8_t b[4];
public:
  IPAddress() { b[0]=b[1]=b[2]=b[3]=0; }
  IPAddress(uint8_t a, uint8_t c, uint8_t d, uint8_t e) { b[0]=a;b[1]=c;b[2]=d;b[3]=e; }
  String toString() const { char buf[16]; snprintf(buf, sizeof buf, "%u.%u.%u.%u", b[0],b[1],b[2],b[3]); return String(buf); }
};

class WiFiClient {
  int fd;
public:
  WiFiClient() : fd(-1) {}
  explicit WiFiClient(int f) : fd(f) {}
  operator bool() const { return fd >= 0; }
  bool connected() { return fd >= 0; }
  int available() { return 0; }
  int read() { return -1; }
  size_t read(uint8_t* buf, size_t sz) { (void)buf; (void)sz; return 0; }
  size_t write(const uint8_t* buf, size_t sz) { (void)buf; (void)sz; return sz; }
  size_t write(uint8_t b) { (void)b; return 1; }
  void stop() { fd = -1; }
  void flush() {}
  int availableForWrite() { return 2048; }
  void print(const char* s) { (void)s; }
  void print(int v) { (void)v; }
  void print(const String& s) { (void)s; }
  void print(uint32_t v) { (void)v; }
  void print(size_t v) { (void)v; }
  void print(long v) { (void)v; }
};

class WiFiServer {
  int port;
public:
  WiFiServer(int p) : port(p) {}
  void begin() {}
  WiFiClient available() { return WiFiClient(-1); }
};

#define WL_CONNECTED 3
#define WIFI_AP 2
#define WIFI_POWER_8_5dBm 34
#define WIFI_STA 1
class WiFiClass {
public:
  void mode(int m) { (void)m; }
  bool softAP(const char* ssid, const char* pass = "") { (void)ssid; (void)pass; return true; }
  IPAddress softAPIP() { return IPAddress(192,168,4,1); }
  void begin(const char* ssid, const char* pass = "") { (void)ssid; (void)pass; }
  void setTxPower(int p) { (void)p; }
  void setSleep(bool b) { (void)b; }
  int status() { return WL_CONNECTED; }
  IPAddress localIP() { return IPAddress(192,168,1,50); }
};
extern WiFiClass WiFi;
