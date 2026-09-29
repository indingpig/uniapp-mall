#include <babyCry_inferencing.h>

/* Edge Impulse Arduino examples
 * Copyright (c) 2022 EdgeImpulse Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// These sketches are tested with 2.0.4 ESP32 Arduino Core
// https://github.com/espressif/arduino-esp32/releases/tag/2.0.4

// If your target is limited in memory remove this macro to save 10K RAM
#define EIDSP_QUANTIZE_FILTERBANK   0

/*
 ** NOTE: If you run into TFLite arena allocation issue.
 **
 ** This may be due to may dynamic memory fragmentation.
 ** Try defining "-DEI_CLASSIFIER_ALLOCATION_STATIC" in boards.local.txt (create
 ** if it doesn't exist) and copy this file to
 ** `<ARDUINO_CORE_INSTALL_PATH>/arduino/hardware/<mbed_core>/<core_version>/`.
 **
 ** See
 ** (https://support.arduino.cc/hc/en-us/articles/360012076960-Where-are-the-installed-cores-located-)
 ** to find where Arduino installs cores on your machine.
 **
 ** If the problem persists then there's not enough memory for this model and application.
 */

/* ========================================================================
 *  Baby Cry Monitor 定制版 (基于 Edge Impulse 官方示例, 已适配本机硬件)
 *
 *  目标板: ESP32-S3-WROOM-1 CoreBoard V1.4 (Arduino 板型选 ESP32S3 Dev Module)
 *  注意: 本板 WROOM-1 模块未引出 IO22~IO34, GPIO25/26/33 不可用!
 *
 *  INMP441 接线 (接 J1 排针的 4/5/6 号脚):
 *    VDD  -> 3.3V
 *    GND  -> GND
 *    L/R  -> GND        (接地 = 左声道, 代码需用 ONLY_LEFT)
 *    WS   -> GPIO4
 *    SCK  -> GPIO5
 *    SD   -> GPIO6
 *
 *  I2S 端口固定用 I2S_NUM_1, 与主固件 baby_cry_detector.ino 的 I2S_NUM_0 互不冲突
 * ======================================================================== */

/* Includes ---------------------------------------------------------------- */
#include <babyCry_inferencing.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include <math.h>

#include "driver/i2s.h"

/** Audio buffers, pointers and selectors */
typedef struct {
    int16_t *buffer;
    uint8_t buf_ready;
    uint32_t buf_count;
    uint32_t n_samples;
} inference_t;

/* 高通滤波器状态.
 * 注意: 这个类型必须定义在文件靠前的位置!
 * Arduino IDE 会把所有函数的原型自动插入到 #include 之后、第一个类型定义之前,
 * 若 HighPassState 定义在使用它的 hpProcess() 附近(文件中部), 自动生成的
 *   static float hpProcess(HighPassState* st, float x);
 * 会出现在类型定义之前 -> "HighPassState was not declared in this scope". */
typedef struct {
  float x1, y1, x2, y2, x3, y3;
} HighPassState;

/* 显式声明原型: Arduino 检测到已存在就不会再自动插入, 避免上述问题 */
static float hpProcess(HighPassState* st, float x);

static inference_t inference;
static const uint32_t sample_buffer_size = 2048;
static signed short sampleBuffer[sample_buffer_size];
static bool debug_nn = false; // true 会打印 DSP 生成的 Features (刷屏), 排查时才打开
static bool record_status = true;

/* ========================================================================
 *  AGC (自动增益控制) — 替代 Edge Impulse 示例里固定 ×8 的 int16 回绕增益
 *
 *  问题: 训练数据用 iPhone 12 mini 录制 (RMS 435~2744, 中位数~1354),
 *        而设备固定 ×8 增益会把 INMP441 音频推到 RMS 4650~16000+,
 *        远超训练分布 -> 模型把一切判成 speach。
 *  方案: 每个推理窗口(1s)先原样缓存, 窗口满后按 目标RMS/实际RMS 计算增益,
 *        限制在 [AGC_MIN_GAIN, AGC_MAX_GAIN], 以 float 运算并截断到 int16。
 *        AGC_TARGET_RMS=2500 落在 iPhone 训练数据的 RMS 区间内。
 *  效果: 设备输入电平被拉回训练分布, 主机实测任何音量/距离的哭声均判 babycry。
 * ======================================================================== */
#define AGC_TARGET_RMS   2500.0f
#define AGC_MIN_GAIN     0.25f
#define AGC_MAX_GAIN     64.0f

static int16_t *window_raw = nullptr;   // 一个窗口的原始(未增益)样本, 供 AGC 计算

/**
 * @brief      Arduino setup function
 */
