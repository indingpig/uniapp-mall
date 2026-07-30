#include <Arduino.h>
#include "driver/i2s.h"

#define I2S_PORT I2S_NUM_0
#define I2S_WS   4
#define I2S_SCK  5
#define I2S_SD   6

#define SAMPLE_RATE 16000
#define RECORD_SECONDS 3
#define RECORD_SIZE (SAMPLE_RATE * RECORD_SECONDS)

int32_t rawBuffer[RECORD_SIZE];

void setupI2S() {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 256,
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
  Serial.begin(2000000);  // 高波特率，传输更快
  delay(2000);

  pinMode(7, OUTPUT);
  digitalWrite(7, LOW);

  Serial.println("=== I2S Recorder ===");
  Serial.println("Send any character to start recording...");
  setupI2S();
}

void loop() {
  if (Serial.available() > 0) {
    Serial.read();  // 清掉输入

    Serial.println("Recording 2 seconds...");

    // 连续读取 2 秒音频
    size_t totalRead = 0;
    while (totalRead < RECORD_SIZE) {
      size_t bytesRead = 0;
      i2s_read(I2S_PORT,
               rawBuffer + totalRead,
               (RECORD_SIZE - totalRead) * sizeof(int32_t),
               &bytesRead,
               portMAX_DELAY);
      totalRead += bytesRead / sizeof(int32_t);
    }

    Serial.println("Recording done. Computing DC offset...");

    // 计算 DC 偏置（所有样本的平均值）
    double dcSum = 0;
    for (int i = 0; i < RECORD_SIZE; i++) {
      dcSum += (int16_t)(rawBuffer[i] >> 16);
    }
    int16_t dcOffset = (int16_t)(dcSum / RECORD_SIZE);

    Serial.print("  DC offset: ");
    Serial.println(dcOffset);
    Serial.println("Sending data...");

    // 发送数据头
    Serial.print("DATA ");
    Serial.println(RECORD_SIZE);

    delay(100);

    // 发送去 DC 后的 16-bit 样本
    for (int i = 0; i < RECORD_SIZE; i++) {
      int16_t sample = (int16_t)(rawBuffer[i] >> 16);
      sample -= dcOffset;   // 减去 DC 偏置，让波形围绕 0
      Serial.write((uint8_t*)&sample, 2);
    }

    Serial.println("\nEND");
    Serial.println("Done! Run the Python script to save WAV.");
  }
}
