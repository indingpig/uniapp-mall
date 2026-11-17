"""WAV 零值占比检查（I2S 麦克风排障判读工具）

用法: python check_wav.py <文件.wav>

判读标准（INMP441 16bit 数据流）:
  精确 0 值占比 < 5%   -> 健康
  > 50%               -> I2S 槽位错乱 / SD 数据线悬空未接模块（2026-11-17 排障实证）
同时给出 0.25s 电平包络: 人声/拍手应呈现明显起伏, 恒定一条线 = 非真实声学采集
"""

import wave
import array
import sys
import math

if len(sys.argv) < 2:
    print(__doc__)
    sys.exit(1)

w = wave.open(sys.argv[1], 'rb')
n, sr = w.getnframes(), w.getframerate()
data = array.array('h', w.readframes(n)).tolist()

zeros = sum(1 for x in data if x == 0)
ratio = zeros / n * 100 if n else 0


def rms(seg):
    return int(math.sqrt(sum(x * x for x in seg) / len(seg))) if seg else 0


peak = max(abs(x) for x in data) if data else 0
verdict = '[OK] 健康' if ratio < 5 else '[异常] 槽位错乱/数据线悬空'
print(f'时长 {n / sr:.2f}s @ {sr}Hz, 样本 {n}')
print(f'精确 0 值: {zeros} ({ratio:.1f}%)  {verdict}')
print(f'整体RMS={rms(data)}, 峰值={peak} ({peak / 327:.0f}%FS)')
env = [rms(data[i:i + sr // 4]) for i in range(0, len(data) - sr // 4, sr // 4)]
for i, v in enumerate(env):
    print(f'{i * 0.25:4.2f}s {v:7d} ' + '#' * min(50, v // 200))
