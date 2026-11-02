#include "baby_infer.h"

#include <babyCry_inferencing.h>
#include <math.h>

#include "audio_pipeline.h"
#include "config.h"

/* config.h 的窗口宏必须与当前模型一致 (EI 头文件只允许本文件包含) */
#if INFER_WINDOW_SAMPLES != EI_CLASSIFIER_RAW_SAMPLE_COUNT
#error "INFER_WINDOW_SAMPLES(config.h) 与模型 EI_CLASSIFIER_RAW_SAMPLE_COUNT 不一致, 请同步修改"
#endif

/* ================================================================== */
/*  AGC (自动增益控制)                                                  */
/*                                                                      */
/*  与 esp32_microphone.ino 的 apply_agc 参数一致 (config.h):            */
/*  每 1s 窗口按 AGC_TARGET_RMS/实际RMS 计算增益, 限幅 [0.25, 64],        */
/*  float 运算截断到 int16, 把设备输入电平拉回训练分布。                   */
/*  注意: HPF 已由 audio_pipeline 逐样本完成, 这里只做增益归一化。         */
/* ================================================================== */

static int16_t* s_inferBuffer = nullptr;   // AGC 后的窗口 (送分类器)
static bool s_running = false;
static bool s_debugNn = false;             // true 打印 DSP Features (刷屏, 排查用)

void inferPrintInfo() {
  ei_printf("Inferencing settings:\n");
  ei_printf("\tInterval: %d ms.\n", (int)EI_CLASSIFIER_INTERVAL_MS);
  ei_printf("\tFrame size: %d\n", EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE);
  ei_printf("\tSample length: %d ms.\n", EI_CLASSIFIER_RAW_SAMPLE_COUNT / 16);
  ei_printf("\tNo. of classes: %d\n",
            (int)(sizeof(ei_classifier_inferencing_categories) /
                  sizeof(ei_classifier_inferencing_categories[0])));
}

/* signal_t 取数回调: 把 AGC 后的 int16 窗口转 float 给 DSP */
static int inferSignalGetData(size_t offset, size_t length, float* out_ptr) {
  numpy::int16_to_float(&s_inferBuffer[offset], out_ptr, length);
  return 0;
}

bool inferStart() {
  if (s_running) return true;
  s_inferBuffer = (int16_t*)malloc(EI_CLASSIFIER_RAW_SAMPLE_COUNT * sizeof(int16_t));
  if (s_inferBuffer == nullptr) {
    Serial.printf("[Infer] ERR: malloc inference buffer failed (%u bytes), free=%u\n",
                  EI_CLASSIFIER_RAW_SAMPLE_COUNT * 2, ESP.getFreeHeap());
    return false;
  }
  audioPipelineSetListenEnabled(true);
  s_running = true;
  Serial.printf("[Infer] started (window=%u samples), free heap=%u\n",
                EI_CLASSIFIER_RAW_SAMPLE_COUNT, ESP.getFreeHeap());
  return true;
}

void inferStop() {
  if (!s_running) return;
  audioPipelineSetListenEnabled(false);
  s_running = false;
  if (s_inferBuffer != nullptr) {
    free(s_inferBuffer);
    s_inferBuffer = nullptr;
  }
  Serial.printf("[Infer] stopped, dropped windows=%u, free heap=%u\n",
                audioPipelineDroppedWindows(), ESP.getFreeHeap());
}

bool inferIsRunning() {
  return s_running;
}

bool inferPoll(InferResult* out) {
  if (!s_running || s_inferBuffer == nullptr) return false;

  const int16_t* window;
  uint32_t count;
  if (!audioPipelineTakeWindow(&window, &count)) return false;

  /* ---- AGC: RMS -> 增益(限幅) -> 归一化到推理缓冲 ---- */
  double sumSq = 0;
  for (uint32_t i = 0; i < count; i++) {
    double v = (double)window[i];
    sumSq += v * v;
  }
  double rms = sqrt(sumSq / (double)count);
  double g = (rms > 1.0) ? (double)AGC_TARGET_RMS / rms : (double)AGC_MAX_GAIN;
  if (g < AGC_MIN_GAIN) g = AGC_MIN_GAIN;
  if (g > AGC_MAX_GAIN) g = AGC_MAX_GAIN;

  for (uint32_t i = 0; i < count; i++) {
    double v = (double)window[i] * g;
    if (v > 32767.0) v = 32767.0;
    else if (v < -32768.0) v = -32768.0;
    s_inferBuffer[i] = (int16_t)v;
  }
  audioPipelineReleaseWindow();   // AGC 已消费完, 归还窗口 (分类期间任务继续填窗)

  /* ---- 分类 ---- */
  signal_t signal;
  signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
  signal.get_data = &inferSignalGetData;
  ei_impulse_result_t result = { 0 };
  EI_IMPULSE_ERROR err = run_classifier(&signal, &result, s_debugNn);
  if (err != EI_IMPULSE_OK) {
    Serial.printf("[Infer] ERR: run_classifier (%d)\n", err);
    return false;
  }

  /* ---- argmax ---- */
  size_t best = 0;
  for (size_t ix = 1; ix < EI_CLASSIFIER_LABEL_COUNT; ix++) {
    if (result.classification[ix].value > result.classification[best].value) {
      best = ix;
    }
  }

  if (out != nullptr) {
    memset(out, 0, sizeof(InferResult));
    strlcpy(out->label, result.classification[best].label, sizeof(out->label));
    out->score = result.classification[best].value;
    out->srcRms = (uint32_t)rms;
  }

  Serial.printf("[Infer] %s (%.1f%%) srcRms=%u dsp=%ums cls=%ums\n",
                result.classification[best].label,
                result.classification[best].value * 100.0f,
                (uint32_t)rms,
                result.timing.dsp, result.timing.classification);
  return true;
}
