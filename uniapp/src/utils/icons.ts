/**
 * 集中管理所有 SVG 图标字符串
 * 通过 base64 data URI 方式渲染，兼容 H5 / 小程序 / APP
 *
 * 为什么不直接用 encodeURIComponent:
 *   - encodeURIComponent 会把 SVG 内的 `#ffffff` 编码为 `%23ffffff`，
 *     这个字面值出现在 SVG 的 fill 属性里，解析器看到的是 `%23ffffff`，
 *     颜色失效，整张图标可能直接不显示。
 *   - base64 编码只是把整段 SVG 包装成合法的 data URI 语法，
 *     不会改变 SVG 内部内容，浏览器 / 小程序解码后仍能正确解析。
 */
export type IconKey
  = | 'signal'
    | 'wifi'
    | 'battery'
    | 'face-cry'
    | 'lock'
    | 'home'
    | 'clock'
    | 'chart'
    | 'gear';

const ICONS: Record<IconKey, string> = {
  // iOS 顶部状态栏 —— 信号
  'signal':
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="12" viewBox="0 0 18 12" fill="none">'
    + '<rect x="0"  y="9" width="3" height="3"  rx="0.6" fill="currentColor"/>'
    + '<rect x="5"  y="6" width="3" height="6"  rx="0.6" fill="currentColor"/>'
    + '<rect x="10" y="3" width="3" height="9"  rx="0.6" fill="currentColor"/>'
    + '<rect x="15" y="0" width="3" height="12" rx="0.6" fill="currentColor"/>'
    + '</svg>',

  // iOS 顶部状态栏 —— WiFi
  'wifi':
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12" viewBox="0 0 16 12" fill="none">'
    + '<path d="M8 11.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="currentColor"/>'
    + '<path d="M3 7.2a7 7 0 0 1 10 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>'
    + '<path d="M0.5 4.2a10.5 10.5 0 0 1 15 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>'
    + '</svg>',

  // iOS 顶部状态栏 —— 电池
  'battery':
    '<svg xmlns="http://www.w3.org/2000/svg" width="27" height="14" viewBox="0 0 27 14" fill="none">'
    + '<rect x="0.5" y="0.5" width="23" height="13" rx="3" stroke="currentColor" stroke-opacity="0.5" fill="none"/>'
    + '<rect x="25"  y="4"   width="2"  height="6"  rx="1" fill="currentColor" fill-opacity="0.5"/>'
    + '<rect x="2"   y="2"   width="20" height="10" rx="1.5" fill="currentColor"/>'
    + '</svg>',

  // 当前状态 —— 笑脸（设计稿里配文是「正在哭泣」，但视觉是笑脸）
  'face-cry':
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" fill="none">'
    + '<circle cx="60" cy="60" r="54" stroke="#d8896a" stroke-width="4" fill="none"/>'
    + '<circle cx="44" cy="52" r="4.5" fill="#d8896a"/>'
    + '<circle cx="76" cy="52" r="4.5" fill="#d8896a"/>'
    + '<path d="M40 78 Q60 96 80 78" stroke="#d8896a" stroke-width="4" stroke-linecap="round" fill="none"/>'
    + '</svg>',

  // 设备卡片 —— 锁
  'lock':
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">'
    + '<path d="M10 14v-3a6 6 0 1 1 12 0v3" stroke="#7ea279" stroke-width="2.4" stroke-linecap="round" fill="none"/>'
    + '<rect x="6" y="14" width="20" height="14" rx="2.5" stroke="#7ea279" stroke-width="2.4" fill="none"/>'
    + '<circle cx="16" cy="20" r="1.6" fill="#7ea279"/>'
    + '<path d="M16 21.5v3" stroke="#7ea279" stroke-width="2.2" stroke-linecap="round"/>'
    + '</svg>',

  // 底部 Tab —— 首页（房子）
  'home':
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">'
    + '<path d="M3 11.2L12 4l9 7.2V20a1 1 0 0 1-1 1h-4v-6h-8v6H4a1 1 0 0 1-1-1v-8.8Z" '
    + 'stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>'
    + '</svg>',

  // 底部 Tab —— 历史（时钟）
  'clock':
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">'
    + '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" fill="none"/>'
    + '<path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>'
    + '</svg>',

  // 底部 Tab —— 统计（柱状图）
  'chart':
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">'
    + '<path d="M5 20V13" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
    + '<path d="M12 20V8"  stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
    + '<path d="M19 20V4"  stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
    + '</svg>',

  // 底部 Tab —— 设置（齿轮）
  'gear':
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">'
    + '<circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.6" fill="none"/>'
    + '<path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" '
    + 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
    + '</svg>',
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
    if (isNaN(b)) {
      output += `${chars.charAt(i1) + chars.charAt(i2)}==`;
    }
    else if (isNaN(c)) {
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
 * @param color  可选：替换 SVG 中的 currentColor（用于 Tab 颜色切换）
 */
export function getIcon(name: IconKey, color?: string): string {
  const raw = color ? ICONS[name].replace(/currentColor/g, color) : ICONS[name];
  return `data:image/svg+xml;base64,${utf8ToBase64(raw)}`;
}
