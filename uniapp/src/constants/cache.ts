export const CACHE_KEY = {
  /** 监控设置（哭声提醒/灵敏度/提醒音量/推送通知） */
  MONITOR_SETTINGS: 'BABY_MONITOR_SETTINGS',
  /** 是否已配对过设备（首页首次空态判定，设计稿 08） */
  PAIRED_DEVICE: 'BABY_PAIRED_DEVICE',
  /** 上次配对成功的服务器地址（配对页「高级设置」预填，规范 5.4） */
  PAIRED_SERVER_URL: 'BABY_PAIRED_SERVER_URL',
  /**
   * 设备令牌（2026-11-26 鉴权）：配网时写入板子 NVS，板子连 server 时携带。
   * 注意：这是**设备**凭证，与家人 token 分开，可单独轮换。
   */
  DEVICE_TOKEN: 'BABY_DEVICE_TOKEN',
  /** 设备重命名的本机昵称（设备详情页导航行「重命名」，规范 5.5；空=显示配对设备名） */
  DEVICE_NAME_OVERRIDE: 'BABY_DEVICE_NAME_OVERRIDE',
  /** 首页铃铛红点已读时刻（规范 S-06：今日最新事件时间戳 > 此值即点亮红点） */
  BELL_READ_AT: 'BABY_BELL_READ_AT',
  /** 统计/首页 → 历史页「定位到某日」下钻信号（一次性，目标页读取后即清除；值为本地日期键 YYYY-MM-DD） */
  STATS_DRILL_DATE: 'BABY_STATS_DRILL_DATE',
  /** TabBar 上一次激活的 tab key（用于高亮滑块的移动方向） */
  TABBAR_PREV: 'BABY_TABBAR_PREV',
  /** 采集页: 开发板地址（http://babycry.local 或 IP） */
  COLLECT_BASE_URL: 'BABY_COLLECT_BASE_URL',
  /** 采集页: 每个分类已保存的文件计数（cry_001.wav 的 NNN） */
  COLLECT_COUNTERS: 'BABY_COLLECT_COUNTERS',
  /** 采集页: 分类列表（key 与 Edge Impulse 工程标签名对齐） */
  COLLECT_CATEGORIES: 'BABY_COLLECT_CATEGORIES',
  /** 家庭共享·所有者凭证（首次进入分享页时本地生成并向 server 认领，先到先得） */
  FAMILY_OWNER: 'BABY_FAMILY_OWNER',
  /** 家庭共享·成员身份（扫码/受邀加入成功后由 server 签发） */
  FAMILY_MEMBER: 'BABY_FAMILY_MEMBER',
  /** 电池优化白名单是否已自动引导过（一次性，避免每次开 App 都弹系统授权） */
  BATTERY_PROMPT_DONE: 'BABY_BATTERY_PROMPT_DONE',
  /** 账号登录凭证（2026-11-28 登录/注册页预留；账号体系接入流程前仅保存不参与鉴权） */
  AUTH_TOKEN: 'BABY_AUTH_TOKEN',
} as const;
