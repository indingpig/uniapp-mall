/**
 * 原生采集录制（uts-wavrec 插件）业务侧封装
 *
 * 分层同 keepalive.ts：native 实现在 uts-wavrec UTS 插件（Kotlin 层，改插件需
 * 重打自定义基座）；本文件负责平台隔离——仅 APP 端可用，H5/小程序端为
 * available=false 的空实现，采集页按 available 分流到 JS 流式/内存路径。
 * 条件编译只包函数体（不能包整个函数声明：vue-tsc 双分支视为重复声明）。
 *
 * 插件 API 全轮询、零回调参数（2026-11-24 云端编译两次 panic 实证顶层导出带
 * lambda 参数会崩 UTS overload 变换器），连接态/结果都由本层轮询转发。
 *
 * 为什么需要它：uni.connectSocket 二进制消息过 Java→JNI→JS 三重边界，消费
 * 32KB/s 音频流跟不上 → TCP 背压 → 板子丢样。原生插件让音频字节完全不进
 * JS 桥，JS 只轮询进度和结果。
 */

import type { WavRecResult } from '@/uni_modules/uts-wavrec';
// #ifdef APP-PLUS
import { closeWs, connectWS, getProgress, getResult, getState, start, stop } from '@/uni_modules/uts-wavrec';

export type { WavRecResult };
// #endif

/** 原生录制是否可用（仅 APP 端；H5/小程序恒 false 走 JS 回退路径） */
export const nativeWavRecAvailable: boolean = (() => {
  // #ifdef APP-PLUS
  return true;
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
})();

/** 发起原生 WS 连接（异步；结果轮询 nativeGetState） */
export function nativeConnectWS(url: string): void {
  // #ifdef APP-PLUS
  connectWS(url);
  // #endif
  // #ifndef APP-PLUS
  void url;
  // #endif
}

/** 连接是否就绪（可 start） */
export function nativeIsConnected(): boolean {
  // #ifdef APP-PLUS
  return getState() === 2;
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
}

/** 连接状态轮询: 0=未连接 1=连接中 2=已连接 */
export function nativeGetState(): number {
  // #ifdef APP-PLUS
  return getState();
  // #endif
  // #ifndef APP-PLUS
  return 0;
  // #endif
}

/** 开始一轮录制：建文件 + 下发 start。false = 未连接 / 已在录制中 */
export function nativeStart(name: string): boolean {
  // #ifdef APP-PLUS
  return start(name);
  // #endif
  // #ifndef APP-PLUS
  void name;
  return false;
  // #endif
}

/** 结束录制：下发 stop。false = 当前没在录制；结果轮询 nativeGetResult */
export function nativeStop(): boolean {
  // #ifdef APP-PLUS
  return stop();
  // #endif
  // #ifndef APP-PLUS
  return false;
  // #endif
}

/** 本轮录制结果；null = 尚未收尾（done/8s 兜底/断连后必有值） */
export function nativeGetResult(): WavRecResult | null {
  // #ifdef APP-PLUS
  return getResult();
  // #endif
  // #ifndef APP-PLUS
  return null;
  // #endif
}

/** 当前已落盘样本数（页面计时器轮询用） */
export function nativeProgress(): number {
  // #ifdef APP-PLUS
  return getProgress();
  // #endif
  // #ifndef APP-PLUS
  return 0;
  // #endif
}

/** 关闭 WS 连接（录制中调用会先按已落盘数据收尾） */
export function nativeClose(): void {
  // #ifdef APP-PLUS
  closeWs();
  // #endif
}
