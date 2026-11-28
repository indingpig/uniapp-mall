/**
 * 业务码：0 = 成功；字符串 = 失败原因（契约见《方案-接口状态码与业务码设计.md》§1.4）。
 * 客户端按「要做的事」分支：UNAUTHORIZED → 清身份引导重新认领；其余展示 message。
 * DEVICE_OFFLINE 仅出现在 WS 错误帧（type:'error' 的 code 字段），不在 HTTP 响应里
 */
export type ApiErrorCode = 'BAD_REQUEST'
  | 'JOIN_CODE_EXPIRED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL'
  | 'DEVICE_OFFLINE'
  /**
   * 预留（2026-11-28 登录/注册契约，规范 5.6）：手机号或密码不正确。刻意不走 401/UNAUTHORIZED——
   * 全局 401 收敛会清家庭身份并 reLaunch 首页，登录表单需要的是字段级报错而非被踢回
   */
  | 'AUTH_FAILED'
  /** 预留（同上）：手机号已注册（注册页字段级错误，建议 HTTP 409） */
  | 'PHONE_REGISTERED';

/** 通用业务响应结构。不变量：2xx 当且仅当 code === 0（请求层已强制） */
export interface ApiResponse<T = unknown> {
  code: 0 | ApiErrorCode;
  message: string;
  data: T;
}

/** 业务错误 */
export interface ResponseError {
  code: ApiErrorCode;
  message: string;
  data?: unknown;
}
