/**
 * Edge Impulse 推理封装 (搬自推理原型 esp32_microphone.ino, 整合进主固件)
 *
 * 与原型的差异 (其余参数逐位一致):
 *   - I2S 采集由 audio_pipeline 统一负责, 本模块只消费其推理窗
 *   - 高通滤波已在 audio_pipeline 逐样本做过, AGC 不再做内部 HPF (避免二次滤波)
 *   - 去掉 while(!Serial) 阻塞; run_classifier 在主循环 (Core 1) 非阻塞轮询
 *
 * 内存: inference.buffer 32KB 在 inferStart 时分配, inferStop 释放。
 * EIDSP_QUANTIZE_FILTERBANK=0 由 platformio.ini 的 build_flags 全局定义
 * (与原型一致用 float filterbank, 若 OOM 可去掉该 flag 省 10KB RAM)。
 */
#pragma once

#include <Arduino.h>
#include <stdint.h>

struct InferResult {
  char label[24];
  float score;        // argmax 概率 0~1
  uint32_t srcRms;    // AGC 前的窗口 RMS (反映实际环境响度)
};

/* 打印模型概要 (setup 调用, 不分配内存) */
void inferPrintInfo();

/* 开始监听: 分配推理缓冲并启动窗口填充; 失败 (OOM) 返回 false */
bool inferStart();

/* 停止监听并释放缓冲 */
void inferStop();

bool inferIsRunning();

/* 非阻塞轮询: 推理窗就绪时跑一次分类并填充 out, 返回 true; 无就绪窗口立即返回 false */
bool inferPoll(InferResult* out);
