#include <babyCry_inferencing.h>

/**
 * Baby Cry Monitor - ESP32 主固件
 *
 * 功能模块:
 *   - audio_task:  INMP441 I2S 麦克风采集 + RMS 计算 (Core 0)
 *   - ble_provision: BLE 配网 (App 写入 WiFi 凭据)
 *   - wifi_connect:  WiFi 连接 + NVS 持久化
 *   - 主循环: WiFi 状态轮询 + 音频数据串口输出
 *
 * 模块接口:
 *   - ble_provision.h: bleProvisionInit / bleProvisionSetCredentialsCallback
 *   - wifi_connect.h:  wifiConnectInit / wifiConnectBegin / wifiLoop
 *
 * 依赖库 (Arduino Library Manager):
 *   - 无需额外库 (BLE/WiFi/Preferences 均为 ESP32 内置)
 *
 * 接线:
 *   INMP441:  WS→4, SCK→5, SD→6
 *   VCC→3.3V, GND→GND, L/R→GND (左声道)
 */

#include <Arduino.h>
#include <math.h>
#include <WiFi.h>
#include "driver/i2s.h"
#include "config.h"
#include "ble_provision.h"
#include "wifi_connect.h"

/* ================================================================== */
/*  I2S 音频配置                                                        */
/* ================================================================== */

#define I2S_PORT     I2S_NUM_0
#define I2S_WS       4
#define I2S_SCK      5
#define I2S_SD       6
#define SAMPLE_RATE  16000
#define BUFFER_SIZE  512

#define SHOW_THRESHOLD 150   // 串口打印阈值

// 音频任务 (Core 0) 输出, 主循环 (Core 1) 读取
volatile float g_rms  = 0;
volatile int   g_peak = 0;
portMUX_TYPE   g_mux  = portMUX_INITIALIZER_UNLOCKED;

/* ================================================================== */
/*  音频采集任务 (运行在 Core 0)                                         */
/* ================================================================== */

void audioTask(void* param) {
  int32_t rawSamples[BUFFER_SIZE];

  i2s_config_t config = {
    .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate          = SAMPLE_RATE,
    .bits_per_sample      = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count        = 8,
    .dma_buf_len          = 64,
    .use_apll             = false,
    .tx_desc_auto_clear   = false,
    .fixed_mclk           = 0
  };

  i2s_pin_config_t pins = {
    .bck_io_num   = I2S_SCK,
    .ws_io_num    = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num  = I2S_SD
  };

  i2s_driver_install(I2S_PORT, &config, 0, nullptr);
  i2s_set_pin(I2S_PORT, &pins);
  i2s_zero_dma_buffer(I2S_PORT);

  Serial.println("[Audio] Task started on Core 0");

  for (;;) {
    size_t bytesRead = 0;
    esp_err_t r = i2s_read(I2S_PORT, rawSamples, sizeof(rawSamples), &bytesRead, portMAX_DELAY);
    if (r != ESP_OK || bytesRead == 0) {
      delay(10);
      continue;
    }

    size_t count = bytesRead / sizeof(int32_t);
    double squareSum = 0;
    int32_t peak = 0;

    for (size_t i = 0; i < count; i++) {
      // INMP441 24-bit 数据位于 bits[31:8]，右移 16 位转为标准 16-bit PCM
      int32_t sample = rawSamples[i] >> 16;
      int32_t absVal = (sample < 0) ? -sample : sample;
      if (absVal > peak) peak = absVal;
      squareSum += (double)sample * sample;
    }

    double rms = sqrt(squareSum / count);

    portENTER_CRITICAL(&g_mux);
    g_rms  = (float)rms;
    g_peak = peak;
    portEXIT_CRITICAL(&g_mux);

    vTaskDelay(pdMS_TO_TICKS(100));  // ~10 Hz 上报
  }
}

/* ================================================================== */
/*  模块间回调 (胶水层)                                                 */
/* ================================================================== */

// WiFi 状态变化 → 转发给 BLE 通知 App
void onWifiStatus(const char* status) {
  bleProvisionUpdateStatus(status);
}

// BLE 收到完整 WiFi 凭据 → 交给 WiFi 模块连接
void onCredentialsReceived(const String& ssid, const String& pass) {
  wifiConnectBegin(ssid, pass);
}

/* ================================================================== */
/*  主程序                                                              */
/* ================================================================== */

char deviceName[32] = "BabyMonitor-0000";

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== Baby Cry Monitor ESP32 ===");

  // 生成设备名 (基于 MAC 后 4 位)
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  snprintf(deviceName, sizeof(deviceName), "BabyMonitor-%s", mac.substring(8, 12).c_str());
  Serial.printf("[Info] Device: %s\n", deviceName);

  // WiFi 模块 (读取 NVS 自动重连)
  wifiConnectInit(onWifiStatus);

  // BLE 配网模块
  bleProvisionInit(deviceName);
  bleProvisionSetCredentialsCallback(onCredentialsReceived);

  // 音频采集任务 (Core 0)
  xTaskCreatePinnedToCore(
    audioTask, "audioTask", 8192, nullptr, 1, nullptr, 0
  );

  Serial.println("[Info] Setup complete");
}

void loop() {
  // WiFi 连接状态轮询
  wifiLoop();

  // 串口输出音频数据 (安静时不刷屏)
  static unsigned long lastPrint = 0;
  float rms;
  int peak;

  portENTER_CRITICAL(&g_mux);
  rms  = g_rms;
  peak = g_peak;
  portEXIT_CRITICAL(&g_mux);

  if (rms > SHOW_THRESHOLD || millis() - lastPrint > 5000) {
    int barLength = (int)(rms / 25.0);
    if (barLength > 50) barLength = 50;

    Serial.print("[");
    Serial.print(millis() / 1000.0, 1);
    Serial.print("s] ");

    if (rms > SHOW_THRESHOLD) Serial.print("🔊 ");

    Serial.print("RMS: ");
    Serial.print(rms, 1);
    Serial.print("  Peak: ");
    Serial.print(peak);
    Serial.print("  [");
    for (int i = 0; i < barLength; i++) Serial.print("#");
    Serial.println("]");

    lastPrint = millis();
  }

  delay(50);
}
