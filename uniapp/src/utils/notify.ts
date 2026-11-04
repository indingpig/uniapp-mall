/**
 * 本地通知（哭声后台提醒）
 *
 * 仅 App 端有通知能力：uni.createPushMessage 创建本地通知栏消息（纯本地，
 * 不依赖个推服务，需 manifest 开启 Push 模块）。H5/小程序无此 API，全部空实现，
 * 「推送通知」开关在那些平台只是存储偏好。
 *
 * 授权判定用 uni 内置 API：uni.getAppAuthorizeSetting().notificationAuthorized
 * （'authorized' | 'denied' | 'not determined' | 'config error'），
 * 引导跳转用 uni.openAppAuthorizeSetting()。Android 13+ 的首次运行时授权
 * 通过 plus.android.requestPermissions 申请（uni 无内置申请 API）。
 *
 * 触发链路：useBabyMonitor 收到进入 crying 的状态转换 → maybeNotifyCry() →
 * App 在后台 + 「哭声提醒」「推送通知」双开 + 距上次通知超过节流窗口才发。
 * 前台时不发系统通知（页面内铃声/状态卡已经承担提醒职责）。
 */

import { CACHE_KEY } from '@/constants/cache';

/** 通知节流窗口：哭声状态可能 noise→cry 反复抖动，60s 内不重复打扰 */
const THROTTLE_MS = 60 * 1000;

let appForeground = true;
let lastCryNotifyAt = 0;

/** App.vue 的 onShow/onHide 调用：后台才发系统通知 */
export function setAppForeground(fg: boolean) {
  appForeground = fg;
}

interface MonitorSettingsLike {
  cryAlert?: boolean;
  pushNotify?: boolean;
}

function readSettings(): MonitorSettingsLike {
  try {
    const saved = uni.getStorageSync(CACHE_KEY.MONITOR_SETTINGS);
    return saved && typeof saved === 'object' ? saved : {};
  }
  catch {
    return {};
  }
}

/** 读取系统通知授权状态（uni 内置 API，App 3.4+） */
function getNotificationAuthorized(): string {
  const res = uni.getAppAuthorizeSetting() as { notificationAuthorized?: string };
  return res?.notificationAuthorized ?? '';
}

/**
 * 系统通知当前是否可用（App 端实时读取；API 不可用/非 App 端返回 true 不阻塞 UI）。
 * 设置页用它让开关如实反映系统状态，maybeNotifyCry 用它做发送前兜底。
 */
export function isNotificationAuthorized(): boolean {
  // #ifdef APP-PLUS
  try {
    const auth = getNotificationAuthorized();
    return auth === '' || auth === 'authorized';
  }
  catch {
    return true;
  }
  // #endif

  // #ifndef APP-PLUS
  return true;
  // #endif
}

/** Android 13+ 的 POST_NOTIFICATIONS 运行时授权弹窗（uni 无内置申请 API，走 plus 桥） */
function requestPostNotifications(): Promise<boolean> {
  // #ifdef APP-PLUS
  return new Promise((resolve) => {
    plus.android.requestPermissions(
      ['android.permission.POST_NOTIFICATIONS'],
      (res: { granted?: boolean[] }) => resolve(!!res?.granted?.[0]),
      () => resolve(false),
    );
  });
  // #endif
}

/** 引导用户去系统设置开启通知；确认并跳转 → true（开关保持打开），取消 → false */
function guideToSystemSettings(): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title: '通知已被系统关闭',
      content: '去系统设置中允许本应用发送通知，才能收到哭声提醒',
      confirmText: '去设置',
      cancelText: '暂不',
      success: ({ confirm }) => {
        if (confirm)
          uni.openAppAuthorizeSetting();
        resolve(!!confirm);
      },
      fail: () => resolve(false),
    });
  });
}

/**
 * 「推送通知」打开时确保通知可用：
 * - authorized → 放行
 * - not determined（Android 13+ 首次开启场景）→ 弹运行时授权，拒绝再引导
 * - denied / config error → 确认框引导跳系统授权设置页（用户确认跳转 → true
 *   保持开关打开；取消 → false 回退开关）
 */
export async function ensureNotificationEnabled(): Promise<boolean> {
  // #ifdef APP-PLUS
  const auth = getNotificationAuthorized();
  if (auth === 'authorized')
    return true;
  if (auth === 'not determined') {
    const granted = await requestPostNotifications();
    if (granted)
      return true;
  }
  return guideToSystemSettings();
  // #endif

  // #ifndef APP-PLUS
  return true;
  // #endif
}

/**
 * 哭声后台通知（含节流与双开关判定）。在状态转换进入 crying 的瞬间调用一次。
 */
export function maybeNotifyCry(): void {
  if (appForeground)
    return;
  if (!isNotificationAuthorized())
    return;

  const { cryAlert, pushNotify } = readSettings();
  // 未显式保存过设置时按默认开启（cryAlert/pushNotify undefined = 用户没动过）
  if (cryAlert === false || pushNotify === false)
    return;

  const now = Date.now();
  if (now - lastCryNotifyAt < THROTTLE_MS)
    return;
  lastCryNotifyAt = now;

  // #ifdef APP-PLUS
  try {
    uni.createPushMessage({
      title: '宝宝哭了',
      content: '检测到哭声，点开看看宝宝的状态',
      payload: { type: 'cry' },
      cover: true, // 覆盖上一条，避免通知栏堆积
    });
  }
  catch (e) {
    console.warn('[notify] createPushMessage failed', e);
  }
  // #endif
}
