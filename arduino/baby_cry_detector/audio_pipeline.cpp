#include "audio_pipeline.h"

#include <Arduino.h>
#include <ESP_I2S.h>
#include <math.h>

#include "config.h"
#include "esp_heap_caps.h"

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

/* 环形缓冲内存策略 (2026-11-19 复盘): 内部堆是配网 WiFi start、推理 32KB
 * 缓冲 + EI arena 的主战场, 大缓冲一律让路 ——
 *   - rmsRing (16KB): 电平表核心 UX, 常驻 (audioPipelineStart 分配)
 *   - wsRing (32KB, WS_RING_SAMPLES): 采集推流缓冲, audioPipelineStart 开机常驻预分配。
 *     曾按需分配 (CollectStart/CollectFree), 但已配网+连服态的暂停推理后
 *     自由堆贴着需求红线, 运行期碎片化下分配必失败 (2026-11-20 真机),
 *     改为开机定位分配 —— 代价是常态少 32KB, 换采集会话确定性可用 */
static int16_t* rmsRing = nullptr;                 // 电平表环形缓冲
static volatile uint32_t rmsHead = 0;

static int16_t* wsRing = nullptr;                  // 采集推流环形缓冲 (开机常驻, 见上)
static bool s_wsRingPreallocated = false;          // true=开机预分配, CollectFree 只复位不释放
static volatile uint32_t wsRingHead = 0;           // 生产 (采集任务)
static volatile uint32_t wsRingTail = 0;           // 消费 (loop 推 WS)
static volatile bool wsCollecting = false;
static volatile uint32_t wsSamples = 0;
static volatile bool wsLost = false;

/* 环形缓冲分配: PSRAM 优先, 失败回落内部堆 (行为兜底, 与 windowRaw 同策略) */
static int16_t* allocRingBuffer(size_t samples, const char* tag) {
  const size_t bytes = samples * sizeof(int16_t);
  int16_t* p = (int16_t*)heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM);
  if (p != nullptr) {
    Serial.printf("[AudioPipe] %s %u B @ PSRAM\n", tag, (unsigned)bytes);
    return p;
  }
  p = (int16_t*)heap_caps_malloc(bytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  if (p != nullptr) {
    Serial.printf("[AudioPipe] %s %u B @ INTERNAL (PSRAM 分配失败回落)\n", tag, (unsigned)bytes);
  }
  return p;
}

/* 推理窗状态机: 0=填充中 1=待消费 2=消费中
 *
 * windowRaw 放在 PSRAM（2026-11-16）：32KB 纯数据、不参与 DMA，
 * 每 1 秒才填满一次，对访问速度不敏感，是"让出内部 SRAM"的最佳候选。
 * PSRAM 不可用时自动回落到内部堆（行为与旧版一致，不会因此起不来）。 */
