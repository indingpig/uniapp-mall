/**
 * uts-keepalive UTS 插件的 TS 类型声明（供 vue-tsc/type-check 使用）。
 * 真值源是插件的 utssdk/app-android/index.uts 导出函数，两处必须保持一致。
 * 业务侧不要直接 import 本插件——统一走 src/utils/keepalive.ts 封装
 * （插件仅限 APP-PLUS 条件编译内导入，封装层负责平台隔离）。
 */

declare module '@/uni_modules/uts-keepalive' {
  /** 启动前台服务（幂等：已在运行时为无操作，但仍会刷新活跃标记） */
  export function start(): void;
  /** 停止前台服务并释放 WakeLock（同时关掉开机自启门控） */
  export function stop(): void;
  /**
   * JS 活性上报：WS 连接期间定期调用。停止上报超过 90s，常驻通知会自行
   * 改写为「监护已中断」——防「服务还在、通知还在、实际没监护」的幽灵态。
   */
  export function heartbeat(): void;
  /** 前台服务是否在运行（服务被系统强杀后此值不会自动回落） */
  export function isRunning(): boolean;
}
