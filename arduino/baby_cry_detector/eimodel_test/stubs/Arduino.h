#pragma once
#include <stdint.h>
#include <time.h>
#include <stddef.h>
#include <string.h>
#include <string>
#include <cctype>
#include <cstring>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include "freertos/task.h"
typedef bool boolean;
class String_Stub {
  std::string d;
public:
  String_Stub() {}
  String_Stub(const char* s) : d(s ? s : "") {}
  String_Stub(const std::string& s) : d(s) {}
  const char* c_str() const { return d.c_str(); }
  size_t length() const { return d.size(); }
  int indexOf(char c) const { auto p = d.find(c); return p == std::string::npos ? -1 : (int)p; }
  int indexOf(char c, int from) const { auto p = d.find(c, from); return p == std::string::npos ? -1 : (int)p; }
  int indexOf(const char* s) const { auto p = d.find(s); return p == std::string::npos ? -1 : (int)p; }
  int indexOf(const String_Stub& s) const { auto p = d.find(s.d); return p == std::string::npos ? -1 : (int)p; }
  String_Stub substring(int a, int b) const { if (b < 0) b = (int)d.size(); if (a < 0) a = 0; if (b > (int)d.size()) b = (int)d.size(); return String_Stub(d.substr(a, b-a)); }
  String_Stub substring(int a) const { if (a < 0) a = 0; return String_Stub(d.substr(a)); }
  bool startsWith(const char* s) const { return d.rfind(s, 0) == 0; }
  bool endsWith(const char* s) const { return d.size() >= strlen(s) && d.compare(d.size()-strlen(s), strlen(s), s) == 0; }
  bool equalsIgnoreCase(const char* s) const {
    if (d.size() != strlen(s)) return false;
    for (size_t i = 0; i < d.size(); i++) if (tolower(d[i]) != tolower(s[i])) return false;
    return true;
  }
  bool operator==(const char* s) const { return d == s; }
  String_Stub& operator+=(const String_Stub& o) { d += o.d; return *this; }
  String_Stub& operator+=(char c) { d += c; return *this; }
  String_Stub& operator+=(const char* s) { d += s; return *this; }
  String_Stub operator+(const String_Stub& o) const { return String_Stub(d + o.d); }
  String_Stub operator+(const char* s) const { return String_Stub(d + s); }
  char operator[](int i) const { return d[i]; }
};
#define String String_Stub

class EspClass { public: void restart() {} };
extern EspClass ESP;

class Serial_Stub {
public:
    void begin(int) {}
    void print(const char* s) { (void)s; }
    void print(float, int = 6) {}
    void print(int) {}
    void println(const char* s = "") { (void)s; }
    void println(float, int = 6) {}
    void println(int) {}
    void write(uint8_t) {}
    void write(const uint8_t*, int) {}
    int available() { return 0; }
    int read() { return -1; }
    void flush() {}
    bool operator!() const { return false; }
    void printf(const char* fmt, ...) __attribute__((format(printf,2,3))) {}
};
extern Serial_Stub Serial;
#define INPUT 0
#define OUTPUT 1
#define LOW 0
#define HIGH 1
static inline void delay(unsigned long ms) { struct timespec ts = {0, (long)ms * 1000000L}; nanosleep(&ts, NULL); }
#define millis() ((uint32_t)0)
#define micros() ((uint32_t)0)
void pinMode(int, int) {}
void digitalWrite(int, int) {}
void yield() {}
#define sq(x) ((x)*(x))
#define constrain(x,a,b) ((x)<(a)?(a):((x)>(b)?(b):(x)))
