# uts-wavrec

宝宝监护器采集录制插件（Android 原生）：WebSocket 收板子采集音频，字节全程留在
Kotlin 层，逐 1s AGC 窗（与固件推理同粒度）流式写 WAV（RandomAccessFile 占位头 +
done 后回补 + 大小校验），JS 只拿进度与结果。

**为什么存在**：uni.connectSocket 的二进制消息过 Java→JNI→JS 引擎三重边界，
App 端消费 32KB/s 音频流跟不上，TCP 背压顶回板子造成丢样（2026-11-24 定位，
详见仓库 交接-内存重整与3x迁移.md §6）。

协议与固件 collect_server 一致：控制 `{"cmd":"start"/"stop"}` 文本帧，音频
2048B 二进制帧，回执 `{"cmd":"done","samples":N,"lost":bool}`。OkHttp 按帧
类型分发回调，文本/音频天然无歧义。

业务侧统一走 `src/utils/nativeWavRec.ts` 封装（APP-PLUS 条件编译）；
`src/utils/wavStream.ts`（JS 流式写盘）是其失败后的回退，再往下是内存累积路径。
