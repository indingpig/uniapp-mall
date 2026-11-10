/**
 * 全局颜色常量 —— TS 侧唯一色源（getIcon、行内 :style、图表配色等）
 *
 * 与 styles/uni.scss 同源（设计规范 v1.1 画布真值）：SCSS 用 $color-* token，
 * TS 用这里的语义名，改动需两边同步。JS 读不到 SCSS 变量，此前模板/脚本里
 * 散落的硬编码 hex 统一收敛到这里。
 *
 * 标注「规范未收录」的三项（dangerInk/empty/disabled）是页面临时色，规范
 * 更新后应归位为正式 token 并在 uni.scss 补同名变量。
 */
export const colors = {
  /* 主色（green 系） */
  primary: '#7BA05B',
  primarySoft: '#E9F0E1',
  primaryDeep: '#55823F',

  /* 状态语义色 */
  amber: '#D99A3D',
  amberSoft: '#F7EBD4',
  amberInk: '#B07A28',
  danger: '#D96A5B',
  dangerSoft: '#F8E3DE', // 浅红底（哭声提醒图标底/错误行/危险提示）
  dangerInk: '#B84A3C', // 规范未收录：统计哭闹柱选中态深红
  coral: '#D96A5B',
  warmGray: '#8C8578',

  /* 品牌表情色 */
  orange: '#E8825A',
  orangeSoft: '#FBE7DE', // 清醒活跃事件图标底（规范画布 .lgc）
  gold: '#F2C14E',
  teal: '#8FB8D8',

  /* 背景与卡片 */
  bg: '#F4EDE1',
  card: '#FFFFFF',
  cardSoft: '#EDE6D8',

  /* 文字（暖墨色系） */
  ink: '#3B362E',
  secondary: '#8C8578',
  muted: '#B3AB9D',
  inkGroup: '#6E675B',

  /* 描边与分割线 */
  divider: '#F2EDE2',
  border: '#EBE3D4',
  borderBtn: '#E5DECF',

  white: '#FFFFFF',

  /* 音量条三分区（与 babyStatus.ts VOLUME_ZONES 同值） */
  zone1: '#DDE9D3',
  zone2: '#F2E3C8',
  zone3: '#F5D9D3',

  /* 规范未收录的页面临时色 */
  empty: '#D5CFC2', // 空态大图标（比 muted 更浅一档）
  disabled: '#A39B8C', // 12.1 禁用变体的图标/文字
} as const;

export type ColorName = keyof typeof colors;
