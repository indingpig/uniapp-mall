/**
 * 导航栏样式配置
 *
 * 与 pages.config.ts 中的 globalStyle.navigationStyle 保持同步。
 * useCapsuleGap 也会读取此值来决定是否需要胶囊避让。
 *
 * 'custom'  — 自定义导航栏，胶囊浮在页面内容上方，需要计算避让高度
 * 'default' — 原生导航栏，系统自动处理胶囊位置，无需额外避让
 */
export const NAVIGATION_STYLE: 'custom' | 'default' = 'custom';