void setup()
{
    // put your setup code here, to run once:
    Serial.begin(115200);
    // comment out the below line to cancel the wait for USB connection (needed for native USB)
    while (!Serial);
    Serial.println("Edge Impulse Inferencing Demo");

    // summary of inferencing settings (from model_metadata.h)
    ei_printf("Inferencing settings:\n");
    ei_printf("\tInterval: ");
    ei_printf_float((float)EI_CLASSIFIER_INTERVAL_MS);
    ei_printf(" ms.\n");
    ei_printf("\tFrame size: %d\n", EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE);
    ei_printf("\tSample length: %d ms.\n", EI_CLASSIFIER_RAW_SAMPLE_COUNT / 16);
    ei_printf("\tNo. of classes: %d\n", sizeof(ei_classifier_inferencing_categories) / sizeof(ei_classifier_inferencing_categories[0]));

    ei_printf("\nStarting continious inference in 2 seconds...\n");
    ei_sleep(2000);

    if (microphone_inference_start(EI_CLASSIFIER_RAW_SAMPLE_COUNT) == false) {
        ei_printf("ERR: Could not allocate audio buffer (size %d), this could be due to the window length of your model\r\n", EI_CLASSIFIER_RAW_SAMPLE_COUNT);
        return;
    }

    ei_printf("Recording...\n");
}

/**
 * @brief      Arduino main function. Runs the inferencing loop.
 */
void loop()
{
    bool m = microphone_inference_record();
    if (!m) {
        ei_printf("ERR: Failed to record audio...\n");
        return;
    }

    signal_t signal;
    signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
    signal.get_data = &microphone_audio_signal_get_data;
    ei_impulse_result_t result = { 0 };

    EI_IMPULSE_ERROR r = run_classifier(&signal, &result, debug_nn);
    if (r != EI_IMPULSE_OK) {
        ei_printf("ERR: Failed to run classifier (%d)\n", r);
        return;
    }

    // print the predictions
    ei_printf("Predictions ");
    ei_printf("(DSP: %d ms., Classification: %d ms., Anomaly: %d ms.)",
        result.timing.dsp, result.timing.classification, result.timing.anomaly);
    ei_printf(": \n");
    for (size_t ix = 0; ix < EI_CLASSIFIER_LABEL_COUNT; ix++) {
        ei_printf("    %s: ", result.classification[ix].label);
        ei_printf_float(result.classification[ix].value);
        ei_printf("\n");
    }
#if EI_CLASSIFIER_HAS_ANOMALY == 1
    ei_printf("    anomaly score: ");
    ei_printf_float(result.anomaly);
    ei_printf("\n");
#endif

    // 识别结果摘要: 取最大概率类别
    size_t best = 0;
    for (size_t ix = 1; ix < EI_CLASSIFIER_LABEL_COUNT; ix++) {
        if (result.classification[ix].value > result.classification[best].value) {
            best = ix;
        }
    }
    ei_printf(">> 识别结果: %s (%.1f%%)\n",
        result.classification[best].label,
        result.classification[best].value * 100.0f);

    // 音频音量(RMS): 排查音频输入是否正常
    double sumSq = 0;
    for (size_t ix = 0; ix < inference.n_samples; ix++) {
        float v = (float)inference.buffer[ix];
        sumSq += v * v;
    }
    ei_printf(">> 音量 RMS: %.0f\n", sqrt(sumSq / inference.n_samples));
}

/* ========================================================================
 *  高通滤波: 去除 DC 偏移 + 50Hz 工频 + 亚声频隆隆声 (与采集固件一致)
 *  保证训练数据 = 推理输入
 *  (HighPassState 类型与 hpProcess 原型已移到文件前部, 见上方说明)
 * ======================================================================== */

static float hpProcess(HighPassState* st, float x) {
  float y = x - st->x1 + 0.99f * st->y1;          // DC 阻断
  st->x1 = x;
  st->y1 = y;
  float h1 = 0.9607f * (st->y2 + y - st->x2);     // 100Hz 高通 第1级
  st->x2 = y;
  st->y2 = h1;
  float h2 = 0.9607f * (st->y3 + h1 - st->x3);    // 100Hz 高通 第2级
  st->x3 = h1;
  st->y3 = h2;
  return h2;
}

/* 窗口满后执行 AGC: 高通滤波 -> RMS -> 增益(带限幅) -> float 运算 -> int16 截断 */
static void apply_agc(void)
{
    static HighPassState hp = { 0, 0, 0, 0, 0, 0 };

    // 1) 高通滤波 (原位)
    for (uint32_t i = 0; i < inference.n_samples; i++) {
        float v = hpProcess(&hp, (float)window_raw[i]);
        if (v > 32767.0f)  v = 32767.0f;
        else if (v < -32768.0f) v = -32768.0f;
        window_raw[i] = (int16_t)v;
    }

    // 2) RMS + AGC
    double sumSq = 0;
    for (uint32_t i = 0; i < inference.n_samples; i++) {
        double v = (double)window_raw[i];
        sumSq += v * v;
    }
    double rms = sqrt(sumSq / (double)inference.n_samples);

    double g = (rms > 1.0) ? (double)AGC_TARGET_RMS / rms : (double)AGC_MAX_GAIN;
    if (g < AGC_MIN_GAIN) g = AGC_MIN_GAIN;
    if (g > AGC_MAX_GAIN) g = AGC_MAX_GAIN;

    for (uint32_t i = 0; i < inference.n_samples; i++) {
        double v = (double)window_raw[i] * g;
        if (v > 32767.0)  v = 32767.0;
        if (v < -32768.0) v = -32768.0;
        inference.buffer[i] = (int16_t)v;
    }

    ei_printf(">> AGC: src_rms=%.0f gain=%.2f out_rms=%.0f\n", rms, g,
        sqrt(sumSq / (double)inference.n_samples) * g);
}

