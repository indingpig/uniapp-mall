/* ================================================================== */
/*  统一错误与响应契约（方案-接口状态码与业务码设计.md §1.5）             */
/*                                                                     */
/*  两层语义分工：                                                      */
/*    HTTP 状态码 = 类别（成功/没身份/没权限/参数错/冲突/服务器故障）      */
/*    code        = 具体原因（业务码，客户端据此做不同动作）               */
/*    message     = 直接展示给用户的中文文案                              */
/*                                                                     */
/*  不变量：2xx 当且仅当 code === 0；错误响应体永远是 JSON。              */
/*  路由层只允许两种写法：ok(res, data) 与 throw new ApiError(...)，      */
/*  不再手写 res.status(...).json({ code: 1, ... })。                    */
/* ================================================================== */

/** 状态码 → 业务码默认映射；跨状态码的原因（如加入码过期）需显式指定 */
export const DEFAULT_CODE_BY_STATUS = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
};

/** 业务错误：错误中间件按 status/code/message 渲染成 JSON */
export class ApiError extends Error {
  /**
   * @param {number} status HTTP 状态码
   * @param {string} message 用户可读的中文文案
   * @param {string} [code] 业务码；缺省时按状态码取默认映射
   */
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || DEFAULT_CODE_BY_STATUS[status] || 'INTERNAL';
  }
}

/** 成功响应（唯一出口，保证 2xx 必带 code:0 信封） */
export const ok = (res, data) => res.json({ code: 0, data });
