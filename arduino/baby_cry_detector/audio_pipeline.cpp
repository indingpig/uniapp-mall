#include "audio_pipeline.h"

#include <Arduino.h>
#include <driver/i2s.h>
#include <math.h>

#include "config.h"

/* 推理窗大小见 config.h INFER_WINDOW_SAMPLES (= EI_CLASSIFIER_RAW_SAMPLE_COUNT)。
 * 注意: 本文件不能 include babyCry_inferencing.h —— EI 模型头文件只允许
 * baby_infer.cpp 一个编译单元包含, 否则链接期重复定义 */

/* ================================================================== */
/*  高通滤波 (去除 DC + 50Hz 工频 + 亚声频隆隆声)                        */
/*  与 audio_app.ino / esp32_microphone.ino 逐位一致的唯一实现           */
/* ================================================================== */

typedef struct {
  float x1, y1, x2, y2, x3, y3;
} HighPassState;

static float hpProcess(HighPassState* st, float x) {
  float y = x - st->x1 + 0.99f * st->y1;
  st->x1 = x;
  st->y1 = y;
  float h1 = 0.9607f * (st->y2 + y - st->x2);
  st->x2 = y;
  st->y2 = h1;
  float h2 = 0.9607f * (st->y3 + h1 - st->x3);
  st->x3 = h1;
  st->y3 = h2;
  return h2;
}

static int16_t hpProcessI16(HighPassState* st, int16_t x) {
  float v = hpProcess(st, (float)x);
  if (v > 32767.0f) v = 32767.0f;
  else if (v < -32768.0f) v = -32768.0f;
  return (int16_t)v;
}

/* ================================================================== */
/*  状态                                                                */
/* ================================================================== */

static const uint32_t WINDOW_SAMPLES = INFER_WINDOW_SAMPLES;

static int16_t rmsRing[RMS_RING_SAMPLES];          // 电平表环形缓冲
static volatile uint32_t rmsHead = 0;

static int16_t wsRing[WS_RING_SAMPLES];            // 采集推流环形缓冲
static volatile uint32_t wsRingHead = 0;           // 生产 (采集任务)
static volatile uint32_t wsRingTail = 0;           // 消费 (loop 推 WS)
static volatile bool wsCollecting = false;
static volatile uint32_t wsSamples = 0;
static volatile bool wsLost = false;

/* 推理窗状态机: 0=填充中 1=待消费 2=消费中 */
static int16_t windowRaw[INFER_WINDOW_SAMPLES];
static volatile uint8_t windowState = 0;
static volatile bool listenEnabled = false;
static volatile uint32_t windowFill = 0;
static volatile uint32_t droppedSamples = 0;

/* 最近一个采集块的电平 (临界区保护) */
static portMUX_TYPE levelMux = portMUX_INITIALIZER_UNLOCKED;
static volatile uint32_t chunkRms = 0;
static volatile int32_t chunkPeak = 0;

/* ================================================================== */
/*  采集任务 (Core 0)                                                   */
/* ================================================================== */

static void audioPipeTask(void* param) {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = AUDIO_SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 512,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };
  i2s_pin_config_t pins = {
    // mck_io_num 是结构体首字段, 省略会被零初始化为 0, 而 0 是合法引脚号 ——
    // i2s_set_pin 会把 GPIO0 (BOOT 键) 配成 I2S MCLK 输出, 按键读数恒为低,
    // 导致 bootButtonLoop 把它当成"一直按住", 松手后误开配网窗口。
    .mck_io_num = I2S_PIN_NO_CHANGE,
    .bck_io_num = AUDIO_PIN_SCK,
    .ws_io_num = AUDIO_PIN_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = AUDIO_PIN_SD
  };
  i2s_driver_install(AUDIO_I2S_PORT, &config, 0, nullptr);
  i2s_set_pin(AUDIO_I2S_PORT, &pins);
  i2s_zero_dma_buffer(AUDIO_I2S_PORT);

  Serial.println("[AudioPipe] task started on Core 0");

  static int16_t buf[AUDIO_CHUNK_SAMPLES];
  HighPassState hp = { 0, 0, 0, 0, 0, 0 };

  for (;;) {
    size_t bytesRead = 0;
    if (i2s_read(AUDIO_I2S_PORT, buf, sizeof(buf), &bytesRead, portMAX_DELAY) != ESP_OK ||
        bytesRead == 0) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    int n = bytesRead / 2;

    double squareSum = 0;
    int32_t peak = 0;
    for (int i = 0; i < n; i++) {
      int16_t sf = hpProcessI16(&hp, buf[i]);
      int32_t a = sf < 0 ? -sf : sf;
      if (a > peak) peak = a;
      squareSum += (double)sf * sf;

      rmsRing[rmsHead % RMS_RING_SAMPLES] = sf;
      rmsHead++;

      if (wsCollecting) {
        if (wsRingHead - wsRingTail >= WS_RING_SAMPLES) {
          wsLost = true;                 // 消费不及时, 覆盖最旧
          wsRingTail++;
        }
        wsRing[wsRingHead % WS_RING_SAMPLES] = sf;
        wsRingHead++;
        wsSamples++;
      }

      if (listenEnabled) {
        if (windowState == 0) {
          windowRaw[windowFill++] = sf;
          if (windowFill >= WINDOW_SAMPLES) {
            windowState = 1;             // 待消费 (任务在窗口被取走前不再写入)
            windowFill = 0;
          }
        } else {
          droppedSamples++;              // 待消费/消费中: 本样本无处可写, 丢弃
        }
      }
    }

    uint32_t rms = (uint32_t)sqrt(squareSum / n);
    portENTER_CRITICAL(&levelMux);
    chunkRms = rms;
    chunkPeak = peak;
    portEXIT_CRITICAL(&levelMux);
  }
}

