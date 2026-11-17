import { Router } from 'express';
import { FamilyError } from '../services/familyStore.js';

/** 称呼统一收敛：去空白、限 12 字、兜底「家人」 */
const sanitizeName = (raw) => {
  const name = String(raw ?? '').trim().slice(0, 12);
  return name || '家人';
};

/**
 * 家庭共享路由（设计定义补全 P-08 / S-07）：
 * 所有者认领 → 扫码免确认加入 / 邀请需确认 → 成员管理（移除/撤销/退出）→ 解散
 * 错误约定自本文件起建立：`{ code: 1, message: '中文文案' }` + 400/401/403/404/409
 */
export function createFamilyRoutes(familyStore, notifyFamilyChanged) {
  const router = Router();

  // 同步错误 → 业务响应包装（FamilyError 之外的原样抛出，交给 Express 兜底）
  const h = fn => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof FamilyError) {
        res.status(err.status).json({ code: 1, message: err.message });
        return;
      }
      throw err;
    }
  };

  const auth = (req) => familyStore.auth(req.headers['x-family-token']);

  /** 所有者认领：已配对手机首次进入分享页时调用，先到先得 */
  router.post('/claim', h((req, res) => {
    const { token, name } = req.body || {};
    if (!token) {
      throw new FamilyError(400, '缺少认领凭证');
    }
    const owner = familyStore.claim(String(token), sanitizeName(name));
    res.json({ code: 0, data: { role: 'owner', ownerName: owner.name } });
  }));

  /** 成员总览：owner 含待确认邀请；member 含 self，不含邀请 */
  router.get('/overview', h((req, res) => {
    res.json({ code: 0, data: familyStore.overview(auth(req)) });
  }));

  /** 生成/取当前扫码加入码（5 分钟内复用同一码） */
  router.post('/join-code', h((req, res) => {
    if (auth(req).role !== 'owner') {
      throw new FamilyError(403, '仅所有者可生成加入二维码');
    }
    const { code, expiresAt } = familyStore.getOrCreateJoinCode();
    res.json({ code: 0, data: { code, expiresAt } });
  }));

  /** 免确认扫码加入 */
  router.post('/join', h((req, res) => {
    const { code, name } = req.body || {};
    if (!code) {
      throw new FamilyError(400, '缺少加入码');
    }
    const member = familyStore.joinByCode(String(code).toUpperCase(), sanitizeName(name));
    notifyFamilyChanged?.({ action: 'added', memberId: member.id });
    res.json({ code: 0, data: { token: member.token, member: { id: member.id, name: member.name, joinedAt: member.joinedAt } } });
  }));

  /** 所有者发起邀请（需对方确认） */
  router.post('/invites', h((req, res) => {
    if (auth(req).role !== 'owner') {
      throw new FamilyError(403, '仅所有者可邀请成员');
    }
    const { name } = req.body || {};
    const invite = familyStore.createInvite(sanitizeName(name));
    res.json({
      code: 0,
      data: { id: invite.id, code: invite.code, name: invite.name, expiresAt: invite.expiresAt },
    });
  }));

  /** 撤销待确认邀请 */
  router.delete('/invites/:id', h((req, res) => {
    if (auth(req).role !== 'owner') {
      throw new FamilyError(403, '仅所有者可撤销邀请');
    }
    familyStore.revokeInvite(req.params.id);
    res.json({ code: 0, data: null });
  }));

  /** 被邀请方凭码接受邀请（码即鉴权） */
  router.post('/invites/:code/accept', h((req, res) => {
    const { member } = familyStore.acceptInvite(String(req.params.code).toUpperCase());
    notifyFamilyChanged?.({ action: 'added', memberId: member.id });
    res.json({ code: 0, data: { token: member.token, member: { id: member.id, name: member.name, joinedAt: member.joinedAt } } });
  }));

  /** 移除成员：owner 移除任意成员；member 移除自己 = 退出共享（E-13） */
  router.delete('/members/:id', h((req, res) => {
    const a = auth(req);
    const removed = familyStore.removeMember(req.params.id, a);
    notifyFamilyChanged?.({ action: 'removed', memberId: removed.id });
    res.json({ code: 0, data: null });
  }));

  /** 解散家庭共享（解除配对联动，E-14） */
  router.delete('/', h((req, res) => {
    if (auth(req).role !== 'owner') {
      throw new FamilyError(403, '仅所有者可解散家庭共享');
    }
    familyStore.dissolve();
    notifyFamilyChanged?.({ action: 'dissolved' });
    res.json({ code: 0, data: null });
  }));

  return router;
}
