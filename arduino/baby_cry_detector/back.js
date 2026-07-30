#include <Arduino.h>
#include <math.h>
#include "driver/i2s.h"

#define I2S_PORT I2S_NUM_0

#define I2S_WS   4
#define I2S_SCK  5
#define I2S_SD   6

#define SAMPLE_RATE 16000
#define BUFFER_SIZE 512

int32_t rawSamples[BUFFER_SIZE];

void setupI2S() {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(
      I2S_MODE_MASTER |
      I2S_MODE_RX
    ),
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

  esp_err_t result;

  result = i2s_driver_install(
    I2S_PORT,
    &config,
    0,
    nullptr
  );

  if (result != ESP_OK) {
    Serial.printf("i2s_driver_install failed: %d\n", result);
    return;
  }

  result = i2s_set_pin(I2S_PORT, &pins);

  if (result != ESP_OK) {
    Serial.printf("i2s_set_pin failed: %d\n", result);
    return;
  }

  i2s_zero_dma_buffer(I2S_PORT);

  Serial.println("I2S microphone ready");
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("=== BOOT ===");

  Serial.println();
  Serial.println("Baby Cry Monitor - microphone test");

  setupI2S();
}

void loop() {
  size_t bytesRead = 0;

  esp_err_t result = i2s_read(
    I2S_PORT,
    rawSamples,
    sizeof(rawSamples),
    &bytesRead,
    portMAX_DELAY
  );

  if (result != ESP_OK || bytesRead == 0) {
    Serial.println("I2S read failed");
    delay(100);
    return;
  }

  size_t sampleCount = bytesRead / sizeof(int32_t);

  double squareSum = 0.0;
  int32_t peak = 0;

  for (size_t i = 0; i < sampleCount; i++) {
    /*
     * INMP441 的有效数据通常位于 32-bit I2S 数据的高位。
     * 右移 14 位，转换成适合当前测试的 16-bit 量级。
     */
    int32_t sample = rawSamples[i] >> 14;

    if (sample > peak) {
      peak = sample;
    }

    if (-sample > peak) {
      peak = -sample;
    }

    squareSum += static_cast<double>(sample) * sample;
  }

  double rms = sqrt(squareSum / sampleCount);

  // 使用 ASCII，避免串口监视器对中文或特殊符号显示异常
  int barLength = static_cast<int>(rms / 100.0);

  if (barLength > 50) {
    barLength = 50;
  }

  Serial.print("RMS: ");
  Serial.print(rms, 1);
  Serial.print("  Peak: ");
  Serial.print(peak);
  Serial.print("  [");

  for (int i = 0; i < barLength; i++) {
    Serial.print("#");
  }

  Serial.println("]");

  delay(50);
}