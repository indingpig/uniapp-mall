/**
 * WAV 流式录制（平台差异逻辑，与 saveWav.ts 同理由：条件编译指令不能进页面 .vue）
 *
 * 解决 2026-11-24 定位的采集卡顿根因：App 端把整条录音攒在 JS 内存
 * （7 分钟 ≈ 12.8MB PCM），保存时再 4 次全量拷贝 + 17MB base64 字符串拼接，
 * GC 压力随时长增长（170s→1.24s 卡顿, 417s→2.54s）。
 *
 * 流式方案：录音期间按 1s AGC 窗（与固件推理同粒度）逐窗归一化并追加写盘，
 * JS 内存恒定（两个 1s 窗缓冲）；收尾时回补 WAV 头（RandomAccessFile seek）。
 * H5 返回 null，页面自动回退旧的内存累积路径（浏览器无桥接问题，无需流式）。
 *
 * EMUI 约束（见 saveWav.ts 注释）：必须 plus.android 类名 importClass + new，
 * 对桥接返回实例 importClass 方法表不保证；byte[] 经 base64 字符串过桥。
 */

export interface WavStreamResult {
  path: string;
  bytes: number;
  samples: number;
  /** 整条录音的原始 RMS（与逐窗 AGC 前的 calcRms 同义） */
  rms: number;
}

export interface WavStreamSession {
  /** 喂原始样本（onMessage 直连；内部按 1s 窗缓冲并逐窗落盘） */
  append: (view: Int16Array) => void;
  /** 收尾：冲刷尾窗 + 回补 44B 头 + 关闭。null = 流中途失败（无有效文件） */
  finalize: () => Promise<WavStreamResult | null>;
  /** 放弃：关闭并删除半成品文件 */
  cancel: () => void;
}

/** 44 字节 WAV 头（16kHz/16bit/mono），dataLen 为 data 块字节数 */
export function wavHeaderBytes(dataLen: number): Uint8Array {
  const buf = new ArrayBuffer(44);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x52494646, false); // "RIFF"
  dv.setUint32(4, 36 + dataLen, true);
  dv.setUint32(8, 0x57415645, false); // "WAVE"
  dv.setUint32(12, 0x666D7420, false); // "fmt "
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, 16000, true);
  dv.setUint32(28, 32000, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  dv.setUint32(36, 0x64617461, false); // "data"
  dv.setUint32(40, dataLen, true);
  return new Uint8Array(buf);
}

function bytesToB64(u8: Uint8Array): string {
  let bin = '';
  const STEP = 8192;
  for (let i = 0; i < u8.length; i += STEP)
    bin += String.fromCharCode(...u8.subarray(i, i + STEP));
  return btoa(bin);
}

/**
 * 开一个流式 WAV 录制会话。null = 平台不支持（H5）或开流失败，
 * 调用方回退内存累积路径。
 */
export function startWavStream(name: string): Promise<WavStreamSession | null> {
  // #ifdef APP-PLUS
  return startWavStreamAndroid(name);
  // #endif
  // #ifndef APP-PLUS
  void name;
  return Promise.resolve(null);
  // #endif
}

// #ifdef APP-PLUS
interface AndroidBridge {
  runtimeMainActivity: () => { getPackageName: () => string };
  importClass: (o: unknown) => unknown;
}

interface Raf {
  write: (data: unknown) => void;
  seek: (pos: number) => void;
  close: () => void;
}

