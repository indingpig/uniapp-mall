// PlatformIO 专用入口。PlatformIO 只会转换 src_dir 根目录的 .ino，
// 子目录里的 ble_test.ino 永远不会被编译，因此由本文件引入。
// Arduino IDE 没有 PLATFORMIO 宏，本文件整体编译为空，
// .ino 由 IDE 自行转换，两套工具链互不冲突。
#ifdef PLATFORMIO
#include <Arduino.h>
#include "ble_test.ino"
#endif
