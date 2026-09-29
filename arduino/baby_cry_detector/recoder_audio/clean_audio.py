#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
clean_audio.py — 去除录音中的低频杂音 (DC 漂移 + 50Hz 工频 + 亚声频隆隆声)

与固件 HighPassState 完全一致: DC 阻断(~30Hz) + 两级 100Hz 高通。
用法:
  python3 clean_audio.py 输入.wav [输出.wav] [--target-rms 2500]

输出默认: 输入_clean.wav (滤波后重新 AGC 到目标 RMS, 便于试听)
"""
import sys, wave, struct, math

def highpass(samples):
    """与固件 hpProcess 相同系数"""
    x1 = y1 = x2 = y2 = x3 = y3 = 0.0
    out = []
    for x in samples:
        x = float(x)
        y = x - x1 + 0.99 * y1          # DC 阻断
        x1, y1 = x, y
        h1 = 0.9607 * (y2 + y - x2)     # 100Hz 高通 1
        x2, y2 = y, h1
        h2 = 0.9607 * (y3 + h1 - x3)    # 100Hz 高通 2
        x3, y3 = h1, h2
        v = max(-32768.0, min(32767.0, h2))
        out.append(int(v))
    return out

def agc(samples, target):
    rms = math.sqrt(sum(x * x for x in samples) / len(samples))
    g = (target / rms) if rms > 1 else 64.0
    g = max(0.25, min(64.0, g))
    return [max(-32768, min(32767, int(round(x * g)))) for x in samples], rms, g

def main():
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else src.rsplit('.', 1)[0] + '_clean.wav'
    target = 2500.0
    if '--target-rms' in sys.argv:
        target = float(sys.argv[sys.argv.index('--target-rms') + 1])

    w = wave.open(src, 'rb')
    nch, sw, fr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    raw = w.readframes(n); w.close()
    assert sw == 2 and fr == 16000, f"需 16kHz/16bit, 实际 {fr}Hz/{sw}bit"
    s = struct.unpack(f"<{len(raw)//2}h", raw)
    if nch == 2: s = s[0::2]

    hp = highpass(s)
    out, src_rms, g = agc(hp, target)

    with wave.open(dst, 'wb') as wo:
        wo.setnchannels(1); wo.setsampwidth(2); wo.setframerate(16000)
        wo.writeframes(struct.pack(f"<{len(out)}h", *out))

    rms_in = math.sqrt(sum(x * x for x in s) / len(s))
    rms_hp = math.sqrt(sum(x * x for x in hp) / len(hp))
    print(f"完成: {dst}")
    print(f"  输入 RMS={rms_in:.0f} → 滤波后 RMS={rms_hp:.0f} → AGC(×{g:.1f}) 输出 RMS={math.sqrt(sum(x*x for x in out)/len(out)):.0f}")

if __name__ == '__main__':
    main()
