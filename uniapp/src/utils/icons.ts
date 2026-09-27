/**
 * 集中管理所有 SVG 图标字符串（单色，统一 currentColor 换色）
 * 通过 base64 data URI 方式渲染，兼容 H5 / 小程序 / APP
 *
 * 图标来源：uniapp/disign/宝宝监控App-图标库/（设计规范 v1.1 第 9 节交付实体）
 * 本文件由 scripts/gen-icons.mjs 生成，勿手改 —— 图标库更新后重跑脚本
 *
 * 为什么不直接用 encodeURIComponent:
 *   - encodeURIComponent 会把 SVG 内的 `#ffffff` 编码为 `%23ffffff`，
 *     这个字面值出现在 SVG 的 fill 属性里，解析器看到的是 `%23ffffff`，
 *     颜色失效，整张图标可能直接不显示。
 *   - base64 编码只是把整段 SVG 包装成合法的 data URI 语法，
 *     不会改变 SVG 内部内容，浏览器 / 小程序解码后仍能正确解析。
 */
export type IconKey
  = | 'activity'
    | 'bar-chart'
    | 'battery'
    | 'bell-off'
    | 'bell'
    | 'bluetooth-off'
    | 'bluetooth'
    | 'chevron-left'
    | 'chevron-right'
    | 'clock-empty'
    | 'clock'
    | 'download'
    | 'droplet'
    | 'eye'
    | 'gear'
    | 'home'
    | 'mic'
    | 'moon'
    | 'plus'
    | 'radar'
    | 'search'
    | 'signal-bars'
    | 'signal-off'
    | 'spinner'
    | 'stop'
    | 'wifi-off'
    | 'wifi-signal'
    | 'wifi';

const ICONS: Record<IconKey, string> = {
  'activity':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  'bar-chart':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="6" y1="20" x2="6" y2="13" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="12" y1="20" x2="12" y2="4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="18" y1="20" x2="18" y2="9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',

  'battery':
    '<svg width="25" height="14" viewBox="0 0 25 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0.75" y="0.75" width="20.5" height="12.5" rx="3.5" stroke="currentColor" stroke-width="1.5"/><rect x="2.5" y="2.5" width="13" height="9" rx="2" fill="currentColor"/><path d="M23 5V9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',

  'bell-off':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 8a6 6 0 0 0-9.33-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',

  'bell':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',

  'bluetooth-off':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 7l10 10-5 5V2l5 5L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',

  'bluetooth':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 7l10 10-5 5V2l5 5L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  'chevron-left':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  'chevron-right':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  'clock-empty':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  'clock':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  'download':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',

  'droplet':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',

  'eye':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>',

  'gear':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  'home':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  'mic':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" stroke-width="2"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 19v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',

  'moon':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  'plus':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',

  'radar':
    '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="3" fill="currentColor"/><path d="M8.8 8.8a7.4 7.4 0 0 0 0 10.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19.2 8.8a7.4 7.4 0 0 1 0 10.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5.4 5.4a12 12 0 0 0 0 17.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/><path d="M22.6 5.4a12 12 0 0 1 0 17.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/></svg>',

  'search':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',

  'signal-bars':
    '<svg width="18" height="14" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="9" width="3" height="5" rx="1" fill="currentColor"/><rect x="5" y="6" width="3" height="8" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="11" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="14" rx="1" fill="currentColor"/></svg>',

  'signal-off':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12.55a11 11 0 0 1 14.08 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="19.5" r="1.4" fill="currentColor"/><line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',

  'spinner':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3a9 9 0 1 1-9 9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',

  'stop':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',

  'wifi-off':
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12.55a11 11 0 0 1 14.08 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M1.42 9a16 16 0 0 1 21.16 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',

  'wifi-signal':
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12.55a11 11 0 0 1 14.08 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="19.5" r="1.4" fill="currentColor"/></svg>',

  'wifi':
    '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 4.5C4.6 1.2 11.4 1.2 15 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 7.5C6 5.3 10 5.3 12.5 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 10.4C7.2 9.4 8.8 9.4 10 10.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="12.8" r="1.1" fill="currentColor"/></svg>',
};

/**
 * 将字符串做 UTF-8 -> base64 编码，兼容浏览器与 Node 环境
 */
function utf8ToBase64(s: string): string {
  if (typeof btoa !== 'undefined') {
    return btoa(unescape(encodeURIComponent(s)));
  }
  // 纯 JS 实现，兼容小程序等无 btoa / Buffer 的环境
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const str = unescape(encodeURIComponent(s));
  let output = '';
  let i = 0;
  while (i < str.length) {
    const a = str.charCodeAt(i++);
    const b = str.charCodeAt(i++);
    const c = str.charCodeAt(i++);
    const i1 = a >> 2;
    const i2 = ((a & 3) << 4) | (b >> 4);
    const i3 = ((b & 15) << 2) | (c >> 6);
    const i4 = c & 63;
    if (Number.isNaN(b)) {
      output += `${chars.charAt(i1) + chars.charAt(i2)}==`;
    }
    else if (Number.isNaN(c)) {
      output += `${chars.charAt(i1) + chars.charAt(i2) + chars.charAt(i3)}=`;
    }
    else {
      output += chars.charAt(i1) + chars.charAt(i2) + chars.charAt(i3) + chars.charAt(i4);
    }
  }
  return output;
}

/**
 * 获取图标的 base64 data URI
 * @param name   图标名
 * @param color  可选：替换 SVG 中的 currentColor（配合 BaseIcon 的 color prop）
 */
export function getIcon(name: IconKey, color?: string): string {
  const raw = color ? ICONS[name].replace(/currentColor/g, color) : ICONS[name];
  return `data:image/svg+xml;base64,${utf8ToBase64(raw)}`;
}
