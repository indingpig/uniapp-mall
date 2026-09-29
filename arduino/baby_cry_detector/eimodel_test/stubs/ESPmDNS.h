#pragma once
class MDNSClass {
public:
  bool begin(const char* name) { (void)name; return true; }
};
extern MDNSClass MDNS;
