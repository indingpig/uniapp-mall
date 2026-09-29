/**
 * audio.js — 音频处理纯逻辑（ES Module，Vue 3 / Vite 与 Node 测试共用）
 *
 * 命令式录音流程里, 手机端负责:
 *   - AGC 归一化 (目标 RMS 2500, gain 限幅 0.25~64, int16 截断) — 与设备推理固件一致
 *   - 16-bit 单声道 16kHz WAV 封装
 */

export const SR = 16000;

export function calcRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/* 与固件 apply_agc() 相同的归一化 */
export function agcNormalize(samples, target) {
  target = target || 2500;
  const rms = calcRms(samples);
  let g = rms > 1 ? target / rms : 64;
  g = Math.max(0.25, Math.min(64, g));
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i] * g;
    if (v > 32767) v = 32767;
    else if (v < -32768) v = -32768;
    out[i] = v;
  }
  return out;
}

export function buildWav(samples) {
  const n = samples.length,
    buf = new ArrayBuffer(44 + n * 2),
    dv = new DataView(buf);
  dv.setUint32(0, 0x52494646, false);            // "RIFF"
  dv.setUint32(4, 36 + n * 2, true);
  dv.setUint32(8, 0x57415645, false);            // "WAVE"
  dv.setUint32(12, 0x666d7420, false);           // "fmt "
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, SR, true);
  dv.setUint32(28, SR * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  dv.setUint32(36, 0x64617461, false);           // "data"
  dv.setUint32(40, n * 2, true);
  new Int16Array(buf, 44, n).set(samples);
  return buf;
}