static int16_t* windowRaw = nullptr;
static bool windowRawInPsram = false;
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
  // arduino-esp32 3.x 新 I2S 驱动 (ESP_I2S.h, 旧 driver/i2s.h 已随 2.0.x 退役)。
  // INMP441 接线: L/R->GND = 左声道; setPins 第 5 参 mclk 显式给 -1 ——
  // 与旧版 mck_io_num 零初始化同坑: 0 是合法引脚, 会把 GPIO0(BOOT 键) 配成
  // MCLK 输出, 按键读数恒低 → 误判长按 (2026-11-14 前科)
  static I2SClass i2s;
  i2s.setPins(AUDIO_PIN_SCK, AUDIO_PIN_WS, -1 /*dout 不用*/, AUDIO_PIN_SD, -1 /*mclk*/);
  // slot_mask 必须显式给 LEFT (INMP441 L/R->GND=左声道): 3.x 迁移首版靠默认值
  // 启动, srcRms 恒 ~12.4K (读到非数据槽位), 显式 LEFT 后恢复真实音频 ——
  // 别省略第 5 参 (2026-11-20 真机教训)
  if (!i2s.begin(I2S_MODE_STD, AUDIO_SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT,
                 I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT)) {
    Serial.println("[AudioPipe] ERR: I2S begin 失败, 音频链未启动");
    vTaskDelete(nullptr);
    return;
  }

  Serial.println("[AudioPipe] task started on Core 0");

  static int16_t buf[AUDIO_CHUNK_SAMPLES];
  HighPassState hp = { 0, 0, 0, 0, 0, 0 };

  for (;;) {
    size_t bytesRead = i2s.readBytes((char*)buf, sizeof(buf));
    if (bytesRead == 0) {
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

      if (wsCollecting && wsRing != nullptr) {
        if (wsRingHead - wsRingTail >= WS_RING_SAMPLES) {
          wsLost = true;                 // 消费不及时, 覆盖最旧
          wsRingTail++;
        }
        wsRing[wsRingHead % WS_RING_SAMPLES] = sf;
        wsRingHead++;
        wsSamples++;
      }

      if (listenEnabled && windowRaw != nullptr) {
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
  // 常驻 rmsRing + wsRing; wsRing 曾按需分配, 但已配网+连服态暂停推理后
  // free≈64K 与旧 64K 需求只差 76B, 碎片下最大连续块仅 13K, 运行期分配必失败
  // (2026-11-20 真机采集会话被拒两连)。开机常驻定位分配 (现 32KB, 见 config.h),
  // 此后采集会话零分配、推理 churn 碎不掉它
  rmsRing = allocRingBuffer(RMS_RING_SAMPLES, "rmsRing");
  if (rmsRing == nullptr) {
    // PSRAM + 内部堆都拿不到 (理论上仅灾难场景): 不起采集任务, 保 BLE 配网可用
    Serial.println("[AudioPipe] ERR: 环形缓冲分配失败, 音频链未启动");
    return;
  }
  memset((void*)rmsRing, 0, (size_t)RMS_RING_SAMPLES * sizeof(int16_t));

  if (wsRing == nullptr) {
    wsRing = allocRingBuffer(WS_RING_SAMPLES, "wsRing");
    s_wsRingPreallocated = (wsRing != nullptr);
    if (wsRing != nullptr) {
      Serial.printf("[AudioPipe] wsRing 常驻预分配 %u B\n",
                    (unsigned)(WS_RING_SAMPLES * sizeof(int16_t)));
    } else {
      // 预分配失败不阻断音频链: CollectStart 仍有懒分配路径兜底
      Serial.println("[AudioPipe] ERR: wsRing 预分配失败, 采集将走运行期懒分配");
    }
  }

  /* 推理窗优先放 PSRAM；失败则退回内部堆，保证功能可用 */
  if (windowRaw == nullptr) {
    windowRaw = (int16_t*)heap_caps_malloc(
        INFER_WINDOW_SAMPLES * sizeof(int16_t), MALLOC_CAP_SPIRAM);
    windowRawInPsram = (windowRaw != nullptr);
    if (windowRaw == nullptr) {
      windowRaw = (int16_t*)heap_caps_malloc(
          INFER_WINDOW_SAMPLES * sizeof(int16_t), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
      Serial.println("[AudioPipe] windowRaw: PSRAM 分配失败, 回落到内部堆");
    }
    if (windowRaw == nullptr) {
      Serial.println("[AudioPipe] ERR: windowRaw 分配失败, 推理不可用");
    } else {
      Serial.printf("[AudioPipe] windowRaw %u B @ %s\n",
                    (unsigned)(INFER_WINDOW_SAMPLES * sizeof(int16_t)),
                    windowRawInPsram ? "PSRAM" : "INTERNAL");
    }
  }
  if (windowRaw != nullptr) {
    memset(windowRaw, 0, INFER_WINDOW_SAMPLES * sizeof(int16_t));
  }
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
  if (windowState != 1 || windowRaw == nullptr) return false;
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

bool audioPipelineCollectStart() {
  if (wsCollecting) return true;
  // 懒分配兜底 (常态已开机预分配, 走不到这里)。失败则拒绝会话 —— 比静默丢样本好
  if (wsRing == nullptr) {
    wsRing = allocRingBuffer(WS_RING_SAMPLES, "wsRing");
    if (wsRing == nullptr) {
      Serial.println("[AudioPipe] ERR: wsRing 分配失败 (内部堆不足), 采集会话拒绝");
      return false;
    }
  }
  wsRingHead = 0;
  wsRingTail = 0;
  wsSamples = 0;
  wsLost = false;
  wsCollecting = true;
  Serial.println("[REC] start (WS stream)");
  return true;
}

void audioPipelineCollectStop() {
  wsCollecting = false;   // 生产者停, ring 里的剩余数据仍可 pop 排干
}

/**
 * 释放 wsRing 还给堆 (常驻预分配模式下只复位不释放, 见实现)。
 * 必须在 stop + 排干之后调用; 内部等 120ms 再释放 —— 生产任务以 64ms 为周期
 * (1024 样本 @16kHz) 轮询 wsCollecting, 延迟能兜住「flag 已读、写入在途」
 * 的最后一块, 避免释放后写入 (use-after-free)。
 */
void audioPipelineCollectFree() {
  wsCollecting = false;
  if (wsRing == nullptr) return;
  // 等 120ms: 生产任务以 64ms 为周期轮询 wsCollecting, 兜住「flag 已读、写入在途」
  // 的最后一块。常驻预分配模式下只复位不释放 (运行期释放/重分配正是碎片化来源)
  vTaskDelay(pdMS_TO_TICKS(120));
  if (!s_wsRingPreallocated) {
    heap_caps_free(wsRing);
    wsRing = nullptr;
    Serial.println("[AudioPipe] wsRing 已释放 (内存还给推理)");
  } else {
    Serial.println("[AudioPipe] wsRing 复位 (常驻模式不释放)");
  }
}

void audioPipelineCollectReset() {
  audioPipelineCollectFree();
  wsRingHead = 0;
  wsRingTail = 0;
  wsSamples = 0;
  wsLost = false;
}

bool audioPipelineCollectActive() {
  return wsCollecting;
}

size_t audioPipelinePopChunk(int16_t* out) {
  if (wsRing == nullptr || wsRingHead - wsRingTail < AUDIO_CHUNK_SAMPLES) return 0;
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
