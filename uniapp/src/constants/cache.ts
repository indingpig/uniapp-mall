export const CACHE_KEY = {
  TOKEN: 'UNI_MALL_TOKEN',
  USER_INFO: 'UNI_MALL_USER_INFO',
  /** 监控设置（哭声提醒/灵敏度/提醒音量/推送通知） */
  MONITOR_SETTINGS: 'BABY_MONITOR_SETTINGS',
  /** 是否已配对过设备（首页首次空态判定，设计稿 08） */
  PAIRED_DEVICE: 'BABY_PAIRED_DEVICE',
  /** TabBar 上一次激活的 tab key（用于高亮滑块的移动方向） */
  TABBAR_PREV: 'BABY_TABBAR_PREV',
  /** 采集页: 开发板地址（http://babycry.local 或 IP） */
  COLLECT_BASE_URL: 'BABY_COLLECT_BASE_URL',
  /** 采集页: 每个分类已保存的文件计数（cry_001.wav 的 NNN） */
  COLLECT_COUNTERS: 'BABY_COLLECT_COUNTERS',
  /** 采集页: 分类列表（key 与 Edge Impulse 工程标签名对齐） */
  COLLECT_CATEGORIES: 'BABY_COLLECT_CATEGORIES',
} as const;
