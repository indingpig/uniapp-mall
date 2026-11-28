/* ================================================================== */
/*  统一鉴权（上公网硬前置）                                             */
/*                                                                     */
/*  三类身份分离，互不通用：                                             */
/*    家人 owner/member → familyStore 签发的个人 token（可单独吊销）      */
/*    板子 esp32        → 独立设备令牌（配网时 BLE 写入 NVS）            */
/*    匿名              → 仅 /api/health，其余一律拒绝                   */
/*                                                                     */
/*  密钥来源约定（AGENTS.md 强制）：                                     */
/*    - 设备令牌只从 env 读，**绝无写死的默认值**                        */
/*    - 未配置 env 时的行为是「拒绝该通道」，不是「放行」                  */
/*      —— 否则忘记配环境变量就等于开了后门                              */
/* ================================================================== */

/** 设备令牌（板子用）。未设置 → esp32 通道整体关闭，不退回放行 */
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';

/**
 * 鉴权强度开关：
 *   enforce（默认）→ 无有效凭据一律拒绝
 *   off            → 兼容旧客户端，只记日志放行（仅供固件未升级时过渡）
 * 默认必须是 enforce，安全默认值。
 */
const AUTH_MODE = process.env.AUTH_MODE === 'off' ? 'off' : 'enforce';

export { AUTH_MODE };
export const authMode = AUTH_MODE;

/** 设备令牌是否已配置（未配置时板子通道不可用，启动日志会明确提示） */
export const deviceTokenConfigured = DEVICE_TOKEN.length > 0;

/**
 * 校验设备令牌。用等长比较避免时序侧信道。
 * @returns {boolean}
 */
export function verifyDeviceToken(candidate) {
  if (!DEVICE_TOKEN) return false;
  if (typeof candidate !== 'string' || candidate.length !== DEVICE_TOKEN.length) {
    return false;
  }
  // 定长逐字节异或累积，不提前 return，避免按字符匹配长度泄露信息
  let diff = 0;
  for (let i = 0; i < DEVICE_TOKEN.length; i++) {
    diff |= candidate.charCodeAt(i) ^ DEVICE_TOKEN.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 从 WS 握手请求里取设备令牌。
 * 支持三种方式（按优先级），便于固件在不支持 header 时过渡：
 *   1. Authorization: Bearer <token>
 *   2. X-Api-Key: <token>
 *   3. query ?dtoken=<token>（最后手段：会留在访问日志里，仅过渡用）
 */
export function extractDeviceTokenFromRequest(req) {
  const authz = req.headers?.authorization;
  if (typeof authz === 'string' && authz.startsWith('Bearer ')) {
    return authz.slice(7).trim();
  }
  const apiKey = req.headers?.['x-api-key'];
  if (typeof apiKey === 'string') return apiKey.trim();
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('dtoken') || '';
  } catch {
    return '';
  }
}

/**
 * REST 鉴权中间件工厂。
 *
 * @param {object} familyStore 家庭身份注册表
 * @param {object} [opts]
 * @param {boolean} [opts.requireOwner] 仅 owner 可访问（设备控制类）
 * @param {boolean} [opts.allowDevice]  允许设备令牌访问（板子拉取配置等）
 */
export function requireFamilyToken(familyStore, opts = {}) {
  const { requireOwner = false, allowDevice = false } = opts;

  return function authMiddleware(req, res, next) {
    // off 模式：只告警放行，供固件未升级时过渡，重启即恢复严格
    if (AUTH_MODE === 'off') {
      console.warn(`[Auth] AUTH_MODE=off，放行 ${req.method} ${req.path}（不安全，仅过渡用）`);
      return next();
    }

    // 设备令牌通道（板子访问 REST 时用）
    if (allowDevice) {
      const bearer = extractDeviceTokenFromRequest({ headers: req.headers, url: req.url });
      if (verifyDeviceToken(bearer)) {
        req.auth = { role: 'device' };
        return next();
      }
    }

    // 家人令牌通道。FamilyError(401)/403 由错误中间件统一渲染；
    // 其它异常不再伪装成 401（那是把内部 bug 显示成「未登录」），转 500 并记日志
    const token = req.headers['x-family-token'];
    try {
      const result = familyStore.auth(token);
      if (requireOwner && result.role !== 'owner') {
        res.status(403).json({ code: 'FORBIDDEN', message: '仅所有者可执行该操作' });
        return;
      }
      req.auth = result;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** 启动时打印鉴权配置状态（不打印密钥本身） */
export function logAuthConfig() {
  console.log(`[Auth] 模式=${AUTH_MODE}`);
  if (!DEVICE_TOKEN) {
    console.warn('[Auth] ⚠️ 未配置 DEVICE_TOKEN：板子(esp32)通道关闭，设备将无法连接');
    console.warn('[Auth]    生成方式：openssl rand -hex 32 → 写入 server/.env 与板子 NVS');
  } else {
    console.log('[Auth] 设备令牌已配置（长度 ' + DEVICE_TOKEN.length + '）');
  }
  if (AUTH_MODE === 'off') {
    console.warn('[Auth] ⚠️ AUTH_MODE=off：所有鉴权被跳过，仅限固件升级过渡期使用！');
  }
}
