/**
 * audio.js 纯逻辑回归测试 (Node, ESM)
 * 运行: node test/test_audio.mjs
 */
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { SR, calcRms, agcNormalize, buildWav } from '../common/audio.js';

// 1) AGC: 安静输入 → 提升到 ~2500
const quiet = Int16Array.from({ length: 16000 }, () => (Math.random() * 600 - 300) | 0);
const q = agcNormalize(quiet);
const qrms = calcRms(q);
console.log(`quiet:  in_rms=${calcRms(quiet).toFixed(0)} out_rms=${qrms.toFixed(0)} (目标2500)`);
assert(qrms > 2000 && qrms < 3000, 'quiet AGC boost failed');

// 2) AGC: 大声输入 → 衰减 + 截断 (无回绕)
const loud = Int16Array.from({ length: 16000 }, () => (Math.random() * 60000 - 30000) | 0);
const l = agcNormalize(loud);
let maxv = 0;
for (const v of l) maxv = Math.max(maxv, Math.abs(v));
console.log(`loud:   in_rms=${calcRms(loud).toFixed(0)} out_rms=${calcRms(l).toFixed(0)} maxabs=${maxv}`);
assert(maxv <= 32767, 'clamp failed');

// 3) WAV 头
const wav = buildWav(q);
const dv = new DataView(wav);
assert(dv.getUint32(0, false) === 0x52494646, 'RIFF');
assert(dv.getUint32(8, false) === 0x57415645, 'WAVE');
assert(dv.getUint32(12, false) === 0x666d7420, 'fmt ');
assert(dv.getUint32(36, false) === 0x64617461, 'data');
assert(Buffer.from(wav).slice(0, 4).toString() === 'RIFF', 'RIFF bytes');
assert(dv.getUint16(20, true) === 1 && dv.getUint16(22, true) === 1, 'PCM mono');
assert(dv.getUint32(24, true) === 16000, 'SR');
assert(dv.getUint16(34, true) === 16, 'bits');
assert(dv.getUint32(40, true) === q.length * 2, 'data size');
console.log('WAV header OK (16kHz mono 16bit)');

// 4) 字节级校验: 用 Python wave 解析一次 (交叉验证)
const tmp = './test/uni_wav_check.wav';
fs.writeFileSync(tmp, Buffer.from(wav));
const out = execSync(`python3 -c "
import wave
w = wave.open('${tmp}','rb')
print(w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes())
"`).toString().trim();
console.log('python wave 解析:', out);
assert(out === '16000 1 2 16000', 'cross-platform wav mismatch');
fs.unlinkSync(tmp);

console.log('\nALL UNI-APP AUDIO TESTS PASSED');
