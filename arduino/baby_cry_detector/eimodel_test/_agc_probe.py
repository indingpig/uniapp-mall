"""Reproduce the firmware AGC on silence-level input to show what the model actually receives.

Firmware logic (esp32_microphone.ino apply_agc):
    rms = sqrt(sum(x^2)/N)
    g   = (rms > 1.0) ? 2500/rms : 64.0
    g   = clamp(g, 0.25, 64)
    out = clamp(x * g, -32768, 32767)
"""
import math, random

TARGET, GMIN, GMAX = 2500.0, 0.25, 64.0

def agc(x, target=TARGET):
    n = len(x)
    rms = math.sqrt(sum(v * v for v in x) / n)
    g = target / rms if rms > 1.0 else GMAX
    g = max(GMIN, min(GMAX, g))
    return [max(-32768.0, min(32767.0, v * g)) for v in x], rms, g

def rms(x):
    return math.sqrt(sum(v * v for v in x) / len(x)) if x else 0.0

N = 16000  # 1 s @ 16 kHz
random.seed(1)

print(f"{'input':<34}{'src RMS':>10}{'gain':>8}{'out RMS':>10}")
print('-' * 62)

cases = {
    'digital silence (all zeros)':      [0.0] * N,
    'near-silence, 1 LSB noise':        [random.choice([-1.0, 0.0, 1.0]) for _ in range(N)],
    'mic noise floor RMS=8':            [random.gauss(0, 8) for _ in range(N)],
    'mic noise floor RMS=30':           [random.gauss(0, 30) for _ in range(N)],
    'mic noise floor RMS=150':          [random.gauss(0, 150) for _ in range(N)],
    'real cry (near.wav-like) RMS=581': [random.gauss(0, 581) for _ in range(N)],
    'loud cry RMS=3000':                [random.gauss(0, 3000) for _ in range(N)],
}
for name, x in cases.items():
    out, src, g = agc(x)
    print(f"{name:<34}{src:>10.1f}{g:>8.2f}{rms(out):>10.1f}")

print()
print("关键: 只要 src RMS > 1.0, AGC 就会把电平放大到 2500 —— 无论内容是噪音还是哭声。")
print("固件无 VAD/静音门限, 所以安静时噪声底也被归一化到与哭声相同的 RMS。")
