#include <Arduino.h>
#include "driver/i2s.h"

#define I2S_PORT I2S_NUM_0
#define I2S_WS   4
#define I2S_SCK  5
#define I2S_SD   6

#define SAMPLE_RATE 16000
#define PLOT_SIZE 256

int32_t rawSamples[PLOT_SIZE];

void setupI2S() {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 64,
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
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  // L/R 引脚接地
  pinMode(7, OUTPUT);
  digitalWrite(7, LOW);

  Serial.println("=== Debug: print first 20 raw hex values ===");
  setupI2S();
}

void loop() {
  size_t bytesRead = 0;
  i2s_read(I2S_PORT, rawSamples, sizeof(rawSamples), &bytesRead, portMAX_DELAY);

  if (bytesRead == 0) return;

  size_t n = min((size_t)20, bytesRead / sizeof(int32_t));

  // 打印原始 HEX，观察 bit 布局
  for (size_t i = 0; i < n; i++) {
    Serial.print("0x");
    Serial.print((uint32_t)rawSamples[i], HEX);
    Serial.print("  ");
  }
  Serial.println();

  // 打印不同移位的结果对比
  Serial.print(">>8:  ");
  for (size_t i = 0; i < n; i++) {
    Serial.print((int16_t)(rawSamples[i] >> 8));
    Serial.print(" ");
  }
  Serial.println();

  Serial.print(">>14: ");
  for (size_t i = 0; i < n; i++) {
    Serial.print((int16_t)(rawSamples[i] >> 14));
    Serial.print(" ");
  }
  Serial.println();

  Serial.print("<<1>>9:");
  for (size_t i = 0; i < n; i++) {
    Serial.print((int16_t)((rawSamples[i] << 1) >> 9));
    Serial.print(" ");
  }
  Serial.println();

  Serial.println("---");
  delay(2000);
}
