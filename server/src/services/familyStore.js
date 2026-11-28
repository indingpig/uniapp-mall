import { randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './errors.js';

// ===== 有效期与上限（env 覆盖仅用于联调时缩短等待）=====
/** 扫码加入码有效期，设计稿 19：「二维码 5 分钟内有效」 */
const JOIN_CODE_TTL_MS = Number(process.env.FAMILY_JOIN_CODE_TTL_MS) || 5 * 60_000;
/** 所有者邀请有效期（规格未定义，取 24 小时） */
const INVITE_TTL_MS = Number(process.env.FAMILY_INVITE_TTL_MS) || 24 * 60 * 60_000;
/** 成员上限不含所有者（设计定义补全 P-02 / Q-02） */
const MEMBER_CAP = 6;

// 6 位加入码字母表：去掉易混淆的 I/L/O/0/1
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// 与其余纯内存数据不同：所有权若不落盘，server 重启后任意先打开分享页的手机
// 都会抢到 owner，成员也被清空，故注册表单独持久化为一个小 JSON。
// FAMILY_DATA_FILE 仅供契约测试隔离数据用（缺省为仓库内 data/family.json）
const DATA_FILE = process.env.FAMILY_DATA_FILE
  || join(dirname(fileURLToPath(import.meta.url)), '../../data/family.json');

/** 业务错误：错误中间件统一渲染为 `{ code, message }` + 对应 HTTP 状态。
 *  code 缺省时按状态码取默认映射；跨状态码的原因（加入码/邀请码失效）显式传参 */
export class FamilyError extends ApiError {}

const genToken = () => randomUUID().replace(/-/g, '');
const genCode = () => {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
};
const isExpired = (item) => Date.now() >= item.expiresAt;

class FamilyStore {
  constructor() {
    /** 家庭注册表：owner + members(≤6，不含 owner) + 待确认 invites + 当前扫码加入码 */
    this.registry = { owner: null, members: [], invites: [], joinCode: null };
    this._load();
  }

  /** 所有者认领（先到先得）。幂等：同一 token 重复认领直接返回成功 */
  claim(token, name) {
    const { owner } = this.registry;
    if (owner) {
      if (owner.token === token) return owner;
      throw new FamilyError(409, '该家庭已被其他手机认领');
    }
    const claimed = { token, name, claimedAt: Date.now() };
    this.registry.owner = claimed;
    this._persist();
    return claimed;
  }

  /** 按 token 鉴权 → { role:'owner' } | { role:'member', member } */
  auth(token) {
    if (token && this.registry.owner?.token === token) {
      return { role: 'owner' };
    }
    const member = this.registry.members.find(m => m.token === token);
    if (member) {
      return { role: 'member', member };
    }
    throw new FamilyError(401, '请先配对认领或扫码加入家庭共享');
  }

  /** 角色感知的成员总览；member 不可见待确认邀请（P-02 只读，管理是 owner 的事） */
  overview(auth) {
    this._pruneInvites();
    const { owner, members, invites } = this.registry;
    const base = {
      role: auth.role,
      ownerName: owner?.name || '',
      members: members.map(({ id, name, joinedAt }) => ({ id, name, joinedAt })),
      quota: { used: members.length, max: MEMBER_CAP },
    };
    if (auth.role === 'owner') {
      return { ...base, invites: invites.map(({ id, name, createdAt, expiresAt }) => ({ id, name, createdAt, expiresAt })) };
    }
    return {
      ...base,
      self: { id: auth.member.id, name: auth.member.name, joinedAt: auth.member.joinedAt },
    };
  }

  /** 取当前扫码加入码：有效期内复用同一个码，过期才换新（避免家人正扫着码失效） */
  getOrCreateJoinCode() {
    this._pruneInvites();
    const { joinCode } = this.registry;
    if (joinCode && !isExpired(joinCode)) {
      return joinCode;
    }
    const fresh = { code: genCode(), expiresAt: Date.now() + JOIN_CODE_TTL_MS };
    this.registry.joinCode = fresh;
    this._persist();
    return fresh;
  }

  /** 免确认扫码加入（设计稿 19：家人主动扫码视为主动加入） */
  joinByCode(code, name) {
    this._pruneInvites();
    const { joinCode } = this.registry;
    if (!joinCode || joinCode.code !== code || isExpired(joinCode)) {
      // 状态码不变（历史口径），由业务码区分「码失效」：与 404 的邀请失效同因不同径
      throw new FamilyError(400, '二维码已失效，请让家人重新生成', 'JOIN_CODE_EXPIRED');
    }
    return this._addMember(name);
  }

  /** 所有者发起邀请（需对方确认），返回 pending 记录 */
  createInvite(name) {
    this._pruneInvites();
    const { members, invites } = this.registry;
    if (members.length + invites.length >= MEMBER_CAP) {
      throw new FamilyError(409, '成员已满（最多 6 位家人）');
    }
    const invite = {
      id: genToken().slice(0, 8),
      code: genCode(),
      name,
      createdAt: Date.now(),
      expiresAt: Date.now() + INVITE_TTL_MS,
    };
    this.registry.invites.push(invite);
    this._persist();
    return invite;
  }

  /** 撤销待确认邀请（设计稿 19：「待确认邀请可点击成员行撤销」） */
  revokeInvite(id) {
    const idx = this.registry.invites.findIndex(i => i.id === id);
    if (idx === -1) {
      throw new FamilyError(404, '邀请不存在或已处理');
    }
    this.registry.invites.splice(idx, 1);
    this._persist();
  }

  /** 被邀请方凭邀请码接受（码即鉴权），转正为成员 */
  acceptInvite(code) {
    this._pruneInvites();
    const invite = this.registry.invites.find(i => i.code === code);
    if (!invite) {
      // 状态码不变（历史口径），由业务码区分「码失效」：与 400 的二维码失效同因不同径
      throw new FamilyError(404, '邀请已失效，请联系家人重新邀请', 'JOIN_CODE_EXPIRED');
    }
    this.registry.invites = this.registry.invites.filter(i => i !== invite);
    const member = this._addMember(invite.name);
    return { member, inviteName: invite.name };
  }

  /** 移除成员。owner 可移除任意成员；member 仅可移除自己（退出共享，E-13） */
  removeMember(id, auth) {
    if (auth.role === 'member' && auth.member.id !== id) {
      throw new FamilyError(403, '成员仅可退出自己的共享');
    }
    const member = this.registry.members.find(m => m.id === id);
    if (!member) {
      throw new FamilyError(404, '成员不存在');
    }
    this.registry.members = this.registry.members.filter(m => m !== member);
    this._persist();
    return member;
  }

  /** 解散家庭注册表（解除配对联动，E-14：所有分享关系同步失效） */
  dissolve() {
    this.registry = { owner: null, members: [], invites: [], joinCode: null };
    this._persist();
  }

  _addMember(name) {
    if (this.registry.members.length >= MEMBER_CAP) {
      throw new FamilyError(409, '成员已满（最多 6 位家人）');
    }
    const member = {
      id: genToken().slice(0, 8),
      token: genToken(),
      name,
      joinedAt: Date.now(),
    };
    this.registry.members.push(member);
    this._persist();
    return member;
  }

  _pruneInvites() {
    const before = this.registry.invites.length;
    this.registry.invites = this.registry.invites.filter(i => !isExpired(i));
    if (this.registry.invites.length !== before) {
      this._persist();
    }
  }

  _persist() {
    try {
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      const tmp = `${DATA_FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.registry, null, 2));
      renameSync(tmp, DATA_FILE);
    } catch (err) {
      console.error('[FamilyStore] persist failed:', err.message);
    }
  }

  _load() {
    try {
      const raw = readFileSync(DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        this.registry = {
          owner: data.owner ?? null,
          members: Array.isArray(data.members) ? data.members : [],
          invites: Array.isArray(data.invites) ? data.invites : [],
          joinCode: data.joinCode ?? null,
        };
      }
    } catch {
      // 首次运行或文件损坏：从空注册表开始
    }
  }
}

export const familyStore = new FamilyStore();
