#pragma once
#include "Arduino.h"
class Preferences {
public:
  void begin(const char* ns, bool ro) { (void)ns; (void)ro; }
  String getString(const char* key, const char* def = "") { (void)key; return String(def); }
  void putString(const char* key, const String& v) { (void)key; (void)v; }
};