/* ================================================================== */
/*  公开接口                                                            */
/* ================================================================== */

void audioPipelineStart() {
  memset((void*)rmsRing, 0, sizeof(rmsRing));
  memset((void*)wsRing, 0, sizeof(wsRing));
  memset((void*)windowRaw, 0, sizeof(windowRaw));
  // stack: 采集任务只做 I2S 读 + 滤波 + 环形写入, 无深层调用, 8KB 足够
  xTaskCreatePinnedToCore(audioPipeTask, "audioPipe", 8192, nullptr, 2, nullptr, 0);
}

void audioPipelineLevel(uint32_t* rms, int32_t* peak) {
  portENTER_CRITICAL(&levelMux);
  *rms = chunkRms;
  *peak = chunkPeak;
  portEXIT_CRITICAL(&levelMux);
}

uint32_t audioPipelineRingRms() {
  uint32_t n = (rmsHead < RMS_RING_SAMPLES) ? rmsHead : RMS_RING_SAMPLES;
  if (n == 0) return 0;
  double sum = 0;
  for (uint32_t i = 0; i < n; i++) {
    double v = rmsRing[(rmsHead - 1 - i) % RMS_RING_SAMPLES];
    sum += v * v;
  }
  return (uint32_t)sqrt(sum / n);
}

/* ---- 推理窗 ---- */

void audioPipelineSetListenEnabled(bool enabled) {
  if (!enabled) {
    // 关闭监听: 中断未填满的窗口, 丢弃待消费窗口
    windowFill = 0;
    windowState = 0;
  }
  listenEnabled = enabled;
}

bool audioPipelineWindowReady() {
  return windowState == 1;
}

bool audioPipelineTakeWindow(const int16_t** samples, uint32_t* count) {
  if (windowState != 1) return false;
  *samples = windowRaw;
  *count = WINDOW_SAMPLES;
  windowState = 2;
  return true;
}

void audioPipelineReleaseWindow() {
  windowState = 0;
}

uint32_t audioPipelineDroppedWindows() {
  // 样本级丢弃折算成窗口数 (诊断用)
  return droppedSamples / WINDOW_SAMPLES;
}

/* ---- 采集推流 ---- */

void audioPipelineCollectStart() {
  wsRingHead = 0;
  wsRingTail = 0;
  wsSamples = 0;
  wsLost = false;
  wsCollecting = true;
  Serial.println("[REC] start (WS stream)");
}

void audioPipelineCollectStop() {
  wsCollecting = false;   // 生产者停, ring 里的剩余数据仍可 pop 排干
}

void audioPipelineCollectReset() {
  wsCollecting = false;
  wsRingHead = 0;
  wsRingTail = 0;
  wsSamples = 0;
  wsLost = false;
}

bool audioPipelineCollectActive() {
  return wsCollecting;
}

size_t audioPipelinePopChunk(int16_t* out) {
  if (wsRingHead - wsRingTail < AUDIO_CHUNK_SAMPLES) return 0;
  for (int i = 0; i < AUDIO_CHUNK_SAMPLES; i++) {
    out[i] = wsRing[wsRingTail % WS_RING_SAMPLES];
    wsRingTail++;
  }
  return AUDIO_CHUNK_SAMPLES;
}

uint32_t audioPipelineCollectSamples() {
  return wsSamples;
}

bool audioPipelineCollectLost() {
  return wsLost;
}
