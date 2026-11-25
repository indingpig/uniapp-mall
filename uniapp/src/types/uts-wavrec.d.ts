/**
 * uts-wavrec UTS 插件的 TS 类型声明（供 vue-tsc/type-check 使用）。
 * 真值源是插件的 utssdk/app-android/index.uts 导出函数，两处必须保持一致。
 * 注意：文件顶层不能有 export（否则 declare module 退化成模块增强，
 * 对不存在的物理模块无效 → Cannot find module）。
 * 业务侧不要直接 import 本插件——统一走 src/utils/nativeWavRec.ts 封装
 * （插件仅限 APP-PLUS 条件编译内导入，封装层负责平台隔离）。
 */

declare module '@/uni_modules/uts-wavrec' {
  /** 连接状态（getState 返回值） */
  export const WAVREC_STATE_DISCONNECTED: number;
  export const WAVREC_STATE_CONNECTING: number;
  export const WAVREC_STATE_CONNECTED: number;

  /** 单轮录制结果（getResult 返回；null = 本轮尚未收尾） */
  export interface WavRecResult {
    /** true = 文件完整落盘并校验；false = 会话异常（文件可能不完整） */
    ok: boolean;
    /** 'done' | 'timeout' | 'disconnected' | 'closed' | 'rejected' | 'size-mismatch' | 'write-failed' | 错误信息 */
    reason: string;
    /** 实际落盘样本数 */
    samples: number;
    /** 板端 done JSON 的 lost 标志 */
    lost: boolean;
    /** 整条录音的原始 RMS（AGC 前） */
    rms: number;
    /** 落盘绝对路径；失败为空串 */
    path: string;
    /** 文件字节数；失败为 0 */
    bytes: number;
  }

  /** 建立与板子的 WS 连接（异步；结果轮询 getState）。重复调用会先关旧连接 */
  export function connectWS(url: string): void;
  /** 连接状态轮询: 0=未连接 1=连接中 2=已连接 */
  export function getState(): number;
  /** 开始一轮录制：建文件（占位头）+ 下发 start + 清空上一轮结果 */
  export function start(name: string): boolean;
  /** 结束录制：下发 stop（结果经 getResult 轮询获取）。false = 当前没在录制 */
  export function stop(): boolean;
  /** 本轮录制结果；null = 尚未收尾（done/8s 兜底/断连后必有值） */
  export function getResult(): WavRecResult | null;
  /** 当前已落盘样本数（页面计时器轮询用） */
  export function getProgress(): number;
  /** 关闭 WS 连接（录制中调用会先按已落盘数据收尾） */
  export function closeWs(): void;
}
