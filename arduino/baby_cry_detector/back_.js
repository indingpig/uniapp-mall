#include <driver/i2s.h>

// INMP441 接线引脚
#define I2S_WS  4
#define I2S_SCK 5
#define I2S_SD  6

#define SAMPLE_RATE 16000
#define BUFFER_SIZE 512

int16_t samples[BUFFER_SIZE];

void setup() {
  Serial.begin(115200);

  // 配置 I2S
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,  // INMP441 固定 32bit
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 64,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD
  };

  i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pin_config);
  i2s_zero_dma_buffer(I2S_NUM_0);

  Serial.println("🎤 I2S 麦克风已就绪");
}

void loop() {
  size_t bytes_read;
  int32_t raw[BUFFER_SIZE];

  esp_err_t err = i2s_read(I2S_NUM_0, raw, sizeof(raw), &bytes_read, portMAX_DELAY);

  if (err == ESP_OK && bytes_read > 0) {
    // INMP441 是 24bit 左对齐在 32bit 里，右移 8 位取高 16bit
    for (int i = 0; i < BUFFER_SIZE; i++) {
      samples[i] = (int16_t)(raw[i] >> 14);
    }

    // 计算 RMS（音量）
    float sum = 0;
    for (int i = 0; i < BUFFER_SIZE; i++) {
      sum += (float)samples[i] * samples[i];
    }
    float rms = sqrt(sum / BUFFER_SIZE);

    // 串口输出：画一个简单的音量条
    Serial.print("音量: ");
    int bar = map(rms, 0, 10000, 0, 50);
    for (int i = 0; i < bar; i++) Serial.print("█");
    Serial.print(" ");
    Serial.println(rms);
  }

  delay(50);
}