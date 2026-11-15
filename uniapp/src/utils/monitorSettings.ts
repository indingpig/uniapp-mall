import { CACHE_KEY } from '@/constants/cache';

/**
 * 监控设置（本地持久化，后端暂无对应接口）——设置页与设备详情页（规范 5.5
 * 监测设置卡）共用同一份偏好，读写都走这里，避免两页各自维护键名漂移。
 *
 * 多观众口径：这是「本机偏好」（每个家庭成员自己的提醒偏好），不是设备级
 * 配置；设备级灵敏度下发待 todo-产品 P2-10 立项后再迁移。
 */
export interface MonitorSettings {
  /** 哭声提醒（crying 事件本地通知） */
  cryAlert: boolean;
  /** 状态变化提醒（规范 5.5 新增，提醒行为待通知策略定稿后接线） */
  stateChangeAlert: boolean;
  /** 灵敏度档位文案（detector 侧阈值目前写死，档位联动待 P2-10） */
  sensitivity: string;
  /** 提醒音量 */
  alertVolume: string;
  /** 推送通知（含系统授权引导，见设置页 onPushNotifyChange） */
  pushNotify: boolean;
  /**
   * 离线警告推送（设计定义补全 D-02/Q-01，规范 5 节 05 屏新增行）：
   * 成员级各自生效，默认开；关闭后该成员不再接收 A-04/A-05 离线推送，
   * 不影响哭闹推送、不影响 App 内离线提示条。推送通道（厂商/APNs）落地前
   * 本开关仅持久化偏好，接线点在通知发送侧。
   */
  offlinePushEnabled: boolean;
}

export const SENSITIVITY_OPTIONS = ['低', '中等', '高'];

export const DEFAULT_MONITOR_SETTINGS: MonitorSettings = {
  cryAlert: true,
  stateChangeAlert: false,
  sensitivity: '中等',
  alertVolume: '70%',
  pushNotify: true,
  offlinePushEnabled: true,
};

/** 读取监控设置：损坏数据/首启回默认值；旧记录缺新键（如 stateChangeAlert）自动补默认 */
export function loadMonitorSettings(): MonitorSettings {
  try {
    const saved = uni.getStorageSync(CACHE_KEY.MONITOR_SETTINGS);
    if (saved && typeof saved === 'object')
      return { ...DEFAULT_MONITOR_SETTINGS, ...saved };
  }
  catch { /* 忽略损坏的本地数据 */ }
  return { ...DEFAULT_MONITOR_SETTINGS };
}

/** 持久化监控设置（存储失败不阻塞 UI） */
export function persistMonitorSettings(settings: MonitorSettings): void {
  try {
    uni.setStorageSync(CACHE_KEY.MONITOR_SETTINGS, { ...settings });
  }
  catch { /* 存储失败不阻塞 UI */ }
}
