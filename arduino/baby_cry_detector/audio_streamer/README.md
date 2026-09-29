# audio_streamer — 训练数据批量采集

用 ESP32 + INMP441 录制 Edge Impulse 训练数据（替代 iPhone 录音）。

## 为什么用设备录

模型目前的训练数据是 iPhone 12 mini 录的（RMS 435~2744，中频主导），而部署在
INMP441 上——两个麦克风的频响/噪声底不同，导致设备端识别置信度低、甚至误判。
**用目标设备（INMP441）录训练数据重训，才能让训练分布 = 推理分布。**

## 使用步骤

### 1. 烧录固件
Arduino IDE 打开 `audio_streamer.ino`（板型 ESP32S3 Dev Module），烧录。
上电后设备通过 USB 串口以 2M baud 持续输出 16kHz/16-bit 单声道音频。

### 2. 运行采集工具（PC 端）
```bash
pip install pyserial
python record_data.py --port COM3        # Windows 用你的端口号
# 不指定 --port 时自动查找 ESP32 串口
```

### 3. 按键采集
设备会实时打印电平条（RMS）。**听到目标声音后按对应键**，保存的是
「刚才最后 3 秒」（滚动缓冲，不需要提前按键）：

| 按键 | 类别 | 保存目录 |
|---|---|---|
| `c` | 宝宝哭声 | dataset/cry/ |
| `b` | 哼唧/咿呀/喃喃 | dataset/babble/ |
| `s` | 说话/电视声 | dataset/speech/ |
| `n` | 背景噪声 | dataset/background/ |
| `x` | 丢弃 | — |
| `q` | 退出 | — |

默认每个片段 AGC 归一化到 RMS=2500（与设备推理时固件 AGC 一致），
保证训练分布 = 设备实际喂给模型的数据。想存原始电平加 `--no-normalize`。

## 采集建议（每类 100+ 条，越多越好）

- **cry 哭声**：不同距离（0.3m/0.5m/1m/2m）、不同音量、哭闹/大哭/哼哼，白天晚上都录
- **babble 哼唧**：宝宝安静时咿呀/喃喃/笑
- **speech 说话**：妈妈/爸爸正常说话、电视声（不同节目）
- **background 背景**：安静房间、空调/风扇、吹风机、电视背景声、走路声——
  注意背景类别**不要**包含哭声和说话
- 每次 3 秒足够（模型窗口 1 秒）；环境多样性比数量更重要
- 电平表 RMS 建议保持 200~8000：太低离远点，太高（削波警告）离远点

## 上传 Edge Impulse

1. Studio → Data acquisition → 上传 `dataset/` 下各分类目录
   （cry/babble/speech/background 自动映射到类别标签）
2. 重新训练（可沿用当前 MFE 参数：32 滤波器、100–7000Hz、窗口 1s）
3. 重新导出 Arduino 库，替换 `libraries/babyCry_inferencing`
4. 重新烧录 `esp32_microphone.ino`（已含 AGC 修复）
