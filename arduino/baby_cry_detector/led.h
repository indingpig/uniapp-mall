#ifndef __LED_H
#define __LED_H

#include "Arduino.h"

// DevKitC-1 板载 WS2812 (GPIO48): 必须用 neopixelWrite 控制, digitalWrite 无效。
// RGB_BUILTIN 是 arduino-esp32 为 neopixelWrite 提供的虚拟引脚
#define LED_PIN  RGB_BUILTIN
#define LED_COLOR_R 64   // 指示灯颜色: 暗橙 (亮度受 RGB_BRIGHTNESS 量级约束)
#define LED_COLOR_G 16
#define LED_COLOR_B 0

void led_init(void);
void led_toggle(void);
void led_blink(unsigned long interval_ms);  // 非阻塞翻转: 在 loop 中反复调用
void led_on(void);
void led_off(void);

#endif
