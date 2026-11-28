import type { ApiResponse } from './type';
import http from '@/utils/request';

/* ------------------------------------------------------------------ */
/*  登录 / 注册 API（规范 v1.1.28 §5.6，2026-11-28 前端先行）            */
/*                                                                     */
/*  服务端 /api/auth/* 尚未实现，此处为前端先行契约：                     */
/*    POST /api/auth/register { name, phone, password }                 */
/*    POST /api/auth/login    { phone, password }                       */
/*    成功：{ code:0, data:{ token, name } }，token 为账号体系访问凭证    */
/*    失败：HTTP 4xx + 业务码（见 api/type.ts 预留的 AUTH_FAILED /        */
/*    PHONE_REGISTERED），客户端据此映射字段级错误；其余一律表单级展示     */
/* ------------------------------------------------------------------ */

export interface AuthSuccessData {
  /** 账号访问凭证（后续请求携带方式由服务端实现时一并定稿） */
  token: string;
  /** 用户称呼（注册页填写 / 登录页回显用） */
  name: string;
}

/** 归一后的鉴权错误：code 可据此映射字段级错误，message 为用户可读文案 */
export interface AuthError {
  code?: string;
  message: string;
}

/**
 * 请求层对 HTTP 4xx/5xx 会把错误体挂在 err.data（见 createRequest.ts），
 * 这里把各种抛错形态归一成 { code, message }，页面不再各自摸错误结构。
 * message 为空或裸「HTTP 5xx」（未配对 server 时 dev 兜底/网关裸响应）则返回空串，
 * 由页面落到「网络异常」兜底文案，不把状态码直接怼给用户
 */
export function authErrorOf(err: unknown): AuthError {
  const data = (err as { data?: { code?: string; message?: string } } | undefined)?.data;
  const raw = (err instanceof Error ? err.message : '') || data?.message || '';
  const message = /^HTTP \d{3}$/.test(raw) ? '' : raw;
  return { code: data?.code, message };
}

function unwrap<T>(p: Promise<ApiResponse<T>>): Promise<T> {
  return p.then(res => res.data);
}

/** 注册并登录（server 未实现前实际提交会 404，表单级红条会兜住展示） */
export function registerAccount(name: string, phone: string, password: string): Promise<AuthSuccessData> {
  return unwrap(http.post<AuthSuccessData>('/api/auth/register', { name, phone, password }));
}

/** 手机号 + 密码登录 */
export function loginByPassword(phone: string, password: string): Promise<AuthSuccessData> {
  return unwrap(http.post<AuthSuccessData>('/api/auth/login', { phone, password }));
}
