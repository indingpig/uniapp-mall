/**
 * 宝宝状态语义配置（设计规范 v1.1 第 6 节终版 5 态 + 12.1 离线变体）
 *
 * 状态机：主状态两态切换 sleep ⇄ awake（音量阈值 + 时长窗口判定）；
 * noise / cry 为事件层，不改变主状态，以事件形式进时间线。
 * 状态切换事件（「开始安睡」「开始清醒」）同样写入时间线。
 *
 * 双轴取色（规范第 6 节，勿混淆）：
 * - STATUS_META.color = 状态语义色（标题色轴）
 * - ACTION_BADGES.tone = 动作级别色（绿=仅记录、琥珀=记录+事件、红=立即推送）
 * 表情双轨制（第 1 节）：face 为首页大表情，固定品牌橙 #E8825A（*-orange.svg，
 * 亲和不焦虑）；事件流/图例小图标随状态语义色（EVENT_META）。
 * 色值与 styles/uni.scss 的状态 token 保持一致（TS 侧无法引用 SCSS 变量，改动需两边同步）。
 */

/** 设计终版 5 态（规范第 6 节） */
export type BabyState = 'sleep' | 'awake' | 'active' | 'noise' | 'cry';

/** 状态卡 / 事件流可用键 = 5 态 + 设备离线（离线是设备级 UI 态，不参与状态机） */
export type CardState = BabyState | 'offline';

/** 服务端状态字符串（api/baby.ts 的 BabyStatusData['status']）→ 设计终版枚举 */
export function toCardState(wire: string): CardState {
  switch (wire) {
    case 'sleeping':
      return 'sleep';
    case 'awake':
      return 'awake';
    case 'playing':
      return 'active';
    case 'crying':
      return 'cry';
    case 'noise':
      return 'noise';
    default:
      return 'offline';
  }
}

export interface StatusMeta {
  /** 状态标题文案 */
  text: string;
  /** 标题/强调色（状态语义色轴） */
  color: string;
  /** 首页大表情（品牌橙变体，静态资源见 src/static/icons） */
  face: string;
}

export const STATUS_META: Record<CardState, StatusMeta> = {
  sleep: { text: '正在安睡', color: '#55823F', face: '/static/icons/face-sleep-orange.svg' },
  awake: { text: '清醒中', color: '#D99A3D', face: '/static/icons/face-awake-orange.svg' },
  active: { text: '清醒活跃', color: '#E8825A', face: '/static/icons/face-active.svg' },
  noise: { text: '有动静', color: '#8C8578', face: '/static/icons/face-pulse.svg' },
  cry: { text: '正在哭泣', color: '#D96A5B', face: '/static/icons/face-cry-orange.svg' },
  offline: { text: '设备离线', color: '#8C8578', face: '/static/icons/face-sleep-offline.svg' },
};

/** 状态 → 动作级别徽章（Pill 的 tone），离线态无动作徽章 */
export const ACTION_BADGES: Record<BabyState, { text: string; tone: 'green' | 'amber' | 'red' }> = {
  sleep: { text: '仅记录', tone: 'green' },
  awake: { text: '仅记录', tone: 'green' },
  active: { text: '记录+事件', tone: 'amber' },
  noise: { text: '记录+事件', tone: 'amber' },
  cry: { text: '立即推送', tone: 'red' },
};

/** 状态变化事件的图标/配色（首页「今日事件」时间线，小图标随状态语义色） */
export const EVENT_META: Record<
  CardState,
  { icon: 'moon' | 'eye' | 'activity' | 'droplet' | 'wifi-off'; color: string; chipBg: string; title: string }
> = {
  sleep: { icon: 'moon', color: '#55823F', chipBg: '#E9F0E1', title: '开始安睡' },
  awake: { icon: 'eye', color: '#D99A3D', chipBg: '#F7EBD4', title: '开始清醒' },
  active: { icon: 'activity', color: '#E8825A', chipBg: '#FBE7DE', title: '清醒活跃' },
  noise: { icon: 'activity', color: '#8C8578', chipBg: '#EDE6D8', title: '有动静' },
  cry: { icon: 'droplet', color: '#D96A5B', chipBg: '#F8E3DE', title: '哭声提醒' },
  offline: { icon: 'wifi-off', color: '#8C8578', chipBg: '#EDE6D8', title: '设备离线' },
};

/**
 * 实时音量映射（设计规范 v1.1 第 7 节）
 *
 * 音量% = clamp((dB − MIN) / (90 − MIN), 0, 1)
 * MIN = 30（未校准）；开底噪校准后 MIN = max(30, N + 5)（N = 安装时采集的环境底噪基线）
 * 显示值 < MIN 视为环境底噪（真实环境不存在 0 dB）：空条 + 文案「安静」；
 * 「静音」专指用户设置的提醒开关，勿混用；仅离线/无数据时显示「-- dB」
 */
export const VOLUME_MIN_DB = 30;
export const VOLUME_MAX_DB = 90;
export const QUIET_HINT = '安静';

export interface VolumeZone {
  /** 本区间的上界（音量百分比，0-100；60/80 与提醒策略联动） */
  max: number;
  /** dB 数值取色 */
  color: string;
  /** 分区底色 */
  soft: string;
  hint: string;
}

export const VOLUME_ZONES: VolumeZone[] = [
  { max: 60, color: '#7BA05B', soft: '#DDE9D3', hint: '音量正常范围内' },
  { max: 80, color: '#D99A3D', soft: '#F2E3C8', hint: '音量偏高，请留意' },
  { max: 100, color: '#D96A5B', soft: '#F5D9D3', hint: '检测到哭声，请及时安抚' },
];
