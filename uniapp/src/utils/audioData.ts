/**
 * 音频处理纯逻辑 (移植自 arduino/baby_cry_detector/audio_app_uni/common/audio.js)
 *
 * 采集链路里手机端负责:
 *   - AGC 归一化 (目标 RMS 2500, 增益限幅 0.25~64, int16 截断) — 与固件 apply_agc 一致
 *   - 16-bit 单声道 16kHz WAV 封装
 *
 * 关键: agcWindowize 按 16000 样本 (=1s, 与模型 EI_CLASSIFIER_RAW_SAMPLE_COUNT
 * 一致) 分窗逐窗 AGC, 与设备端推理的每窗口增益粒度一致 —— 保证训练数据分布
 * = 推理输入分布。不要对整条录音做全局归一化 (粒度不一致会引入分布偏移)。
 */

export const SAMPLE_RATE = 16000;

/** 推理窗大小 = EI_CLASSIFIER_RAW_SAMPLE_COUNT (16000 = 1s) */
export const WINDOW_SAMPLES = 16000;

/** AGC 参数, 与固件 config.h 的 AGC_TARGET_RMS / AGC_MIN_GAIN / AGC_MAX_GAIN 一致 */
export const AGC_TARGET_RMS = 2500;
export const AGC_MIN_GAIN = 0.25;
export const AGC_MAX_GAIN = 64;

export function calcRms(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/** 与固件 apply_agc 相同的归一化 (单段) */
export function agcNormalize(samples: Int16Array, target: number = AGC_TARGET_RMS): Int16Array {
  const rms = calcRms(samples);
  let g = rms > 1 ? target / rms : AGC_MAX_GAIN;
  g = Math.max(AGC_MIN_GAIN, Math.min(AGC_MAX_GAIN, g));
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i] * g;
    if (v > 32767)
      v = 32767;
    else if (v < -32768)
      v = -32768;
    out[i] = v;
  }
  return out;
}

/**
 * 按 1s 窗口逐窗 AGC (与设备端推理同粒度), 返回归一化后的完整 PCM。
 * 不足一窗的尾部按实际样本数归一化 (整窗粒度从录音起点对齐)。
 */
export function agcWindowize(samples: Int16Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let off = 0; off < samples.length; off += WINDOW_SAMPLES) {
    const end = Math.min(off + WINDOW_SAMPLES, samples.length);
    const win = samples.subarray(off, end) as Int16Array;
    out.set(agcNormalize(win), off);
  }
  return out;
}

/** 16kHz / 16-bit / 单声道 WAV 封装 (44 字节头) */
export function buildWav(samples: Int16Array): ArrayBuffer {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x52494646, false); // "RIFF"
  dv.setUint32(4, 36 + n * 2, true);
  dv.setUint32(8, 0x57415645, false); // "WAVE"
  dv.setUint32(12, 0x666D7420, false); // "fmt "
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, SAMPLE_RATE, true);
  dv.setUint32(28, SAMPLE_RATE * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  dv.setUint32(36, 0x64617461, false); // "data"
  dv.setUint32(40, n * 2, true);
  new Int16Array(buf, 44, n).set(samples);
  return buf;
}
