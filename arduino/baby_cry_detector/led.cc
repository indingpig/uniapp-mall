#include "led.h"

static unsigned long led_last_toggle = 0;
static bool led_state = false;

void led_init(void) {
  led_off();
}

void led_toggle(void) {
  led_state = !led_state;
  neopixelWrite(LED_PIN,
                led_state ? LED_COLOR_R : 0,
                led_state ? LED_COLOR_G : 0,
                led_state ? LED_COLOR_B : 0);
}

void led_blink(unsigned long interval_ms) {
  unsigned long now = millis();
  if (now - led_last_toggle >= interval_ms) {
    led_toggle();
    led_last_toggle = now;
  }
}

void led_on(void) {
  led_state = true;
  neopixelWrite(LED_PIN, LED_COLOR_R, LED_COLOR_G, LED_COLOR_B);
}

void led_off(void) {
  led_state = false;
  neopixelWrite(LED_PIN, 0, 0, 0);
}
