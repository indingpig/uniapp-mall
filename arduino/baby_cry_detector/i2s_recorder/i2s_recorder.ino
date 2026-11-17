#include <Arduino.h>
#include "driver/i2s.h"

// 麦克风诊断版 v3：16 位立体声读取 + 软件自动判声道。
// 排障史（2026-11-17）：32 位读在 S3 旧版驱动上 DMA 填的是自身生成的
// 0xFFFFFFFF/0x00000000 交错图案（SD 接地后依然如此，已实锤），完全不读
// 真实引脚；16 位 ONLY_LEFT 读虽读真实引脚，但会把双槽交错喂进缓冲，
// 表现为约半数样本精确为 0。本版 = 16 位 + RIGHT_LEFT 双槽 + 软件按能量
// 自动选有数据的槽，两个坑一起绕。

#define I2S_PORT I2S_NUM_0
#define I2S_WS   4
#define I2S_SCK  5
#define I2S_SD   6

#define SAMPLE_RATE 16000
#define RECORD_SECONDS 2
#define RECORD_SIZE (SAMPLE_RATE * RECORD_SECONDS)   // 输出样本数

int16_t rawBuffer[RECORD_SIZE * 2];   // 双槽交错: [slotA, slotB, ...]

void setupI2S() {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
    .communication_format = I2S_COMM_FORMAT_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 512,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };
  i2s_pin_config_t pins = {
    .mck_io_num = I2S_PIN_NO_CHANGE,
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
  Serial.begin(2000000);
  delay(2000);

  Serial.println("=== I2S Recorder 16bit stereo + auto-channel v3 ===");
  Serial.println("Send any character to start recording...");
  setupI2S();
}

void loop() {
  if (Serial.available() > 0) {
    Serial.read();  // 清掉输入

    Serial.println("Recording 2 seconds (16bit stereo)...");
    size_t totalRead = 0;
    while (totalRead < RECORD_SIZE * 2) {
      size_t bytesRead = 0;
      i2s_read(I2S_PORT,
               rawBuffer + totalRead,
               (RECORD_SIZE * 2 - totalRead) * sizeof(int16_t),
               &bytesRead,
               portMAX_DELAY);
      totalRead += bytesRead / sizeof(int16_t);
    }

    // 自动判声道: 哪个槽带数据取哪个（按能量选，不赌 LEFT/RIGHT 方向）
    long e0 = 0, e1 = 0;
    for (int i = 0; i < RECORD_SIZE; i++) {
      e0 += abs(rawBuffer[2 * i]);
      e1 += abs(rawBuffer[2 * i + 1]);
    }
    int off = (e1 > e0) ? 1 : 0;
    Serial.printf("声道: slot%d (能量 %ld vs %ld)\n", off, e0, e1);

    // 原地打包: 数据槽样本压缩到前半（写游标 ≤ 读游标，安全）
    for (int i = 0; i < RECORD_SIZE; i++)
      rawBuffer[i] = rawBuffer[2 * i + off];

    Serial.print("DATA ");
    Serial.println(RECORD_SIZE);
    delay(100);
    Serial.write((uint8_t*)rawBuffer, RECORD_SIZE * 2);
    Serial.println("\nEND");
    Serial.println("Done!");
  }
}
