#include "led.h"

static unsigned long led_last_toggle = 0;

void led_init(void) {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
}

void led_toggle(void) {
  digitalWrite(LED_PIN, !digitalRead(LED_PIN));
}

void led_blink(unsigned long interval_ms) {
  unsigned long now = millis();
  if (now - led_last_toggle >= interval_ms) {
    led_toggle();
    led_last_toggle = now;
  }
}