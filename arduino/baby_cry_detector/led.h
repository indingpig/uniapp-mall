#ifndef __LED_H
#define __LED_H

#include "Arduino.h"

#define LED_PIN 97

#define LED_ON()   digitalWrite(LED_PIN, HIGH)
#define LED_OFF()  digitalWrite(LED_PIN, LOW)

void led_init(void);
void led_toggle(void);
void led_blink(unsigned long interval_ms);

#endif