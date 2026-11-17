"""I2S Recorder 自动连录接收端（诊断版 v3: 16bit 立体声+自动判声道 配套）

用法:
  python recv_auto.py                # 自动探测串口, 录 3 段
  python recv_auto.py COM5           # Windows 手动指定串口
  python recv_auto.py /dev/cu.usbmodem142101 5 myout   # 指定串口/段数/输出前缀

流程: 连接(打开后立即 dtr/rts=False, 防 DTR 拉低 GPIO0 误触发恢复出厂)
  → 等固件就绪 → 每段按回车触发(触发时对着麦克风说话/拍手) → 存 wav
判读: python check_wav.py myout_1.wav → 精确 0 值 <5% 为健康
"""

import serial
import wave
import sys
import time
from serial.tools import list_ports


def find_port():
    if len(sys.argv) > 1:
        return sys.argv[1]
    cands = [p.device for p in list_ports.comports()
             if 'usb' in p.device.lower() or 'modem' in p.device.lower()]
    if not cands:
        cands = [p.device for p in list_ports.comports()]
    return cands[0]


def main():
    port = find_port()
    segs = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    prefix = sys.argv[3] if len(sys.argv) > 3 else 'i2s_out'
    baud = 2000000

    ser = serial.Serial(port, baud, timeout=10)
    ser.dtr = False   # 必须: 默认 DTR=True 会拉低 GPIO0, 触发误恢复出厂
    ser.rts = False
    print(f'已连接 {port}，跳过启动信息...', flush=True)

    deadline = time.time() + 20
    ready = False
    while time.time() < deadline:
        line = ser.readline().decode('utf-8', 'ignore').strip()
        print(' ', line, flush=True)
        if 'Send any character' in line:
            ready = True
            break
    if not ready:
        print('未等到就绪行: 确认烧录的是 [env:i2s_recorder] 环境固件')
        sys.exit(1)
    print('就绪。', flush=True)

    for k in range(1, segs + 1):
        input(f'第 {k}/{segs} 段: 按回车开始录音(录音时对着麦克风说话/拍手)...')
        ser.write(b'r\n')
        ser.flush()

        count = None
        dl = time.time() + 15
        while time.time() < dl:
            line = ser.readline().decode('utf-8', 'ignore').strip()
            print(' ', line, flush=True)
            if 'DATA' in line:
                count = int(line.split()[1])
                break
        if count is None:
            print('未收到 DATA')
            sys.exit(1)

        raw = b''
        expect = count * 2  # int16 = 2 bytes
        while len(raw) < expect:
            chunk = ser.read(expect - len(raw))
            if not chunk:
                print('串口超时, 数据不完整')
                break
            raw += chunk
        ser.readline()  # END 行

        out = f'{prefix}_{k}.wav'
        with wave.open(out, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(raw)
        print(f'已保存 {out} ({count} 样本) — 判读: python check_wav.py {out}', flush=True)

    print('全部完成')


if __name__ == '__main__':
    main()
