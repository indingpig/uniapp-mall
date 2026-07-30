"""
I2S Recorder - Python 接收端
从 ESP32 串口接收音频数据，保存为 WAV 文件

使用方法:
  1. 先确认 COM 口号（Arduino IDE → 工具 → 端口）
  2. 修改下面的 COM_PORT
  3. 烧录 i2s_recorder.ino 到 ESP32
  4. 运行: python recv_wav.py
  5. 在串口监视器里发送任意字符触发录音
  6. 等待完成，得到 output.wav
"""

import serial
import struct
import wave
import sys

# ========== 修改这里 ==========
COM_PORT = "COM3"       # 改成你的 COM 口号
BAUD_RATE = 2000000
OUTPUT_FILE = "output.wav"
SAMPLE_RATE = 16000
# =============================

def main():
    try:
        ser = serial.Serial(COM_PORT, BAUD_RATE, timeout=10)
        print(f"已连接到 {COM_PORT}")
    except Exception as e:
        print(f"无法打开串口 {COM_PORT}: {e}")
        print("请修改脚本中的 COM_PORT 为正确的端口号")
        sys.exit(1)

    print("等待 ESP32 启动...")
    # 跳过启动信息
    while True:
        line = ser.readline().decode("utf-8", errors="ignore").strip()
        print(f"  {line}")
        if "Send any character" in line:
            break

    input("按回车发送录音指令...")
    ser.write(b"r\n")
    ser.flush()

    # 等待录音完成
    while True:
        line = ser.readline().decode("utf-8", errors="ignore").strip()
        print(f"  {line}")
        if "DATA" in line:
            parts = line.split()
            sample_count = int(parts[1])
            break

    print(f"接收 {sample_count} 个样本...")

    # 接收二进制数据
    raw_bytes = b""
    expected_bytes = sample_count * 2  # int16 = 2 bytes
    while len(raw_bytes) < expected_bytes:
        chunk = ser.read(expected_bytes - len(raw_bytes))
        if not chunk:
            print("串口超时，数据不完整")
            break
        raw_bytes += chunk

    print(f"收到 {len(raw_bytes)} 字节")

    # 读取 END 确认
    end_line = ser.readline().decode("utf-8", errors="ignore").strip()
    print(f"  {end_line}")

    ser.close()

    # 写入 WAV 文件
    print(f"写入 {OUTPUT_FILE}...")
    with wave.open(OUTPUT_FILE, "wb") as wav:
        wav.setnchannels(1)           # 单声道
        wav.setsampwidth(2)           # 16-bit
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(raw_bytes)

    duration = len(raw_bytes) / (SAMPLE_RATE * 2)
    print(f"✅ 完成！文件: {OUTPUT_FILE}，时长: {duration:.1f} 秒")
    print(f"   可以用任意播放器打开试听")

if __name__ == "__main__":
    main()
