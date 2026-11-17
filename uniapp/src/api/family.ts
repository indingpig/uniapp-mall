import type { ApiResponse } from './type';
import { familyApiUrl, familyTokenHeader } from '@/utils/family';
import http from '@/utils/request';

/* ------------------------------------------------------------------ */
/*  家庭共享 API（server/src/routes/family.js）                         */
/*  错误约定：server 非 0 code / HTTP 4xx → 抛 Error(中文文案)           */
/* ------------------------------------------------------------------ */

export interface FamilyMemberData {
  id: string;
  name: string;
  joinedAt: number;
}

export interface FamilyInviteData {
  id: string;
  code: string;
  name: string;
  expiresAt: number;
}

export interface FamilyOverviewData {
  role: 'owner' | 'member';
  ownerName: string;
  members: FamilyMemberData[];
  quota: { used: number; max: number };
  /** 仅 owner 视角返回 */
  invites?: FamilyInviteData[];
  /** 仅 member 视角返回 */
  self?: FamilyMemberData;
}

export interface JoinCodeData {
  code: string;
  expiresAt: number;
}

export interface JoinResultData {
  token: string;
  member: FamilyMemberData;
}

/** 统一业务码检查：server 用 `{ code:0 }` 表示成功，非 0 的 message 即用户可读文案 */
function unwrap<T>(p: Promise<ApiResponse<T>>): Promise<T> {
  return p.then((res) => {
    if (res.code !== 0) {
      throw new Error(res.message || '请求失败');
    }
    return res.data;
  });
}

/** 所有者认领（首次进入分享页；token 为本机生成凭证，先到先得） */
export function claimFamily(token: string, name: string): Promise<{ role: 'owner'; ownerName: string }> {
  return unwrap(http.request({
    url: '/api/family/claim',
    method: 'POST',
    headers: familyTokenHeader(),
    data: { token, name },
  }));
}

/** 成员总览（owner 含 invites；member 含 self） */
export function fetchFamilyOverview(): Promise<FamilyOverviewData> {
  return unwrap(http.request({
    url: '/api/family/overview',
    headers: familyTokenHeader(),
  }));
}

/** 生成/取当前扫码加入码（5 分钟内复用同一码） */
export function fetchJoinCode(): Promise<JoinCodeData> {
  return unwrap(http.request({
    url: '/api/family/join-code',
    method: 'POST',
    headers: familyTokenHeader(),
  }));
}

/** 免确认扫码加入：指向扫码得到的目标 server（加入方本地尚未配置服务器地址） */
export function joinFamily(server: string, code: string, name: string): Promise<JoinResultData> {
  return unwrap(http.request({
    url: familyApiUrl(server, '/api/family/join'),
    method: 'POST',
    data: { code, name },
  }));
}

/** 接受邀请（码即鉴权，同样指向目标 server） */
export function acceptFamilyInvite(server: string, code: string): Promise<JoinResultData> {
  return unwrap(http.request({
    url: familyApiUrl(server, `/api/family/invites/${code}/accept`),
    method: 'POST',
  }));
}

/** 所有者发起邀请（需对方确认，24 小时有效） */
export function createFamilyInvite(name: string): Promise<FamilyInviteData> {
  return unwrap(http.request({
    url: '/api/family/invites',
    method: 'POST',
    headers: familyTokenHeader(),
    data: { name },
  }));
}

/** 撤销待确认邀请 */
export function revokeFamilyInvite(id: string): Promise<null> {
  return unwrap(http.request({
    url: `/api/family/invites/${id}`,
    method: 'DELETE',
    headers: familyTokenHeader(),
  }));
}

/** 移除成员（owner 移除任意成员；member 传自己的 id = 退出共享） */
export function removeFamilyMember(id: string): Promise<null> {
  return unwrap(http.request({
    url: `/api/family/members/${id}`,
    method: 'DELETE',
    headers: familyTokenHeader(),
  }));
}

/** 解散家庭共享（owner，解除配对联动 E-14） */
export function dissolveFamily(): Promise<null> {
  return unwrap(http.request({
    url: '/api/family',
    method: 'DELETE',
    headers: familyTokenHeader(),
  }));
}