static void capture_samples(void* arg) {

  const int32_t i2s_bytes_to_read = (uint32_t)arg;
  size_t bytes_read = 0;

  while (record_status) {

    /* read data at once from i2s */
    i2s_read((i2s_port_t)1, (void*)sampleBuffer, i2s_bytes_to_read, &bytes_read, 100);

    if (bytes_read <= 0) {
      ei_printf("Error in I2S read : %d", bytes_read);
    }
    else {
        if (bytes_read < i2s_bytes_to_read) {
        ei_printf("Partial I2S read");
        }

        // 原样缓存 (不做增益), 窗口满后统一 AGC
        int n = (int)(bytes_read / 2);   // int16 样本数
        for (int x = 0; x < n; x++) {
            window_raw[inference.buf_count++] = sampleBuffer[x];
            if (inference.buf_count >= inference.n_samples) {
                inference.buf_count = 0;
                if (record_status) {
                    apply_agc();
                    inference.buf_ready = 1;
                }
                else {
                    break;
                }
            }
        }
    }
  }
  vTaskDelete(NULL);
}

/**
 * @brief      Init inferencing struct and setup/start PDM
 *
 * @param[in]  n_samples  The n samples
 *
 * @return     { description_of_the_return_value }
 */
static bool microphone_inference_start(uint32_t n_samples)
{
    inference.buffer = (int16_t *)malloc(n_samples * sizeof(int16_t));
    window_raw = (int16_t *)malloc(n_samples * sizeof(int16_t));

    if(inference.buffer == NULL || window_raw == NULL) {
        return false;
    }

    inference.buf_count  = 0;
    inference.n_samples  = n_samples;
    inference.buf_ready  = 0;

    if (i2s_init(EI_CLASSIFIER_FREQUENCY)) {
        ei_printf("Failed to start I2S!");
    }

    ei_sleep(100);

    record_status = true;

    xTaskCreate(capture_samples, "CaptureSamples", 1024 * 32, (void*)sample_buffer_size, 10, NULL);

    return true;
}

/**
 * @brief      Wait on new data
 *
 * @return     True when finished
 */
static bool microphone_inference_record(void)
{
    bool ret = true;

    while (inference.buf_ready == 0) {
        delay(10);
    }

    inference.buf_ready = 0;
    return ret;
}

/**
 * Get raw audio signal data
 */
static int microphone_audio_signal_get_data(size_t offset, size_t length, float *out_ptr)
{
    numpy::int16_to_float(&inference.buffer[offset], out_ptr, length);

    return 0;
}

/**
 * @brief      Stop PDM and release buffers
 */
static void microphone_inference_end(void)
{
    i2s_deinit();
    ei_free(inference.buffer);
    ei_free(window_raw);
    window_raw = nullptr;
}


static int i2s_init(uint32_t sampling_rate) {
  // Start listening for audio: MONO @ 8/16KHz
  i2s_config_t i2s_config = {
      .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_TX),
      .sample_rate = sampling_rate,
      .bits_per_sample = (i2s_bits_per_sample_t)16,
      .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
      .communication_format = I2S_COMM_FORMAT_I2S,
      .intr_alloc_flags = 0,
      .dma_buf_count = 8,
      .dma_buf_len = 512,
      .use_apll = false,
      .tx_desc_auto_clear = false,
      .fixed_mclk = -1,
  };
  i2s_pin_config_t pin_config = {
      .bck_io_num = 5,     // IIS_SCLK  (INMP441 SCK)
      .ws_io_num = 4,      // IIS_LCLK  (INMP441 WS)
      .data_out_num = -1,  // IIS_DSIN
      .data_in_num = 6,    // IIS_DOUT  (INMP441 SD)
  };
  esp_err_t ret = 0;

  ret = i2s_driver_install((i2s_port_t)1, &i2s_config, 0, NULL);
  if (ret != ESP_OK) {
    ei_printf("Error in i2s_driver_install");
  }

  ret = i2s_set_pin((i2s_port_t)1, &pin_config);
  if (ret != ESP_OK) {
    ei_printf("Error in i2s_set_pin");
  }

  ret = i2s_zero_dma_buffer((i2s_port_t)1);
  if (ret != ESP_OK) {
    ei_printf("Error in initializing dma buffer with 0");
  }

  return int(ret);
}

static int i2s_deinit(void) {
    i2s_driver_uninstall((i2s_port_t)1); //stop & destroy i2s driver
    return 0;
}

#if !defined(EI_CLASSIFIER_SENSOR) || EI_CLASSIFIER_SENSOR != EI_CLASSIFIER_SENSOR_MICROPHONE
#error "Invalid model for current sensor."
#endif