async function startWavStreamAndroid(name: string): Promise<WavStreamSession | null> {
  try {
    const androidBridge = plus.android as unknown as AndroidBridge;
    const main = androidBridge.runtimeMainActivity() as { getPackageName: () => string };
    const pkg = main.getPackageName();
    const JFileCls = androidBridge.importClass('java.io.File') as new (
      path: string,
    ) => { mkdirs: () => boolean; getAbsolutePath: () => string; length: () => number; delete: () => boolean };
    const dir = new JFileCls(`/storage/emulated/0/Android/data/${pkg}/files/BabyCry`);
    dir.mkdirs();
    const path = `${dir.getAbsolutePath()}/${name}`;

    // rwd: 写穿数据+元数据。开流即占位 44B 头, 数据顺序追加, finalize 时 seek(0) 回补
    const RAF = androidBridge.importClass('java.io.RandomAccessFile') as new (
      path: string,
      mode: string,
    ) => Raf;
    const raf = new RAF(path, 'rwd');
    raf.seek(0);
    raf.write(decodeB64(androidBridge, bytesToB64(wavHeaderBytes(0))));

    const windowBuf = new Int16Array(16000); // 原始 1s 窗（复用, 零逐条分配）
    const normBuf = new Int16Array(16000); // 归一化输出（复用）
    let winFill = 0;
    let winSumSq = 0;
    let totalSamples = 0;
    let totalSumSq = 0;
    let failed = false;

    function flushWindow(len: number): boolean {
      try {
        // 与 audioData.agcNormalize 同语义: rms>1 ? 2500/rms : 64, 限幅 [0.25, 64]
        const rms = len > 0 ? Math.sqrt(winSumSq / len) : 0;
        let g = rms > 1 ? 2500 / rms : 64;
        g = Math.max(0.25, Math.min(64, g));
        for (let i = 0; i < len; i++) {
          let v = windowBuf[i] * g;
          if (v > 32767)
            v = 32767;
          else if (v < -32768)
            v = -32768;
          normBuf[i] = v;
        }
        const u8 = new Uint8Array(normBuf.buffer, 0, len * 2);
        raf.write(decodeB64(androidBridge, bytesToB64(u8)));
        winFill = 0;
        winSumSq = 0;
        return true;
      }
      catch (e) {
        console.warn('[wavStream] 窗写入失败, 后续样本丢弃:', e);
        failed = true;
        winFill = 0;
        winSumSq = 0;
        return false;
      }
    }

    return {
      append(view: Int16Array): void {
        if (failed)
          return;
        let srcOff = 0;
        while (srcOff < view.length) {
          const n = Math.min(view.length - srcOff, 16000 - winFill);
          windowBuf.set(view.subarray(srcOff, srcOff + n), winFill);
          for (let i = srcOff; i < srcOff + n; i++) {
            const v = view[i];
            winSumSq += v * v;
            totalSumSq += v * v;
          }
          winFill += n;
          totalSamples += n;
          srcOff += n;
          if (winFill === 16000 && !flushWindow(16000))
            return;
        }
      },
      async finalize(): Promise<WavStreamResult | null> {
        try {
          if (failed)
            return null;
          if (winFill > 0 && !flushWindow(winFill))
            return null;
          raf.seek(0);
          raf.write(decodeB64(androidBridge, bytesToB64(wavHeaderBytes(totalSamples * 2))));
          raf.close();
          const jf = new JFileCls(path);
          const len = Number(jf.length());
          if (len !== 44 + totalSamples * 2) {
            console.warn('[wavStream] 落盘大小不符:', path, len, '期望', 44 + totalSamples * 2);
            return null;
          }
          return {
            path,
            bytes: len,
            samples: totalSamples,
            rms: totalSamples > 0 ? Math.sqrt(totalSumSq / totalSamples) : 0,
          };
        }
        catch (e) {
          console.warn('[wavStream] finalize 失败:', e);
          try {
            raf.close();
          }
          catch { /* 已关 */ }
          return null;
        }
      },
      cancel(): void {
        try {
          raf.close();
        }
        catch { /* 已关 */ }
        try {
          new JFileCls(path).delete();
        }
        catch { /* 尽力删 */ }
      },
    };
  }
  catch (e) {
    console.warn('[wavStream] 开流失败, 回退内存累积:', e);
    return Promise.resolve(null);
  }
}

function decodeB64(androidBridge: AndroidBridge, b64: string): unknown {
  const Base64 = androidBridge.importClass('android.util.Base64') as {
    decode: (str: string, flags: number) => unknown;
  };
  return Base64.decode(b64, 0); // Base64.DEFAULT
}
// #endif
