#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
record_data.py — 用 ESP32 + INMP441 批量采集 Edge Impulse 训练数据

配合 audio_streamer.ino 使用: 设备上电后持续通过串口(2M baud)流出
16kHz / 16-bit 单声道原始音频, 本工具维护一个滚动缓冲, 按键保存片段。

工作方式(专为宝宝哭声设计):
  宝宝哭的时候你不需要提前按任何键 —— 听到哭声后按下对应按键,
  工具会把「刚才最后 N 秒」的音频存成训练片段 (事后补救式保存)。

按键:
  c  = 保存最后一段 → dataset/cry/       (宝宝哭声)
  b  = 保存最后一段 → dataset/babble/    (哼唧/咿呀/喃喃)
  s  = 保存最后一段 → dataset/speech/    (妈妈说话/电视声)
  n  = 保存最后一段 → dataset/background/(安静房间/吹风机/电视背景)
  x  = 丢弃当前缓冲 (不保存)
  h  = 帮助
  q  = 退出

默认会把保存的片段 AGC 归一化到 RMS=2500 (与设备推理时的 AGC 一致,
训练分布 = 推理分布)。用 --no-normalize 保留原始电平。

依赖: pip install pyserial
用法: python record_data.py --port COM3
"""

import argparse
import os
import struct
import sys
import threading
import time
import wave
from collections import deque

try:
    import serial
except ImportError:
    print("缺少 pyserial, 请先安装: pip install pyserial")
    sys.exit(1)

CLASS_DIRS = {
    "c": ("cry", "宝宝哭声"),
    "b": ("babble", "哼唧/咿呀"),
    "s": ("speech", "说话/电视声"),
    "n": ("background", "背景噪声"),
}

# ---------------------------------------------------------------- 键盘输入
def _getch():
    if sys.platform == "win32":
        import msvcrt
        while True:
            ch = msvcrt.getwch()
            if ch in ("\x03",):  # Ctrl+C
                return "q"
            return ch.lower()
    else:
        import termios, tty, select
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setcbreak(fd)
            if select.select([sys.stdin], [], [], 0.2)[0]:
                ch = sys.stdin.read(1)
                return ch.lower()
            return None
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)


# ---------------------------------------------------------------- 音频处理
def agc_normalize(samples, target_rms, sr):
    """与固件 apply_agc() 相同的逻辑: gain=clamp(target/rms,0.25,64), int16 截断"""
    if not samples:
        return samples
    n = len(samples)
    mean = sum(x * x for x in samples) / n
    rms = mean ** 0.5
    g = (target_rms / rms) if rms > 1.0 else 64.0
    g = max(0.25, min(64.0, g))
    out = []
    for x in samples:
        v = x * g
        if v > 32767:
            v = 32767
        elif v < -32768:
            v = -32768
        out.append(int(v))
    return out, rms, g


def save_wav(path, samples, sr):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(struct.pack(f"<{len(samples)}h", *samples))


def clip_stats(samples):
    n = len(samples)
    rms = (sum(x * x for x in samples) / n) ** 0.5
    peak = max(abs(x) for x in samples)
    clip = sum(1 for x in samples if abs(x) > 32760)
    return rms, peak, 100.0 * clip / n


# ---------------------------------------------------------------- 主程序
def main():
    ap = argparse.ArgumentParser(description="ESP32 训练数据批量采集器")
    ap.add_argument("--port", help="串口, 如 COM3 (缺省自动查找)")
    ap.add_argument("--baud", type=int, default=2000000)
    ap.add_argument("--sr", type=int, default=16000, help="采样率 (固件固定 16000)")
    ap.add_argument("--clip", type=float, default=3.0, help="每个片段秒数")
    ap.add_argument("--buffer", type=float, default=8.0, help="滚动缓冲秒数")
    ap.add_argument("--outdir", default="dataset", help="输出根目录")
    ap.add_argument("--target-rms", type=float, default=2500.0,
                    help="AGC 目标 RMS (与固件 AGC_TARGET_RMS 一致)")
    ap.add_argument("--no-normalize", action="store_true",
                    help="不做 AGC 归一化, 保存原始电平")
    ap.add_argument("--min-rms", type=float, default=100.0,
                    help="保存时低于该 RMS 提示太安静")
    args = ap.parse_args()

    sr = args.sr
    clip_n = int(args.clip * sr)
    buf_n = int(args.buffer * sr)
    if buf_n < clip_n:
        buf_n = clip_n
        args.buffer = args.clip

    # ---------------- 打开串口
    port = args.port
    if not port:
        try:
            from serial.tools import list_ports
            for p in list_ports.comports():
                if any(k in (p.description + p.device).lower() for k in
                       ("esp32", "cp210", "ch340", "usb serial")):
                    port = p.device
                    break
        except Exception:
            pass
        if not port:
            print("未找到 ESP32 串口, 请用 --port 指定, 例如 --port COM3")
            sys.exit(1)
    print(f"连接 {port} @ {args.baud} baud ...")
    ser = serial.Serial(port, args.baud, timeout=0.05)

    # 等待固件就绪标记
    print("等待设备 STREAM_READY ...")
    ser.reset_input_buffer()
    deadline = time.time() + 15
    ready = False
    while time.time() < deadline:
        line = ser.readline()
        if b"STREAM_READY" in line:
            ready = True
            break
    if not ready:
        print("未收到 STREAM_READY。请确认: 已烧录 audio_streamer.ino / 端口正确")
        sys.exit(1)
    print("设备就绪, 开始采集 (按 h 查看帮助)")

    # ---------------- 滚动缓冲
    buf = deque(maxlen=buf_n)
    counters = {}
    lock = threading.Lock()
    stop = threading.Event()
    last_meter = time.time()

    def reader():
        raw = bytearray()
        while not stop.is_set():
            try:
                chunk = ser.read(4096)
            except Exception:
                break
            if not chunk:
                continue
            raw += chunk
            # 只保留完整的 int16 样本
            usable = len(raw) - (len(raw) % 2)
            if usable > 0:
                samples = struct.unpack(f"<{usable//2}h", bytes(raw[:usable]))
                with lock:
                    buf.extend(samples)
                del raw[:usable]
            if len(raw) > 8192:
                del raw[:len(raw) - (len(raw) % 2) - 8192]

    t = threading.Thread(target=reader, daemon=True)
    t.start()

    # ---------------- 主循环
    saved_total = 0
    try:
        while True:
            # 实时电平表 (每 0.5s)
            now = time.time()
            if now - last_meter >= 0.5:
                last_meter = now
                with lock:
                    recent = list(buf)[-sr:]
                if recent:
                    rms, peak, _ = clip_stats(recent)
                    bar = "|" * min(50, int(rms / 200))
                    print(f"\r  RMS={rms:6.0f} peak={peak:6d} {bar}    ", end="", flush=True)

            ch = _getch()
            if ch is None:
                continue
            if ch == "q":
                print("\n退出。")
                break
            if ch == "h":
                print("\n按键: c=哭声 b=哼唧 s=说话 n=背景 x=丢弃 q=退出")
                continue
            if ch not in CLASS_DIRS:
                continue
            dirname, label = CLASS_DIRS[ch]

            with lock:
                clip_samples = list(buf)[-clip_n:]
            if len(clip_samples) < clip_n:
                print(f"\n缓冲不足 (还需 {clip_n - len(clip_samples)} 样本), 稍后再按")
                continue

            rms, peak, clip_pct = clip_stats(clip_samples)
            if rms < args.min_rms:
                print(f"\n[警告] RMS={rms:.0f} 太低, 可能太安静/离麦克风太远, 仍已保存")
            if clip_pct > 1.0:
                print(f"\n[警告] 削波 {clip_pct:.1f}%, 声音过大, 离远一点 (仍已保存)")

            if not args.no_normalize:
                clip_samples, src_rms, g = agc_normalize(clip_samples, args.target_rms, sr)
                norm_txt = f"AGC {src_rms:.0f}->{args.target_rms:.0f} (x{g:.2f})"
            else:
                norm_txt = "raw"

            outdir = os.path.join(args.outdir, dirname)
            os.makedirs(outdir, exist_ok=True)
            counters[dirname] = counters.get(dirname, 0) + 1
            fname = f"{dirname}_{counters[dirname]:03d}.wav"
            fpath = os.path.join(outdir, fname)
            save_wav(fpath, clip_samples, sr)
            saved_total += 1
            print(f"\n✔ {label:6s} -> {fpath}  ({norm_txt}, RMS={rms:.0f})"
                  f"  [总数 {saved_total}]")

            # 每类 100 条后提醒
            if counters[dirname] in (50, 100, 150):
                print(f"  → {dirname} 已 {counters[dirname]} 条"
                      f"{'，可以停了' if counters[dirname] >= 100 else ''}")
    finally:
        stop.set()
        ser.close()
        print("\n已保存:")
        for d, n in counters.items():
            print(f"  {d}: {n} 条")


if __name__ == "__main__":
    main()
