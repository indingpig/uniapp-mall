import { CACHE_KEY } from '@/constants/cache';
import { isValidServerUrl } from '@/utils/server';
import { storage } from '@/utils/storage';
import { joinURL } from '@/utils/tools';

/* ------------------------------------------------------------------ */
/*  家庭共享本机身份（无账号体系）：所有者=配对手机认领，成员=加入签发    */
/* ------------------------------------------------------------------ */

export interface FamilyOwnerInfo {
  token: string;
  name: string;
}

export interface FamilyMemberInfo {
  token: string;
  id: string;
  name: string;
  joinedAt: number;
}

export type FamilyRole = 'owner' | 'member' | 'none';

export function getFamilyOwner(): FamilyOwnerInfo | null {
  return storage.get<FamilyOwnerInfo>(CACHE_KEY.FAMILY_OWNER);
}

export function saveFamilyOwner(owner: FamilyOwnerInfo): void {
  storage.set(CACHE_KEY.FAMILY_OWNER, owner);
}

export function getFamilyMember(): FamilyMemberInfo | null {
  return storage.get<FamilyMemberInfo>(CACHE_KEY.FAMILY_MEMBER);
}

export function saveFamilyMember(member: FamilyMemberInfo): void {
  storage.set(CACHE_KEY.FAMILY_MEMBER, member);
}

/** 成员身份优先：既是 owner 又存有 member 记录时（罕见），按 member 收敛 */
export function getFamilyRole(): FamilyRole {
  if (getFamilyMember())
    return 'member';
  if (getFamilyOwner())
    return 'owner';
  return 'none';
}

/** 清空本机家庭身份（被移除/解散/退出共享时） */
export function clearFamilyIdentity(): void {
  storage.remove(CACHE_KEY.FAMILY_OWNER);
  storage.remove(CACHE_KEY.FAMILY_MEMBER);
}

/** 家庭 token 请求头（owner/member 通用，server 据此鉴权与判角色） */
export function familyTokenHeader(): Record<string, string> {
  const token = getFamilyMember()?.token || getFamilyOwner()?.token;
  return token ? { 'X-Family-Token': token } : {};
}

/** 本机生成所有者认领凭证（不依赖 crypto：App/小程序环境一致） */
export function genLocalToken(): string {
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += Math.floor(Math.random() * 16).toString(16);
  }
  return token;
}

/* ------------------------------------------------------------------ */
/*  加入二维码 / 邀请码 payload                                        */
/* ------------------------------------------------------------------ */

interface JoinQrPayload {
  app: 'babymonitor';
  kind: 'join' | 'invite';
  server: string;
  code: string;
  /** 邀请码附带被邀请人称呼，仅用于加入方确认弹框展示，server 以下发的为准 */
  name?: string;
}

export type ParsedJoinQr
  = | { kind: 'join' | 'invite'; server: string; code: string; name?: string }
  /** 旧版纯服务器地址二维码 */
    | { kind: 'legacy' }
    | { kind: 'invalid' };

/** 构建分享二维码内容（owner 端出码用） */
export function buildJoinQrPayload(options: { kind: 'join' | 'invite'; server: string; code: string; name?: string }): string {
  const payload: JoinQrPayload = {
    app: 'babymonitor',
    kind: options.kind,
    server: options.server,
    code: options.code,
  };
  if (options.name)
    payload.name = options.name;
  return JSON.stringify(payload);
}

/** 解析扫码结果：新 payload / 旧地址码 / 无效 */
export function parseJoinQr(text: string): ParsedJoinQr {
  const trimmed = text.trim();
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return { kind: 'legacy' };
  }
  try {
    const obj = JSON.parse(trimmed) as Partial<JoinQrPayload>;
    if (
      obj?.app === 'babymonitor'
      && (obj.kind === 'join' || obj.kind === 'invite')
      && typeof obj.server === 'string'
      && isValidServerUrl(obj.server)
      && typeof obj.code === 'string'
      && obj.code.length > 0
    ) {
      return { kind: obj.kind, server: obj.server, code: obj.code.toUpperCase(), name: obj.name };
    }
  }
  catch {
    // 非 JSON：按无效码处理
  }
  return { kind: 'invalid' };
}

/** ws(s) 服务器地址 → REST 同源 base（与 resolveApiBaseUrl 同规则，但针对任意扫码来的地址） */
export function toApiBase(wsUrl: string): string {
  return wsUrl.replace(/^ws(s)?:\/\//i, 'http$1://').replace(/\/ws\/?$/i, '');
}

/** 拼出指向目标 server 的绝对 API 地址（加入方尚未持有服务器地址，必须显式指向） */
export function familyApiUrl(wsUrl: string, path: string): string {
  return joinURL(toApiBase(wsUrl), path);
}

/* ------------------------------------------------------------------ */
/*  展示辅助                                                            */
/* ------------------------------------------------------------------ */

/** 相对加入时间（设计稿 19：「只读 · 2 天前加入」） */
export function formatJoinedAt(joinedAt: number): string {
  const diffDays = Math.floor((Date.now() - joinedAt) / 86_400_000);
  if (diffDays < 1)
    return '今天加入';
  if (diffDays === 1)
    return '1 天前加入';
  return `${diffDays} 天前加入`;
}

/** 头像字母：称呼首字符（设计稿 19 的圆形首字母头像） */
export function avatarInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() || '家';
}

/** 统一取可展示的错误文案（server 业务 message 优先，网络失败兜底） */
export function familyErrorMessage(err: unknown): string {
  const msg = (err as { message?: string; errMsg?: string })?.message;
  return msg || '网络异常，请稍后再试';
}
