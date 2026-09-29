#include <Arduino.h>
#include "driver/i2s.h"

/**
 * Audio Streamer - 连续音频流固件
 *
 * 用途: 批量采集 Edge Impulse 训练数据。
 *   设备上电后通过 USB 串口 (2M baud) 持续输出 16-bit / 16kHz 单声道原始音频,
 *   由 PC 端 record_data.py 接收、缓冲、按键保存为训练片段。
 *
 * 接线 (与 i2s_recorder 一致):
 *   INMP441: WS→4, SCK→5, SD→6, VCC→3.3V, GND→GND, L/R→GND (左声道)
 *
 * 用法:
 *   1. Arduino IDE 打开本文件, 选 ESP32S3 Dev Module, 烧录
 *   2. 串口监视器确认输出 "STREAM_READY" (或直接跑 record_data.py)
 *   3. 运行: python record_data.py --port COM3
 */

#define I2S_PORT I2S_NUM_0
#define I2S_WS   4
#define I2S_SCK  5
#define I2S_SD   6

#define SAMPLE_RATE 16000
#define BUF_SAMPLES 1024    // 每次读取的 int16 样本数

int16_t sampleBuf[BUF_SAMPLES];

void setupI2S() {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 512,
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
  Serial.begin(2000000);   // 2M baud, 音频 32KB/s 远低于串口带宽
  delay(500);

  setupI2S();

  // 通知 PC 端可以开始接收
  Serial.println("STREAM_READY");
}

void loop() {
  size_t bytesRead = 0;
  esp_err_t r = i2s_read(I2S_PORT, sampleBuf, sizeof(sampleBuf), &bytesRead, portMAX_DELAY);
  if (r == ESP_OK && bytesRead > 0) {
    // 原始 int16 LE 字节流直接送出
    Serial.write((const uint8_t *)sampleBuf, bytesRead);
  }
}
