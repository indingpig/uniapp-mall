/**
 * 音频采集管线 (唯一 I2S 采集链, 整合固件的核心)
 *
 * 职责:
 *   - I2S 采集任务 (Core 0): 16kHz/16bit/单声道 → 逐样本高通滤波
 *   - 高通滤波全固件仅此一份实现 (0.99 DC 阻断 + 两级 0.9607,
 *     与采集原型 audio_app / 推理原型 esp32_microphone 逐位一致)
 *   - 三个消费者共用同一份滤波后数据:
 *       1) RMS/Peak 电平 (server 上报 + 串口)
 *       2) 推理窗 (16000 样本 = 1s, 交 baby_infer 做 AGC + 分类)
 *       3) 采集推流环形缓冲 (交 collect_server 经 WS 推给 App)
 *
 * 线程模型:
 *   采集任务写, loop (Core 1) 读。RMS 用临界区保护;
 *   wsRing 用 head/tail 单生产单消费协议 (溢出置 lost);
 *   推理窗用状态机 0=填充中 1=待消费 2=消费中, 消费不及时整窗丢弃并计数。
 */
#pragma once

#include <Arduino.h>
#include <stdint.h>

/* 启动采集任务并安装 I2S 驱动 (整个生命周期只调用一次, 不卸载) */
void audioPipelineStart();

/* 最近一个采集块的电平 (约 64ms 更新一次), 线程安全 */
void audioPipelineLevel(uint32_t* rms, int32_t* peak);

/* 电平表环形缓冲的整体 RMS (更平滑, collect_server 的 /rms 用) */
uint32_t audioPipelineRingRms();

/* ------------------------------------------------------------------ */
/*  推理窗 (baby_infer 使用)                                            */
/* ------------------------------------------------------------------ */

/* 开关窗口填充: 监听关闭时不填窗 (避免白白丢窗计数) */
void audioPipelineSetListenEnabled(bool enabled);

/* 窗口是否已就绪待消费 */
bool audioPipelineWindowReady();

/* 取走就绪窗口的指针 (内部缓冲, 消费期间任务不会覆写)。
 * 取到返回 true 并把状态置为"消费中"; 消费完必须调用 audioPipelineReleaseWindow() */
bool audioPipelineTakeWindow(const int16_t** samples, uint32_t* count);

/* 消费完毕, 归还窗口 (任务可继续填充) */
void audioPipelineReleaseWindow();

/* 诊断: 因消费不及时被丢弃的窗口数 */
uint32_t audioPipelineDroppedWindows();

/* ------------------------------------------------------------------ */
/*  采集推流 (collect_server 使用)                                       */
/* ------------------------------------------------------------------ */

void audioPipelineCollectStart();

/* 停止采集 (保留 ring 中未推完的数据供 drain, samples/lost 计数保留) */
void audioPipelineCollectStop();

/* 复位状态 (新采集客户端接入时调用, 避免继承上次会话) */
void audioPipelineCollectReset();

/* 当前是否在采集 */
bool audioPipelineCollectActive();

/* 弹出一个完整块 (AUDIO_CHUNK_SAMPLES 样本) 到 out;
 * 不足一块返回 0。返回弹出的样本数。 */
size_t audioPipelinePopChunk(int16_t* out);

/* 本次采集累计样本数 / 是否发生过环形缓冲覆盖丢帧 */
uint32_t audioPipelineCollectSamples();
bool audioPipelineCollectLost();
