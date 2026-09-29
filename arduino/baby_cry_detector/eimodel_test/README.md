# ei_model_test — 模型/固件输入链路诊断测试台

在 PC 上直接运行 Edge Impulse 导出的 `babyCry` 模型（EON TFLite），用合成音频和
设备录制的 WAV 复现、验证固件输入链路的问题。

## 背景结论（2026-08 排查）

设备"全判 speach"**不是设备坏了，也不是推理代码坏了**，而是**训练/部署分布不匹配**：

**训练数据用 iPhone 12 mini 录制**（`E:\OneDrive\babyCry`，m4a→wav，RMS 435~2744、中位数~1354、
频谱中频 1-4kHz 主导）。EI 页面测试用的是同一批 iPhone 音频 → 模型识别正常。

**设备端**：INMP441 采集的原始音频 RMS 与 iPhone 相近（near.wav RMS 581 → 模型能认出 babycry
79.5%），但固件里固定 `×8` int16 增益把音频推到 RMS 4650~16000+，**远超训练上限 2744** →
模型把一切判成 speach。主机实测：输入 RMS > ~12000 后模型一律输出 speach 100%。

次要因素：INMP441 频谱比 iPhone 录音更多高频能量（>4kHz 占 26% vs 10-15%），模型置信度略降；
3kHz 纯音/吹气在任何电平判 speach（speech 类外扩）、白噪声判 babycry（会误报）——需重训解决。

## 修复

`esp32_microphone.ino` 用**窗口级 AGC** 替换固定 ×8 回绕增益：

```
采集 1s 窗口原始样本 → 算 RMS → gain = clamp(2500/RMS, 0.25, 64) → float 运算 → int16 截断
```

目标 RMS 2500 取训练数据区间（435~2744）中值附近。主机验证：near.wav 在输入 RMS 29~2325
全范围 → babycry 100%；iPhone 训练哭声 → babycry 0.97~1.00（与页面一致）。

## 使用方法

```bash
make            # 编译（需要 g++，SDK 路径在 Makefile 里）
./ei_test <wav...>    # 喂设备录制的 WAV，跑 raw / x8-wrap / x8-clamp / 增益扫描 / AGC 对比
```

用例内建：静音、1k/3k 纯音、白噪声、合成哭声、设备链路仿真（×8 回绕）、AGC 仿真。

## 设备侧验证协议（烧录修复后固件）

1. 播放 near.wav / tone1k.wav（手机或电脑扬声器，距麦克风 0.5m/1m/2m 各试一次）
2. 串口看 `>> AGC: src_rms=... gain=... out_rms=...` —— out_rms 应始终 ≈2500
3. 对比识别结果：near.wav 应稳定判 babycry，tone1k 应稳定 babble/babycry 混合
4. 真宝宝哭时：任何距离/音量都应在 babycry 0.5+ 以上
5. 若仍全判 speach → 用 debug_nn=true 抓特征，与主机特征对比定位差异

## 遗留（需在 Edge Impulse Studio 重训，与设备对齐）

当前模型学的完全是 iPhone 12 mini 的声学分布，即使 AGC 修复电平，
麦克风频响差异（INMP441 高频更多）仍会拉低置信度。彻底解决：

- 用本设备录音：`i2s_recorder.ino`（增益1、16kHz、3s）+ `recv_wav.py`，每类 100+ 条
  - babycry：真实哭声（含不同距离/音量）
  - babble：哼唧/咿呀（对应 iPhone 的 babyhenghengjiji）
  - speach：妈妈说话/电视声
  - background：吹风机/安静房间/电视（对应 background）
- 上传 EI Studio 重训（可沿用当前 MFE 配置），重新导出替换 `libraries/babyCry_inferencing`
- 已知模型边界问题（3kHz→speech、白噪声→babycry）重训后一并缓解
