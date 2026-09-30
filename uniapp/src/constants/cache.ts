export const CACHE_KEY = {
  TOKEN: 'UNI_MALL_TOKEN',
  USER_INFO: 'UNI_MALL_USER_INFO',
  /** 监控设置（哭声提醒/灵敏度/提醒音量/推送通知） */
  MONITOR_SETTINGS: 'BABY_MONITOR_SETTINGS',
  /** 是否已配对过设备（首页首次空态判定，设计稿 08） */
  PAIRED_DEVICE: 'BABY_PAIRED_DEVICE',
  /** TabBar 上一次激活的 tab key（用于高亮滑块的移动方向） */
  TABBAR_PREV: 'BABY_TABBAR_PREV',
} as const;
